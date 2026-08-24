import { expandRequestedFields } from "../catalog/non-isobaric-fields.js";
import { expandRequestedVariables } from "../catalog/variables.js";
import {
  batchPointsQuerySchema,
  type BatchPointsQueryInput,
  type PointCoordinate,
  type ProfileQueryInput,
} from "../schema/query.js";
import { mapConcurrent } from "./concurrency.js";
import { forecastHour, parseGfsRun } from "./forecast-hour.js";
import { LatestRunResolver, type LatestRunProvider } from "./latest-run.js";
import { ProfileService } from "./profile.js";
import type { BatchPointsResult, ProfileResult } from "./types.js";

export const DEFAULT_BATCH_POINT_CONCURRENCY = 8;

export interface BatchProfileGetter {
  getProfile(query: ProfileQueryInput): Promise<ProfileResult>;
}

export interface BatchPointsServiceOptions {
  profileGetter?: BatchProfileGetter;
  latestRunProvider?: LatestRunProvider;
  concurrency?: number;
}

export class BatchPointsService {
  private readonly latestRunProvider: LatestRunProvider;
  private readonly profileGetter: BatchProfileGetter;
  private readonly concurrency: number;

  constructor(options: BatchPointsServiceOptions = {}) {
    this.latestRunProvider = options.latestRunProvider ?? new LatestRunResolver();
    this.profileGetter = options.profileGetter ?? new ProfileService({ latestRunProvider: this.latestRunProvider });
    this.concurrency = options.concurrency ?? DEFAULT_BATCH_POINT_CONCURRENCY;
  }

  async getPoints(input: BatchPointsQueryInput): Promise<BatchPointsResult> {
    const query = batchPointsQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const variables = expandRequestedVariables(query.variables ?? []);
    const fields = expandRequestedFields(query.fields ?? []);
    const pressureLevelsHpa = query.pressureLevelsHpa ?? [];

    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun({
          type: "valid_time",
          validTime,
          selection: {
            variableCodes: variables.map((variable) => variable.gfsCode),
            pressureLevelsHpa,
            fields,
          },
        })
      : query.run === "latest_complete"
        ? await this.latestRunProvider.resolveLatestRun()
        : parseGfsRun(query.run);
    const fh = forecastHour(run, validTime);

    const profiles = await mapConcurrent(
      query.points,
      this.concurrency,
      async (point) => this.profileGetter.getProfile(profileQuery(point, query, run, validTime)),
    );

    for (const profile of profiles) {
      if (profile.run !== run.toISOString() || profile.validTime !== validTime.toISOString() || profile.forecastHour !== fh) {
        throw new Error("Profile result changed run or valid time within one batched point query");
      }
      if (
        profile.source.provider !== "NOAA AWS Open Data"
        || profile.source.access !== "s3_range"
        || profile.source.decoder !== profiles[0]!.source.decoder
      ) {
        throw new Error("Batched point queries require the NOAA AWS S3 byte-range source");
      }
    }

    return {
      model: "gfs_0p25",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour: fh,
      points: profiles.map((profile) => ({
        requestedPoint: profile.requestedPoint,
        gridPoint: profile.gridPoint,
        levels: profile.levels,
        ...(profile.fields === undefined ? {} : { fields: profile.fields }),
      })),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: profiles[0]!.source.decoder,
        cacheHit: profiles.every((profile) => profile.source.cacheHit),
      },
    };
  }
}

function profileQuery(
  point: PointCoordinate,
  query: ReturnType<typeof batchPointsQuerySchema.parse>,
  run: Date,
  validTime: Date,
): ProfileQueryInput {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    run: run.toISOString(),
    validTime: validTime.toISOString(),
    ...(query.variables === undefined ? {} : { variables: query.variables }),
    ...(query.pressureLevelsHpa === undefined ? {} : { pressureLevelsHpa: query.pressureLevelsHpa }),
    ...(query.fields === undefined ? {} : { fields: query.fields }),
    source: "s3",
  };
}
