import { sortGefsMembers } from "../catalog/gefs.js";
import type { GefsReforecastMember } from "../catalog/gefs-reforecast.js";
import {
  gefsReforecastPointsQuerySchema,
  gefsReforecastPointsResultSchema,
  type GefsReforecastPointsQueryInput,
  type GefsReforecastPointsResult,
} from "../schema/gefs-reforecast.js";
import {
  gefsReforecastForecastHour,
  parseGefsReforecastRun,
} from "../sources/gefs-reforecast-s3.js";
import { mapConcurrent } from "./concurrency.js";
import {
  bundleScalarOutputCount,
  prepareGefsBundleSelection,
} from "./gefs-bundle-decoder.js";
import { GefsReforecastProfileService } from "./gefs-reforecast-profile.js";
import { GefsReforecastPointService } from "./gefs-reforecast.js";

export const DEFAULT_GEFS_REFORECAST_POINT_CONCURRENCY = 4;

export interface GefsReforecastPointsServiceOptions {
  pointGetter?: Pick<GefsReforecastPointService, "getPoint">;
  profileGetter?: Pick<GefsReforecastProfileService, "getProfile">;
  pointConcurrency?: number;
}

export class GefsReforecastPointsService {
  private readonly pointGetter: Pick<GefsReforecastPointService, "getPoint">;
  private readonly profileGetter: Pick<GefsReforecastProfileService, "getProfile">;
  private readonly pointConcurrency: number;

  constructor(options: GefsReforecastPointsServiceOptions = {}) {
    this.pointGetter = options.pointGetter ?? new GefsReforecastPointService();
    this.profileGetter = options.profileGetter ?? new GefsReforecastProfileService();
    this.pointConcurrency =
      options.pointConcurrency ?? DEFAULT_GEFS_REFORECAST_POINT_CONCURRENCY;
  }

  async getPoints(
    input: GefsReforecastPointsQueryInput,
  ): Promise<GefsReforecastPointsResult> {
    const query = gefsReforecastPointsQuerySchema.parse(input);
    const run = parseGefsReforecastRun(query.run);
    const validTime = new Date(query.validTime);
    const forecastHour = gefsReforecastForecastHour(run, validTime);
    const members = sortGefsMembers(query.members) as GefsReforecastMember[];
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const common = {
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      members,
      quantiles,
      includeMembers: query.includeMembers,
    };

    if (query.selection.kind === "fields") {
      const fields = [...query.selection.fields];
      const scalarOutputs = bundleScalarOutputCount(prepareGefsBundleSelection({
        variables: [],
        pressureLevelsHpa: [],
        fields,
      }));
      assertMemberSampleLimit(
        query.includeMembers,
        query.points.length * members.length * scalarOutputs,
        query.maxMemberSamples,
      );

      const results = await mapConcurrent(
        query.points,
        this.pointConcurrency,
        async (point) => this.pointGetter.getPoint({
          ...point,
          ...common,
          fields,
        }),
      );
      const first = assertPointResultInvariants(
        run,
        validTime,
        forecastHour,
        query.points,
        results,
      );
      for (const result of results) {
        if (
          result.source.decoder !== first.source.decoder
          || result.source.leadBlock !== first.source.leadBlock
          || result.source.horizontalGridDegrees !== first.source.horizontalGridDegrees
        ) {
          throw new Error(
            "GEFSv12 reforecast multi-point field query changed source semantics between points",
          );
        }
      }

      return gefsReforecastPointsResultSchema.parse({
        model: "gefs_v12_reforecast",
        kind: "fields",
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        forecastHour,
        selection: {
          kind: "fields",
          fields,
          members,
          quantiles,
        },
        includeMembers: query.includeMembers,
        points: results.map((result) => ({
          kind: "fields",
          requestedPoint: result.requestedPoint,
          gridPoint: result.gridPoint,
          fieldSummaries: result.fieldSummaries,
          ...(result.members === undefined ? {} : { members: result.members }),
        })),
        source: {
          provider: "NOAA AWS Open Data",
          access: "s3_range",
          decoder: first.source.decoder,
          archiveType: "reforecast",
          dataset: "GEFSv12/reforecast",
          leadBlock: first.source.leadBlock,
          horizontalGridDegrees: first.source.horizontalGridDegrees,
          allCacheHit: results.every((result) => result.source.allCacheHit),
        },
      });
    }

    const variables = [...query.selection.variables];
    const pressureLevelsHpa = [...query.selection.pressureLevelsHpa]
      .sort((a, b) => b - a);
    assertMemberSampleLimit(
      query.includeMembers,
      query.points.length * members.length * variables.length * pressureLevelsHpa.length,
      query.maxMemberSamples,
    );

    const results = await mapConcurrent(
      query.points,
      this.pointConcurrency,
      async (point) => this.profileGetter.getProfile({
        ...point,
        ...common,
        variables,
        pressureLevelsHpa,
      }),
    );
    const first = assertPointResultInvariants(
      run,
      validTime,
      forecastHour,
      query.points,
      results,
    );
    for (const result of results) {
      if (
        result.source.decoder !== first.source.decoder
        || result.source.leadBlock !== first.source.leadBlock
        || result.source.horizontalGridDegrees !== first.source.horizontalGridDegrees
        || result.source.profileGridPolicy !== first.source.profileGridPolicy
      ) {
        throw new Error(
          "GEFSv12 reforecast multi-point profile query changed source semantics between points",
        );
      }
    }

    return gefsReforecastPointsResultSchema.parse({
      model: "gefs_v12_reforecast",
      kind: "profile",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      selection: {
        kind: "profile",
        variables,
        pressureLevelsHpa,
        members,
        quantiles,
      },
      includeMembers: query.includeMembers,
      points: results.map((result) => ({
        kind: "profile",
        requestedPoint: result.requestedPoint,
        gridPoint: result.gridPoint,
        summaries: result.summaries,
        ...(result.members === undefined ? {} : { members: result.members }),
      })),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: first.source.decoder,
        archiveType: "reforecast",
        dataset: "GEFSv12/reforecast",
        leadBlock: first.source.leadBlock,
        horizontalGridDegrees: first.source.horizontalGridDegrees,
        profileGridPolicy: first.source.profileGridPolicy,
        allCacheHit: results.every((result) => result.source.allCacheHit),
      },
    });
  }
}

function assertMemberSampleLimit(
  includeMembers: boolean,
  samples: number,
  maxMemberSamples: number,
): void {
  if (includeMembers && samples > maxMemberSamples) {
    throw new Error(
      `GEFSv12 reforecast multi-point query would return ${samples} member scalar samples, exceeding maxMemberSamples=${maxMemberSamples}`,
    );
  }
}

function assertPointResultInvariants<
  T extends {
    run: string;
    validTime: string;
    forecastHour: number;
    requestedPoint: { latitude: number; longitude: number };
    source: {
      decoder: "gribberish" | "wgrib2";
      leadBlock: "Days:1-10" | "Days:10-16";
      horizontalGridDegrees: 0.25 | 0.5;
    };
  },
>(
  run: Date,
  validTime: Date,
  forecastHour: number,
  points: Array<{ latitude: number; longitude: number }>,
  results: T[],
): T {
  const first = results[0];
  if (!first) {
    throw new Error("GEFSv12 reforecast multi-point query produced no point results");
  }
  const expectedRun = run.toISOString();
  const expectedValidTime = validTime.toISOString();
  for (const [index, result] of results.entries()) {
    const expectedPoint = points[index];
    if (!expectedPoint) {
      throw new Error("GEFSv12 reforecast multi-point internal point alignment failed");
    }
    if (
      result.run !== expectedRun
      || result.validTime !== expectedValidTime
      || result.forecastHour !== forecastHour
    ) {
      throw new Error(
        "GEFSv12 reforecast multi-point result drifted in run, valid time or forecast hour",
      );
    }
    if (
      result.requestedPoint.latitude !== expectedPoint.latitude
      || result.requestedPoint.longitude !== expectedPoint.longitude
    ) {
      throw new Error(
        "GEFSv12 reforecast multi-point result changed requested point ordering",
      );
    }
  }
  return first;
}
