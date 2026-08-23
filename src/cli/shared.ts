import type {
  LayerDiagnosticId,
  NonIsobaricFieldId,
  PointCoordinate,
  ProfileDiagnosticId,
  VariableId,
} from "../schema/query.js";

export const DEFAULT_VARIABLES = "temperature,relative_humidity,wind";
export const DEFAULT_LEVELS = "1000,925,850,700,500";
export const DEFAULT_LAYER_DIAGNOSTICS = "temperature_lapse_rate,wind_shear,potential_temperature_gradient";
export const DEFAULT_PROFILE_DIAGNOSTICS = "freezing_level_crossings,temperature_inversion_layers";
export const RUN_HELP = "GFS run initialization; latest = newest run satisfying this query, latest_complete = newest run published through f384";

export function pointSelection(vars: unknown, levels: unknown, fields: unknown): {
  variables?: VariableId[];
  pressureLevelsHpa?: number[];
  fields?: NonIsobaricFieldId[];
} {
  const parsedFields = parseFields(fields);
  const hasExplicitPressureSelection = vars !== undefined || levels !== undefined;
  const includeDefaultPressureSelection = !hasExplicitPressureSelection && parsedFields.length === 0;

  const variables = vars !== undefined
    ? parseVariables(vars)
    : hasExplicitPressureSelection || includeDefaultPressureSelection
      ? parseVariables(DEFAULT_VARIABLES)
      : undefined;
  const pressureLevelsHpa = levels !== undefined
    ? parseLevels(levels)
    : hasExplicitPressureSelection || includeDefaultPressureSelection
      ? parseLevels(DEFAULT_LEVELS)
      : undefined;

  return {
    ...(variables === undefined ? {} : { variables }),
    ...(pressureLevelsHpa === undefined ? {} : { pressureLevelsHpa }),
    ...(parsedFields.length === 0 ? {} : { fields: parsedFields }),
  };
}

export function collectPoint(value: string, previous: PointCoordinate[] | undefined): PointCoordinate[] {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 2) throw new Error(`Expected --point lat,lon, received: ${value}`);
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`Expected numeric --point lat,lon, received: ${value}`);
  }
  return [...(previous ?? []), { latitude, longitude }];
}

export function parseVariables(value: unknown): VariableId[] {
  return String(value).split(",").map((variable) => variable.trim()).filter(Boolean) as VariableId[];
}

export function parseLayerDiagnostics(value: unknown): LayerDiagnosticId[] {
  return String(value).split(",").map((diagnostic) => diagnostic.trim()).filter(Boolean) as LayerDiagnosticId[];
}

export function parseProfileDiagnostics(value: unknown): ProfileDiagnosticId[] {
  return String(value).split(",").map((diagnostic) => diagnostic.trim()).filter(Boolean) as ProfileDiagnosticId[];
}

export function parseLevels(value: unknown): number[] {
  return String(value).split(",").map((level) => level.trim()).filter(Boolean).map(Number);
}

export function parseFields(value: unknown): NonIsobaricFieldId[] {
  if (value === undefined) return [];
  return String(value).split(",").map((field) => field.trim()).filter(Boolean) as NonIsobaricFieldId[];
}
