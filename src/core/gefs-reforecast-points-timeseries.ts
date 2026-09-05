import { sortGefsMembers } from "../catalog/gefs.js";
import type { GefsReforecastMember } from "../catalog/gefs-reforecast.js";
import {
  gefsReforecastPointsResultSchema,
  gefsReforecastPointsTimeSeriesQuerySchema,
  gefsReforecastPointsTimeSeriesResultSchema,
  type GefsReforecastPointsResult,
  type GefsReforecastPointsTimeSeriesQueryInput,
  type GefsReforecastPointsTimeSeriesResult,
} from "../schema/gefs-reforecast.js";
import {
  gefsReforecastForecastHour,
  nativeGefsReforecastValidTimesInRange,
  parseGefsReforecastRun,
} from "../sources/gefs-reforecast-s3.js";
import { mapConcurrent } from "./concurrency.js";
import { GefsReforecastPointsService } from "./gefs-reforecast-points.js";
import { InvalidRequestError } from "../failure.js";

export const DEFAULT_GEFS_REFORECAST_POINTS_TIME_STEP_CONCURRENCY = 2;

export interface GefsReforecastPointsTimeSeriesServiceOptions {
  pointsGetter?: Pick<GefsReforecastPointsService, "getPoints">;
  stepConcurrency?: number;
}

export class GefsReforecastPointsTimeSeriesService {
  private readonly pointsGetter: Pick<GefsReforecastPointsService, "getPoints">;
  private readonly stepConcurrency: number;

  constructor(options: GefsReforecastPointsTimeSeriesServiceOptions = {}) {
    this.pointsGetter = options.pointsGetter ?? new GefsReforecastPointsService();
    this.stepConcurrency =
      options.stepConcurrency ?? DEFAULT_GEFS_REFORECAST_POINTS_TIME_STEP_CONCURRENCY;
  }

  async getPointsTimeSeries(
    input: GefsReforecastPointsTimeSeriesQueryInput,
  ): Promise<GefsReforecastPointsTimeSeriesResult> {
    const query = gefsReforecastPointsTimeSeriesQuerySchema.parse(input);
    const run = parseGefsReforecastRun(query.run);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const times = nativeGefsReforecastValidTimesInRange(
      run,
      startTime,
      endTime,
      query.maxSteps,
    );
    const pointSteps = query.points.length * times.length;
    if (pointSteps > query.maxPointSteps) {
      throw new InvalidRequestError(
        `GEFSv12 reforecast multi-point range contains ${query.points.length} points × ${times.length} steps = ${pointSteps} point-steps, exceeding maxPointSteps=${query.maxPointSteps}`,
      );
    }

    const members = sortGefsMembers(query.members) as GefsReforecastMember[];
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const common = {
      points: query.points,
      run: run.toISOString(),
      members,
      quantiles,
      includeMembers: false,
    };

    if (query.selection.kind === "fields") {
      const fields = [...query.selection.fields];
      const batches = await mapConcurrent(
        times,
        this.stepConcurrency,
        async (validTime) => gefsReforecastPointsResultSchema.parse(
          await this.pointsGetter.getPoints({
            ...common,
            validTime: validTime.toISOString(),
            selection: {
              kind: "fields",
              fields,
            },
          }),
        ),
      );
      const first = assertBatchInvariants(run, times, query.points, batches);
      if (first.kind !== "fields") {
        throw new Error("GEFSv12 reforecast field range returned a profile batch");
      }
      for (const batch of batches) {
        if (batch.kind !== "fields") {
          throw new Error("GEFSv12 reforecast field range changed selection kind");
        }
        if (batch.source.decoder !== first.source.decoder) {
          throw new Error(
            "GEFSv12 reforecast multi-point range changed decoder between forecast steps",
          );
        }
        if (
          !sameArray(batch.selection.fields, fields)
          || !sameArray(batch.selection.members, members)
          || !sameArray(batch.selection.quantiles, quantiles)
        ) {
          throw new Error(
            "GEFSv12 reforecast multi-point field range changed selection between forecast steps",
          );
        }
      }

      return gefsReforecastPointsTimeSeriesResultSchema.parse({
        model: "gefs_v12_reforecast",
        run: run.toISOString(),
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        selection: {
          kind: "fields",
          fields,
          members,
          quantiles,
        },
        series: batches.map((batch) => {
          if (batch.kind !== "fields") {
            throw new Error("GEFSv12 reforecast field range changed selection kind");
          }
          return {
            kind: "fields",
            validTime: batch.validTime,
            forecastHour: batch.forecastHour,
            points: batch.points,
            source: {
              leadBlock: batch.source.leadBlock,
              horizontalGridDegrees: batch.source.horizontalGridDegrees,
              allCacheHit: batch.source.allCacheHit,
            },
          };
        }),
        source: sourceSummary(
          first.source.decoder,
          batches.every((batch) => batch.source.allCacheHit),
        ),
      });
    }

    const variables = [...query.selection.variables];
    const pressureLevelsHpa = [...query.selection.pressureLevelsHpa]
      .sort((a, b) => b - a);
    const batches = await mapConcurrent(
      times,
      this.stepConcurrency,
      async (validTime) => gefsReforecastPointsResultSchema.parse(
        await this.pointsGetter.getPoints({
          ...common,
          validTime: validTime.toISOString(),
          selection: {
            kind: "profile",
            variables,
            pressureLevelsHpa,
          },
        }),
      ),
    );
    const first = assertBatchInvariants(run, times, query.points, batches);
    if (first.kind !== "profile") {
      throw new Error("GEFSv12 reforecast profile range returned a field batch");
    }
    for (const batch of batches) {
      if (batch.kind !== "profile") {
        throw new Error("GEFSv12 reforecast profile range changed selection kind");
      }
      if (batch.source.decoder !== first.source.decoder) {
        throw new Error(
          "GEFSv12 reforecast multi-point range changed decoder between forecast steps",
        );
      }
      if (
        !sameArray(batch.selection.variables, variables)
        || !sameArray(batch.selection.pressureLevelsHpa, pressureLevelsHpa)
        || !sameArray(batch.selection.members, members)
        || !sameArray(batch.selection.quantiles, quantiles)
      ) {
        throw new Error(
          "GEFSv12 reforecast multi-point profile range changed selection between forecast steps",
        );
      }
    }

    return gefsReforecastPointsTimeSeriesResultSchema.parse({
      model: "gefs_v12_reforecast",
      run: run.toISOString(),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      selection: {
        kind: "profile",
        variables,
        pressureLevelsHpa,
        members,
        quantiles,
      },
      series: batches.map((batch) => {
        if (batch.kind !== "profile") {
          throw new Error("GEFSv12 reforecast profile range changed selection kind");
        }
        return {
          kind: "profile",
          validTime: batch.validTime,
          forecastHour: batch.forecastHour,
          points: batch.points,
          source: {
            leadBlock: batch.source.leadBlock,
            horizontalGridDegrees: batch.source.horizontalGridDegrees,
            profileGridPolicy: batch.source.profileGridPolicy,
            allCacheHit: batch.source.allCacheHit,
          },
        };
      }),
      source: sourceSummary(
        first.source.decoder,
        batches.every((batch) => batch.source.allCacheHit),
      ),
    });
  }
}

function assertBatchInvariants(
  run: Date,
  times: Date[],
  requestedPoints: Array<{ latitude: number; longitude: number }>,
  batches: GefsReforecastPointsResult[],
): GefsReforecastPointsResult {
  const first = batches[0];
  if (!first) {
    throw new Error("GEFSv12 reforecast multi-point range produced no forecast steps");
  }
  const expectedRun = run.toISOString();

  for (const [batchIndex, batch] of batches.entries()) {
    const expectedTime = times[batchIndex];
    if (!expectedTime) {
      throw new Error("GEFSv12 reforecast multi-point range internal time alignment failed");
    }
    if (
      batch.run !== expectedRun
      || batch.validTime !== expectedTime.toISOString()
      || batch.forecastHour !== gefsReforecastForecastHour(run, expectedTime)
    ) {
      throw new Error(
        "GEFSv12 reforecast multi-point range drifted in run, valid time or forecast hour",
      );
    }
    if (batch.points.length !== requestedPoints.length) {
      throw new Error(
        "GEFSv12 reforecast multi-point range changed point count between forecast steps",
      );
    }
    for (const [pointIndex, point] of batch.points.entries()) {
      const requestedPoint = requestedPoints[pointIndex];
      if (!requestedPoint) {
        throw new Error(
          "GEFSv12 reforecast multi-point range internal point alignment failed",
        );
      }
      if (
        point.requestedPoint.latitude !== requestedPoint.latitude
        || point.requestedPoint.longitude !== requestedPoint.longitude
      ) {
        throw new Error(
          "GEFSv12 reforecast multi-point range changed requested point ordering",
        );
      }
      // Deliberately do not compare gridPoint across forecast steps. A range
      // crossing f240 can move from the 0.25-degree to the 0.5-degree archive grid.
    }
  }

  return first;
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

function sameArray<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}
