import { sortGefsMembers } from "../catalog/gefs.js";
import type { GefsReforecastMember } from "../catalog/gefs-reforecast.js";
import {
  gefsReforecastTimeSeriesQuerySchema,
  gefsReforecastTimeSeriesResultSchema,
  type GefsReforecastTimeSeriesQueryInput,
  type GefsReforecastTimeSeriesResult,
} from "../schema/gefs-reforecast.js";
import {
  gefsReforecastForecastHour,
  nativeGefsReforecastValidTimesInRange,
  parseGefsReforecastRun,
} from "../sources/gefs-reforecast-s3.js";
import { mapConcurrent } from "./concurrency.js";
import { GefsReforecastProfileService } from "./gefs-reforecast-profile.js";
import { GefsReforecastPointService } from "./gefs-reforecast.js";

export const DEFAULT_GEFS_REFORECAST_TIME_STEP_CONCURRENCY = 2;

export interface GefsReforecastTimeSeriesServiceOptions {
  pointGetter?: Pick<GefsReforecastPointService, "getPoint">;
  profileGetter?: Pick<GefsReforecastProfileService, "getProfile">;
  stepConcurrency?: number;
}

export class GefsReforecastTimeSeriesService {
  private readonly pointGetter: Pick<GefsReforecastPointService, "getPoint">;
  private readonly profileGetter: Pick<GefsReforecastProfileService, "getProfile">;
  private readonly stepConcurrency: number;

  constructor(options: GefsReforecastTimeSeriesServiceOptions = {}) {
    this.pointGetter = options.pointGetter ?? new GefsReforecastPointService();
    this.profileGetter = options.profileGetter ?? new GefsReforecastProfileService();
    this.stepConcurrency =
      options.stepConcurrency ?? DEFAULT_GEFS_REFORECAST_TIME_STEP_CONCURRENCY;
  }

  async getTimeSeries(
    input: GefsReforecastTimeSeriesQueryInput,
  ): Promise<GefsReforecastTimeSeriesResult> {
    const query = gefsReforecastTimeSeriesQuerySchema.parse(input);
    const run = parseGefsReforecastRun(query.run);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const times = nativeGefsReforecastValidTimesInRange(
      run,
      startTime,
      endTime,
      query.maxSteps,
    );
    const members = sortGefsMembers(query.members) as GefsReforecastMember[];
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const common = {
      latitude: query.latitude,
      longitude: query.longitude,
      run: run.toISOString(),
      members,
      quantiles,
      includeMembers: false,
    };

    if (query.selection.kind === "fields") {
      const fields = [...query.selection.fields];
      const results = await mapConcurrent(
        times,
        this.stepConcurrency,
        async (validTime) => this.pointGetter.getPoint({
          ...common,
          validTime: validTime.toISOString(),
          fields,
        }),
      );
      assertStepInvariants(run, times, results);
      const first = results[0];
      if (!first) {
        throw new Error("GEFSv12 reforecast field time series produced no steps");
      }
      for (const result of results) {
        if (result.source.decoder !== first.source.decoder) {
          throw new Error("GEFSv12 reforecast time series changed decoder within one range");
        }
      }

      return gefsReforecastTimeSeriesResultSchema.parse({
        model: "gefs_v12_reforecast",
        run: run.toISOString(),
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        requestedPoint: {
          latitude: query.latitude,
          longitude: query.longitude,
        },
        selection: {
          kind: "fields",
          fields,
          members,
          quantiles,
        },
        series: results.map((result) => ({
          kind: "fields",
          validTime: result.validTime,
          forecastHour: result.forecastHour,
          gridPoint: result.gridPoint,
          fieldSummaries: result.fieldSummaries,
          source: {
            leadBlock: result.source.leadBlock,
            horizontalGridDegrees: result.source.horizontalGridDegrees,
            allCacheHit: result.source.allCacheHit,
          },
        })),
        source: sourceSummary(
          first.source.decoder,
          results.every((result) => result.source.allCacheHit),
        ),
      });
    }

    const variables = [...query.selection.variables];
    const pressureLevelsHpa = [...query.selection.pressureLevelsHpa]
      .sort((a, b) => b - a);
    const results = await mapConcurrent(
      times,
      this.stepConcurrency,
      async (validTime) => this.profileGetter.getProfile({
        ...common,
        validTime: validTime.toISOString(),
        variables,
        pressureLevelsHpa,
      }),
    );
    assertStepInvariants(run, times, results);
    const first = results[0];
    if (!first) {
      throw new Error("GEFSv12 reforecast profile time series produced no steps");
    }
    for (const result of results) {
      if (result.source.decoder !== first.source.decoder) {
        throw new Error("GEFSv12 reforecast time series changed decoder within one range");
      }
    }

    return gefsReforecastTimeSeriesResultSchema.parse({
      model: "gefs_v12_reforecast",
      run: run.toISOString(),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      requestedPoint: {
        latitude: query.latitude,
        longitude: query.longitude,
      },
      selection: {
        kind: "profile",
        variables,
        pressureLevelsHpa,
        members,
        quantiles,
      },
      series: results.map((result) => ({
        kind: "profile",
        validTime: result.validTime,
        forecastHour: result.forecastHour,
        gridPoint: result.gridPoint,
        profileSummaries: result.summaries,
        source: {
          leadBlock: result.source.leadBlock,
          horizontalGridDegrees: result.source.horizontalGridDegrees,
          profileGridPolicy: result.source.profileGridPolicy,
          allCacheHit: result.source.allCacheHit,
        },
      })),
      source: sourceSummary(
        first.source.decoder,
        results.every((result) => result.source.allCacheHit),
      ),
    });
  }
}

function assertStepInvariants(
  run: Date,
  times: Date[],
  results: Array<{
    run: string;
    validTime: string;
    forecastHour: number;
  }>,
): void {
  const expectedRun = run.toISOString();
  for (const [index, result] of results.entries()) {
    const expectedTime = times[index];
    if (!expectedTime) {
      throw new Error("GEFSv12 reforecast time-series internal time alignment failed");
    }
    if (result.run !== expectedRun) {
      throw new Error("GEFSv12 reforecast time series drifted between model runs");
    }
    const expectedValidTime = expectedTime.toISOString();
    const expectedForecastHour = gefsReforecastForecastHour(run, expectedTime);
    if (
      result.validTime !== expectedValidTime
      || result.forecastHour !== expectedForecastHour
    ) {
      throw new Error(
        "GEFSv12 reforecast time-series step returned inconsistent valid time or forecast hour",
      );
    }
  }
}

function sourceSummary(
  decoder: "gribberish" | "wgrib2",
  allCacheHit: boolean,
) {
  return {
    provider: "NOAA AWS Open Data" as const,
    access: "s3_range" as const,
    decoder,
    archiveType: "reforecast" as const,
    dataset: "GEFSv12/reforecast" as const,
    nativeCadence: [
      { fromForecastHour: 3 as const, throughForecastHour: 240 as const, stepHours: 3 as const },
      { fromForecastHour: 246 as const, throughForecastHour: 384 as const, stepHours: 6 as const },
    ] as const,
    allCacheHit,
  };
}
