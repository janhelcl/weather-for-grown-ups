import { homedir } from "node:os";
import { join } from "node:path";
import {
  IfsOpenDataSubsetCache,
  type IfsSelectionSource,
} from "../cache/ifs-open-data-cache.js";
import {
  ifsEnsMemberNumber,
  sortIfsEnsMembers,
  type IfsEnsMember,
} from "../catalog/ifs-ens.js";
import {
  NON_ISOBARIC_FIELD_CATALOG,
  type NonIsobaricLevel,
} from "../catalog/non-isobaric-fields.js";
import { VARIABLE_CATALOG } from "../catalog/variables.js";
import {
  ifsEnsMemberBundleQuerySchema,
  ifsEnsMemberBundleResultSchema,
  type IfsEnsMemberBundleQueryInput,
  type IfsEnsMemberBundleResult,
  type IfsEnsSelection,
} from "../schema/ifs-ens.js";
import type { IfsProfileSample } from "./ifs-profile.js";
import { mapConcurrent } from "./concurrency.js";
import {
  summarizeCircularDegrees,
  summarizeNumericDistribution,
} from "./ensemble-statistics.js";
import {
  IfsEnsLatestRunResolver,
  type IfsEnsLatestRunProvider,
} from "./ifs-ens-latest-run.js";
import { IfsEnsMemberSelectionSource } from "./ifs-ens-member-source.js";
import { IfsProfileService, ifsIndexSelectorsForSelection } from "./ifs-profile.js";
import { ifsEnsForecastHour, parseIfsRun } from "./ifs-time.js";

export const DEFAULT_IFS_ENS_MEMBER_CONCURRENCY = 4;

export interface IfsEnsMemberBundleServiceOptions {
  cacheDir?: string;
  source?: IfsSelectionSource;
  latestRunProvider?: IfsEnsLatestRunProvider;
  concurrency?: number;
}

interface MemberSample {
  member: IfsEnsMember;
  profile: IfsProfileSample;
}

export class IfsEnsMemberBundleService {
  private readonly source: IfsSelectionSource;
  private readonly latestRunProvider: IfsEnsLatestRunProvider;
  private readonly concurrency: number;

  constructor(options: IfsEnsMemberBundleServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new IfsOpenDataSubsetCache(join(cacheDir, "ifs-open-data"));
    this.latestRunProvider = options.latestRunProvider ?? new IfsEnsLatestRunResolver();
    this.concurrency = options.concurrency ?? DEFAULT_IFS_ENS_MEMBER_CONCURRENCY;
  }

  async getBundle(input: IfsEnsMemberBundleQueryInput): Promise<IfsEnsMemberBundleResult> {
    const query = ifsEnsMemberBundleQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortIfsEnsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const baseSelectors = ifsIndexSelectorsForSelection(query.selection);
    const availabilitySelectors = members.flatMap((member) => {
      const number = ifsEnsMemberNumber(member);
      return baseSelectors.map((selector) => ({ ...selector, number }));
    });
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, availabilitySelectors)
      : parseIfsRun(query.run);
    const forecastHour = ifsEnsForecastHour(run, validTime);

    const samples = await mapConcurrent(members, this.concurrency, async (member): Promise<MemberSample> => {
      const source = new IfsEnsMemberSelectionSource(this.source, ifsEnsMemberNumber(member));
      const profile = await new IfsProfileService({ source }).getProfileSample({
        latitude: query.latitude,
        longitude: query.longitude,
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        ...(query.selection.variables.length === 0
          ? {}
          : {
              variables: query.selection.variables,
              pressureLevelsHpa: query.selection.pressureLevelsHpa,
            }),
        ...(query.selection.fields.length === 0 ? {} : { fields: query.selection.fields }),
      }, {
        forecastHourResolver: ifsEnsForecastHour,
        sourceProduct: "ifs_0p25_enfo_ef",
      });
      return { member, profile };
    });

    const first = samples[0];
    if (!first) throw new Error("IFS ENS produced no perturbation samples");
    for (const sample of samples) {
      if (
        sample.profile.gridPoint.latitude !== first.profile.gridPoint.latitude
        || sample.profile.gridPoint.longitude !== first.profile.gridPoint.longitude
      ) {
        throw new Error("IFS ENS perturbations resolved to inconsistent grid points");
      }
    }

    const memberValues = samples.map((sample) => projectMember(sample, query.selection));
    const pressureSummaries = summarizePressure(memberValues, query.selection, quantiles);
    const fieldSummaries = summarizeFields(memberValues, query.selection, quantiles);

    return ifsEnsMemberBundleResultSchema.parse({
      model: "ifs_ens_0p25",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.profile.gridPoint,
      selection: {
        variables: query.selection.variables,
        pressureLevelsHpa: [...query.selection.pressureLevelsHpa].sort((a, b) => b - a),
        fields: query.selection.fields,
        members,
        quantiles,
      },
      pressureSummaries,
      fieldSummaries,
      ...(query.includeMembers ? { members: memberValues } : {}),
      source: {
        provider: "ECMWF Open Data",
        access: "indexed_http_range",
        decoder: first.profile.source.decoder,
        product: "ifs_0p25_enfo_ef",
        horizontalGridDegrees: 0.25,
        allCacheHit: samples.every((sample) => sample.profile.source.cacheHit),
        memberSemantics: "50_perturbed_members_control_is_oper_fc",
      },
    });
  }
}


function projectMember(sample: MemberSample, selection: IfsEnsSelection) {
  const pressureValues = [...selection.pressureLevelsHpa]
    .sort((a, b) => b - a)
    .flatMap((pressureLevelHpa) => {
      const level = sample.profile.levels.find((candidate) => candidate.pressureHpa === pressureLevelHpa);
      if (!level) throw new Error(`IFS ENS ${sample.member} is missing ${pressureLevelHpa} hPa`);
      return selection.variables.map((variable) => {
        const definition = VARIABLE_CATALOG[variable];
        const values = Object.fromEntries(definition.outputs.map((output) => [
          output.field,
          requiredNumericOutput(level as unknown as Record<string, unknown>, output.field, `${variable}@${pressureLevelHpa}hPa`),
        ]));
        return { variable, pressureLevelHpa, values };
      });
    });

  const fields = selection.fields.map((field) => {
    const result = sample.profile.fields?.find((candidate) => candidate.id === field);
    if (!result) throw new Error(`IFS ENS ${sample.member} is missing field ${field}`);
    const definition = NON_ISOBARIC_FIELD_CATALOG[field];
    const values = Object.fromEntries(definition.outputs.map((output) => [
      output.field,
      requiredNumericOutput(result.values, output.field, field),
    ]));
    return { field, temporal: result.temporal, values };
  });

  return {
    member: sample.member,
    cacheHit: sample.profile.source.cacheHit,
    pressureValues,
    fields,
  };
}

function summarizePressure(
  samples: ReturnType<typeof projectMember>[],
  selection: IfsEnsSelection,
  quantiles: readonly number[],
) {
  return [...selection.pressureLevelsHpa]
    .sort((a, b) => b - a)
    .flatMap((pressureLevelHpa) =>
      selection.variables.map((variable) => {
        const definition = VARIABLE_CATALOG[variable];
        const memberValues = samples.map((sample) => {
          const value = sample.pressureValues.find((candidate) =>
            candidate.variable === variable && candidate.pressureLevelHpa === pressureLevelHpa,
          );
          if (!value) throw new Error(`IFS ENS aggregation is missing ${variable}@${pressureLevelHpa}hPa`);
          return value.values;
        });
        return {
          variable,
          pressureLevelHpa,
          outputs: definition.outputs.map((output) =>
            summarizeOutput(
              memberValues.map((values) => requiredNumericOutput(values, output.field, variable)),
              output.field,
              output.unit,
              quantiles,
            ),
          ),
        };
      }),
    );
}

function summarizeFields(
  samples: ReturnType<typeof projectMember>[],
  selection: IfsEnsSelection,
  quantiles: readonly number[],
) {
  return selection.fields.map((field) => {
    const definition = NON_ISOBARIC_FIELD_CATALOG[field];
    const memberFields = samples.map((sample) => {
      const value = sample.fields.find((candidate) => candidate.field === field);
      if (!value) throw new Error(`IFS ENS aggregation is missing field ${field}`);
      return value;
    });
    const temporal = memberFields[0]?.temporal;
    if (!temporal) throw new Error(`IFS ENS field ${field} produced no perturbation values`);
    for (const memberField of memberFields) {
      if (JSON.stringify(memberField.temporal) !== JSON.stringify(temporal)) {
        throw new Error(`IFS ENS field ${field} has inconsistent temporal semantics across perturbations`);
      }
    }
    return {
      field,
      level: publicLevel(definition.level),
      temporal,
      outputs: definition.outputs.map((output) =>
        summarizeOutput(
          memberFields.map((value) => requiredNumericOutput(value.values, output.field, field)),
          output.field,
          output.unit,
          quantiles,
        ),
      ),
    };
  });
}

function summarizeOutput(
  values: readonly number[],
  field: string,
  unit: string,
  quantiles: readonly number[],
) {
  if (field === "windDirectionDeg" && unit === "degree") {
    return {
      aggregation: "circular_direction" as const,
      field: "windDirectionDeg" as const,
      unit: "degree" as const,
      ...summarizeCircularDegrees(values),
    };
  }
  return {
    aggregation: "numeric_distribution" as const,
    field,
    unit,
    distribution: summarizeNumericDistribution(values, quantiles),
  };
}

function publicLevel(level: NonIsobaricLevel) {
  switch (level.type) {
    case "surface": return { type: "surface" as const };
    case "height_above_ground_m":
      return { type: "height_above_ground_m" as const, heightM: level.heightM };
    case "named_layer": return { type: "named_layer" as const, id: level.id };
    case "named_level": return { type: "named_level" as const, id: level.id };
  }
}

function requiredNumericOutput(
  values: Readonly<Record<string, unknown>>,
  field: string,
  context: string,
): number {
  const value = values[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`IFS ENS ${context} is missing numeric output ${field}`);
  }
  return value;
}
