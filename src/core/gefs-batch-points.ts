import { homedir } from "node:os";
import { join } from "node:path";
import { sortGefsMembers, type GefsMember } from "../catalog/gefs.js";
import { VARIABLE_CATALOG, type RawVariableDefinition } from "../catalog/variables.js";
import {
  GefsS3SubsetCache,
  type GefsMemberSource,
} from "../cache/gefs-s3-subset-cache.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import {
  gefsBatchPointsQuerySchema,
  gefsBatchPointsResultSchema,
  type GefsBatchPointsQueryInput,
  type GefsBatchPointsResult,
} from "../schema/gefs-batch-points.js";
import type { PointCoordinate } from "../schema/query.js";
import type { DecodedValue } from "./types.js";
import { mapConcurrent } from "./concurrency.js";
import { summarizeNumericDistribution, thresholdGteSummary } from "./ensemble-statistics.js";
import { DEFAULT_GEFS_MEMBER_CONCURRENCY, type GefsPointDecoder } from "./gefs-ensemble.js";
import { GefsLatestRunResolver, type GefsLatestRunProvider } from "./gefs-latest-run.js";
import { gefsForecastHour, parseGefsRun } from "./gefs-time.js";

interface MemberPointSample {
  requestedPoint: PointCoordinate;
  gridPoint: PointCoordinate;
  value: number;
}

interface MemberBatchSample {
  member: GefsMember;
  cacheHit: boolean;
  points: MemberPointSample[];
}

export interface GefsBatchPointsServiceOptions {
  cacheDir?: string;
  wgrib2Path?: string;
  source?: GefsMemberSource;
  decoder?: GefsPointDecoder;
  latestRunProvider?: GefsLatestRunProvider;
  memberConcurrency?: number;
}

/**
 * Sample one GEFS field at multiple points without multiplying upstream fetches
 * by the number of coordinates. Each member's selected GRIB message is fetched
 * once, then all requested points are decoded from that local cached slice.
 */
export class GefsBatchPointsService {
  private readonly source: GefsMemberSource;
  private readonly decoder: GefsPointDecoder;
  private readonly latestRunProvider: GefsLatestRunProvider;
  private readonly memberConcurrency: number;

  constructor(options: GefsBatchPointsServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new GefsS3SubsetCache(join(cacheDir, "gefs-s3"));
    this.decoder = options.decoder ?? new Wgrib2Decoder(options.wgrib2Path);
    this.latestRunProvider = options.latestRunProvider ?? new GefsLatestRunResolver();
    this.memberConcurrency = options.memberConcurrency ?? DEFAULT_GEFS_MEMBER_CONCURRENCY;
  }

  async getPoints(input: GefsBatchPointsQueryInput): Promise<GefsBatchPointsResult> {
    const query = gefsBatchPointsQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortGefsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, members)
      : parseGefsRun(query.run);
    const forecastHour = gefsForecastHour(run, validTime);
    const variable = VARIABLE_CATALOG[query.variable] as RawVariableDefinition;

    const memberSamples = await mapConcurrent(
      members,
      this.memberConcurrency,
      async (member) => this.sampleMember(
        member,
        run,
        forecastHour,
        query.points,
        variable,
        query.pressureLevelHpa,
      ),
    );

    const firstMember = memberSamples[0];
    if (!firstMember) throw new Error("GEFS multi-point query produced no member samples");

    const points = query.points.map((requestedPoint, pointIndex) => {
      const samples = memberSamples.map((memberSample) => {
        const point = memberSample.points[pointIndex];
        if (!point) throw new Error(`GEFS member ${memberSample.member} is missing batched point index ${pointIndex}`);
        return { member: memberSample.member, ...point };
      });
      const first = samples[0];
      if (!first) throw new Error(`GEFS multi-point query produced no samples for point index ${pointIndex}`);
      for (const sample of samples) {
        if (
          sample.requestedPoint.latitude !== requestedPoint.latitude ||
          sample.requestedPoint.longitude !== requestedPoint.longitude
        ) {
          throw new Error(`GEFS requested point changed within batched point index ${pointIndex}`);
        }
        if (
          sample.gridPoint.latitude !== first.gridPoint.latitude ||
          sample.gridPoint.longitude !== first.gridPoint.longitude
        ) {
          throw new Error(`GEFS members resolved to inconsistent grid points at batched point index ${pointIndex}`);
        }
      }

      const values = samples.map((sample) => sample.value);
      const summary = summarizeNumericDistribution(values, quantiles);
      const threshold = query.thresholdGte === undefined
        ? undefined
        : thresholdGteSummary(values, query.thresholdGte);

      return {
        requestedPoint,
        gridPoint: first.gridPoint,
        summary: {
          ...summary,
          ...(threshold === undefined ? {} : { threshold }),
        },
        ...(query.includeMembers
          ? { members: samples.map(({ member, value }) => ({ member, value })) }
          : {}),
      };
    });

    const output = variable.outputs[0];
    return gefsBatchPointsResultSchema.parse({
      model: "gefs_0p50",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      selection: {
        variable: query.variable,
        gfsCode: variable.gfsCode,
        pressureLevelHpa: query.pressureLevelHpa,
        outputField: output.field,
        unit: output.unit,
        members,
        quantiles,
        ...(query.thresholdGte === undefined ? {} : { thresholdGte: query.thresholdGte }),
      },
      points,
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: "wgrib2",
        product: "pgrb2a_0p50",
        memberFiles: memberSamples.map(({ member, cacheHit }) => ({ member, cacheHit })),
        allCacheHit: memberSamples.every((sample) => sample.cacheHit),
      },
    });
  }

  private async sampleMember(
    member: GefsMember,
    run: Date,
    forecastHour: number,
    points: PointCoordinate[],
    variable: RawVariableDefinition,
    pressureLevelHpa: number,
  ): Promise<MemberBatchSample> {
    const file = await this.source.fetch({
      run,
      forecastHour,
      member,
      variableCode: variable.gfsCode,
      pressureLevelHpa,
    });

    const samples: MemberPointSample[] = [];
    // Keep point decoding sequential inside one member. Member processing is
    // already bounded-concurrent, so this caps simultaneous wgrib2 processes.
    for (const requestedPoint of points) {
      const decoded = await this.decoder.extractPoint(file.path, requestedPoint.longitude, requestedPoint.latitude);
      samples.push(this.readPoint(decoded, requestedPoint, member, variable, pressureLevelHpa));
    }

    return { member, cacheHit: file.cacheHit, points: samples };
  }

  private readPoint(
    decoded: DecodedValue[],
    requestedPoint: PointCoordinate,
    member: GefsMember,
    variable: RawVariableDefinition,
    pressureLevelHpa: number,
  ): MemberPointSample {
    const value = decoded.find((candidate) =>
      candidate.code === variable.gfsCode && candidate.pressureHpa === pressureLevelHpa,
    );
    if (!value) {
      throw new Error(`Decoded GEFS ${member} subset is missing ${variable.gfsCode}@${pressureLevelHpa}mb`);
    }
    return {
      requestedPoint,
      gridPoint: value.gridPoint,
      value: normalizeValue(variable, value.value),
    };
  }
}

function normalizeValue(variable: RawVariableDefinition, value: number): number {
  const output = variable.outputs[0];
  if (variable.sourceUnit === "K" && output.unit === "degC") return value - 273.15;
  return value;
}
