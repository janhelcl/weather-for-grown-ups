import * as z from "zod/v4";
import {
  GEFS_REFORECAST_EXTENDED_MEMBERS,
  GEFS_REFORECAST_FIELD_IDS,
  GEFS_REFORECAST_PRESSURE_VARIABLE_IDS,
  isSupportedGefsReforecastPressureSelection,
} from "../catalog/gefs-reforecast.js";
import {
  ATMOSPHERIC_DATASET_CATALOG,
  datasetSupportsRunSelector,
  type AtmosphericDatasetId,
  type AtmosphericDatasetKind,
  type AtmosphericDatasetRole,
  type AtmosphericRunSelectorId,
} from "../catalog/models.js";
import {
  AIGFS_AREA_FIELD_IDS,
  AIGFS_PRESSURE_LEVELS_HPA,
  AIGFS_PRESSURE_VARIABLE_IDS,
  AIGFS_RAW_PRESSURE_VARIABLE_IDS,
} from "../catalog/aigfs.js";
import { AIGEFS_MEMBERS } from "../catalog/aigefs.js";
import { AROME_0P01_AREA_FIELD_IDS, AROME_0P01_FIELD_IDS } from "../catalog/arome.js";
import {
  ICON_D2_AREA_FIELD_IDS,
  ICON_D2_AREA_PRESSURE_VARIABLE_IDS,
  ICON_D2_FIELD_IDS,
  ICON_D2_PRESSURE_LEVELS_HPA,
  ICON_D2_PRESSURE_VARIABLE_IDS,
} from "../catalog/icon-d2.js";
import { AIFS_ENS_MEMBERS } from "../catalog/aifs-ens.js";
import { ICON_D2_EPS_MEMBERS } from "../catalog/icon-d2-eps.js";
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

export interface DatasetCapabilityMetadata {
  internalDatasetId: AtmosphericDatasetId;
  role: AtmosphericDatasetRole;
  kind: AtmosphericDatasetKind;
}

const DATASET_CAPABILITY_VALIDATORS: Readonly<Record<string, readonly DatasetCapabilityValidator[]>> = {
  gfs: [validateGfsModifiers],
  aigfs: [validateAigfsModifiers],
  aigefs: [validateAigfsModifiers, validateAigefsMembers],
  hgefs: [validateAigfsModifiers, validateHgefsModifiers, validateHgefsMembers],
  "icon-d2": [validateIconD2Modifiers],
  "icon-d2-eps": [validateIconD2Modifiers, validateIconD2EpsMembers],
  arome: [validateAromeModifiers],
  aifs: [validateAifsModifiers],
  "aifs-ens": [validateAifsModifiers, validateAifsEnsMembers],
};

export function validateDatasetCapabilityModifiers(
  request: any,
  context: z.RefinementCtx,
  metadata: DatasetCapabilityMetadata,
): void {
  validateSharedDatasetModifiers(request, context, metadata);
  if (request.forecast?.kind === "reforecast") {
    validateGefsReforecastModifiers(request, context);
  }
  for (const validator of DATASET_CAPABILITY_VALIDATORS[request.dataset] ?? []) {
    validator(request, context);
  }
}

function validateSharedDatasetModifiers(
  request: any,
  context: z.RefinementCtx,
  metadata: DatasetCapabilityMetadata,
): void {
  const isReforecast = request.forecast?.kind === "reforecast";

  if (metadata.role === "forecast" && !isReforecast) {
    const run = request.forecast?.run ?? "latest";
    const selector = runSelectorCapability(run);
    if (!datasetSupportsRunSelector(metadata.internalDatasetId, selector)) {
      const supported = ATMOSPHERIC_DATASET_CATALOG[metadata.internalDatasetId].runSelectors
        .map(runSelectorLabel)
        .join(", ");
      context.addIssue({
        code: "custom",
        path: ["forecast", "run"],
        message: `dataset=${request.dataset} does not support run=${run}; supported run selectors: ${supported}`,
      });
    }
  }

  if (metadata.role === "analysis" && request.forecast !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["forecast"],
      message: "Historical GFS analysis has no forecast initialization or lead axis",
    });
  }
  if (metadata.role !== "analysis" && "from" in request.time && request.time.hoursUtc !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["time", "hoursUtc"],
      message: "hoursUtc is only valid for gfs-analysis ranges",
    });
  }
  if (request.dataset !== "gfs" && request.forecast?.grid !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["forecast", "grid"],
      message: "forecast.grid is only configurable for the gfs dataset",
    });
  }
  if (metadata.kind !== "ensemble" && request.ensemble !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["ensemble"],
      message: "ensemble controls are only valid for ensemble datasets: aigefs, hgefs, icon-d2-eps, gefs, aifs-ens, or ifs-ens",
    });
  }
  if (request.dataset !== "gfs" && request.source !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["source"],
      message: "source override is only valid for gfs",
    });
  }
}

function validateGfsModifiers(request: any, context: z.RefinementCtx): void {
  if (request.source === undefined || request.source === "archive") return;
  if (request.geometry?.type === "area" && request.source !== "nomads") {
    context.addIssue({
      code: "custom",
      path: ["source"],
      message: "Operational GFS area queries use NOMADS geographic subsetting; omit source for automatic routing or use source=nomads",
    });
  }
  if (
    (request.geometry?.type === "points" || request.geometry?.type === "transect")
    && request.source !== "s3"
  ) {
    context.addIssue({
      code: "custom",
      path: ["source"],
      message: "Operational GFS multi-point and transect queries reuse AWS S3 byte-range slices; omit source for automatic routing or use source=s3",
    });
  }
}

function validateGefsReforecastModifiers(
  request: any,
  context: z.RefinementCtx,
): void {
  if (request.dataset !== "gefs") {
    context.addIssue({
      code: "custom",
      path: ["forecast", "kind"],
      message: "forecast.kind=reforecast is currently available only for dataset=gefs",
    });
  }
  if (request.forecast?.run === "latest" || request.forecast?.run === "latest_complete") {
    context.addIssue({
      code: "custom",
      path: ["forecast", "run"],
      message: "GEFSv12 reforecast queries require an explicit historical 00Z initialization",
    });
  }
  if (
    request.geometry?.type !== "point"
    && request.geometry?.type !== "points"
  ) {
    context.addIssue({
      code: "custom",
      path: ["geometry"],
      message: "GEFSv12 reforecast support currently covers point and multi-point geometry; transect and area support will be added without changing the public query vocabulary",
    });
  }
  if (
    request.time !== undefined
    && "from" in request.time
    && request.ensemble?.includeMembers === true
  ) {
    context.addIssue({
      code: "custom",
      path: ["ensemble", "includeMembers"],
      message: "GEFSv12 reforecast time ranges return compact member-first summaries; use one valid time to include raw member payloads",
    });
  }
  if (
    request.diagnostic !== undefined
    && request.diagnostic.kind === "parcel"
  ) {
    context.addIssue({
      code: "custom",
      path: ["diagnostic"],
      message: "GEFSv12 reforecast parcel diagnostics are not exposed because the current retrospective subset lacks the required moisture/surface inputs",
    });
  }
  if (request.selection !== undefined) {
    const variables = request.selection.variables ?? [];
    const pressureLevelsHpa = request.selection.pressureLevelsHpa ?? [];
    const fields = request.selection.fields ?? [];
    const supportedFields = new Set<string>(GEFS_REFORECAST_FIELD_IDS);
    const unsupportedFields = fields.filter((field: string) => !supportedFields.has(field));
    if (unsupportedFields.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selection", "fields"],
        message: `GEFSv12 reforecast fields not yet supported: ${unsupportedFields.join(", ")}`,
      });
    }

    const supportedVariables = new Set<string>(GEFS_REFORECAST_PRESSURE_VARIABLE_IDS);
    const unsupportedVariables = variables.filter((variable: string) => !supportedVariables.has(variable));
    if (unsupportedVariables.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selection", "variables"],
        message: `GEFSv12 reforecast pressure variables not supported: ${unsupportedVariables.join(", ")}`,
      });
    }
    for (const variable of variables) {
      if (!supportedVariables.has(variable)) continue;
      for (const pressureLevelHpa of pressureLevelsHpa) {
        if (!isSupportedGefsReforecastPressureSelection(variable as any, pressureLevelHpa)) {
          context.addIssue({
            code: "custom",
            path: ["selection", "pressureLevelsHpa"],
            message: `GEFSv12 reforecast cannot satisfy ${variable} at ${pressureLevelHpa} hPa`,
          });
        }
      }
    }
  }
  if (request.ensemble?.members !== undefined) {
    const supportedMembers = new Set<string>(GEFS_REFORECAST_EXTENDED_MEMBERS);
    const unsupported = request.ensemble.members.filter(
      (member: string) => !supportedMembers.has(member),
    );
    if (unsupported.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["ensemble", "members"],
        message: `GEFSv12 reforecast members are c00,p01..p10; unsupported: ${unsupported.join(", ")}`,
      });
    }
  }
}

function runSelectorCapability(value: string): AtmosphericRunSelectorId {
  if (value === "latest" || value === "latest_complete") return value;
  return "explicit";
}

function runSelectorLabel(value: AtmosphericRunSelectorId): string {
  return value === "explicit" ? "explicit ISO cycle" : value;
}

function validateIconD2EpsMembers(request: any, context: z.RefinementCtx): void {
  validateMemberSelection(
    request,
    context,
    ICON_D2_EPS_MEMBERS,
    "ICON-D2-EPS members are p01..p20",
  );
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


function validateAromeModifiers(
  request: any,
  context: z.RefinementCtx,
): void {
  if (request.selection !== undefined) {
    const variables = request.selection.variables ?? [];
    const pressureLevelsHpa = request.selection.pressureLevelsHpa ?? [];
    const fields = request.selection.fields ?? [];

    if (variables.length > 0 || pressureLevelsHpa.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selection", "variables"],
        message: "AROME 0.01° EURW1S100 is a field-only capability in WFG; pressure-level variables belong to a separate Météo-France product and are not silently mixed into this dataset",
      });
    }

    const supportedFields = new Set<string>(AROME_0P01_FIELD_IDS);
    const unsupportedFields = fields.filter((field: string) => !supportedFields.has(field));
    if (unsupportedFields.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selection", "fields"],
        message: `AROME 0.01° fields not supported: ${unsupportedFields.join(", ")}`,
      });
    }

    if (request.geometry?.type === "area") {
      const areaFields = new Set<string>(AROME_0P01_AREA_FIELD_IDS);
      const unsupportedAreaFields = fields.filter((field: string) => !areaFields.has(field));
      if (unsupportedAreaFields.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["selection", "fields"],
          message: `AROME 0.01° area summaries require a native scalar field; unsupported: ${unsupportedAreaFields.join(", ")}`,
        });
      }
    }
  }

  if (request.diagnostic !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["diagnostic"],
      message: "AROME 0.01° EURW1S100 currently exposes field-only queries; pressure-based diagnostics are not available from this product",
    });
  }
}

function validateIconD2Modifiers(
  request: any,
  context: z.RefinementCtx,
): void {
  const variableSet = new Set<string>(ICON_D2_PRESSURE_VARIABLE_IDS);
  const pressureLevelSet = new Set<number>(ICON_D2_PRESSURE_LEVELS_HPA);
  const fieldSet = new Set<string>(ICON_D2_FIELD_IDS);
  const areaVariableSet = new Set<string>(ICON_D2_AREA_PRESSURE_VARIABLE_IDS);
  const areaFieldSet = new Set<string>(ICON_D2_AREA_FIELD_IDS);

  if (request.selection !== undefined) {
    const variables = request.selection.variables ?? [];
    const pressureLevelsHpa = request.selection.pressureLevelsHpa ?? [];
    const fields = request.selection.fields ?? [];

    const unsupportedVariables = variables.filter(
      (variable: string) => !variableSet.has(variable),
    );
    if (unsupportedVariables.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selection", "variables"],
        message: `ICON-D2 pressure variables not supported: ${unsupportedVariables.join(", ")}`,
      });
    }

    const unsupportedLevels = pressureLevelsHpa.filter(
      (level: number) => !pressureLevelSet.has(level),
    );
    if (unsupportedLevels.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selection", "pressureLevelsHpa"],
        message: `ICON-D2 pressure levels not supported: ${unsupportedLevels.join(", ")} hPa`,
      });
    }

    const unsupportedFields = fields.filter((field: string) => !fieldSet.has(field));
    if (unsupportedFields.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["selection", "fields"],
        message: `ICON-D2 fields not supported: ${unsupportedFields.join(", ")}`,
      });
    }

    if (request.geometry?.type === "area") {
      const unsupportedAreaVariables = variables.filter(
        (variable: string) => !areaVariableSet.has(variable),
      );
      if (unsupportedAreaVariables.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["selection", "variables"],
          message: `ICON-D2 area summaries require a native scalar pressure variable; unsupported: ${unsupportedAreaVariables.join(", ")}`,
        });
      }
      const unsupportedAreaFields = fields.filter(
        (field: string) => !areaFieldSet.has(field),
      );
      if (unsupportedAreaFields.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["selection", "fields"],
          message: `ICON-D2 area summaries require a native scalar field; unsupported: ${unsupportedAreaFields.join(", ")}`,
        });
      }
    }
  }

  if (request.diagnostic !== undefined) {
    if (request.diagnostic.kind === "parcel") {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "ICON-D2 parcel diagnostics are not exposed by the current Open Data subset",
      });
      return;
    }
    const levels = request.diagnostic.kind === "layer"
      ? [request.diagnostic.lowerPressureHpa, request.diagnostic.upperPressureHpa]
      : request.diagnostic.pressureLevelsHpa;
    const unsupportedLevels = levels.filter(
      (level: number) => !pressureLevelSet.has(level),
    );
    if (unsupportedLevels.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: `ICON-D2 diagnostic pressure levels not supported: ${unsupportedLevels.join(", ")} hPa`,
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
