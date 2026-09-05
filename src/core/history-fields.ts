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
  HistoricalAnalysisResponse,
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
  ncssName: string;
  group: HistoricalFieldGroup;
  heightM?: number;
  transform(value: number): number;
}

const identity = (value: number) => value;
const kelvinToCelsius = (value: number) => value - 273.15;

const RAW_FIELDS: Record<HistoricalRawFieldId, HistoricalRawFieldDefinition> = {
  surface_pressure: raw("surface_pressure", "Pressure_surface", "scalar", identity),
  surface_geopotential_height: raw("surface_geopotential_height", "Geopotential_height_surface", "scalar", identity),
  surface_temperature: raw("surface_temperature", "Temperature_surface", "scalar", kelvinToCelsius),
  surface_cape: raw("surface_cape", "Convective_available_potential_energy_surface", "scalar", identity),
  surface_cin: raw("surface_cin", "Convective_inhibition_surface", "scalar", identity),
  temperature_2m: rawHeight("temperature_2m", "Temperature_height_above_ground", "temperature_hag", 2, kelvinToCelsius),
  relative_humidity_2m: rawHeight("relative_humidity_2m", "Relative_humidity_height_above_ground", "moisture_2m", 2, identity),
  specific_humidity_2m: rawHeight("specific_humidity_2m", "Specific_humidity_height_above_ground", "specific_humidity_hag", 2, identity),
  dew_point_2m: rawHeight("dew_point_2m", "Dewpoint_temperature_height_above_ground", "moisture_2m", 2, kelvinToCelsius),
  u_wind_10m: rawHeight("u_wind_10m", "u-component_of_wind_height_above_ground", "wind_hag", 10, identity),
  v_wind_10m: rawHeight("v_wind_10m", "v-component_of_wind_height_above_ground", "wind_hag", 10, identity),
  temperature_80m: rawHeight("temperature_80m", "Temperature_height_above_ground", "temperature_hag", 80, kelvinToCelsius),
  specific_humidity_80m: rawHeight("specific_humidity_80m", "Specific_humidity_height_above_ground", "specific_humidity_hag", 80, identity),
  pressure_80m: rawHeight("pressure_80m", "Pressure_height_above_ground", "pressure_hag", 80, identity),
  u_wind_80m: rawHeight("u_wind_80m", "u-component_of_wind_height_above_ground", "wind_hag", 80, identity),
  v_wind_80m: rawHeight("v_wind_80m", "v-component_of_wind_height_above_ground", "wind_hag", 80, identity),
  temperature_100m: rawHeight("temperature_100m", "Temperature_height_above_ground", "temperature_hag", 100, kelvinToCelsius),
  u_wind_100m: rawHeight("u_wind_100m", "u-component_of_wind_height_above_ground", "wind_hag", 100, identity),
  v_wind_100m: rawHeight("v_wind_100m", "v-component_of_wind_height_above_ground", "wind_hag", 100, identity),
  precipitable_water: raw("precipitable_water", "Precipitable_water_entire_atmosphere_single_layer", "scalar", identity),
  total_column_cloud_water: raw("total_column_cloud_water", "Cloud_water_entire_atmosphere_single_layer", "scalar", identity),
  column_relative_humidity: raw("column_relative_humidity", "Relative_humidity_entire_atmosphere_single_layer", "scalar", identity),
  total_column_ozone: raw("total_column_ozone", "Total_ozone_entire_atmosphere_single_layer", "scalar", identity),
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
    const responses: HistoricalAnalysisResponse[] = [];
    let gridPoint = { latitude: query.latitude, longitude: query.longitude };

    for (const group of groups) {
      const response = await this.source.fetch({
        analysisTime,
        latitude: query.latitude,
        longitude: query.longitude,
        variables: [...new Set(group.map((definition) => definition.ncssName))],
      });
      responses.push(response);
      const parsed = parseHistoricalFieldsCsv(response.csv, group, {
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

export function parseHistoricalFieldsCsv(
  csv: string,
  definitions: readonly HistoricalRawFieldDefinition[],
  requestedPoint: { latitude: number; longitude: number },
): ParsedFields {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("Historical GFS field response contains no data rows");
  const headers = parseCsvLine(lines[0]!).map(normalizeHeader);
  const latitudeIndex = findHeaderIndex(headers, ["latitude", "lat"]);
  const longitudeIndex = findHeaderIndex(headers, ["longitude", "lon"]);
  const heightIndex = headers.findIndex(
    (header) => header.startsWith("height_above_ground") || header === "alt",
  );
  const columnIndexes = new Map<string, number>();
  for (const definition of definitions) {
    if (columnIndexes.has(definition.ncssName)) continue;
    const aliases = windAliases(definition.ncssName);
    const index = findHeaderIndex(headers, aliases);
    if (index < 0) throw new Error(`Historical GFS field response is missing variable ${definition.ncssName}`);
    columnIndexes.set(definition.ncssName, index);
  }

  const values = new Map<HistoricalRawFieldId, number>();
  let gridPoint = requestedPoint;
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const rowHeight = heightIndex < 0 ? undefined : numericCell(cells[heightIndex]);
    for (const definition of definitions) {
      if (definition.heightM !== undefined && !sameHeight(rowHeight, definition.heightM)) continue;
      const columnIndex = columnIndexes.get(definition.ncssName)!;
      const value = numericCell(cells[columnIndex]);
      if (value !== undefined) values.set(definition.id, definition.transform(value));
    }
    const latitude = latitudeIndex < 0 ? undefined : numericCell(cells[latitudeIndex]);
    const longitude = longitudeIndex < 0 ? undefined : numericCell(cells[longitudeIndex]);
    if (latitude !== undefined && longitude !== undefined) {
      gridPoint = { latitude, longitude: longitude > 180 ? longitude - 360 : longitude };
    }
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
  ncssName: string,
  group: HistoricalFieldGroup,
  transform: (value: number) => number,
): HistoricalRawFieldDefinition {
  return { id, ncssName, group, transform };
}

function rawHeight(
  id: HistoricalRawFieldId,
  ncssName: string,
  group: HistoricalFieldGroup,
  heightM: number,
  transform: (value: number) => number,
): HistoricalRawFieldDefinition {
  return { id, ncssName, group, heightM, transform };
}

function requiredRawValue(values: ReadonlyMap<HistoricalRawFieldId, number>, id: HistoricalRawFieldId): number {
  const value = values.get(id);
  if (value === undefined) throw new Error(`Historical GFS analysis is missing requested field ${id}`);
  return value;
}

function sameHeight(value: number | undefined, expected: number): boolean {
  return value !== undefined && Math.abs(value - expected) < 1e-6;
}

function windAliases(name: string): string[] {
  return name.startsWith("u-component") || name.startsWith("v-component")
    ? [name, name.replace("-component", "component")]
    : [name];
}

function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, "").replace(/\[.*$/, "").trim();
}

function findHeaderIndex(headers: readonly string[], aliases: readonly string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function numericCell(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "" || value.trim().toLowerCase() === "nan") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(value);
      value = "";
      continue;
    }
    value += char;
  }
  cells.push(value);
  return cells;
}
