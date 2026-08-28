import { IFS_ENS_MEMBERS, ifsEnsMemberNumber, sortIfsEnsMembers } from "../catalog/ifs-ens.js";
import { NON_ISOBARIC_FIELD_CATALOG } from "../catalog/non-isobaric-fields.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import {
  ifsEnsTimeSeriesQuerySchema,
  ifsEnsTimeSeriesResultSchema,
  type IfsEnsTimeSeriesQueryInput,
  type IfsEnsTimeSeriesResult,
} from "../schema/ifs-ens-timeseries.js";
import type {
  IfsEnsMemberBundleQueryInput,
  IfsEnsMemberBundleResult,
} from "../schema/ifs-ens.js";
import { mapConcurrent } from "./concurrency.js";
import {
  IfsEnsLatestRunResolver,
  type IfsEnsLatestRangeRunProvider,
} from "./ifs-ens-latest-run.js";
import { IfsEnsMemberBundleService } from "./ifs-ens-member-bundle.js";
import { ifsIndexSelectorsForSelection } from "./ifs-profile.js";
import {
  ifsEnsForecastHoursInRange,
  ifsEnsValidTimeForForecastHour,
  parseIfsRun,
} from "./ifs-time.js";

export const DEFAULT_IFS_ENS_TIME_STEP_CONCURRENCY = 2;

export interface IfsEnsBundleGetter {
  getBundle(input: IfsEnsMemberBundleQueryInput): Promise<IfsEnsMemberBundleResult>;
}

export interface IfsEnsTimeSeriesServiceOptions {
  bundleGetter?: IfsEnsBundleGetter;
  latestRunRangeProvider?: IfsEnsLatestRangeRunProvider;
  stepConcurrency?: number;
}

export class IfsEnsTimeSeriesService {
  private readonly bundleGetter: IfsEnsBundleGetter;
  private readonly latestRunRangeProvider: IfsEnsLatestRangeRunProvider;
  private readonly stepConcurrency: number;

  constructor(options: IfsEnsTimeSeriesServiceOptions = {}) {
    this.bundleGetter = options.bundleGetter ?? new IfsEnsMemberBundleService();
    this.latestRunRangeProvider = options.latestRunRangeProvider ?? new IfsEnsLatestRunResolver();
    this.stepConcurrency = options.stepConcurrency ?? DEFAULT_IFS_ENS_TIME_STEP_CONCURRENCY;
  }

  async getTimeSeries(input: IfsEnsTimeSeriesQueryInput): Promise<IfsEnsTimeSeriesResult> {
    const query = ifsEnsTimeSeriesQuerySchema.parse(input);
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);
    const members = sortIfsEnsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const selection = {
      variables: [...query.selection.variables],
      pressureLevelsHpa: [...query.selection.pressureLevelsHpa].sort((a, b) => b - a),
      fields: [...query.selection.fields],
    };

    const baseSelectors = ifsIndexSelectorsForSelection(selection);
    const availabilitySelectors = members.flatMap((member) => {
      const number = ifsEnsMemberNumber(member);
      return baseSelectors.map((selector) => ({ ...selector, number }));
    });

    const run = query.run === "latest"
      ? await this.latestRunRangeProvider.resolveLatestRunForRange(startTime, endTime, availabilitySelectors)
      : parseIfsRun(query.run);
    const forecastHours = ifsEnsForecastHoursInRange(run, startTime, endTime);

    if (forecastHours.length > query.maxSteps) {
      throw new Error(
        `Requested IFS ENS time range contains ${forecastHours.length} native outputs, exceeding maxSteps=${query.maxSteps}`,
      );
    }

    if (query.includeMembers) {
      const scalarOutputsPerMemberStep =
        selection.pressureLevelsHpa.length
          * selection.variables.reduce((sum, id) => sum + VARIABLE_CATALOG[id].outputs.length, 0)
        + selection.fields.reduce((sum, id) => sum + NON_ISOBARIC_FIELD_CATALOG[id].outputs.length, 0);
      const memberSamples = forecastHours.length * members.length * scalarOutputsPerMemberStep;
      if (memberSamples > query.maxMemberSamples) {
        throw new Error(
          `IFS ENS time series would return ${memberSamples} member scalar samples, exceeding maxMemberSamples=${query.maxMemberSamples}`,
        );
      }
    }

    const results = await mapConcurrent(forecastHours, this.stepConcurrency, async (forecastHour) =>
      this.bundleGetter.getBundle({
        latitude: query.latitude,
        longitude: query.longitude,
        run: run.toISOString(),
        validTime: ifsEnsValidTimeForForecastHour(run, forecastHour).toISOString(),
        selection,
        members,
        quantiles,
        includeMembers: query.includeMembers,
      }),
    );

    const first = results[0];
    if (!first) throw new Error("IFS ENS time series produced no native forecast steps");
    for (const [index, result] of results.entries()) {
      const forecastHour = forecastHours[index];
      if (forecastHour === undefined) throw new Error("IFS ENS time-series internal time alignment failed");
      assertInvariant(result, run, forecastHour, first.gridPoint);
      if (
        result.source.product !== first.source.product
        || result.source.horizontalGridDegrees !== first.source.horizontalGridDegrees
        || result.source.decoder !== first.source.decoder
        || result.source.memberSemantics !== first.source.memberSemantics
      ) {
        throw new Error("IFS ENS time series changed source provenance within one range");
      }
      if (query.includeMembers && result.members === undefined) {
        throw new Error("IFS ENS time-series member payload was requested but omitted by the bundle service");
      }
    }

    return ifsEnsTimeSeriesResultSchema.parse({
      model: "ifs_ens_0p25",
      run: run.toISOString(),
      requestedStartTime: startTime.toISOString(),
      requestedEndTime: endTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      selection: {
        variables: selection.variables,
        pressureLevelsHpa: selection.pressureLevelsHpa,
        fields: selection.fields,
        members,
        quantiles,
      },
      includeMembers: query.includeMembers,
      series: results.map((result) => ({
        validTime: result.validTime,
        forecastHour: result.forecastHour,
        pressureSummaries: result.pressureSummaries,
        fieldSummaries: result.fieldSummaries,
        ...(query.includeMembers ? { members: result.members } : {}),
        allCacheHit: result.source.allCacheHit,
      })),
      source: {
        provider: "ECMWF Open Data",
        access: "indexed_http_range",
        decoder: first.source.decoder,
        product: "ifs_0p25_enfo_ef",
        horizontalGridDegrees: 0.25,
        allCacheHit: results.every((result) => result.source.allCacheHit),
        memberSemantics: "50_perturbed_members_control_is_oper_fc",
      },
    });
  }
}

function assertInvariant(
  result: IfsEnsMemberBundleResult,
  expectedRun: Date,
  expectedForecastHour: number,
  expectedGridPoint: { latitude: number; longitude: number },
): void {
  const expectedRunIso = expectedRun.toISOString();
  const expectedValidIso = ifsEnsValidTimeForForecastHour(expectedRun, expectedForecastHour).toISOString();
  if (result.run !== expectedRunIso) throw new Error("IFS ENS time series drifted between model runs");
  if (result.forecastHour !== expectedForecastHour || result.validTime !== expectedValidIso) {
    throw new Error("IFS ENS time-series step returned inconsistent valid time or forecast hour");
  }
  if (
    result.gridPoint.latitude !== expectedGridPoint.latitude
    || result.gridPoint.longitude !== expectedGridPoint.longitude
  ) {
    throw new Error("IFS ENS time-series steps resolved to inconsistent grid points");
  }
}
