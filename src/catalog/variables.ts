import type { VariableId } from "../schema/query.js";

export type GfsCode = "TMP" | "RH" | "UGRD" | "VGRD";

export interface RawVariableDefinition {
  id: Exclude<VariableId, "wind">;
  kind: "raw";
  gfsCode: GfsCode;
  unit: string;
  description: string;
}

export interface DerivedVariableDefinition {
  id: "wind";
  kind: "derived";
  dependencies: ["u_wind", "v_wind"];
  description: string;
}

export type VariableDefinition = RawVariableDefinition | DerivedVariableDefinition;

export const VARIABLE_CATALOG: Record<VariableId, VariableDefinition> = {
  temperature: {
    id: "temperature",
    kind: "raw",
    gfsCode: "TMP",
    unit: "K",
    description: "Air temperature on an isobaric pressure level",
  },
  relative_humidity: {
    id: "relative_humidity",
    kind: "raw",
    gfsCode: "RH",
    unit: "%",
    description: "Relative humidity on an isobaric pressure level",
  },
  u_wind: {
    id: "u_wind",
    kind: "raw",
    gfsCode: "UGRD",
    unit: "m/s",
    description: "Eastward wind component on an isobaric pressure level",
  },
  v_wind: {
    id: "v_wind",
    kind: "raw",
    gfsCode: "VGRD",
    unit: "m/s",
    description: "Northward wind component on an isobaric pressure level",
  },
  wind: {
    id: "wind",
    kind: "derived",
    dependencies: ["u_wind", "v_wind"],
    description: "Wind speed and meteorological direction derived from U/V components",
  },
};

export function expandRequestedVariables(ids: VariableId[]): RawVariableDefinition[] {
  const rawIds = new Set<Exclude<VariableId, "wind">>();

  for (const id of ids) {
    const definition = VARIABLE_CATALOG[id];
    if (definition.kind === "raw") {
      rawIds.add(definition.id);
    } else {
      for (const dependency of definition.dependencies) rawIds.add(dependency);
    }
  }

  return [...rawIds].map((id) => VARIABLE_CATALOG[id] as RawVariableDefinition);
}
