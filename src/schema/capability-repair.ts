import * as z from "zod/v4";
import {
  GEFS_REFORECAST_EXTENDED_MEMBERS,
  GEFS_REFORECAST_FIELD_IDS,
  GEFS_REFORECAST_PRESSURE_LEVELS_HPA,
  GEFS_REFORECAST_PRESSURE_VARIABLE_IDS,
} from "../catalog/gefs-reforecast.js";
import {
  ATMOSPHERIC_DATASET_CATALOG,
  type AtmosphericRunSelectorId,
} from "../catalog/models.js";
import {
  AIGFS_FIELD_IDS,
  AIGFS_PRESSURE_LEVELS_HPA,
  AIGFS_PRESSURE_VARIABLE_IDS,
} from "../catalog/aigfs.js";
import { AIGEFS_MEMBERS } from "../catalog/aigefs.js";
import { AROME_0P01_FIELD_IDS } from "../catalog/arome.js";
import { PE_AROME_FIELD_IDS, PE_AROME_MEMBERS } from "../catalog/pe-arome.js";
import {
  ICON_D2_FIELD_IDS,
  ICON_D2_PRESSURE_LEVELS_HPA,
  ICON_D2_PRESSURE_VARIABLE_IDS,
} from "../catalog/icon-d2.js";
import { ICON_D2_EPS_MEMBERS } from "../catalog/icon-d2-eps.js";
import {
  AIFS_FIELD_IDS,
  AIFS_PRESSURE_LEVELS_HPA,
  AIFS_PRESSURE_VARIABLE_IDS,
} from "../catalog/aifs.js";
import { AIFS_ENS_MEMBERS } from "../catalog/aifs-ens.js";
import { HGEFS_MEMBERS } from "../catalog/hgefs.js";
import { GFS_PRESSURE_LEVELS_HPA } from "../catalog/pressure-levels.js";
import type { DatasetCapabilityMetadata } from "./dataset-capability-validation.js";

type RepairValue = string | number;
type RefinementIssueInput = Parameters<z.RefinementCtx["addIssue"]>[0];
type RefinementIssue = Exclude<RefinementIssueInput, string>;

export interface CapabilityRepairHint {
  kind: "unsupported_inventory" | "unsupported_capability";
  action: "choose_supported_values" | "remove_modifier" | "inspect_capabilities";
  dataset: string;
  path: string;
  unsupported?: readonly RepairValue[];
  supported?: readonly RepairValue[];
  constraints?: {
    maxForecastHour?: number;
    nativeTimeCadenceHours: readonly number[];
  };
  inspect: {
    dataset: string;
    forecastKind?: string;
    geometryType?: string;
  };
}

/**
 * Decorate dataset-capability validation issues with enough structured context
 * for an agent to repair the request without scraping the human-readable error.
 * The validator remains the source of truth for what is invalid; this layer only
 * exposes the catalog knowledge that already exists alongside that validation.
 */
export function withCapabilityRepairContext(
  request: any,
  context: z.RefinementCtx,
  metadata: DatasetCapabilityMetadata,
): z.RefinementCtx {
  return {
    ...context,
    addIssue(issue: RefinementIssueInput): void {
      if (typeof issue === "string") {
        context.addIssue(issue);
        return;
      }
      const repair = capabilityRepairHint(request, metadata, issue);
      const existingParams = "params" in issue && isRecord(issue.params)
        ? issue.params
        : {};
      context.addIssue({
        ...issue,
        params: {
          ...existingParams,
          repair,
        },
      } as RefinementIssueInput);
    },
  };
}

function capabilityRepairHint(
  request: any,
  metadata: DatasetCapabilityMetadata,
  issue: RefinementIssue,
): CapabilityRepairHint {
  const path = Array.isArray(issue.path) ? issue.path.map(String).join(".") : "";
  const message = typeof issue.message === "string" ? issue.message : "";
  const supported = supportedValues(request, metadata, path, message);
  const unsupported = supported === undefined
    ? undefined
    : requestedValues(request, path).filter((value) => !supported.includes(value));
  const definition = ATMOSPHERIC_DATASET_CATALOG[metadata.internalDatasetId];
  const inspect = {
    dataset: String(request.dataset),
    ...(request.forecast?.kind === undefined
      ? {}
      : { forecastKind: String(request.forecast.kind) }),
    ...(request.geometry?.type === undefined
      ? {}
      : { geometryType: String(request.geometry.type) }),
  };
  const constraints = {
    ...(definition.maxForecastHour === undefined
      ? {}
      : { maxForecastHour: definition.maxForecastHour }),
    nativeTimeCadenceHours: [...definition.nativeTimeCadenceHours],
  };

  if (supported !== undefined) {
    return {
      kind: "unsupported_inventory",
      action: "choose_supported_values",
      dataset: String(request.dataset),
      path,
      ...(unsupported === undefined || unsupported.length === 0 ? {} : { unsupported }),
      supported,
      constraints,
      inspect,
    };
  }

  if (path === "source" || path === "forecast.grid") {
    return {
      kind: "unsupported_capability",
      action: "remove_modifier",
      dataset: String(request.dataset),
      path,
      constraints,
      inspect,
    };
  }

  return {
    kind: "unsupported_capability",
    action: "inspect_capabilities",
    dataset: String(request.dataset),
    path,
    constraints,
    inspect,
  };
}

function supportedValues(
  request: any,
  metadata: DatasetCapabilityMetadata,
  path: string,
  message: string,
): RepairValue[] | undefined {
  if (path === "forecast.run") {
    if (request.dataset === "gefs" && request.forecast?.kind === "reforecast") {
      return ["explicit ISO cycle"];
    }
    return ATMOSPHERIC_DATASET_CATALOG[metadata.internalDatasetId].runSelectors
      .map(runSelectorLabel);
  }
  if (path.startsWith("selection.") && /area summaries|cannot satisfy|variable\/level|intersection/i.test(message)) {
    return undefined;
  }
  if (path === "selection.pressureLevelsHpa") {
    return pressureLevels(request);
  }
  if (path === "selection.variables") {
    return pressureVariables(request);
  }
  if (path === "selection.fields") {
    return fields(request);
  }
  if (path === "ensemble.members") {
    return members(request);
  }
  if (path === "forecast.kind" && request.forecast?.kind === "reforecast") {
    return request.dataset === "gefs" ? ["reforecast"] : ["operational"];
  }
  if (path === "geometry" && request.forecast?.kind === "reforecast") {
    return ["point", "points"];
  }
  if (path === "source" && request.dataset === "gfs") {
    if (request.geometry?.type === "area") return ["nomads"];
    if (request.geometry?.type === "points" || request.geometry?.type === "transect") return ["s3"];
  }
  return undefined;
}

function requestedValues(request: any, path: string): RepairValue[] {
  switch (path) {
    case "forecast.run":
      return request.forecast?.run === undefined ? ["latest"] : [String(request.forecast.run)];
    case "selection.pressureLevelsHpa":
      return asRepairValues(request.selection?.pressureLevelsHpa);
    case "selection.variables":
      return asRepairValues(request.selection?.variables);
    case "selection.fields":
      return asRepairValues(request.selection?.fields);
    case "ensemble.members":
      return asRepairValues(request.ensemble?.members);
    case "forecast.kind":
      return request.forecast?.kind === undefined ? [] : [String(request.forecast.kind)];
    case "geometry":
      return request.geometry?.type === undefined ? [] : [String(request.geometry.type)];
    case "source":
      return request.source === undefined ? [] : [String(request.source)];
    default:
      return [];
  }
}

function pressureLevels(request: any): RepairValue[] | undefined {
  if (request.forecast?.kind === "reforecast") {
    return request.dataset === "gefs" ? [...GEFS_REFORECAST_PRESSURE_LEVELS_HPA] : undefined;
  }
  switch (request.dataset) {
    case "gfs": return [...GFS_PRESSURE_LEVELS_HPA];
    case "aigfs":
    case "aigefs":
    case "hgefs": return [...AIGFS_PRESSURE_LEVELS_HPA];
    case "icon-d2":
    case "icon-d2-eps": return [...ICON_D2_PRESSURE_LEVELS_HPA];
    case "aifs":
    case "aifs-ens": return [...AIFS_PRESSURE_LEVELS_HPA];
    default: return undefined;
  }
}

function pressureVariables(request: any): RepairValue[] | undefined {
  if (request.forecast?.kind === "reforecast") {
    return request.dataset === "gefs" ? [...GEFS_REFORECAST_PRESSURE_VARIABLE_IDS] : undefined;
  }
  switch (request.dataset) {
    case "aigfs":
    case "aigefs":
    case "hgefs": return [...AIGFS_PRESSURE_VARIABLE_IDS];
    case "icon-d2":
    case "icon-d2-eps": return [...ICON_D2_PRESSURE_VARIABLE_IDS];
    case "aifs":
    case "aifs-ens": return [...AIFS_PRESSURE_VARIABLE_IDS];
    default: return undefined;
  }
}

function fields(request: any): RepairValue[] | undefined {
  if (request.forecast?.kind === "reforecast") {
    return request.dataset === "gefs" ? [...GEFS_REFORECAST_FIELD_IDS] : undefined;
  }
  switch (request.dataset) {
    case "aigfs":
    case "aigefs":
    case "hgefs": return [...AIGFS_FIELD_IDS];
    case "icon-d2":
    case "icon-d2-eps": return [...ICON_D2_FIELD_IDS];
    case "arome": return [...AROME_0P01_FIELD_IDS];
    case "pe-arome": return [...PE_AROME_FIELD_IDS];
    case "aifs":
    case "aifs-ens": return [...AIFS_FIELD_IDS];
    default: return undefined;
  }
}

function members(request: any): RepairValue[] | undefined {
  if (request.forecast?.kind === "reforecast") {
    return request.dataset === "gefs" ? [...GEFS_REFORECAST_EXTENDED_MEMBERS] : undefined;
  }
  switch (request.dataset) {
    case "aigefs": return [...AIGEFS_MEMBERS];
    case "hgefs": return [...HGEFS_MEMBERS];
    case "icon-d2-eps": return [...ICON_D2_EPS_MEMBERS];
    case "pe-arome": return [...PE_AROME_MEMBERS];
    case "aifs-ens": return [...AIFS_ENS_MEMBERS];
    default: return undefined;
  }
}

function runSelectorLabel(value: AtmosphericRunSelectorId): string {
  return value === "explicit" ? "explicit ISO cycle" : value;
}

function asRepairValues(value: unknown): RepairValue[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is RepairValue =>
    typeof entry === "string" || typeof entry === "number");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
