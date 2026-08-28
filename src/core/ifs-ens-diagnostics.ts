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
import type { IfsFieldId, IfsPressureVariableId } from "../catalog/ifs.js";
import {
  expandLayerDiagnosticVariables,
  type LayerDiagnosticId,
} from "../catalog/layer-diagnostics.js";
import { PARCEL_DIAGNOSTIC_CATALOG } from "../catalog/parcel-diagnostics.js";
import {
  expandProfileDiagnosticVariables,
  type ProfileDiagnosticId,
} from "../catalog/profile-diagnostics.js";
import { deriveParcelComputation } from "../derived/parcel-diagnostics.js";
import {
  ifsEnsLayerDiagnosticsQuerySchema,
  ifsEnsLayerDiagnosticsResultSchema,
  ifsEnsParcelDiagnosticsQuerySchema,
  ifsEnsParcelDiagnosticsResultSchema,
  ifsEnsProfileDiagnosticsQuerySchema,
  ifsEnsProfileDiagnosticsResultSchema,
  type IfsEnsLayerDiagnosticsQueryInput,
  type IfsEnsLayerDiagnosticsResult,
  type IfsEnsParcelDiagnosticsQueryInput,
  type IfsEnsParcelDiagnosticsResult,
  type IfsEnsProfileDiagnosticsQueryInput,
  type IfsEnsProfileDiagnosticsResult,
} from "../schema/ifs-ens-diagnostics.js";
import type { IfsPointQueryInput } from "../schema/ifs.js";
import { mapConcurrent } from "./concurrency.js";
import {
  summarizeEnsembleLayerDiagnostics,
  summarizeEnsembleParcels,
  summarizeEnsembleProfileDiagnostics,
} from "./ensemble-diagnostic-summaries.js";
import {
  IfsEnsLatestRunResolver,
  type IfsEnsLatestRunProvider,
} from "./ifs-ens-latest-run.js";
import { IfsEnsMemberSelectionSource } from "./ifs-ens-member-source.js";
import {
  IfsProfileService,
  ifsIndexSelectorsForSelection,
  type IfsProfileSample,
} from "./ifs-profile.js";
import { ifsEnsForecastHour, parseIfsRun } from "./ifs-time.js";
import { parcelEnvironmentLevel, parcelSurfaceEnvironment } from "./parcel-diagnostics.js";
import {
  deriveLayerDiagnosticsFromLevels,
  deriveProfileDiagnosticsFromLevels,
} from "./pressure-diagnostics.js";
import type { ProfileLevel } from "./types.js";

export const DEFAULT_IFS_ENS_DIAGNOSTIC_MEMBER_CONCURRENCY = 4;

export interface IfsEnsMemberProfileGetter {
  getProfile(member: IfsEnsMember, input: IfsPointQueryInput): Promise<IfsProfileSample>;
}

export interface IfsEnsDiagnosticsServiceOptions {
  cacheDir?: string;
  source?: IfsSelectionSource;
  profileGetter?: IfsEnsMemberProfileGetter;
  latestRunProvider?: IfsEnsLatestRunProvider;
  concurrency?: number;
}

interface MemberProfile {
  member: IfsEnsMember;
  profile: IfsProfileSample;
}

export class IfsEnsDiagnosticsService {
  private readonly profileGetter: IfsEnsMemberProfileGetter;
  private readonly latestRunProvider: IfsEnsLatestRunProvider;
  private readonly concurrency: number;

  constructor(options: IfsEnsDiagnosticsServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const source = options.source ?? new IfsOpenDataSubsetCache(join(cacheDir, "ifs-open-data"));
    this.profileGetter = options.profileGetter ?? new DefaultIfsEnsMemberProfileGetter(source);
    this.latestRunProvider = options.latestRunProvider ?? new IfsEnsLatestRunResolver();
    this.concurrency = options.concurrency ?? DEFAULT_IFS_ENS_DIAGNOSTIC_MEMBER_CONCURRENCY;
  }

  async getLayerDiagnostics(
    input: IfsEnsLayerDiagnosticsQueryInput,
  ): Promise<IfsEnsLayerDiagnosticsResult> {
    const query = ifsEnsLayerDiagnosticsQuerySchema.parse(input);
    const diagnostics = [...new Set(query.diagnostics)] as LayerDiagnosticId[];
    const members = sortIfsEnsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const variables = expandLayerDiagnosticVariables(diagnostics) as IfsPressureVariableId[];
    const pressureLevelsHpa = [query.lowerPressureHpa, query.upperPressureHpa];

    const { run, forecastHour } = await this.resolveRun(
      query.run,
      new Date(query.validTime),
      members,
      { variables, pressureLevelsHpa },
    );
    const samples = await this.sampleMembers(members, {
      latitude: query.latitude,
      longitude: query.longitude,
      run: run.toISOString(),
      validTime: query.validTime,
      variables,
      pressureLevelsHpa,
    });
    const first = assertMemberProfiles(samples, run, query.validTime, forecastHour);

    const derivedMembers = samples.map(({ member, profile }) => {
      const derived = deriveLayerDiagnosticsFromLevels(
        profile.levels as ProfileLevel[],
        query.lowerPressureHpa,
        query.upperPressureHpa,
        diagnostics,
      );
      return {
        member,
        cacheHit: profile.source.cacheHit,
        ...derived,
      };
    });
    const aggregate = summarizeEnsembleLayerDiagnostics(diagnostics, derivedMembers, quantiles);

    return ifsEnsLayerDiagnosticsResultSchema.parse({
      model: "ifs_ens_0p25",
      run: run.toISOString(),
      validTime: query.validTime,
      forecastHour,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.profile.gridPoint,
      pressureLayer: {
        lowerPressureHpa: query.lowerPressureHpa,
        upperPressureHpa: query.upperPressureHpa,
      },
      selection: { diagnostics, members, quantiles },
      layerDepthGpm: aggregate.layerDepthGpm,
      summaries: aggregate.summaries,
      ...(query.includeMembers
        ? {
            members: derivedMembers.map(({ member, cacheHit, layer, diagnostics: values }) => ({
              member,
              cacheHit,
              layer,
              diagnostics: values,
            })),
          }
        : {}),
      source: ensembleSource(samples),
    });
  }

  async getProfileDiagnostics(
    input: IfsEnsProfileDiagnosticsQueryInput,
  ): Promise<IfsEnsProfileDiagnosticsResult> {
    const query = ifsEnsProfileDiagnosticsQuerySchema.parse(input);
    const diagnostics = [...new Set(query.diagnostics)] as ProfileDiagnosticId[];
    const members = sortIfsEnsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const pressureLevelsHpa = [...new Set(query.pressureLevelsHpa)].sort((a, b) => b - a);
    const variables = expandProfileDiagnosticVariables(diagnostics) as IfsPressureVariableId[];

    const { run, forecastHour } = await this.resolveRun(
      query.run,
      new Date(query.validTime),
      members,
      { variables, pressureLevelsHpa },
    );
    const samples = await this.sampleMembers(members, {
      latitude: query.latitude,
      longitude: query.longitude,
      run: run.toISOString(),
      validTime: query.validTime,
      variables,
      pressureLevelsHpa,
    });
    const first = assertMemberProfiles(samples, run, query.validTime, forecastHour);

    const derivedMembers = samples.map(({ member, profile }) => ({
      member,
      cacheHit: profile.source.cacheHit,
      levels: profile.levels as ProfileLevel[],
      diagnostics: deriveProfileDiagnosticsFromLevels(profile.levels as ProfileLevel[], diagnostics),
    }));

    return ifsEnsProfileDiagnosticsResultSchema.parse({
      model: "ifs_ens_0p25",
      run: run.toISOString(),
      validTime: query.validTime,
      forecastHour,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.profile.gridPoint,
      sampledPressureLevelsHpa: pressureLevelsHpa,
      selection: { diagnostics, members, quantiles },
      summaries: summarizeEnsembleProfileDiagnostics(diagnostics, derivedMembers, quantiles),
      ...(query.includeMembers
        ? {
            members: derivedMembers.map(({ member, cacheHit, levels, diagnostics: values }) => ({
              member,
              cacheHit,
              levels,
              diagnostics: values,
            })),
          }
        : {}),
      source: ensembleSource(samples),
    });
  }

  async getParcelDiagnostics(
    input: IfsEnsParcelDiagnosticsQueryInput,
  ): Promise<IfsEnsParcelDiagnosticsResult> {
    const query = ifsEnsParcelDiagnosticsQuerySchema.parse(input);
    const definition = PARCEL_DIAGNOSTIC_CATALOG[query.parcel];
    const members = sortIfsEnsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const pressureLevelsHpa = [...new Set(query.pressureLevelsHpa)].sort((a, b) => b - a);
    const variables = [...definition.pressureDependencies] as IfsPressureVariableId[];
    const fields = [...definition.fieldDependencies] as IfsFieldId[];

    const { run, forecastHour } = await this.resolveRun(
      query.run,
      new Date(query.validTime),
      members,
      { variables, pressureLevelsHpa, fields },
    );
    const samples = await this.sampleMembers(members, {
      latitude: query.latitude,
      longitude: query.longitude,
      run: run.toISOString(),
      validTime: query.validTime,
      variables,
      pressureLevelsHpa,
      fields,
    });
    const first = assertMemberProfiles(samples, run, query.validTime, forecastHour);

    const derivedMembers = samples.map(({ member, profile }) => ({
      member,
      cacheHit: profile.source.cacheHit,
      levels: profile.levels as ProfileLevel[],
      parcel: deriveParcelComputation(
        query.parcel,
        parcelSurfaceEnvironment(profile.fields ?? []),
        (profile.levels as ProfileLevel[]).map(parcelEnvironmentLevel),
      ),
    }));

    return ifsEnsParcelDiagnosticsResultSchema.parse({
      model: "ifs_ens_0p25",
      run: run.toISOString(),
      validTime: query.validTime,
      forecastHour,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.profile.gridPoint,
      sampledPressureLevelsHpa: pressureLevelsHpa,
      selection: { parcel: query.parcel, members, quantiles },
      methodology: {
        pressureMoisture: "ifs_specific_humidity_direct_per_member",
        surfaceMoisture: "2m_temperature_dew_point_surface_pressure_to_specific_humidity_per_member",
        surfaceOrography: "same_cycle_f000_surface_geopotential_height",
      },
      summary: summarizeEnsembleParcels(
        derivedMembers.map((member) => member.parcel),
        quantiles,
      ),
      ...(query.includeMembers
        ? {
            members: derivedMembers.map(({ member, cacheHit, levels, parcel }) => ({
              member,
              cacheHit,
              levels,
              parcel,
            })),
          }
        : {}),
      source: ensembleSource(samples),
    });
  }

  private async resolveRun(
    runSelector: string,
    validTime: Date,
    members: readonly IfsEnsMember[],
    selection: {
      variables?: readonly IfsPressureVariableId[];
      pressureLevelsHpa?: readonly number[];
      fields?: readonly IfsFieldId[];
    },
  ): Promise<{ run: Date; forecastHour: number }> {
    const baseSelectors = ifsIndexSelectorsForSelection(selection);
    const availabilitySelectors = members.flatMap((member) => {
      const number = ifsEnsMemberNumber(member);
      return baseSelectors.map((selector) => ({ ...selector, number }));
    });
    const run = runSelector === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, availabilitySelectors)
      : parseIfsRun(runSelector);
    return { run, forecastHour: ifsEnsForecastHour(run, validTime) };
  }

  private sampleMembers(
    members: readonly IfsEnsMember[],
    input: IfsPointQueryInput,
  ): Promise<MemberProfile[]> {
    return mapConcurrent(members, this.concurrency, async (member) => ({
      member,
      profile: await this.profileGetter.getProfile(member, input),
    }));
  }
}

class DefaultIfsEnsMemberProfileGetter implements IfsEnsMemberProfileGetter {
  constructor(private readonly source: IfsSelectionSource) {}

  getProfile(member: IfsEnsMember, input: IfsPointQueryInput): Promise<IfsProfileSample> {
    const service = new IfsProfileService({
      source: new IfsEnsMemberSelectionSource(this.source, ifsEnsMemberNumber(member)),
    });
    return service.getProfileSample(input, {
      forecastHourResolver: ifsEnsForecastHour,
      sourceProduct: "ifs_0p25_enfo_ef",
    });
  }
}

function assertMemberProfiles(
  samples: readonly MemberProfile[],
  run: Date,
  validTime: string,
  forecastHour: number,
): MemberProfile {
  const first = samples[0];
  if (!first) throw new Error("IFS ENS diagnostics produced no perturbation samples");
  const expectedRun = run.toISOString();
  const expectedValidTime = new Date(validTime).toISOString();
  for (const sample of samples) {
    const profile = sample.profile;
    if (
      profile.run !== expectedRun
      || profile.validTime !== expectedValidTime
      || profile.forecastHour !== forecastHour
    ) {
      throw new Error("IFS ENS diagnostic member profile drifted in run, valid time, or forecast hour");
    }
    if (
      profile.gridPoint.latitude !== first.profile.gridPoint.latitude
      || profile.gridPoint.longitude !== first.profile.gridPoint.longitude
    ) {
      throw new Error("IFS ENS diagnostic perturbations resolved to inconsistent grid points");
    }
    if (
      profile.source.product !== "ifs_0p25_enfo_ef"
      || profile.source.decoder !== first.profile.source.decoder
      || profile.source.horizontalGridDegrees !== 0.25
    ) {
      throw new Error("IFS ENS diagnostic perturbations resolved to inconsistent source provenance");
    }
  }
  return first;
}

function ensembleSource(samples: readonly MemberProfile[]) {
  const first = samples[0];
  if (!first) throw new Error("IFS ENS diagnostics produced no perturbation samples");
  return {
    provider: "ECMWF Open Data" as const,
    access: "indexed_http_range" as const,
    decoder: first.profile.source.decoder,
    product: "ifs_0p25_enfo_ef" as const,
    horizontalGridDegrees: 0.25 as const,
    allCacheHit: samples.every((sample) => sample.profile.source.cacheHit),
    memberSemantics: "50_perturbed_members_control_is_oper_fc" as const,
  };
}
