import { expandRequestedFields } from "../catalog/non-isobaric-fields.js";
import { expandRequestedVariables } from "../catalog/variables.js";
import { timeSeriesQuerySchema, type ProfileQueryInput, type TimeSeriesQueryInput } from "../schema/query.js";
import { mapConcurrent } from "./concurrency.js";
import {
  nativeForecastHoursInRange,
  parseGfsRun,
  validTimeForForecastHour,
} from "./forecast-hour.js";
import { LatestRunResolver, type LatestRunProvider } from "./latest-run.js";
import { ProfileService } from "./profile.js";
import type { ProfileResult, TimeSeriesResult } from "./types.js";

export const DEFAULT_TIME_SERIES_CONCURRENCY = 4;

export interface ProfileGetter {
  getProfile(query: ProfileQueryInput): Promise<ProfileResult>;
}

export interface TimeSeriesServiceOptions {
  profileGetter?: ProfileGetter;
  latestRunProvider?: LatestRunProvider;
  concurrency?: number;
}

export class TimeSeriesService {
  private readonly latestRunProvider: LatestRunProvider;
  private readonly profileGetter: ProfileGetter;
  private readonly concurrency: number;

  constructor(options: TimeSeriesServiceOptions = {}) {
    this.latestRunProvider = options.latestRunProvider ?? new LatestRunResolver();
    this.profileGetter = options.profileGetter ?? new ProfileService({ latestRunProvider: this.latestRunProvider });
    this.concurrency = options.concurrency ?? DEFAULT_TIME_SERIES_CONCURRENCY;
  }

  async getTimeSeries(input: TimeSeriesQueryInput): Promise<TimeSeriesResult> {
    const query = timeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const variables = expandRequestedVariables(query.variables ?? []);
    const fields = expandRequestedFields(query.fields ?? []);
    const pressureLevelsHpa = query.pressureLevelsHpa ?? [];
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun({
          type: "time_range",
          startTime,
          endTime,
          selection: {
            variableCodes: variables.map((variable) => variable.gfsCode),
            pressureLevelsHpa,
            fields,
          },
        }, query.grid)
      : query.run === "latest_complete"
        ? await this.latestRunProvider.resolveLatestRun(undefined, query.grid)
        : parseGfsRun(query.run);
    const forecastHours = nativeForecastHoursInRange(run, startTime, endTime, query.grid);

    if (forecastHours.length > query.maxSteps) {
      throw new Error(
        `Requested time range contains ${forecastHours.length} native GFS outputs, exceeding maxSteps=${query.maxSteps}. Narrow the range or raise maxSteps.`,
      );
    }

    const profiles = await mapConcurrent(
      forecastHours,
      this.concurrency,
      async (forecastHourValue) => this.profileGetter.getProfile({
        latitude: query.latitude,
        longitude: query.longitude,
        run: run.toISOString(),
        grid: query.grid,
        validTime: validTimeForForecastHour(run, forecastHourValue).toISOString(),
        ...(query.variables === undefined ? {} : { variables: query.variables }),
        ...(query.pressureLevelsHpa === undefined ? {} : { pressureLevelsHpa: query.pressureLevelsHpa }),
        ...(query.fields === undefined ? {} : { fields: query.fields }),
        source: query.source,
      }),
    );

    const first = profiles[0];
    if (!first) throw new Error("No GFS profiles returned for time series");
    for (const profile of profiles) {
      if (
        profile.gridPoint.latitude !== first.gridPoint.latitude ||
        profile.gridPoint.longitude !== first.gridPoint.longitude
      ) {
        throw new Error("GFS grid point changed within one time-series query");
      }
      if (
        profile.source.provider !== first.source.provider ||
        profile.source.access !== first.source.access ||
        profile.source.decoder !== first.source.decoder
      ) {
        throw new Error("Data source changed within one time-series query");
      }
    }

    return {
      model: first.model,
      run: run.toISOString(),
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      source: {
        provider: first.source.provider,
        access: first.source.access,
        decoder: first.source.decoder,
      },
      series: profiles.map((profile) => ({
        validTime: profile.validTime,
        forecastHour: profile.forecastHour,
        levels: profile.levels,
        ...(profile.fields === undefined ? {} : { fields: profile.fields }),
        cacheHit: profile.source.cacheHit,
      })),
    };
  }
}
