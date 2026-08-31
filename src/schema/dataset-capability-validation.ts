import * as z from "zod/v4";
import {
  AIGFS_AREA_FIELD_IDS,
  AIGFS_PRESSURE_LEVELS_HPA,
  AIGFS_PRESSURE_VARIABLE_IDS,
  AIGFS_RAW_PRESSURE_VARIABLE_IDS,
} from "../catalog/aigfs.js";
import { AIGEFS_MEMBERS } from "../catalog/aigefs.js";
import { AIFS_ENS_MEMBERS } from "../catalog/aifs-ens.js";
import {
  AIFS_AREA_FIELD_IDS,
  AIFS_FIELD_IDS,
  AIFS_PRESSURE_LEVELS_HPA,
  AIFS_PRESSURE_VARIABLE_IDS,
  AIFS_RAW_PRESSURE_VARIABLE_IDS,
  isSupportedAifsPressureSelection,
} from "../catalog/aifs.js";
import {
  HGEFS_AREA_PRESSURE_VARIABLE_IDS,
  HGEFS_MEMBERS,
  isSupportedHgefsPressureSelection,
} from "../catalog/hgefs.js";
import { expandLayerDiagnosticVariables } from "../catalog/layer-diagnostics.js";
import { expandProfileDiagnosticVariables } from "../catalog/profile-diagnostics.js";

type DatasetCapabilityValidator = (request: any, context: z.RefinementCtx) => void;

const DATASET_CAPABILITY_VALIDATORS: Readonly<Record<string, readonly DatasetCapabilityValidator[]>> = {
  aigfs: [validateAigfsModifiers],
  aigefs: [validateAigfsModifiers, validateAigefsMembers],
  hgefs: [validateAigfsModifiers, validateHgefsModifiers, validateHgefsMembers],
  aifs: [validateAifsModifiers],
  "aifs-ens": [validateAifsModifiers, validateAifsEnsMembers],
};

export function validateDatasetCapabilityModifiers(
  request: any,
  context: z.RefinementCtx,
): void {
  for (const validator of DATASET_CAPABILITY_VALIDATORS[request.dataset] ?? []) {
    validator(request, context);
  }
}

function validateAifsEnsMembers(request: any, context: z.RefinementCtx): void {
  validateMemberSelection(
    request,
    context,
    AIFS_ENS_MEMBERS,
    "AIFS ENS members are c00,p01..p50",
  );
}

function validateAigefsMembers(request: any, context: z.RefinementCtx): void {
  validateMemberSelection(
    request,
    context,
    AIGEFS_MEMBERS,
    "AIGEFS members are c00,p01..p30",
  );
}

function validateHgefsMembers(request: any, context: z.RefinementCtx): void {
  validateMemberSelection(
    request,
    context,
    HGEFS_MEMBERS,
    "HGEFS members use population-qualified IDs gefs:c00..p30 or aigefs:c00..p30",
  );
}

function validateMemberSelection(
  request: any,
  context: z.RefinementCtx,
  supportedMembers: readonly string[],
  label: string,
): void {
  if (request.ensemble?.members === undefined) return;
  const supported = new Set<string>(supportedMembers);
  const unsupported = request.ensemble.members.filter(
    (member: string) => !supported.has(member),
  );
  if (unsupported.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["ensemble", "members"],
      message: `${label}; unsupported: ${unsupported.join(", ")}`,
    });
  }
}

function validateAigfsModifiers(
  request: any,
  context: z.RefinementCtx,
): void {
  const label = request.dataset === "aigefs"
    ? "AIGEFS"
    : request.dataset === "hgefs"
      ? "HGEFS"
      : "AIGFS";
  const variableSet = new Set<string>(AIGFS_PRESSURE_VARIABLE_IDS);
  const rawVariableSet = new Set<string>(AIGFS_RAW_PRESSURE_VARIABLE_IDS);
  const pressureLevelSet = new Set<number>(AIGFS_PRESSURE_LEVELS_HPA);
  const areaFieldSet = new Set<string>(AIGFS_AREA_FIELD_IDS);

  if (request.selection !== undefined) {
    const variables = request.selection.variables ?? [];
    const pressureLevelsHpa = request.selection.pressureLevelsHpa ?? [];
    const fields = request.selection.fields ?? [];

    const unsupportedVariables = variables.filter((variable: string) => !variableSet.has(variable));
    if (unsupportedVariables.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selection", "variables"],
        message: `${label} pressure variables not supported: ${unsupportedVariables.join(", ")}`,
      });
    }

    const unsupportedLevels = pressureLevelsHpa.filter((level: number) => !pressureLevelSet.has(level));
    if (unsupportedLevels.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selection", "pressureLevelsHpa"],
        message: `${label} pressure levels not supported: ${unsupportedLevels.join(", ")} hPa`,
      });
    }

    const supportedFields = new Set<string>([
      "temperature_2m",
      "u_wind_10m",
      "v_wind_10m",
      "wind_10m",
      "mean_sea_level_pressure",
      "total_precipitation",
    ]);
    const unsupportedFields = fields.filter((field: string) => !supportedFields.has(field));
    if (unsupportedFields.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selection", "fields"],
        message: `${label} fields not supported: ${unsupportedFields.join(", ")}`,
      });
    }

    if (request.geometry?.type === "area") {
      const derivedAreaVariables = variables.filter((variable: string) => !rawVariableSet.has(variable));
      if (derivedAreaVariables.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["selection", "variables"],
          message: `${label} area summaries require a native scalar pressure variable; derived variables not supported for area geometry: ${derivedAreaVariables.join(", ")}`,
        });
      }
      const unsupportedAreaFields = fields.filter((field: string) => !areaFieldSet.has(field));
      if (unsupportedAreaFields.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["selection", "fields"],
          message: `${label} area summaries require a native scalar field; unsupported: ${unsupportedAreaFields.join(", ")}`,
        });
      }
    }
  }

  if (request.diagnostic !== undefined) {
    if (request.diagnostic.kind === "parcel") {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: `${label} parcel diagnostics are not exposed because the operational surface product lacks surface pressure, surface geopotential height, and 2 m specific humidity`,
      });
      return;
    }
    const levels = request.diagnostic.kind === "layer"
      ? [request.diagnostic.lowerPressureHpa, request.diagnostic.upperPressureHpa]
      : request.diagnostic.pressureLevelsHpa;
    const unsupportedLevels = levels.filter((level: number) => !pressureLevelSet.has(level));
    if (unsupportedLevels.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: `${label} diagnostic pressure levels not supported: ${unsupportedLevels.join(", ")} hPa`,
      });
    }
  }
}

function validateHgefsModifiers(
  request: any,
  context: z.RefinementCtx,
): void {
  if (request.geometry?.type === "points" && request.geometry.points.length > 20) {
    context.addIssue({
      code: "custom",
      path: ["geometry", "points"],
      message: "HGEFS multi-point queries currently support at most 20 points because the GEFS constituent reuses one member file across the point batch",
    });
  }
  if (
    request.geometry?.type === "transect"
    && (request.geometry.samples ?? 20) > 20
  ) {
    context.addIssue({
      code: "custom",
      path: ["geometry", "samples"],
      message: "HGEFS transects currently support at most 20 samples because the GEFS constituent reuses the native ensemble transect primitive",
    });
  }
  if (request.selection !== undefined) {
    const variables = request.selection.variables ?? [];
    const pressureLevelsHpa = request.selection.pressureLevelsHpa ?? [];

    const unsupportedSelections = variables.flatMap((variable: string) =>
      pressureLevelsHpa
        .filter((level: number) =>
          !isSupportedHgefsPressureSelection(variable, level))
        .map((level: number) => `${variable}@${level}hPa`));
    if (unsupportedSelections.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selection", "pressureLevelsHpa"],
        message: `HGEFS constituent member intersection cannot satisfy: ${unsupportedSelections.join(", ")}`,
      });
    }

    if (request.geometry?.type === "area" && variables.length > 0) {
      const areaVariables = new Set<string>(HGEFS_AREA_PRESSURE_VARIABLE_IDS);
      const unsupportedAreaVariables = variables.filter(
        (variable: string) => !areaVariables.has(variable),
      );
      if (unsupportedAreaVariables.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["selection", "variables"],
          message: `HGEFS area pressure summaries require variables available as native scalar fields in both constituent ensembles; unsupported: ${unsupportedAreaVariables.join(", ")}`,
        });
      }
    }
  }

  if (request.diagnostic !== undefined && request.diagnostic.kind !== "parcel") {
    const levels = request.diagnostic.kind === "layer"
      ? [request.diagnostic.lowerPressureHpa, request.diagnostic.upperPressureHpa]
      : request.diagnostic.pressureLevelsHpa;
    const variables = request.diagnostic.kind === "layer"
      ? expandLayerDiagnosticVariables(request.diagnostic.diagnostics)
      : expandProfileDiagnosticVariables(request.diagnostic.diagnostics);
    const unsupportedSelections = variables.flatMap((variable: string) =>
      levels
        .filter((level: number) =>
          !isSupportedHgefsPressureSelection(variable, level))
        .map((level: number) => `${variable}@${level}hPa`));
    if (unsupportedSelections.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: `HGEFS constituent member intersection cannot satisfy diagnostic inputs: ${unsupportedSelections.join(", ")}`,
      });
    }
  }
}

function validateAifsModifiers(
  request: any,
  context: z.RefinementCtx,
): void {
  const variableSet = new Set<string>(AIFS_PRESSURE_VARIABLE_IDS);
  const rawVariableSet = new Set<string>(AIFS_RAW_PRESSURE_VARIABLE_IDS);
  const pressureLevelSet = new Set<number>(AIFS_PRESSURE_LEVELS_HPA);
  const fieldSet = new Set<string>(AIFS_FIELD_IDS);
  const areaFieldSet = new Set<string>(AIFS_AREA_FIELD_IDS);

  if (request.selection !== undefined) {
    const variables = request.selection.variables ?? [];
    const pressureLevelsHpa = request.selection.pressureLevelsHpa ?? [];
    const fields = request.selection.fields ?? [];

    const unsupportedVariables = variables.filter((variable: string) => !variableSet.has(variable));
    if (unsupportedVariables.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selection", "variables"],
        message: `AIFS pressure variables not supported: ${unsupportedVariables.join(", ")}`,
      });
    }

    const unsupportedLevels = pressureLevelsHpa.filter((level: number) => !pressureLevelSet.has(level));
    if (unsupportedLevels.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selection", "pressureLevelsHpa"],
        message: `AIFS pressure levels not supported: ${unsupportedLevels.join(", ")} hPa`,
      });
    }

    const unsupportedSelections = variables.flatMap((variable: string) =>
      pressureLevelsHpa
        .filter((level: number) =>
          variableSet.has(variable)
          && pressureLevelSet.has(level)
          && !isSupportedAifsPressureSelection(variable as any, level))
        .map((level: number) => `${variable}@${level}hPa`));
    if (unsupportedSelections.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selection"],
        message: `AIFS pressure variable/level selections not supported: ${unsupportedSelections.join(", ")}`,
      });
    }

    const unsupportedFields = fields.filter((field: string) => !fieldSet.has(field));
    if (unsupportedFields.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selection", "fields"],
        message: `AIFS fields not supported: ${unsupportedFields.join(", ")}`,
      });
    }

    if (request.geometry?.type === "area") {
      const derivedAreaVariables = variables.filter((variable: string) => !rawVariableSet.has(variable));
      if (derivedAreaVariables.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["selection", "variables"],
          message: `AIFS area summaries require a native scalar pressure variable; derived variables not supported: ${derivedAreaVariables.join(", ")}`,
        });
      }
      const unsupportedAreaFields = fields.filter((field: string) => !areaFieldSet.has(field));
      if (unsupportedAreaFields.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["selection", "fields"],
          message: `AIFS area summaries require a native scalar field; unsupported: ${unsupportedAreaFields.join(", ")}`,
        });
      }
    }
  }

  if (request.diagnostic !== undefined) {
    if (request.diagnostic.kind === "parcel") {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "AIFS parcel diagnostics are not exposed in the current capability slice",
      });
      return;
    }
    const levels = request.diagnostic.kind === "layer"
      ? [request.diagnostic.lowerPressureHpa, request.diagnostic.upperPressureHpa]
      : request.diagnostic.pressureLevelsHpa;
    const unsupportedLevels = levels.filter((level: number) => !pressureLevelSet.has(level));
    if (unsupportedLevels.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: `AIFS diagnostic pressure levels not supported: ${unsupportedLevels.join(", ")} hPa`,
      });
    }
  }
}
