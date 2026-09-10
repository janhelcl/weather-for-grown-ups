import type { Command } from "commander";
import { ATMOSPHERIC_OPERATION_IDS } from "../catalog/models.js";
import { inspectAtmosphereCapabilities } from "../catalog/capability-inspection.js";
import { InvalidRequestError } from "../failure.js";
import {
  PUBLIC_ATMOSPHERIC_DATASET_IDS,
  publicAtmosphericDatasetSchema,
  type PublicAtmosphericDataset,
} from "../schema/unified-api.js";
import type { InspectAtmosphereCapabilitiesInput } from "../schema/capability-inspection.js";
import { parseCoordinate, parseNumberList, parseStringList } from "./shared.js";

export function registerCapabilityCommand(program: Command): void {
  program
    .command("capabilities")
    .description("Check declared support for one planned atmospheric query without fetching data")
    .requiredOption(`--dataset <${PUBLIC_ATMOSPHERIC_DATASET_IDS.join("|")}>`, "Dataset to inspect")
    .option(`--operation <${ATMOSPHERIC_OPERATION_IDS.join("|")}>`, "Planned operation")
    .option("--point <lat,lon>", "Planned point; also checks declared spatial coverage")
    .option("--area <west,east,south,north>", "Planned bounded area; also checks declared spatial coverage")
    .option("--variables <list>", "Comma-separated pressure-variable IDs")
    .option("--levels <hpa,...>", "Comma-separated pressure levels for variables or diagnostics")
    .option("--fields <list>", "Comma-separated non-isobaric field IDs")
    .option("--layer-diagnostic <id>", "Exact layer diagnostic ID; --levels must contain lower,upper pressure")
    .option("--profile-diagnostic <id>", "Exact profile diagnostic ID; --levels supplies the pressure profile")
    .option("--parcel <id>", "Exact parcel definition ID; --levels supplies the environmental pressure profile")
    .option("--forecast-kind <operational|reforecast>", "Forecast population capability")
    .option("--run <latest|latest_complete|ISO-cycle>", "Planned run selector")
    .option("--grid <0p25|0p50>", "GFS grid override")
    .option("--members <list>", "Comma-separated ensemble member IDs")
    .option("--include-members", "Check raw-member payload support")
    .option("--source <nomads|s3|archive>", "GFS source override")
    .option("--json", "Output JSON")
    .action((options) => {
      const input = buildCapabilityInput(options);
      const result = inspectAtmosphereCapabilities(input);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      printCapabilityResult(result);
    });
}

export function buildCapabilityInput(options: Record<string, any>): InspectAtmosphereCapabilitiesInput {
  const dataset = parseDataset(options.dataset);
  const geometry = parseGeometry(options);
  const selection = parseSelection(options);
  const diagnostic = parseDiagnostic(options);
  const forecast = parseForecast(options);
  const ensemble = parseEnsemble(options);

  return {
    dataset,
    ...(options.operation === undefined ? {} : { operation: String(options.operation) as any }),
    ...(geometry === undefined ? {} : { geometry }),
    ...(selection === undefined ? {} : { selection }),
    ...(diagnostic === undefined ? {} : { diagnostic }),
    ...(forecast === undefined ? {} : { forecast }),
    ...(ensemble === undefined ? {} : { ensemble }),
    ...(options.source === undefined ? {} : { source: String(options.source) as any }),
  };
}

function parseDataset(value: unknown): PublicAtmosphericDataset {
  const parsed = publicAtmosphericDatasetSchema.safeParse(String(value).trim().toLowerCase());
  if (parsed.success) return parsed.data;
  throw new InvalidRequestError(
    `Expected --dataset ${PUBLIC_ATMOSPHERIC_DATASET_IDS.join("|")}, received: ${String(value)}`,
  );
}

function parseGeometry(options: Record<string, any>): InspectAtmosphereCapabilitiesInput["geometry"] {
  if (options.point !== undefined && options.area !== undefined) {
    throw new InvalidRequestError("Use only one of --point or --area");
  }
  if (options.point !== undefined) {
    return { type: "point", ...parseCoordinate(options.point, "--point") };
  }
  if (options.area !== undefined) {
    const values = parseNumberList(options.area, "--area");
    if (values.length !== 4) {
      throw new InvalidRequestError("Expected --area west,east,south,north");
    }
    return {
      type: "area",
      westLongitude: values[0]!,
      eastLongitude: values[1]!,
      southLatitude: values[2]!,
      northLatitude: values[3]!,
    };
  }
  return undefined;
}

function parseSelection(options: Record<string, any>): InspectAtmosphereCapabilitiesInput["selection"] {
  const variables = options.variables === undefined ? undefined : parseStringList(options.variables);
  const levels = options.levels === undefined ? undefined : parseNumberList(options.levels, "--levels");
  const fields = options.fields === undefined ? undefined : parseStringList(options.fields);
  const hasDiagnostic = diagnosticOptionCount(options) > 0;

  if (hasDiagnostic) return undefined;
  if (variables === undefined && levels === undefined && fields === undefined) return undefined;
  if ((variables === undefined) !== (levels === undefined)) {
    throw new InvalidRequestError("Use --variables and --levels together for pressure-level selections");
  }
  return {
    ...(variables === undefined ? {} : { variables, pressureLevelsHpa: levels! }),
    ...(fields === undefined ? {} : { fields }),
  };
}

function parseDiagnostic(options: Record<string, any>): InspectAtmosphereCapabilitiesInput["diagnostic"] {
  const count = diagnosticOptionCount(options);
  if (count === 0) return undefined;
  if (count > 1) {
    throw new InvalidRequestError("Use only one of --layer-diagnostic, --profile-diagnostic, or --parcel");
  }
  if (options.variables !== undefined || options.fields !== undefined) {
    throw new InvalidRequestError("Diagnostic inspection cannot be combined with --variables or --fields");
  }
  const levels = options.levels === undefined ? undefined : parseNumberList(options.levels, "--levels");
  if (levels === undefined) {
    throw new InvalidRequestError("Diagnostic inspection requires --levels");
  }

  if (options.layerDiagnostic !== undefined) {
    if (levels.length !== 2) {
      throw new InvalidRequestError("--layer-diagnostic requires exactly two --levels values: lower,upper pressure hPa");
    }
    return {
      kind: "layer",
      lowerPressureHpa: levels[0]!,
      upperPressureHpa: levels[1]!,
      diagnostics: [String(options.layerDiagnostic) as any],
    };
  }
  if (options.profileDiagnostic !== undefined) {
    return {
      kind: "profile",
      pressureLevelsHpa: levels,
      diagnostics: [String(options.profileDiagnostic) as any],
    };
  }
  return {
    kind: "parcel",
    pressureLevelsHpa: levels,
    parcel: String(options.parcel) as any,
  };
}

function parseForecast(options: Record<string, any>): InspectAtmosphereCapabilitiesInput["forecast"] {
  if (options.forecastKind === undefined && options.run === undefined && options.grid === undefined) return undefined;
  return {
    ...(options.forecastKind === undefined ? {} : { kind: String(options.forecastKind) as any }),
    ...(options.run === undefined ? {} : { run: String(options.run) as any }),
    ...(options.grid === undefined ? {} : { grid: String(options.grid) as any }),
  };
}

function parseEnsemble(options: Record<string, any>): InspectAtmosphereCapabilitiesInput["ensemble"] {
  if (options.members === undefined && options.includeMembers !== true) return undefined;
  return {
    ...(options.members === undefined ? {} : { members: parseStringList(options.members) }),
    ...(options.includeMembers === true ? { includeMembers: true } : {}),
  };
}

function diagnosticOptionCount(options: Record<string, any>): number {
  return [options.layerDiagnostic, options.profileDiagnostic, options.parcel]
    .filter((value) => value !== undefined).length;
}

function printCapabilityResult(result: ReturnType<typeof inspectAtmosphereCapabilities>): void {
  console.log(`${result.dataset}: ${result.supported ? "supported" : "unsupported"} (declared capability)`);
  if (result.unsupported.length > 0) {
    for (const issue of result.unsupported) {
      console.log(`- ${issue.path.join(".") || "request"}: ${issue.reason}`);
    }
  }
  console.log(`Geometries: ${result.geometries.join(", ") || "none"}`);
  console.log(`Operations: ${result.capabilities.operations.join(", ")}`);
  console.log(`Kind: ${result.capabilities.kind}; model: ${result.capabilities.modelClass}; provider: ${result.capabilities.provider}`);
  console.log(`Cadence: ${result.capabilities.nativeTimeCadenceHours.join(",")}h${result.capabilities.maxForecastHour === undefined ? "" : `; horizon: f${result.capabilities.maxForecastHour}`}`);
  if (result.capabilities.members !== undefined) {
    console.log(`Members: ${result.capabilities.members}`);
  }
  console.log("Note: this checks declared contract support, not live run/product availability.");
}
