import { sortIfsEnsMembers } from "../catalog/ifs-ens.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import type {
  IfsEnsMemberBundleQueryInput,
  IfsEnsMemberBundleResult,
} from "../schema/ifs-ens.js";
import {
  ifsIfsEnsComparisonQuerySchema,
  ifsIfsEnsComparisonResultSchema,
  type IfsIfsEnsComparisonQueryInput,
  type IfsIfsEnsComparisonResult,
} from "../schema/ifs-ifs-ens-comparison.js";
import type { IfsPointQueryInput, IfsProfileResult } from "../schema/ifs.js";
import { IfsEnsMemberBundleService } from "./ifs-ens-member-bundle.js";
import {
  IfsIfsEnsAlignedRunResolver,
  type IfsIfsEnsAlignedRunProvider,
} from "./ifs-ifs-ens-aligned-run.js";
import { IfsProfileService } from "./ifs-profile.js";
import { ifsEnsForecastHour, ifsForecastHour, parseIfsRun } from "./ifs-time.js";

export interface IfsComparisonProfileGetter {
  getProfile(query: IfsPointQueryInput): Promise<IfsProfileResult>;
}

export interface IfsEnsComparisonBundleGetter {
  getBundle(query: IfsEnsMemberBundleQueryInput): Promise<IfsEnsMemberBundleResult>;
}

export interface IfsIfsEnsComparisonServiceOptions {
  ifsGetter?: IfsComparisonProfileGetter;
  ifsEnsGetter?: IfsEnsComparisonBundleGetter;
  alignedRunProvider?: IfsIfsEnsAlignedRunProvider;
}

export class IfsIfsEnsComparisonService {
  private readonly ifsGetter: IfsComparisonProfileGetter;
  private readonly ifsEnsGetter: IfsEnsComparisonBundleGetter;
  private readonly alignedRunProvider: IfsIfsEnsAlignedRunProvider;

  constructor(options: IfsIfsEnsComparisonServiceOptions = {}) {
    this.ifsGetter = options.ifsGetter ?? new IfsProfileService();
    this.ifsEnsGetter = options.ifsEnsGetter ?? new IfsEnsMemberBundleService();
    this.alignedRunProvider =
      options.alignedRunProvider ?? new IfsIfsEnsAlignedRunResolver();
  }

  async compare(
    input: IfsIfsEnsComparisonQueryInput,
  ): Promise<IfsIfsEnsComparisonResult> {
    const query = ifsIfsEnsComparisonQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortIfsEnsMembers(query.members);
    const quantiles = [...query.quantiles].sort((left, right) => left - right);

    const run = query.run === "latest"
      ? await this.alignedRunProvider.resolveLatestAlignedRun(
          validTime,
          query.variable,
          query.pressureLevelHpa,
          members,
        )
      : parseIfsRun(query.run);
    const runIso = run.toISOString();
    const forecastHour = ifsForecastHour(run, validTime);
    const ensembleForecastHour = ifsEnsForecastHour(run, validTime);
    if (forecastHour !== ensembleForecastHour) {
      throw new Error("IFS/IFS ENS comparison resolved inconsistent forecast hours");
    }

    const [deterministic, ensemble] = await Promise.all([
      this.ifsGetter.getProfile({
        latitude: query.latitude,
        longitude: query.longitude,
        run: runIso,
        validTime: query.validTime,
        variables: [query.variable],
        pressureLevelsHpa: [query.pressureLevelHpa],
      }),
      this.ifsEnsGetter.getBundle({
        latitude: query.latitude,
        longitude: query.longitude,
        run: runIso,
        validTime: query.validTime,
        selection: {
          variables: [query.variable],
          pressureLevelsHpa: [query.pressureLevelHpa],
          fields: [],
        },
        members,
        quantiles,
        includeMembers: true,
      }),
    ]);

    assertAlignedMetadata(deterministic, ensemble, runIso);
    const level = deterministic.levels.find(
      (candidate) => candidate.pressureHpa === query.pressureLevelHpa,
    );
    if (!level) {
      throw new Error(
        `Deterministic IFS comparison profile is missing ${query.pressureLevelHpa} hPa`,
      );
    }

    const definition = VARIABLE_CATALOG[query.variable];
    if (definition.outputs.length !== 1) {
      throw new Error(
        `IFS/IFS ENS comparison requires one scalar output for ${query.variable}`,
      );
    }
    const output = definition.outputs[0]!;
    const deterministicValue = requiredProfileOutput(
      level,
      output.field,
      query.variable,
    );
    const ensembleOutput = requiredEnsembleOutput(
      ensemble,
      query.variable,
      query.pressureLevelHpa,
      output.field,
      output.unit,
    );
    const memberValues = requiredMemberValues(
      ensemble,
      query.variable,
      query.pressureLevelHpa,
      output.field,
    );

    const values = memberValues.map((sample) => sample.value);
    const membersBelow = values.filter((value) => value < deterministicValue).length;
    const membersAtOrBelow =
      values.filter((value) => value <= deterministicValue).length;
    const meanDifference = deterministicValue - ensembleOutput.distribution.mean;
    const standardizedDifference =
      ensembleOutput.distribution.populationStdDev === 0
        ? null
        : meanDifference / ensembleOutput.distribution.populationStdDev;
    const rangePosition = deterministicValue < ensembleOutput.distribution.min
      ? "below_member_min" as const
      : deterministicValue > ensembleOutput.distribution.max
        ? "above_member_max" as const
        : "within_member_range" as const;

    return ifsIfsEnsComparisonResultSchema.parse({
      run: runIso,
      validTime: query.validTime,
      forecastHour,
      requestedPoint: {
        latitude: query.latitude,
        longitude: query.longitude,
      },
      selection: {
        variable: query.variable,
        pressureLevelHpa: query.pressureLevelHpa,
        outputField: output.field,
        unit: output.unit,
      },
      deterministicIfs: {
        model: deterministic.model,
        gridPoint: deterministic.gridPoint,
        value: deterministicValue,
        source: deterministic.source,
      },
      ifsEns: {
        model: ensemble.model,
        gridPoint: ensemble.gridPoint,
        members: memberValues,
        summary: ensembleOutput.distribution,
        source: ensemble.source,
      },
      comparison: {
        deterministicMinusEnsembleMean: meanDifference,
        standardizedDifference,
        membersBelowDeterministic: membersBelow,
        membersAtOrBelowDeterministic: membersAtOrBelow,
        fractionMembersBelowDeterministic: membersBelow / values.length,
        fractionMembersAtOrBelowDeterministic: membersAtOrBelow / values.length,
        rangePosition,
        outsideMemberRange: rangePosition !== "within_member_range",
        interpretation:
          "deterministic_ifs_control_vs_perturbed_ensemble_distribution_not_calibrated_uncertainty",
      },
    });
  }
}

function assertAlignedMetadata(
  deterministic: IfsProfileResult,
  ensemble: IfsEnsMemberBundleResult,
  runIso: string,
): void {
  if (deterministic.run !== runIso || ensemble.run !== runIso) {
    throw new Error(
      "IFS/IFS ENS comparison received data from inconsistent initialization cycles",
    );
  }
  if (
    deterministic.validTime !== ensemble.validTime
    || deterministic.forecastHour !== ensemble.forecastHour
  ) {
    throw new Error(
      "IFS/IFS ENS comparison received inconsistent valid-time semantics",
    );
  }
}

function requiredProfileOutput(
  level: IfsProfileResult["levels"][number],
  outputField: string,
  variable: string,
): number {
  const value = (level as unknown as Record<string, unknown>)[outputField];
  if (typeof value !== "number") {
    throw new Error(
      `Deterministic IFS comparison is missing numeric output ${outputField} for ${variable}@${level.pressureHpa}hPa`,
    );
  }
  return value;
}

function requiredEnsembleOutput(
  result: IfsEnsMemberBundleResult,
  variable: IfsIfsEnsComparisonQueryInput["variable"],
  pressureLevelHpa: number,
  outputField: string,
  unit: string,
) {
  const pressure = result.pressureSummaries.find(
    (candidate) =>
      candidate.variable === variable
      && candidate.pressureLevelHpa === pressureLevelHpa,
  );
  if (!pressure) {
    throw new Error(
      `IFS ENS comparison is missing ${variable}@${pressureLevelHpa}hPa`,
    );
  }
  const output = pressure.outputs.find(
    (candidate) =>
      candidate.aggregation === "numeric_distribution"
      && candidate.field === outputField,
  );
  if (!output || output.aggregation !== "numeric_distribution") {
    throw new Error(
      `IFS ENS comparison is missing numeric output ${outputField}`,
    );
  }
  if (output.unit !== unit) {
    throw new Error(
      `IFS/IFS ENS comparison output unit mismatch for ${outputField}: ${unit} vs ${output.unit}`,
    );
  }
  return output;
}

function requiredMemberValues(
  result: IfsEnsMemberBundleResult,
  variable: IfsIfsEnsComparisonQueryInput["variable"],
  pressureLevelHpa: number,
  outputField: string,
): Array<{ member: IfsEnsMemberBundleResult["selection"]["members"][number]; value: number; cacheHit: boolean }> {
  if (!result.members) {
    throw new Error("IFS/IFS ENS comparison requires internal member payloads");
  }
  return result.members.map((sample) => {
    const values = sample.pressureValues.find(
      (candidate) =>
        candidate.variable === variable
        && candidate.pressureLevelHpa === pressureLevelHpa,
    )?.values;
    const value = values?.[outputField];
    if (value === undefined) {
      throw new Error(
        `IFS ENS ${sample.member} is missing comparison output ${outputField}`,
      );
    }
    return {
      member: sample.member,
      value,
      cacheHit: sample.cacheHit,
    };
  });
}
