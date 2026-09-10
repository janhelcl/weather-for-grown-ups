import * as z from "zod/v4";
import { AIFS_PRESSURE_LEVELS_HPA } from "./aifs.js";
import { AIGFS_PRESSURE_LEVELS_HPA } from "./aigfs.js";
import { getGefsCatalog } from "./gefs-catalog.js";
import { ICON_D2_PRESSURE_LEVELS_HPA } from "./icon-d2.js";
import { IFS_PRESSURE_LEVELS_HPA } from "./ifs.js";
import { GFS_PRESSURE_LEVELS_HPA } from "./pressure-levels.js";
import { searchAtmosphereCatalog } from "./unified-search.js";
import {
  capabilityInspectionResultSchema,
  inspectAtmosphereCapabilitiesSchema,
  type CapabilityInspectionResult,
  type InspectAtmosphereCapabilitiesInput,
  type InspectAtmosphereCapabilitiesRequest,
} from "../schema/capability-inspection.js";
import {
  publicDatasetCapabilities,
  publicDatasetCoversGeometry,
  publicDatasetMetadata,
  validateDatasetModifiers,
} from "../schema/unified-api.js";

const CAPABILITY_PROBE_TIME = { at: "2000-01-01T00:00:00Z" } as const;

type CapabilityIssue = { path: Array<string | number>; reason: string };
type GeometryType = "point" | "points" | "transect" | "area";

export function inspectAtmosphereCapabilities(
  input: InspectAtmosphereCapabilitiesInput,
): CapabilityInspectionResult {
  const requested = inspectAtmosphereCapabilitiesSchema.parse(input);
  const forecastKind = requested.forecast?.kind;
  const capabilities = publicDatasetCapabilities(requested.dataset, forecastKind);
  const unsupported: CapabilityIssue[] = [];

  collectDatasetModifierIssues(requested, unsupported);
  collectOperationIssues(requested, capabilities.operations, unsupported);
  collectGeometryIssues(requested, geometryTypes(capabilities.operations), capabilities.spatialDomain, unsupported);
  collectCatalogSelectionIssues(requested, unsupported);
  collectPressureLevelIssues(requested, unsupported);

  const deduplicated = deduplicateIssues(unsupported);
  return capabilityInspectionResultSchema.parse({
    basis: "declared_capability",
    dataset: requested.dataset,
    supported: deduplicated.length === 0,
    requested,
    geometries: geometryTypes(capabilities.operations),
    capabilities,
    unsupported: deduplicated,
  });
}

function collectDatasetModifierIssues(
  requested: InspectAtmosphereCapabilitiesRequest,
  issues: CapabilityIssue[],
): void {
  const probe = {
    ...requested,
    time: requested.time ?? CAPABILITY_PROBE_TIME,
  };
  const schema = z.any().superRefine((value, context) => {
    validateDatasetModifiers(value, context);
  });
  const parsed = schema.safeParse(probe);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    issues.push({ path: issue.path, reason: issue.message });
  }
}

function collectOperationIssues(
  requested: InspectAtmosphereCapabilitiesRequest,
  operations: readonly string[],
  issues: CapabilityIssue[],
): void {
  const operation = requested.operation ?? inferOperation(requested);
  if (operation === undefined || operations.includes(operation)) return;
  issues.push({
    path: ["operation"],
    reason: `dataset=${requested.dataset} does not support operation=${operation}; supported operations: ${operations.join(", ")}`,
  });
}

function collectGeometryIssues(
  requested: InspectAtmosphereCapabilitiesRequest,
  geometries: readonly GeometryType[],
  spatialDomain: ReturnType<typeof publicDatasetCapabilities>["spatialDomain"],
  issues: CapabilityIssue[],
): void {
  const geometry = requested.geometry;
  if (geometry === undefined) return;

  if (!geometries.includes(geometry.type)) {
    issues.push({
      path: ["geometry", "type"],
      reason: `dataset=${requested.dataset} does not support geometry=${geometry.type}; supported geometries: ${geometries.join(", ")}`,
    });
  }

  if (!publicDatasetCoversGeometry(requested.dataset, geometry)) {
    const detail = spatialDomain.scope === "global"
      ? "declared global domain"
      : `${spatialDomain.name} bounds ${spatialDomain.bounds.westLongitude}..${spatialDomain.bounds.eastLongitude}° lon, ${spatialDomain.bounds.southLatitude}..${spatialDomain.bounds.northLatitude}° lat`;
    issues.push({
      path: ["geometry"],
      reason: `dataset=${requested.dataset} does not fully cover the requested geometry (${detail})`,
    });
  }

  if (
    requested.time !== undefined
    && "from" in requested.time
    && (geometry.type === "transect" || geometry.type === "area")
  ) {
    issues.push({
      path: ["time"],
      reason: `${geometry.type} queries currently support one valid time, not a time range`,
    });
  }
}

function collectCatalogSelectionIssues(
  requested: InspectAtmosphereCapabilitiesRequest,
  issues: CapabilityIssue[],
): void {
  const forecastKind = requested.dataset === "gefs" ? requested.forecast?.kind : undefined;
  const catalog = searchAtmosphereCatalog({
    datasets: [requested.dataset],
    ...(forecastKind === undefined ? {} : { forecastKind }),
    sections: ["variables", "fields", "layer_diagnostics", "profile_diagnostics", "parcel_definitions"],
    limit: 100,
  });
  const support = new Map<string, Set<string>>();
  for (const match of catalog.matches) {
    const ids = support.get(match.section) ?? new Set<string>();
    ids.add(match.id);
    support.set(match.section, ids);
  }

  for (const variable of requested.selection?.variables ?? []) {
    if (!support.get("variables")?.has(variable)) {
      issues.push({
        path: ["selection", "variables"],
        reason: `dataset=${requested.dataset} does not expose pressure variable=${variable}`,
      });
    }
  }
  for (const field of requested.selection?.fields ?? []) {
    if (!support.get("fields")?.has(field)) {
      issues.push({
        path: ["selection", "fields"],
        reason: `dataset=${requested.dataset} does not expose field=${field}`,
      });
    }
  }

  const diagnostic = requested.diagnostic;
  if (diagnostic?.kind === "layer") {
    for (const id of diagnostic.diagnostics) {
      if (!support.get("layer_diagnostics")?.has(id)) {
        issues.push({ path: ["diagnostic", "diagnostics"], reason: `dataset=${requested.dataset} does not expose layer diagnostic=${id}` });
      }
    }
  } else if (diagnostic?.kind === "profile") {
    for (const id of diagnostic.diagnostics) {
      if (!support.get("profile_diagnostics")?.has(id)) {
        issues.push({ path: ["diagnostic", "diagnostics"], reason: `dataset=${requested.dataset} does not expose profile diagnostic=${id}` });
      }
    }
  } else if (diagnostic?.kind === "parcel") {
    if (!support.get("parcel_definitions")?.has(diagnostic.parcel)) {
      issues.push({ path: ["diagnostic", "parcel"], reason: `dataset=${requested.dataset} does not expose parcel definition=${diagnostic.parcel}` });
    }
  }
}

function collectPressureLevelIssues(
  requested: InspectAtmosphereCapabilitiesRequest,
  issues: CapabilityIssue[],
): void {
  const selection = requested.selection;
  if (selection?.pressureLevelsHpa === undefined) return;

  if (requested.forecast?.kind === "reforecast") return;

  if (requested.dataset === "gefs") {
    const byVariable = new Map(
      getGefsCatalog().variables.map((variable) => [
        variable.id,
        new Set<number>(variable.supportedPressureLevelsHpa),
      ] as const),
    );
    for (const variable of selection.variables ?? []) {
      const levels = byVariable.get(variable);
      if (levels === undefined) continue;
      for (const level of selection.pressureLevelsHpa) {
        if (!levels.has(level)) {
          issues.push({
            path: ["selection", "pressureLevelsHpa"],
            reason: `dataset=gefs cannot satisfy ${variable} at ${level} hPa in the operational pgrb2a product`,
          });
        }
      }
    }
    return;
  }

  const levels = declaredPressureLevels(requested.dataset);
  if (levels === undefined) return;
  const supported = new Set<number>(levels);
  const invalid = selection.pressureLevelsHpa.filter((level) => !supported.has(level));
  if (invalid.length > 0) {
    issues.push({
      path: ["selection", "pressureLevelsHpa"],
      reason: `dataset=${requested.dataset} does not expose pressure levels: ${invalid.join(", ")} hPa`,
    });
  }
}

function declaredPressureLevels(dataset: InspectAtmosphereCapabilitiesRequest["dataset"]): readonly number[] | undefined {
  switch (dataset) {
    case "gfs": return GFS_PRESSURE_LEVELS_HPA;
    case "aigfs":
    case "aigefs":
    case "hgefs": return AIGFS_PRESSURE_LEVELS_HPA;
    case "icon-d2":
    case "icon-d2-eps": return ICON_D2_PRESSURE_LEVELS_HPA;
    case "ifs":
    case "ifs-ens": return IFS_PRESSURE_LEVELS_HPA;
    case "aifs":
    case "aifs-ens": return AIFS_PRESSURE_LEVELS_HPA;
    default: return undefined;
  }
}

function inferOperation(requested: InspectAtmosphereCapabilitiesRequest): string | undefined {
  if (requested.diagnostic !== undefined) {
    if (requested.time !== undefined && "from" in requested.time) return "diagnostic_timeseries";
    if (requested.diagnostic.kind === "layer") return "layer_diagnostics";
    if (requested.diagnostic.kind === "profile") return "profile_diagnostics";
    return "parcel_diagnostics";
  }
  if (requested.geometry === undefined || requested.time === undefined) return undefined;
  const isRange = "from" in requested.time;
  switch (requested.geometry.type) {
    case "point": return isRange ? "timeseries" : "profile";
    case "points": return isRange ? "points_timeseries" : "points";
    case "transect": return "transect";
    case "area": return "area_summary";
  }
}

function geometryTypes(operations: readonly string[]): GeometryType[] {
  const result = new Set<GeometryType>();
  if (operations.some((operation) => [
    "profile",
    "timeseries",
    "layer_diagnostics",
    "profile_diagnostics",
    "diagnostic_timeseries",
    "parcel_diagnostics",
    "ensemble_distribution",
    "alignment",
  ].includes(operation))) result.add("point");
  if (operations.some((operation) => operation === "points" || operation === "points_timeseries")) result.add("points");
  if (operations.includes("transect")) result.add("transect");
  if (operations.includes("area_summary")) result.add("area");
  return ["point", "points", "transect", "area"].filter((geometry) => result.has(geometry as GeometryType)) as GeometryType[];
}

function deduplicateIssues(issues: CapabilityIssue[]): CapabilityIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.path.join(".")}:${issue.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
