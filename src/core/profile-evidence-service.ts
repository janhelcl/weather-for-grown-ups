import { homedir } from "node:os";
import { join } from "node:path";
import { expandRequestedFields } from "../catalog/non-isobaric-fields.js";
import {
  expandIfsPressureVariables,
  type IfsPressureVariableId,
  type IfsRawPressureVariableId,
} from "../catalog/ifs.js";
import {
  expandRequestedVariables,
  VARIABLE_CATALOG,
} from "../catalog/variables.js";
import {
  ProfileEvidenceCache,
  type ProfileEvidenceIdentity,
  type ProfileEvidenceSelection,
} from "../cache/profile-evidence-cache.js";
import {
  profileQuerySchema,
  type ProfileQueryInput,
  type VariableId,
} from "../schema/query.js";
import {
  ifsPointQuerySchema,
  type IfsPointQueryInput,
  type IfsProfileResult,
} from "../schema/ifs.js";
import { forecastHour, parseGfsRun } from "./forecast-hour.js";
import {
  LatestRunResolver,
  resolveLatestCompleteRunForGrid,
  resolveLatestRunForGrid,
  type LatestRunProvider,
} from "./latest-run.js";
import {
  IfsLatestRunResolver,
  type IfsLatestRunProvider,
} from "./ifs-latest-run.js";
import { ifsIndexSelectorsForSelection, IfsProfileService } from "./ifs-profile.js";
import { ifsForecastHour, parseIfsRun } from "./ifs-time.js";
import { applyDerivedPressureValues, ProfileService } from "./profile.js";
import type { ProfileLevel, ProfileResult } from "./types.js";

const sharedStores = new Map<string, ProfileEvidenceCache<unknown>>();

export interface GfsProfileEvidenceServiceOptions {
  cacheDir?: string;
  profileGetter?: Pick<ProfileService, "getProfile">;
  latestRunProvider?: LatestRunProvider;
  evidenceCache?: ProfileEvidenceCache<ProfileResult>;
}

/**
 * Run-resolved, persistent GFS profile evidence.
 *
 * The wrapped ProfileService remains the acquisition/decoding authority. This
 * layer only reuses a wider already-materialized column and projects it back to
 * the exact requested view, so diagnostics do not need a second public API or
 * a second upstream fetch/decode path.
 */
export class GfsProfileEvidenceService {
  private readonly profileGetter: Pick<ProfileService, "getProfile">;
  private readonly latestRunProvider: LatestRunProvider;
  private readonly evidence: ProfileEvidenceCache<ProfileResult>;

  constructor(options: GfsProfileEvidenceServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.latestRunProvider = options.latestRunProvider ?? new LatestRunResolver();
    this.profileGetter = options.profileGetter ?? new ProfileService({
      latestRunProvider: this.latestRunProvider,
    });
    this.evidence = options.evidenceCache
      ?? sharedStore<ProfileResult>(join(cacheDir, "evidence", "gfs-profile"));
  }

  async getProfile(input: ProfileQueryInput): Promise<ProfileResult> {
    const query = profileQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const variables = expandRequestedVariables(query.variables ?? []);
    const fields = expandRequestedFields(query.fields ?? []);
    const run = query.run === "latest"
      ? await resolveLatestRunForGrid(this.latestRunProvider, {
          type: "valid_time",
          validTime,
          selection: {
            variableCodes: variables.map((variable) => variable.gfsCode),
            pressureLevelsHpa: query.pressureLevelsHpa ?? [],
            fields,
          },
        }, query.grid)
      : query.run === "latest_complete"
        ? await resolveLatestCompleteRunForGrid(this.latestRunProvider, query.grid)
        : parseGfsRun(query.run);
    // Validate lead/grid semantics before consulting persisted evidence. A cache
    // entry must never make a now-invalid request appear valid.
    forecastHour(run, validTime, query.grid ?? "0p25");

    const resolved = { ...query, run: run.toISOString() };
    const identity = gfsIdentity(resolved);
    const selection = gfsSelection(resolved);
    const cached = await this.evidence.find(identity, selection);
    if (cached !== undefined) return projectGfsProfile(cached, resolved);

    const result = await this.profileGetter.getProfile(resolved);
    await this.evidence.put(identity, selection, result);
    return result;
  }
}

export interface IfsProfileEvidenceServiceOptions {
  cacheDir?: string;
  profileGetter?: Pick<IfsProfileService, "getProfile">;
  latestRunProvider?: IfsLatestRunProvider;
  evidenceCache?: ProfileEvidenceCache<IfsProfileResult>;
}

/** Persistent equivalent of GfsProfileEvidenceService for ECMWF IFS. */
export class IfsProfileEvidenceService {
  private readonly profileGetter: Pick<IfsProfileService, "getProfile">;
  private readonly latestRunProvider: IfsLatestRunProvider;
  private readonly evidence: ProfileEvidenceCache<IfsProfileResult>;

  constructor(options: IfsProfileEvidenceServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.latestRunProvider = options.latestRunProvider ?? new IfsLatestRunResolver({ cacheDir });
    this.profileGetter = options.profileGetter ?? new IfsProfileService({
      cacheDir,
      latestRunProvider: this.latestRunProvider,
    });
    this.evidence = options.evidenceCache
      ?? sharedStore<IfsProfileResult>(join(cacheDir, "evidence", "ifs-profile"));
  }

  async getProfile(input: IfsPointQueryInput): Promise<IfsProfileResult> {
    const query = ifsPointQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(
          validTime,
          ifsIndexSelectorsForSelection(query),
        )
      : parseIfsRun(query.run);
    ifsForecastHour(run, validTime);

    const resolved = { ...query, run: run.toISOString() };
    const identity = ifsIdentity(resolved);
    const selection = ifsSelection(resolved);
    const cached = await this.evidence.find(identity, selection);
    if (cached !== undefined) return projectIfsProfile(cached, resolved);

    const result = await this.profileGetter.getProfile(resolved);
    await this.evidence.put(identity, selection, result);
    return result;
  }
}

function gfsIdentity(query: ReturnType<typeof profileQuerySchema.parse>): ProfileEvidenceIdentity {
  return {
    dataset: "gfs",
    run: normalizeTime(query.run),
    validTime: normalizeTime(query.validTime),
    latitude: query.latitude,
    longitude: query.longitude,
    variant: query.grid ?? "0p25",
    source: query.source,
  };
}

function gfsSelection(query: ReturnType<typeof profileQuerySchema.parse>): ProfileEvidenceSelection {
  return {
    pressureVariables: expandRequestedVariables(query.variables ?? []).map((variable) => variable.gfsCode),
    pressureLevelsHpa: query.pressureLevelsHpa ?? [],
    // Final ProfileResult contains requested canonical fields, not every raw
    // dependency as an independently reusable field result.
    fields: query.fields ?? [],
  };
}

function projectGfsProfile(
  profile: ProfileResult,
  query: ReturnType<typeof profileQuerySchema.parse>,
): ProfileResult {
  const requestedVariables = query.variables ?? [];
  const allowedFields = gfsPressureOutputFields(requestedVariables);
  const pressureLevels = new Set(query.pressureLevelsHpa ?? []);
  const levels = profile.levels
    .filter((level) => pressureLevels.has(level.pressureHpa))
    .map((level) => projectLevel(level, allowedFields))
    .map((level) => {
      applyDerivedPressureValues(level, requestedVariables);
      return level;
    });
  const fields = projectFields(profile.fields, query.fields ?? []);
  const { fields: _cachedFields, ...base } = profile;

  return {
    ...base,
    levels,
    ...(fields.length === 0 ? {} : { fields }),
    source: { ...profile.source, cacheHit: true },
  };
}

function gfsPressureOutputFields(variables: readonly VariableId[]): Set<string> {
  const fields = new Set<string>();
  for (const raw of expandRequestedVariables([...variables])) {
    for (const output of raw.outputs) fields.add(output.field);
  }
  for (const variable of variables) {
    for (const output of VARIABLE_CATALOG[variable].outputs) fields.add(output.field);
  }
  return fields;
}

function ifsIdentity(query: ReturnType<typeof ifsPointQuerySchema.parse>): ProfileEvidenceIdentity {
  return {
    dataset: "ifs",
    run: normalizeTime(query.run),
    validTime: normalizeTime(query.validTime),
    latitude: query.latitude,
    longitude: query.longitude,
    variant: "ifs_0p25_oper_fc",
    source: "ecmwf-open-data",
  };
}

function ifsSelection(query: ReturnType<typeof ifsPointQuerySchema.parse>): ProfileEvidenceSelection {
  return {
    pressureVariables: expandIfsPressureVariables(query.variables ?? []),
    pressureLevelsHpa: query.pressureLevelsHpa ?? [],
    // Final IfsProfileResult contains canonical field results. Unlike pressure
    // levels, raw field dependencies are not retained independently, so field
    // reuse stays conservative until the requested canonical field exists.
    fields: query.fields ?? [],
  };
}

function projectIfsProfile(
  profile: IfsProfileResult,
  query: ReturnType<typeof ifsPointQuerySchema.parse>,
): IfsProfileResult {
  const requestedVariables = query.variables ?? [];
  const allowedFields = ifsPressureOutputFields(requestedVariables);
  const pressureLevels = new Set(query.pressureLevelsHpa ?? []);
  const levels = profile.levels
    .filter((level) => pressureLevels.has(level.pressureHpa))
    .map((level) => projectLevel(level, allowedFields))
    .map((level) => {
      applyDerivedPressureValues(level, requestedVariables as readonly VariableId[]);
      return level;
    });
  const fields = projectFields(profile.fields, query.fields ?? []);
  const { fields: _cachedFields, ...base } = profile;

  return {
    ...base,
    levels,
    ...(fields.length === 0 ? {} : { fields }),
    source: { ...profile.source, cacheHit: true },
  };
}

const IFS_RAW_OUTPUT_FIELD: Record<IfsRawPressureVariableId, string> = {
  temperature: "temperatureC",
  relative_humidity: "relativeHumidityPct",
  u_wind: "uWindMs",
  v_wind: "vWindMs",
  geopotential_height: "geopotentialHeightGpm",
  specific_humidity: "specificHumidityKgKg",
  vertical_velocity: "verticalVelocityPaS",
  relative_vorticity: "absoluteVorticityS1",
  divergence: "divergenceS1",
};

function ifsPressureOutputFields(variables: readonly IfsPressureVariableId[]): Set<string> {
  const fields = new Set<string>();
  for (const raw of expandIfsPressureVariables(variables)) fields.add(IFS_RAW_OUTPUT_FIELD[raw]);
  for (const variable of variables) {
    for (const output of VARIABLE_CATALOG[variable].outputs) fields.add(output.field);
  }
  return fields;
}

function projectLevel(level: ProfileLevel, allowedFields: ReadonlySet<string>): ProfileLevel {
  const projected: ProfileLevel = { pressureHpa: level.pressureHpa };
  const source = level as unknown as Record<string, unknown>;
  const target = projected as unknown as Record<string, unknown>;
  for (const field of allowedFields) {
    const value = source[field];
    if (typeof value === "number") target[field] = value;
  }
  return projected;
}

function projectFields<T extends { id: string }>(
  available: readonly T[] | undefined,
  requestedIds: readonly string[],
): T[] {
  if (available === undefined || requestedIds.length === 0) return [];
  const byId = new Map(available.map((field) => [field.id, field]));
  return requestedIds.map((id) => {
    const field = byId.get(id);
    if (field === undefined) throw new Error(`Cached profile evidence is missing requested field ${id}`);
    return field;
  });
}

function normalizeTime(value: string): string {
  return new Date(value).toISOString();
}

function sharedStore<T>(rootDir: string): ProfileEvidenceCache<T> {
  const existing = sharedStores.get(rootDir);
  if (existing !== undefined) return existing as ProfileEvidenceCache<T>;
  const created = new ProfileEvidenceCache<T>(rootDir);
  sharedStores.set(rootDir, created as ProfileEvidenceCache<unknown>);
  return created;
}
