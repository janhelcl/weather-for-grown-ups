import { homedir } from "node:os";
import { join } from "node:path";
import {
  GefsReforecastS3SubsetCache,
  type GefsReforecastSelectionSource,
} from "../cache/gefs-reforecast-s3-subset-cache.js";
import { sortGefsMembers } from "../catalog/gefs.js";
import type {
  GefsReforecastMember,
  GefsReforecastPressureVariableId,
} from "../catalog/gefs-reforecast.js";
import {
  VARIABLE_CATALOG,
  type RawVariableDefinition,
} from "../catalog/variables.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import {
  gefsReforecastProfileQuerySchema,
  gefsReforecastProfileResultSchema,
  type GefsReforecastProfileQueryInput,
  type GefsReforecastProfileResult,
} from "../schema/gefs-reforecast.js";
import {
  gefsReforecastForecastHour,
  gefsReforecastLeadBlock,
  gefsReforecastProfileGrid,
  parseGefsReforecastRun,
} from "../sources/gefs-reforecast-s3.js";
import { mapConcurrent } from "./concurrency.js";
import { summarizeNumericDistribution } from "./ensemble-statistics.js";
import {
  DEFAULT_GEFS_MEMBER_CONCURRENCY,
  type GefsPointDecoder,
} from "./gefs-ensemble.js";

export interface GefsReforecastProfileServiceOptions {
  cacheDir?: string;
  wgrib2Path?: string;
  source?: GefsReforecastSelectionSource;
  decoder?: GefsPointDecoder;
  concurrency?: number;
}

interface MemberProfileValue {
  variable: GefsReforecastPressureVariableId;
  pressureLevelHpa: number;
  value: number;
}

export class GefsReforecastProfileService {
  private readonly source: GefsReforecastSelectionSource;
  private readonly decoder: GefsPointDecoder;
  private readonly concurrency: number;

  constructor(options: GefsReforecastProfileServiceOptions = {}) {
    const cacheDir =
      options.cacheDir
      ?? process.env.WFG_CACHE_DIR
      ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new GefsReforecastS3SubsetCache(
      join(cacheDir, "gefs-v12-reforecast-s3"),
    );
    this.decoder = options.decoder ?? new Wgrib2Decoder(options.wgrib2Path);
    this.concurrency = options.concurrency ?? DEFAULT_GEFS_MEMBER_CONCURRENCY;
  }

  async getProfile(
    input: GefsReforecastProfileQueryInput,
  ): Promise<GefsReforecastProfileResult> {
    const query = gefsReforecastProfileQuerySchema.parse(input);
    const run = parseGefsReforecastRun(query.run);
    const validTime = new Date(query.validTime);
    const forecastHour = gefsReforecastForecastHour(run, validTime);
    const members = sortGefsMembers(query.members) as GefsReforecastMember[];
    const pressureLevelsHpa = [...query.pressureLevelsHpa].sort((a, b) => b - a);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const variables = query.variables.map((id) => ({
      id,
      definition: VARIABLE_CATALOG[id] as RawVariableDefinition,
    }));
    const profileGrid = gefsReforecastProfileGrid(
      forecastHour,
      pressureLevelsHpa,
    );
    const samplePoint = profileGrid.profileGridPolicy === "coherent_0p50"
      ? {
          latitude: snapToGrid(query.latitude, 0.5, -90, 90),
          longitude: snapToGrid(query.longitude, 0.5, -180, 180),
        }
      : { latitude: query.latitude, longitude: query.longitude };

    const samples = await mapConcurrent(
      members,
      this.concurrency,
      async (member) => {
        const file = await this.source.fetchSelection({
          run,
          forecastHour,
          member,
          pressureVariables: variables.map(({ definition }) => definition),
          pressureLevelsHpa,
        });
        const decoded = await this.decoder.extractPoint(
          file.path,
          samplePoint.longitude,
          samplePoint.latitude,
        );
        let gridPoint: { latitude: number; longitude: number } | undefined;
        const values: MemberProfileValue[] = [];

        for (const pressureLevelHpa of pressureLevelsHpa) {
          for (const { id, definition } of variables) {
            const candidate = decoded.find(
              (value) =>
                value.code === definition.gfsCode
                && value.pressureHpa === pressureLevelHpa,
            );
            if (!candidate) {
              const availableLevels = [...new Set(
                decoded
                  .filter((value) =>
                    value.code === definition.gfsCode
                    && typeof value.pressureHpa === "number"
                  )
                  .map((value) => value.pressureHpa as number),
              )].sort((a, b) => b - a);
              throw new Error(
                `GEFSv12 reforecast archive file for ${member}, run ${run.toISOString()}, f${forecastHour} is missing ${id}@${pressureLevelHpa}mb (${definition.gfsCode}); available ${definition.gfsCode} levels in this decoded file: ${availableLevels.length > 0 ? availableLevels.join(", ") : "none"}. This is run-local archive availability, not a global catalog capability`,
              );
            }
            if (
              gridPoint !== undefined
              && (
                candidate.gridPoint.latitude !== gridPoint.latitude
                || candidate.gridPoint.longitude !== gridPoint.longitude
              )
            ) {
              throw new Error(
                `Decoded GEFSv12 reforecast ${member} profile fields resolved to inconsistent grid points`,
              );
            }
            gridPoint ??= candidate.gridPoint;
            values.push({
              variable: id,
              pressureLevelHpa,
              value: normalizeValue(definition, candidate.value),
            });
          }
        }

        if (!gridPoint) {
          throw new Error(
            `Decoded GEFSv12 reforecast ${member} profile produced no values`,
          );
        }
        return { member, cacheHit: file.cacheHit, gridPoint, values };
      },
    );

    const first = samples[0];
    if (!first) {
      throw new Error("GEFSv12 reforecast profile produced no member samples");
    }
    for (const sample of samples) {
      if (
        sample.gridPoint.latitude !== first.gridPoint.latitude
        || sample.gridPoint.longitude !== first.gridPoint.longitude
      ) {
        throw new Error(
          "GEFSv12 reforecast members resolved to inconsistent grid points for one profile query",
        );
      }
    }

    const summaries = pressureLevelsHpa.flatMap((pressureLevelHpa) =>
      variables.map(({ id, definition }) => {
        const memberValues = samples.map((sample) => {
          const match = sample.values.find(
            (candidate) =>
              candidate.variable === id
              && candidate.pressureLevelHpa === pressureLevelHpa,
          );
          if (!match) {
            throw new Error(
              `Internal GEFSv12 reforecast profile aggregation error for ${id}@${pressureLevelHpa}mb`,
            );
          }
          return match.value;
        });
        const output = definition.outputs[0];
        if (!output) {
          throw new Error(
            `GEFSv12 reforecast profile variable ${id} has no output definition`,
          );
        }
        return {
          variable: id,
          gfsCode: definition.gfsCode,
          pressureLevelHpa,
          outputField: output.field,
          unit: output.unit,
          ...summarizeNumericDistribution(memberValues, quantiles),
        };
      }),
    );

    return gefsReforecastProfileResultSchema.parse({
      model: "gefs_v12_reforecast",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      requestedPoint: {
        latitude: query.latitude,
        longitude: query.longitude,
      },
      gridPoint: first.gridPoint,
      selection: {
        variables: query.variables,
        pressureLevelsHpa,
        members,
        quantiles,
      },
      summaries,
      ...(query.includeMembers
        ? {
            members: samples.map(({ member, cacheHit, values }) => ({
              member,
              cacheHit,
              values,
            })),
          }
        : {}),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: this.decoder.engine ?? "wgrib2",
        archiveType: "reforecast",
        dataset: "GEFSv12/reforecast",
        leadBlock: gefsReforecastLeadBlock(forecastHour),
        ...profileGrid,
        allCacheHit: samples.every((sample) => sample.cacheHit),
      },
    });
  }
}

function normalizeValue(
  variable: RawVariableDefinition,
  value: number,
): number {
  const output = variable.outputs[0];
  if (variable.sourceUnit === "K" && output.unit === "degC") {
    return value - 273.15;
  }
  return value;
}

function snapToGrid(
  value: number,
  gridDegrees: number,
  minimum: number,
  maximum: number,
): number {
  const snapped = Math.round(value / gridDegrees) * gridDegrees;
  return Math.min(maximum, Math.max(minimum, snapped));
}
