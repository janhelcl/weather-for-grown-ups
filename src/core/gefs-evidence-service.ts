import { homedir } from "node:os";
import { join } from "node:path";
import { ProfileEvidenceCache } from "../cache/profile-evidence-cache.js";
import {
  GEFS_PGRB2A_FIELD_CATALOG,
  type GefsPgrb2aFieldId,
} from "../catalog/gefs-fields.js";
import {
  gefsProfileRawDependencies,
  isNativeGefsPressureVariable,
  sortGefsMembers,
  type GefsMember,
  type GefsPressureVariableId,
  type GefsProfileVariableId,
} from "../catalog/gefs.js";
import { VARIABLE_CATALOG, type RawVariableDefinition } from "../catalog/variables.js";
import { deriveSpecificHumidityFromRelativeHumidityKgKg } from "../derived/humidity.js";
import {
  deriveParcelComputation,
  type ParcelEnvironmentLevel,
} from "../derived/parcel-diagnostics.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import type { NonIsobaricGribSelector } from "../grib/index.js";
import {
  gefsEnsembleProfileQuerySchema,
  gefsEnsembleProfileResultSchema,
  type GefsEnsembleProfileQueryInput,
  type GefsEnsembleProfileResult,
} from "../schema/gefs-ensemble-profile.js";
import {
  gefsMemberBundleQuerySchema,
  gefsMemberBundleResultSchema,
  type GefsMemberBundleQueryInput,
  type GefsMemberBundleResult,
} from "../schema/gefs-member-bundle.js";
import {
  gefsParcelDiagnosticsQuerySchema,
  gefsParcelDiagnosticsResultSchema,
  type GefsParcelDiagnosticsQueryInput,
  type GefsParcelDiagnosticsResult,
} from "../schema/gefs-parcel-diagnostics.js";
import type { GefsMemberSelectionSource } from "../cache/gefs-s3-subset-cache.js";
import { GefsS3SubsetCache } from "../cache/gefs-s3-subset-cache.js";
import type { GefsAtmosProduct } from "../sources/gefs-s3.js";
import { gefsAtmosProductForSelection } from "../sources/gefs-s3.js";
import { mapConcurrent } from "./concurrency.js";
import {
  prepareGefsBundleSelection,
  summarizeGefsMemberBundles,
  type DecodedGefsMemberBundle,
} from "./gefs-bundle-decoder.js";
import { DEFAULT_GEFS_MEMBER_CONCURRENCY, type GefsPointDecoder } from "./gefs-ensemble.js";
import { GefsMemberBundleService } from "./gefs-member-bundle.js";
import {
  GefsLatestRunResolver,
  type GefsLatestRunProvider,
} from "./gefs-latest-run.js";
import { deriveGefsProfileValue, gefsRawPressureKey } from "./gefs-profile-derivation.js";
import { gefsForecastHour, parseGefsRun } from "./gefs-time.js";
import { summarizeEnsembleParcels } from "./ensemble-diagnostic-summaries.js";
import { memberValuesToLevels } from "./atmospheric-profile.js";
import type { ProfileLevel } from "./types.js";

const sharedBundleStores = new Map<string, ProfileEvidenceCache<GefsMemberBundleResult>>();
const sharedOrographyStores = new Map<string, ProfileEvidenceCache<GefsOrographySample>>();

export interface GefsBundleGetter {
  getBundle(
    input: GefsMemberBundleQueryInput,
    productOverride?: GefsAtmosProduct,
  ): Promise<GefsMemberBundleResult>;
}

export interface GefsMemberBundleEvidenceServiceOptions {
  cacheDir?: string;
  bundleGetter?: GefsBundleGetter;
  latestRunProvider?: GefsLatestRunProvider;
  evidenceCache?: ProfileEvidenceCache<GefsMemberBundleResult>;
}

/**
 * Persistent member-first GEFS evidence. Underlying acquisition always retains
 * member values internally, even when the public request asks only for compact
 * summaries, so a later nonlinear diagnostic can reuse the same decoded
 * population instead of fetching and decoding every member again.
 */
export class GefsMemberBundleEvidenceService implements GefsBundleGetter {
  private readonly bundleGetter: GefsBundleGetter;
  private readonly latestRunProvider: GefsLatestRunProvider;
  private readonly evidence: ProfileEvidenceCache<GefsMemberBundleResult>;

  constructor(options: GefsMemberBundleEvidenceServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.latestRunProvider = options.latestRunProvider ?? new GefsLatestRunResolver();
    this.bundleGetter = options.bundleGetter ?? new GefsMemberBundleService({
      cacheDir,
      latestRunProvider: this.latestRunProvider,
    });
    this.evidence = options.evidenceCache
      ?? sharedBundleStore(join(cacheDir, "evidence", "gefs-member-bundle"));
  }

  async getBundle(
    input: GefsMemberBundleQueryInput,
    productOverride?: GefsAtmosProduct,
  ): Promise<GefsMemberBundleResult> {
    const query = gefsMemberBundleQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortGefsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const pressureLevelsHpa = [...query.selection.pressureLevelsHpa].sort((a, b) => b - a);
    const rawPressureVariables = rawDependencies(query.selection.variables);
    const evidenceVariables = uniqueVariables([
      ...query.selection.variables,
      ...rawPressureVariables,
    ]);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, members)
      : parseGefsRun(query.run);
    const forecastHour = gefsForecastHour(run, validTime);
    const product = productOverride ?? gefsAtmosProductForSelection(
      evidenceVariables.length > 0,
      forecastHour,
    );
    const resolvedQuery = {
      ...query,
      run: run.toISOString(),
      members,
      quantiles,
      selection: {
        variables: query.selection.variables,
        pressureLevelsHpa,
        fields: query.selection.fields,
      },
    };
    const identity = {
      dataset: "gefs",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      latitude: query.latitude,
      longitude: query.longitude,
      variant: product,
      source: "noaa-aws",
      population: members.join(","),
    };
    const selection = {
      pressureVariables: rawPressureVariables,
      pressureLevelsHpa,
      fields: query.selection.fields,
    };

    const cached = await this.evidence.find(identity, selection);
    if (cached !== undefined) return projectBundle(cached, resolvedQuery, true);

    const acquired = await this.bundleGetter.getBundle({
      ...resolvedQuery,
      selection: {
        variables: evidenceVariables,
        pressureLevelsHpa,
        fields: query.selection.fields,
      },
      includeMembers: true,
    }, product);
    if (acquired.members === undefined) {
      throw new Error("GEFS evidence acquisition must retain member values");
    }
    await this.evidence.put(identity, selection, acquired);
    return projectBundle(acquired, resolvedQuery, false);
  }
}

export interface GefsEnsembleProfileEvidenceServiceOptions {
  bundleGetter?: GefsBundleGetter;
}

/** Adapter from reusable mixed member bundles to the established profile view. */
export class GefsEnsembleProfileEvidenceService {
  private readonly bundleGetter: GefsBundleGetter;

  constructor(options: GefsEnsembleProfileEvidenceServiceOptions = {}) {
    this.bundleGetter = options.bundleGetter ?? new GefsMemberBundleEvidenceService();
  }

  async getProfile(input: GefsEnsembleProfileQueryInput): Promise<GefsEnsembleProfileResult> {
    const query = gefsEnsembleProfileQuerySchema.parse(input);
    const bundle = await this.bundleGetter.getBundle({
      latitude: query.latitude,
      longitude: query.longitude,
      run: query.run,
      validTime: query.validTime,
      selection: {
        variables: query.variables,
        pressureLevelsHpa: query.pressureLevelsHpa,
        fields: [],
      },
      members: query.members,
      quantiles: query.quantiles,
      includeMembers: true,
    }, "pgrb2a_0p50");
    if (bundle.members === undefined) throw new Error("GEFS profile evidence is missing member values");

    return gefsEnsembleProfileResultSchema.parse({
      model: "gefs_0p50",
      run: bundle.run,
      validTime: bundle.validTime,
      forecastHour: bundle.forecastHour,
      requestedPoint: bundle.requestedPoint,
      gridPoint: bundle.gridPoint,
      selection: {
        variables: query.variables,
        pressureLevelsHpa: [...query.pressureLevelsHpa].sort((a, b) => b - a),
        members: bundle.selection.members,
        quantiles: bundle.selection.quantiles,
      },
      summaries: bundle.pressureSummaries.map((summary) => {
        const raw = isNativeGefsPressureVariable(summary.variable)
          ? VARIABLE_CATALOG[summary.variable] as RawVariableDefinition
          : undefined;
        return {
          variable: summary.variable,
          ...(raw === undefined
            ? { dependencies: gefsProfileRawDependencies(summary.variable) }
            : { gfsCode: raw.gfsCode }),
          pressureLevelHpa: summary.pressureLevelHpa,
          outputField: summary.outputField,
          unit: summary.unit,
          ...summary.distribution,
        };
      }),
      ...(query.includeMembers
        ? {
            members: bundle.members.map((member) => ({
              member: member.member,
              cacheHit: member.cacheHit,
              values: member.pressureValues,
            })),
          }
        : {}),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: bundle.source.decoder,
        product: "pgrb2a_0p50",
        allCacheHit: bundle.source.allCacheHit,
      },
    });
  }
}

interface GefsOrographySample {
  heightGpm: number;
  gridPoint: { latitude: number; longitude: number };
  cacheHit: boolean;
}

interface GefsOrographyGetter {
  getOrography(input: {
    run: Date;
    member: GefsMember;
    latitude: number;
    longitude: number;
  }): Promise<GefsOrographySample>;
}

class GefsSurfaceOrographyEvidenceService implements GefsOrographyGetter {
  private readonly source: GefsMemberSelectionSource;
  private readonly decoder: GefsPointDecoder;
  private readonly evidence: ProfileEvidenceCache<GefsOrographySample>;

  constructor(options: {
    cacheDir?: string;
    source?: GefsMemberSelectionSource;
    decoder?: GefsPointDecoder;
    evidenceCache?: ProfileEvidenceCache<GefsOrographySample>;
  } = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new GefsS3SubsetCache(join(cacheDir, "gefs-s3"));
    this.decoder = options.decoder ?? new Wgrib2Decoder();
    this.evidence = options.evidenceCache
      ?? sharedOrographyStore(join(cacheDir, "evidence", "gefs-orography"));
  }

  async getOrography(input: {
    run: Date;
    member: GefsMember;
    latitude: number;
    longitude: number;
  }): Promise<GefsOrographySample> {
    const identity = {
      dataset: "gefs",
      run: input.run.toISOString(),
      validTime: input.run.toISOString(),
      latitude: input.latitude,
      longitude: input.longitude,
      variant: "pgrb2a_0p50-f000-orography",
      source: "noaa-aws",
      population: input.member,
    };
    const selection = {
      pressureVariables: [],
      pressureLevelsHpa: [],
      fields: ["surface_geopotential_height"],
    };
    const cached = await this.evidence.find(identity, selection);
    if (cached !== undefined) return { ...cached, cacheHit: true };

    const file = await this.source.fetchSelection({
      run: input.run,
      forecastHour: 0,
      member: input.member,
      variableCodes: [],
      pressureLevelsHpa: [],
      fields: [SURFACE_GEOPOTENTIAL_SELECTOR],
      product: "pgrb2a_0p50",
    });
    const values = await this.decoder.extractPoint(file.path, input.longitude, input.latitude);
    const value = values.find((candidate) => candidate.code === "HGT" && candidate.surface === true);
    if (value === undefined) throw new Error(`GEFS ${input.member} f000 orography is missing surface HGT`);
    const result = {
      heightGpm: value.value,
      gridPoint: value.gridPoint,
      cacheHit: file.cacheHit,
    };
    await this.evidence.put(identity, selection, result);
    return result;
  }
}

export interface GefsParcelDiagnosticsEvidenceServiceOptions {
  bundleGetter?: GefsBundleGetter;
  orographyGetter?: GefsOrographyGetter;
  memberConcurrency?: number;
}

/** Member-first parcel physics over the same reusable GEFS bundle as raw queries. */
export class GefsParcelDiagnosticsEvidenceService {
  private readonly bundleGetter: GefsBundleGetter;
  private readonly orographyGetter: GefsOrographyGetter;
  private readonly memberConcurrency: number;

  constructor(options: GefsParcelDiagnosticsEvidenceServiceOptions = {}) {
    this.bundleGetter = options.bundleGetter ?? new GefsMemberBundleEvidenceService();
    this.orographyGetter = options.orographyGetter ?? new GefsSurfaceOrographyEvidenceService();
    this.memberConcurrency = options.memberConcurrency ?? DEFAULT_GEFS_MEMBER_CONCURRENCY;
  }

  async getParcelDiagnostics(
    input: GefsParcelDiagnosticsQueryInput,
  ): Promise<GefsParcelDiagnosticsResult> {
    const query = gefsParcelDiagnosticsQuerySchema.parse(input);
    const members = sortGefsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const pressureLevelsHpa = [...query.pressureLevelsHpa].sort((a, b) => b - a);
    const bundle = await this.bundleGetter.getBundle({
      latitude: query.latitude,
      longitude: query.longitude,
      run: query.run,
      validTime: query.validTime,
      selection: {
        variables: ["temperature", "relative_humidity", "geopotential_height"],
        pressureLevelsHpa,
        fields: ["surface_pressure", "temperature_2m", "relative_humidity_2m"],
      },
      members,
      quantiles,
      includeMembers: true,
    }, "pgrb2a_0p50");
    if (bundle.members === undefined) throw new Error("GEFS parcel evidence is missing member values");
    const run = new Date(bundle.run);

    const derivedMembers = await mapConcurrent(
      bundle.members,
      this.memberConcurrency,
      async (member) => {
        const orography = await this.orographyGetter.getOrography({
          run,
          member: member.member,
          latitude: query.latitude,
          longitude: query.longitude,
        });
        assertSameGrid(bundle.gridPoint, orography.gridPoint, member.member);
        const levels = parcelLevels(pressureLevelsHpa, member.pressureValues);
        const surfacePressurePa = memberFieldValue(member.fields, "surface_pressure", "pressurePa");
        const surfaceTemperatureC = memberFieldValue(member.fields, "temperature_2m", "temperatureC");
        const surfaceRelativeHumidityPct = memberFieldValue(
          member.fields,
          "relative_humidity_2m",
          "relativeHumidityPct",
        );
        const surface: ParcelEnvironmentLevel = {
          pressureHpa: surfacePressurePa / 100,
          geopotentialHeightGpm: orography.heightGpm,
          temperatureC: surfaceTemperatureC,
          specificHumidityKgKg: deriveSpecificHumidityFromRelativeHumidityKgKg(
            surfaceTemperatureC,
            surfaceRelativeHumidityPct,
            surfacePressurePa / 100,
          ),
        };
        const parcel = deriveParcelComputation(
          query.parcel,
          surface,
          levels.map((level) => ({
            pressureHpa: level.pressureHpa,
            geopotentialHeightGpm: required(level.geopotentialHeightGpm, "geopotential height"),
            temperatureC: required(level.temperatureC, "temperature"),
            specificHumidityKgKg: required(level.specificHumidityKgKg, "specific humidity"),
          })),
        );
        return {
          member: member.member,
          forecastCacheHit: member.cacheHit,
          surfaceOrographyCacheHit: orography.cacheHit,
          levels,
          parcel,
        };
      },
    );

    return gefsParcelDiagnosticsResultSchema.parse({
      model: "gefs_0p50",
      run: bundle.run,
      validTime: bundle.validTime,
      forecastHour: bundle.forecastHour,
      requestedPoint: bundle.requestedPoint,
      gridPoint: bundle.gridPoint,
      sampledPressureLevelsHpa: pressureLevelsHpa,
      selection: { parcel: query.parcel, members, quantiles },
      methodology: {
        pressureMoisture: "temperature_relative_humidity_pressure_to_specific_humidity_per_member",
        surfaceMoisture: "2m_temperature_relative_humidity_surface_pressure_to_specific_humidity_per_member",
        surfaceOrography: "same_cycle_f000_surface_geopotential_height",
      },
      summary: summarizeEnsembleParcels(
        derivedMembers.map((member) => member.parcel),
        quantiles,
      ),
      ...(query.includeMembers ? { members: derivedMembers } : {}),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: bundle.source.decoder,
        product: "pgrb2a_0p50",
        allCacheHit: derivedMembers.every((member) =>
          member.forecastCacheHit && member.surfaceOrographyCacheHit),
      },
    });
  }
}

const SURFACE_GEOPOTENTIAL_SELECTOR: NonIsobaricGribSelector = {
  id: "surface_geopotential_height",
  gfsCode: "HGT",
  level: { gribLevel: "surface" },
  temporalSemantics: "instantaneous",
};

function projectBundle(
  evidence: GefsMemberBundleResult,
  query: ReturnType<typeof gefsMemberBundleQuerySchema.parse>,
  evidenceHit: boolean,
): GefsMemberBundleResult {
  if (evidence.members === undefined) throw new Error("Stored GEFS evidence is missing member values");
  const prepared = prepareGefsBundleSelection(query.selection);
  const rawIds = rawDependencies(query.selection.variables);
  const samples: DecodedGefsMemberBundle[] = evidence.members.map((member) => {
    const rawValues = new Map<string, number>();
    for (const pressureLevelHpa of prepared.pressureLevelsHpa) {
      for (const rawId of rawIds) {
        const value = member.pressureValues.find((candidate) =>
          candidate.variable === rawId && candidate.pressureLevelHpa === pressureLevelHpa,
        );
        if (value === undefined) {
          throw new Error(`Stored GEFS evidence is missing ${rawId}@${pressureLevelHpa}mb for ${member.member}`);
        }
        rawValues.set(gefsRawPressureKey(rawId, pressureLevelHpa), value.value);
      }
    }
    const pressureValues = prepared.pressureLevelsHpa.flatMap((pressureLevelHpa) =>
      prepared.variables.map((variable) => ({
        variable,
        pressureLevelHpa,
        value: deriveGefsProfileValue(variable, pressureLevelHpa, rawValues),
      })),
    );
    const requestedFields = new Set(prepared.fields);
    return {
      member: member.member,
      cacheHit: evidenceHit ? true : member.cacheHit,
      gridPoint: evidence.gridPoint,
      pressureValues,
      fields: member.fields.filter((field) => requestedFields.has(field.field)),
    };
  });
  const summaries = summarizeGefsMemberBundles(samples, prepared, query.quantiles);

  return gefsMemberBundleResultSchema.parse({
    model: "gefs_0p50",
    run: evidence.run,
    validTime: evidence.validTime,
    forecastHour: evidence.forecastHour,
    requestedPoint: evidence.requestedPoint,
    gridPoint: evidence.gridPoint,
    selection: {
      variables: prepared.variables,
      pressureLevelsHpa: prepared.pressureLevelsHpa,
      fields: prepared.fields,
      members: query.members,
      quantiles: query.quantiles,
    },
    ...summaries,
    ...(query.includeMembers
      ? {
          members: samples.map(({ member, cacheHit, pressureValues, fields }) => ({
            member,
            cacheHit,
            pressureValues,
            fields,
          })),
        }
      : {}),
    source: {
      ...evidence.source,
      allCacheHit: samples.every((sample) => sample.cacheHit),
    },
  });
}

function rawDependencies(variables: readonly GefsProfileVariableId[]): GefsPressureVariableId[] {
  const ids = new Set<GefsPressureVariableId>();
  for (const variable of variables) {
    for (const dependency of gefsProfileRawDependencies(variable)) ids.add(dependency);
  }
  return [...ids];
}

function uniqueVariables(
  variables: readonly GefsProfileVariableId[],
): GefsProfileVariableId[] {
  return [...new Set(variables)];
}

function parcelLevels(
  pressureLevelsHpa: readonly number[],
  values: readonly { variable: GefsProfileVariableId; pressureLevelHpa: number; value: number }[],
): ProfileLevel[] {
  return memberValuesToLevels(pressureLevelsHpa, values).map((level) => {
    const temperatureC = required(level.temperatureC, "temperature");
    const relativeHumidityPct = required(level.relativeHumidityPct, "relative humidity");
    return {
      ...level,
      specificHumidityKgKg: deriveSpecificHumidityFromRelativeHumidityKgKg(
        temperatureC,
        relativeHumidityPct,
        level.pressureHpa,
      ),
    };
  });
}

function memberFieldValue(
  fields: readonly { field: GefsPgrb2aFieldId; values: Record<string, number> }[],
  fieldId: GefsPgrb2aFieldId,
  output: string,
): number {
  const field = fields.find((candidate) => candidate.field === fieldId);
  const value = field?.values[output];
  if (value === undefined) throw new Error(`GEFS member evidence is missing ${fieldId}.${output}`);
  return value;
}

function required(value: number | undefined, name: string): number {
  if (value === undefined) throw new Error(`GEFS parcel evidence is missing ${name}`);
  return value;
}

function assertSameGrid(
  expected: { latitude: number; longitude: number },
  actual: { latitude: number; longitude: number },
  member: GefsMember,
): void {
  if (expected.latitude !== actual.latitude || expected.longitude !== actual.longitude) {
    throw new Error(`GEFS ${member} surface orography resolved to a different grid point`);
  }
}

function sharedBundleStore(rootDir: string): ProfileEvidenceCache<GefsMemberBundleResult> {
  const existing = sharedBundleStores.get(rootDir);
  if (existing !== undefined) return existing;
  const created = new ProfileEvidenceCache<GefsMemberBundleResult>(rootDir);
  sharedBundleStores.set(rootDir, created);
  return created;
}

function sharedOrographyStore(rootDir: string): ProfileEvidenceCache<GefsOrographySample> {
  const existing = sharedOrographyStores.get(rootDir);
  if (existing !== undefined) return existing;
  const created = new ProfileEvidenceCache<GefsOrographySample>(rootDir);
  sharedOrographyStores.set(rootDir, created);
  return created;
}
