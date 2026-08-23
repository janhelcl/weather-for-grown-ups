import { sortGefsMembers } from "../catalog/gefs.js";
import { VARIABLE_CATALOG, type RawVariableDefinition } from "../catalog/variables.js";
import type { GefsEnsembleQueryInput, GefsEnsembleResult } from "../schema/gefs-ensemble.js";
import {
  gfsGefsComparisonQuerySchema,
  gfsGefsComparisonResultSchema,
  type GfsGefsComparisonQueryInput,
  type GfsGefsComparisonResult,
} from "../schema/gfs-gefs-comparison.js";
import type { ProfileQueryInput } from "../schema/query.js";
import type { ProfileLevel, ProfileResult } from "./types.js";
import { GefsEnsembleService } from "./gefs-ensemble.js";
import { gefsForecastHour, parseGefsRun } from "./gefs-time.js";
import { GfsGefsAlignedRunResolver, type GfsGefsAlignedRunProvider } from "./gfs-gefs-aligned-run.js";
import { ProfileService } from "./profile.js";

export interface GfsProfileGetter {
  getProfile(query: ProfileQueryInput): Promise<ProfileResult>;
}

export interface GefsEnsembleGetter {
  getEnsemble(query: GefsEnsembleQueryInput): Promise<GefsEnsembleResult>;
}

export interface GfsGefsComparisonServiceOptions {
  profileGetter?: GfsProfileGetter;
  ensembleGetter?: GefsEnsembleGetter;
  alignedRunProvider?: GfsGefsAlignedRunProvider;
}

export class GfsGefsComparisonService {
  private readonly profileGetter: GfsProfileGetter;
  private readonly ensembleGetter: GefsEnsembleGetter;
  private readonly alignedRunProvider: GfsGefsAlignedRunProvider;

  constructor(options: GfsGefsComparisonServiceOptions = {}) {
    this.profileGetter = options.profileGetter ?? new ProfileService();
    this.ensembleGetter = options.ensembleGetter ?? new GefsEnsembleService();
    this.alignedRunProvider = options.alignedRunProvider ?? new GfsGefsAlignedRunResolver();
  }

  async compare(input: GfsGefsComparisonQueryInput): Promise<GfsGefsComparisonResult> {
    const query = gfsGefsComparisonQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortGefsMembers(query.members);
    const variable = VARIABLE_CATALOG[query.variable] as RawVariableDefinition;
    const run = query.run === "latest"
      ? await this.alignedRunProvider.resolveLatestAlignedRun(
          validTime,
          variable.gfsCode,
          query.pressureLevelHpa,
          members,
        )
      : parseGefsRun(query.run);
    const forecastHour = gefsForecastHour(run, validTime);
    const runIso = run.toISOString();

    const [gfs, gefs] = await Promise.all([
      this.profileGetter.getProfile({
        latitude: query.latitude,
        longitude: query.longitude,
        run: runIso,
        validTime: query.validTime,
        variables: [query.variable],
        pressureLevelsHpa: [query.pressureLevelHpa],
        source: "s3",
      }),
      this.ensembleGetter.getEnsemble({
        latitude: query.latitude,
        longitude: query.longitude,
        run: runIso,
        validTime: query.validTime,
        variable: query.variable,
        pressureLevelHpa: query.pressureLevelHpa,
        members,
        quantiles: query.quantiles,
      }),
    ]);

    if (gfs.run !== runIso || gefs.run !== runIso) {
      throw new Error("GFS/GEFS comparison received data from inconsistent initialization cycles");
    }
    if (gfs.validTime !== gefs.validTime || gfs.forecastHour !== gefs.forecastHour) {
      throw new Error("GFS/GEFS comparison received inconsistent valid-time semantics");
    }

    const level = gfs.levels.find((candidate) => candidate.pressureHpa === query.pressureLevelHpa);
    if (!level) throw new Error(`GFS comparison profile is missing ${query.pressureLevelHpa} hPa`);
    const deterministicValue = rawProfileValue(level, query.variable);
    const ensembleValues = gefs.members.map((sample) => sample.value);
    const membersBelow = ensembleValues.filter((value) => value < deterministicValue).length;
    const membersAtOrBelow = ensembleValues.filter((value) => value <= deterministicValue).length;
    const meanDifference = deterministicValue - gefs.summary.mean;
    const standardizedDifference = gefs.summary.populationStdDev === 0
      ? null
      : meanDifference / gefs.summary.populationStdDev;
    const rangePosition = deterministicValue < gefs.summary.min
      ? "below_member_min" as const
      : deterministicValue > gefs.summary.max
        ? "above_member_max" as const
        : "within_member_range" as const;

    const output = variable.outputs[0];
    return gfsGefsComparisonResultSchema.parse({
      run: runIso,
      validTime: query.validTime,
      forecastHour,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      selection: {
        variable: query.variable,
        gfsCode: variable.gfsCode,
        pressureLevelHpa: query.pressureLevelHpa,
        outputField: output.field,
        unit: output.unit,
      },
      deterministicGfs: {
        model: "gfs_0p25",
        gridPoint: gfs.gridPoint,
        value: deterministicValue,
        source: gfs.source,
      },
      gefs: {
        model: "gefs_0p50",
        gridPoint: gefs.gridPoint,
        members: gefs.members,
        summary: gefs.summary,
        source: gefs.source,
      },
      comparison: {
        deterministicMinusEnsembleMean: meanDifference,
        standardizedDifference,
        membersBelowDeterministic: membersBelow,
        membersAtOrBelowDeterministic: membersAtOrBelow,
        fractionMembersBelowDeterministic: membersBelow / ensembleValues.length,
        fractionMembersAtOrBelowDeterministic: membersAtOrBelow / ensembleValues.length,
        rangePosition,
        outsideMemberRange: rangePosition !== "within_member_range",
        interpretation: "raw_model_vs_raw_ensemble_distribution_not_calibrated_uncertainty",
      },
    });
  }
}

function rawProfileValue(
  level: ProfileLevel,
  variable: GfsGefsComparisonQueryInput["variable"],
): number {
  const value = variable === "temperature"
    ? level.temperatureC
    : variable === "relative_humidity"
      ? level.relativeHumidityPct
      : variable === "u_wind"
        ? level.uWindMs
        : variable === "v_wind"
          ? level.vWindMs
          : level.geopotentialHeightGpm;
  if (value === undefined) {
    throw new Error(`GFS comparison profile is missing ${variable}@${level.pressureHpa}mb`);
  }
  return value;
}
