import * as z from "zod/v4";
import { AIFS_PRESSURE_LEVELS_HPA } from "./aifs.js";
import { AIGFS_PRESSURE_LEVELS_HPA } from "./aigfs.js";
import { getGefsCatalog } from "./gefs-catalog.js";
import { ICON_D2_PRESSURE_LEVELS_HPA } from "./icon-d2.js";
import { ICON_D2_EPS_PRESSURE_LEVELS_HPA } from "./icon-d2-eps.js";
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
import type { UnifiedCatalogResult } from "../schema/unified-catalog.js";
import {
  publicDatasetCapabilities,
  publicDatasetCoversGeometry,
  validateDatasetModifiers,
} from "../schema/unified-api.js";

const CAPABILITY_PROBE_TIME = { at: "2000-01-01T00:00:00Z" } as const;
const CAPABILITY_PROBE_GEOMETRY = { type: "point", latitude: 0, longitude: 0 } as const;

type CapabilityIssue = { path: Array<string | number>; reason: string };
type GeometryType = "point" | "points" | "transect" | "area";
type CatalogSection = UnifiedCatalogResult["matches"][number]["section"];

export function inspectAtmosphereCapabilities(
  input: InspectAtmosphereCapabilitiesInput,
): CapabilityInspectionResult {
  const requested = inspectAtmosphereCapabilitiesSchema.parse(input);
  const forecastKind = requested.forecast?.kind;
  const capabilities = publicDatasetCapabilities(requested.dataset, forecastKind);
  const geometries = geometryTypes(capabilities.operations);
  const unsupported: CapabilityIssue[] = [];

  collectDatasetModifierIssues(requested, unsupported);
  collectOperationIssues(requested, capabilities.operations, unsupported);
  collectOperationShapeIssues(requested, unsupported);
  collectGeometryIssues(requested, geometries, capabilities.spatialDomain, unsupported);
  collectCatalogSelectionIssues(requested, unsupported);
  collectPressureLevelIssues(requested, unsupported);

  const deduplicated = deduplicateIssues(unsupported);
  return capabilityInspectionResultSchema.parse({
    basis: "declared_capability",
    dataset: requested.dataset,
    supported: deduplicated.length === 0,
    requested,
    geometries,
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
    geometry: requested.geometry ?? CAPABILITY_PROBE_GEOMETRY,
    time: requested.time ?? CAPABILITY_PROBE_TIME,
  };
  const schema = z.any().superRefine((value, context) => {
    validateDatasetModifiers(value, context);
  });
  const parsed = schema.safeParse(probe);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    issues.push({
      path: issue.path.map((part) => typeof part === "symbol" ? (part.description ?? String(part)) : part),
      reason: issue.message,
    });
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

function collectOperationShapeIssues(
  requested: InspectAtmosphereCapabilitiesRequest,
  issues: CapabilityIssue[],
): void {
  const operation = requested.operation;
  if (operation === undefined) return;

  const expectedGeometry = operationGeometry(operation);
  if (
    expectedGeometry !== undefined
    && requested.geometry !== undefined
    && requested.geometry.type !== expectedGeometry
  ) {
    issues.push({
      path: ["geometry", "type"],
      reason: `operation=${operation} requires geometry=${expectedGeometry}, received geometry=${requested.geometry.type}`,
    });
  }

  const expectedTime = operationTimeShape(operation);
  if (expectedTime !== undefined && requested.time !== undefined) {
    const receivedTime = "from" in requested.time ? "range" : "instant";
    if (receivedTime !== expectedTime) {
      issues.push({
        path: ["time"],
        reason: `operation=${operation} requires ${expectedTime} valid time, received ${receivedTime}`,
      });
    }
  }

  const diagnosticKind = operationDiagnosticKind(operation);
  if (diagnosticKind !== undefined && requested.selection !== undefined) {
    issues.push({
      path: ["selection"],
      reason: `operation=${operation} expects a diagnostic selection, not a raw query selection`,
    });
  }
  if (diagnosticKind === undefined && requested.diagnostic !== undefined && operation !== "diagnostic_timeseries") {
    issues.push({
      path: ["diagnostic"],
      reason: `operation=${operation} does not consume a diagnostic selection`,
    });
  }
  if (
    diagnosticKind !== undefined
    && diagnosticKind !== "any"
    && requested.diagnostic !== undefined
    && requested.diagnostic.kind !== diagnosticKind
  ) {
    issues.push({
      path: ["diagnostic", "kind"],
      reason: `operation=${operation} requires diagnostic.kind=${diagnosticKind}, received ${requested.diagnostic.kind}`,
    });
  }
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

  if (geometry.type === "area" && requested.selection !== undefined) {
    const variableCount = requested.selection.variables?.length ?? 0;
    const levelCount = requested.selection.pressureLevelsHpa?.length ?? 0;
    const fieldCount = requested.selection.fields?.length ?? 0;
    const pressureSelection = variableCount === 1 && levelCount === 1 && fieldCount === 0;
    const fieldSelection = variableCount === 0 && levelCount === 0 && fieldCount === 1;
    if (!pressureSelection && !fieldSelection) {
      issues.push({
        path: ["selection"],
        reason: "area geometry requires exactly one pressure variable at one pressure level or exactly one field",
      });
    }
  }
}

function collectCatalogSelectionIssues(
  requested: InspectAtmosphereCapabilitiesRequest,
  issues: CapabilityIssue[],
): void {
  for (const variable of requested.selection?.variables ?? []) {
    if (!catalogSupports(requested, "variables", variable)) {
      issues.push({
        path: ["selection", "variables"],
        reason: `dataset=${requested.dataset} does not expose pressure variable=${variable}`,
      });
    }
  }
  for (const field of requested.selection?.fields ?? []) {
    if (!catalogSupports(requested, "fields", field)) {
      issues.push({
        path: ["selection", "fields"],
        reason: `dataset=${requested.dataset} does not expose field=${field}`,
      });
    }
  }

  const diagnostic = requested.diagnostic;
  if (diagnostic?.kind === "layer") {
    for (const id of diagnostic.diagnostics) {
      if (!catalogSupports(requested, "layer_diagnostics", id)) {
        issues.push({
          path: ["diagnostic", "diagnostics"],
          reason: `dataset=${requested.dataset} does not expose layer diagnostic=${id}`,
        });
      }
    }
  } else if (diagnostic?.kind === "profile") {
    for (const id of diagnostic.diagnostics) {
      if (!catalogSupports(requested, "profile_diagnostics", id)) {
        issues.push({
          path: ["diagnostic", "diagnostics"],
          reason: `dataset=${requested.dataset} does not expose profile diagnostic=${id}`,
        });
      }
    }
  } else if (diagnostic?.kind === "parcel") {
    if (!catalogSupports(requested, "parcel_definitions", diagnostic.parcel)) {
      issues.push({
        path: ["diagnostic", "parcel"],
        reason: `dataset=${requested.dataset} does not expose parcel definition=${diagnostic.parcel}`,
      });
    }
  }
}

function catalogSupports(
  requested: InspectAtmosphereCapabilitiesRequest,
  section: CatalogSection,
  id: string,
): boolean {
  const forecastKind = requested.dataset === "gefs" ? requested.forecast?.kind : undefined;
  const result = searchAtmosphereCatalog({
    datasets: [requested.dataset],
    ...(forecastKind === undefined ? {} : { forecastKind }),
    sections: [section],
    search: id,
    limit: 10,
  });
  return result.matches.some((match) => match.section === section && match.id === id);
}

function collectPressureLevelIssues(
  requested: InspectAtmosphereCapabilitiesRequest,
  issues: CapabilityIssue[],
): void {
  const selection = requested.selection;
  if (selection?.pressureLevelsHpa === undefined) return;

  if (requested.forecast?.kind === "reforecast") return;

  if (requested.dataset === "gefs") {
    const byVariable = new Map<string, Set<number>>(
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
    case "icon-d2": return ICON_D2_PRESSURE_LEVELS_HPA;
    case "icon-d2-eps": return ICON_D2_EPS_PRESSURE_LEVELS_HPA;
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

function operationGeometry(operation: string): GeometryType | undefined {
  switch (operation) {
    case "profile":
    case "timeseries":
    case "layer_diagnostics":
    case "profile_diagnostics":
    case "diagnostic_timeseries":
    case "parcel_diagnostics":
    case "ensemble_distribution":
    case "alignment":
      return "point";
    case "points":
    case "points_timeseries":
      return "points";
    case "transect":
      return "transect";
    case "area_summary":
      return "area";
    default:
      return undefined;
  }
}

function operationTimeShape(operation: string): "instant" | "range" | undefined {
  switch (operation) {
    case "profile":
    case "layer_diagnostics":
    case "profile_diagnostics":
    case "parcel_diagnostics":
    case "points":
    case "transect":
    case "area_summary":
    case "ensemble_distribution":
      return "instant";
    case "timeseries":
    case "diagnostic_timeseries":
    case "points_timeseries":
      return "range";
    default:
      return undefined;
  }
}

function operationDiagnosticKind(operation: string): "layer" | "profile" | "parcel" | "any" | undefined {
  switch (operation) {
    case "layer_diagnostics": return "layer";
    case "profile_diagnostics": return "profile";
    case "parcel_diagnostics": return "parcel";
    case "diagnostic_timeseries": return "any";
    default: return undefined;
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
  return (["point", "points", "transect", "area"] as const).filter((geometry) => result.has(geometry));
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
