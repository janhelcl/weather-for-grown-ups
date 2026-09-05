import { homedir } from "node:os";
import { join } from "node:path";
import {
  NON_ISOBARIC_FIELD_CATALOG,
  type NonIsobaricFieldDefinition,
} from "../catalog/non-isobaric-fields.js";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import { CachedGfsAnalysisFileStore, CachedGfsAnalysisSource } from "../cache/historical-gfs-cache.js";
import { RoutedGfsAnalysisSource } from "../sources/gfs-analysis-routed.js";
import type {
  HistoricalAnalysisDataSource,
  HistoricalAnalysisPointResponse,
  HistoricalAnalysisPointRow,
} from "../sources/gfs-analysis.js";
import { deriveWind } from "../derived/wind.js";
import {
  historicalFieldsQuerySchema,
  type HistoricalFieldsQueryInput,
  type HistoricalFieldsResult,
  type HistoricalGfsFieldId,
} from "../schema/history-fields.js";
import type { HistoricalProfileQueryInput } from "../schema/history.js";
import { isoDateTimeSchema } from "../schema/query.js";
import type { HistoricalProfileResult } from "../schema/history-result.js";
import { NCEI_GFS_GRID4_ANALYSIS_START } from "../sources/ncei-gfs-history.js";
import { HistoricalProfileService } from "./history.js";

const CAVEAT = "GFS model analysis fields; not direct observations or homogeneous climatological reanalysis" as const;

type HistoricalRawFieldId = Exclude<HistoricalGfsFieldId, "wind_10m" | "wind_80m" | "wind_100m">;
type HistoricalFieldGroup = "scalar" | "temperature_hag" | "moisture_2m" | "specific_humidity_hag" | "pressure_hag" | "wind_hag";

type HistoricalFieldResult = HistoricalFieldsResult["fields"][number];
type HistoricalFieldLevel = HistoricalFieldResult["level"];

interface HistoricalRawFieldDefinition {
  id: HistoricalRawFieldId;
  group: HistoricalFieldGroup;
  heightM?: number;
  transform(value: number): number;
}

const identity = (value: number) => value;
const kelvinToCelsius = (value: number) => value - 273.15;

const RAW_FIELDS: Record<HistoricalRawFieldId, HistoricalRawFieldDefinition> = {
  surface_pressure: raw("surface_pressure", "scalar", identity),
  surface_geopotential_height: raw("surface_geopotential_height", "scalar", identity),
  surface_temperature: raw("surface_temperature", "scalar", kelvinToCelsius),
  surface_cape: raw("surface_cape", "scalar", identity),
  surface_cin: raw("surface_cin", "scalar", identity),
  temperature_2m: rawHeight("temperature_2m", "temperature_hag", 2, kelvinToCelsius),
  relative_humidity_2m: rawHeight("relative_humidity_2m", "moisture_2m", 2, identity),
  specific_humidity_2m: rawHeight("specific_humidity_2m", "specific_humidity_hag", 2, identity),
  dew_point_2m: rawHeight("dew_point_2m", "moisture_2m", 2, kelvinToCelsius),
  u_wind_10m: rawHeight("u_wind_10m", "wind_hag", 10, identity),
  v_wind_10m: rawHeight("v_wind_10m", "wind_hag", 10, identity),
  temperature_80m: rawHeight("temperature_80m", "temperature_hag", 80, kelvinToCelsius),
  specific_humidity_80m: rawHeight("specific_humidity_80m", "specific_humidity_hag", 80, identity),
  pressure_80m: rawHeight("pressure_80m", "pressure_hag", 80, identity),
  u_wind_80m: rawHeight("u_wind_80m", "wind_hag", 80, identity),
  v_wind_80m: rawHeight("v_wind_80m", "wind_hag", 80, identity),
  temperature_100m: rawHeight("temperature_100m", "temperature_hag", 100, kelvinToCelsius),
  u_wind_100m: rawHeight("u_wind_100m", "wind_hag", 100, identity),
  v_wind_100m: rawHeight("v_wind_100m", "wind_hag", 100, identity),
  precipitable_water: raw("precipitable_water", "scalar", identity),
  total_column_cloud_water: raw("total_column_cloud_water", "scalar", identity),
  column_relative_humidity: raw("column_relative_humidity", "scalar", identity),
  total_column_ozone: raw("total_column_ozone", "scalar", identity),
};

const WIND_DEPENDENCIES: Record<"wind_10m" | "wind_80m" | "wind_100m", readonly [HistoricalRawFieldId, HistoricalRawFieldId]> = {
  wind_10m: ["u_wind_10m", "v_wind_10m"],
  wind_80m: ["u_wind_80m", "v_wind_80m"],
  wind_100m: ["u_wind_100m", "v_wind_100m"],
};

export interface HistoricalFieldsProfileGetter {
  getHistoricalProfile(input: HistoricalProfileQueryInput): Promise<HistoricalProfileResult>;
}

export interface HistoricalFieldsServiceOptions {
  cacheDir?: string;
  accessPolicy?: UpstreamAccessPolicy;
  source?: HistoricalAnalysisDataSource;
  profileGetter?: HistoricalFieldsProfileGetter;
  now?: () => Date;
  allowNonAnalysisCycle?: boolean;
  minimumTime?: Date;
  nativeSpecificHumidity?: boolean;
}

export class HistoricalFieldsService {
  private readonly source: HistoricalAnalysisDataSource;
  private readonly profileGetter: HistoricalFieldsProfileGetter;
  private readonly now: () => Date;
  private readonly allowNonAnalysisCycle: boolean;
  private readonly minimumTime: Date;

  constructor(options: HistoricalFieldsServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const accessPolicy = options.accessPolicy
      ?? new FileAccessPolicy(join(cacheDir, "state"), UPSTREAM_ACCESS_POLICIES.nceiThredds);
    const awsAccessPolicy = new FileAccessPolicy(join(cacheDir, "state"), UPSTREAM_ACCESS_POLICIES.noaaAws);
    this.source = options.source ?? new CachedGfsAnalysisSource(
      join(cacheDir, "gfs-analysis"),
      new RoutedGfsAnalysisSource({
        nceiAccessPolicy: accessPolicy,
        awsAccessPolicy,
        fileStore: new CachedGfsAnalysisFileStore(join(cacheDir, "gfs-analysis-fileserver")),
      }),
    );
    this.now = options.now ?? (() => new Date());
    this.allowNonAnalysisCycle = options.allowNonAnalysisCycle ?? false;
    this.minimumTime = options.minimumTime ?? NCEI_GFS_GRID4_ANALYSIS_START;
    this.profileGetter = options.profileGetter ?? new HistoricalProfileService({
      source: this.source,
      now: this.now,
      allowNonAnalysisCycle: this.allowNonAnalysisCycle,
      minimumTime: this.minimumTime,
      nativeSpecificHumidity: options.nativeSpecificHumidity ?? false,
    });
  }

  async getHistoricalFields(input: HistoricalFieldsQueryInput): Promise<HistoricalFieldsResult> {
    const query = this.allowNonAnalysisCycle
      ? historicalFieldsQuerySchema.safeExtend({ analysisTime: isoDateTimeSchema }).parse(input)
      : historicalFieldsQuerySchema.parse(input);
    const analysisTime = new Date(query.analysisTime);
    if (analysisTime < this.minimumTime) {
      throw new Error(`GFS Grid 4 history begins at ${this.minimumTime.toISOString()} for this data source`);
    }
    if (analysisTime > this.now()) throw new Error("Historical GFS analysisTime must not be in the future");

    const requestedFields = [...new Set(query.fields)];
    const rawFields = expandHistoricalFieldDependencies(requestedFields);
    const groups = groupRawFields(rawFields);
    const rawValues = new Map<HistoricalRawFieldId, number>();
    const responses: HistoricalAnalysisPointResponse[] = [];
    let gridPoint = { latitude: query.latitude, longitude: query.longitude };

    for (const group of groups) {
      const response = await this.source.fetch({
        analysisTime,
        latitude: query.latitude,
        longitude: query.longitude,
        variables: group.map((definition) => definition.id),
      });
      responses.push(response);
      const parsed = parseHistoricalFieldRows(response.rows, group, {
        latitude: query.latitude,
        longitude: query.longitude,
      });
      gridPoint = parsed.gridPoint;
      for (const [id, value] of parsed.values) rawValues.set(id, value);
    }

    for (const definition of rawFields) {
      if (!rawValues.has(definition.id)) {
        throw new Error(`Historical GFS analysis is missing requested field ${definition.id}`);
      }
    }

    const profile = query.variables && query.pressureLevelsHpa
      ? await this.profileGetter.getHistoricalProfile({
          latitude: query.latitude,
          longitude: query.longitude,
          analysisTime: query.analysisTime,
          variables: query.variables,
          pressureLevelsHpa: query.pressureLevelsHpa,
        })
      : undefined;
    if (profile) gridPoint = profile.gridPoint;

    const firstResponse = responses[0];
    if (!firstResponse) throw new Error("Historical GFS mixed-field query resolved no archive fields");

    return {
      model: "gfs_grid4_analysis_0p5",
      analysisTime: analysisTime.toISOString(),
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint,
      selection: {
        ...(query.variables ? { variables: query.variables } : {}),
        ...(query.pressureLevelsHpa ? { pressureLevelsHpa: query.pressureLevelsHpa } : {}),
        fields: requestedFields,
      },
      ...(profile ? { levels: profile.levels } : {}),
      fields: requestedFields.map((id) => buildHistoricalFieldResult(id, rawValues)),
      source: {
        provider: firstResponse.provider,
        access: firstResponse.access,
        dataset: firstResponse.dataset,
        cacheHit: responses.every((response) => response.cacheHit) && (profile?.source.cacheHit ?? true),
      },
      caveat: CAVEAT,
    };
  }
}

interface ParsedFields {
  gridPoint: { latitude: number; longitude: number };
  values: Map<HistoricalRawFieldId, number>;
}

export function parseHistoricalFieldRows(
  rows: readonly HistoricalAnalysisPointRow[],
  definitions: readonly HistoricalRawFieldDefinition[],
  requestedPoint: { latitude: number; longitude: number },
): ParsedFields {
  const values = new Map<HistoricalRawFieldId, number>();
  let gridPoint = requestedPoint;
  for (const row of rows) {
    let matched = false;
    for (const definition of definitions) {
      if (definition.heightM !== undefined && !sameHeight(row.heightAboveGroundM, definition.heightM)) continue;
      const value = row.values[definition.id];
      if (value === undefined) continue;
      values.set(definition.id, definition.transform(value));
      matched = true;
    }
    if (matched) gridPoint = { latitude: row.latitude, longitude: row.longitude };
  }
  return { gridPoint, values };
}

function buildHistoricalFieldResult(
  id: HistoricalGfsFieldId,
  rawValues: ReadonlyMap<HistoricalRawFieldId, number>,
): HistoricalFieldResult {
  const catalogDefinition = NON_ISOBARIC_FIELD_CATALOG[id] as NonIsobaricFieldDefinition;
  if (id === "wind_10m" || id === "wind_80m" || id === "wind_100m") {
    const [uId, vId] = WIND_DEPENDENCIES[id];
    const u = requiredRawValue(rawValues, uId);
    const v = requiredRawValue(rawValues, vId);
    const wind = deriveWind(u, v);
    return {
      id,
      level: resultLevel(catalogDefinition),
      temporal: { type: "instantaneous" },
      values: { windSpeedMs: wind.speedMs, windDirectionDeg: wind.directionDeg },
    };
  }

  const value = requiredRawValue(rawValues, id as HistoricalRawFieldId);
  const output = catalogDefinition.outputs[0];
  if (!output) throw new Error(`Historical field ${id} has no output definition`);
  return {
    id,
    level: resultLevel(catalogDefinition),
    temporal: { type: "instantaneous" },
    values: { [output.field]: value },
  };
}

function resultLevel(definition: NonIsobaricFieldDefinition): HistoricalFieldLevel {
  const level = definition.level;
  if (level.type === "surface") return { type: "surface" };
  if (level.type === "height_above_ground_m") return { type: "height_above_ground_m", heightM: level.heightM };
  if (level.type === "named_layer") return { type: "named_layer", id: level.id };
  return { type: "named_level", id: level.id };
}

function expandHistoricalFieldDependencies(ids: readonly HistoricalGfsFieldId[]): HistoricalRawFieldDefinition[] {
  const rawIds = new Set<HistoricalRawFieldId>();
  for (const id of ids) {
    if (id === "wind_10m" || id === "wind_80m" || id === "wind_100m") {
      for (const dependency of WIND_DEPENDENCIES[id]) rawIds.add(dependency);
    } else {
      rawIds.add(id as HistoricalRawFieldId);
    }
  }
  return [...rawIds].map((id) => RAW_FIELDS[id]);
}

function groupRawFields(definitions: readonly HistoricalRawFieldDefinition[]): HistoricalRawFieldDefinition[][] {
  const groups = new Map<HistoricalFieldGroup, HistoricalRawFieldDefinition[]>();
  for (const definition of definitions) {
    const group = groups.get(definition.group) ?? [];
    group.push(definition);
    groups.set(definition.group, group);
  }
  return [...groups.values()];
}

function raw(
  id: HistoricalRawFieldId,
  group: HistoricalFieldGroup,
  transform: (value: number) => number,
): HistoricalRawFieldDefinition {
  return { id, group, transform };
}

function rawHeight(
  id: HistoricalRawFieldId,
  group: HistoricalFieldGroup,
  heightM: number,
  transform: (value: number) => number,
): HistoricalRawFieldDefinition {
  return { id, group, heightM, transform };
}

function requiredRawValue(values: ReadonlyMap<HistoricalRawFieldId, number>, id: HistoricalRawFieldId): number {
  const value = values.get(id);
  if (value === undefined) throw new Error(`Historical GFS analysis is missing requested field ${id}`);
  return value;
}

function sameHeight(value: number | undefined, expected: number): boolean {
  return value !== undefined && Math.abs(value - expected) < 1e-6;
}
