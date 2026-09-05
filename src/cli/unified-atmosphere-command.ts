import type { Command } from "commander";
import {
  UnifiedAnalogService,
  UnifiedAtmosphereDiagnosticService,
  UnifiedAtmosphereQueryService,
  UnifiedDatasetComparisonService,
  UnifiedForecastVerificationService,
  UnifiedRunComparisonService,
} from "../core/unified-atmosphere-api.js";
import {
  PUBLIC_ATMOSPHERIC_DATASET_IDS,
  publicAtmosphericDatasetSchema,
  publicDatasetMetadata,
  type DiagnoseAtmosphereInput,
  type PublicAtmosphericDataset,
  type QueryAtmosphereInput,
} from "../schema/unified-api.js";
import {
  ATMOSPHERIC_RUN_COMPARISON_DATASET_IDS,
  compareAtmosphericDatasetsSchema,
  compareAtmosphericRunsSchema,
  type CompareAtmosphericDatasetsInput,
  type CompareAtmosphericRunsInput,
  type VerifyAtmosphericForecastInput,
} from "../schema/unified-specialized.js";
import type { PointCoordinate } from "../schema/query.js";
import type { AtmosphericStepProgress } from "../core/progress.js";
import { InvalidRequestError } from "../failure.js";
import {
  DEFAULT_LEVELS,
  collectPoint,
  numberOption,
  parseAigefsMembers,
  parseAifsEnsMembers,
  parseCoordinate,
  parseGefsMembers,
  parseIfsEnsMembers,
  parseNumberList,
  parseStringList,
} from "./shared.js";

const DEFAULT_UNIFIED_VARIABLES =
  "temperature,relative_humidity,u_wind,v_wind,geopotential_height";
const DEFAULT_IGRA_VERIFICATION_VARIABLES =
  "temperature,relative_humidity,wind,geopotential_height";

export function registerUnifiedAtmosphereCommands(program: Command): void {
  registerQueryCommand(program);
  registerDiagnoseCommand(program);
  registerCompareRunsCommand(program);
  registerCompareDatasetsCommand(program);
  registerVerifyCommand(program);
  registerAnalogsCommand(program);
}

function registerQueryCommand(program: Command): void {
  program
    .command("query")
    .description("Query atmospheric state through dataset × geometry × time × selection")
    .option("--dataset <id>", `Atmospheric dataset (${PUBLIC_ATMOSPHERIC_DATASET_IDS.join("|")})`, "gfs")
    .option("--lat <number>", "Point latitude", numberOption("--lat"))
    .option("--lon <number>", "Point longitude", numberOption("--lon"))
    .option("--point <lat,lon>", "Multi-point coordinate; repeat as needed", collectPoint)
    .option("--start <lat,lon>", "Transect start")
    .option("--end <lat,lon>", "Transect end")
    .option("--samples <number>", "Transect sample count", numberOption("--samples"))
    .option("--west <number>", "Area west longitude", numberOption("--west"))
    .option("--east <number>", "Area east longitude", numberOption("--east"))
    .option("--south <number>", "Area south latitude", numberOption("--south"))
    .option("--north <number>", "Area north latitude", numberOption("--north"))
    .option("--at <iso>", "One atmospheric valid time")
    .option("--from <iso>", "Inclusive valid-time range start")
    .option("--to <iso>", "Inclusive valid-time range end")
    .option("--cycles <list>", "gfs-analysis range only: UTC cycles such as 0,6,12,18")
    .option("--max-steps <number>", "Maximum time steps", numberOption("--max-steps"))
    .option("--vars <list>", "Comma-separated pressure-level variables")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "Comma-separated non-isobaric fields")
    .option("--run <iso|latest|latest_complete>", "Forecast initialization")
    .option("--forecast-kind <operational|reforecast>", "Forecast population; reforecast currently selects GEFSv12 retrospective forecasts")
    .option("--grid <0p25|0p50>", "GFS horizontal grid")
    .option("--source <nomads|s3|archive>", "GFS source override; omit for automatic AWS/NOMADS/archive routing")
    .option("--members <list>", "Dataset-native ensemble member IDs; use catalog/search_catalog for the supported population")
    .option("--quantiles <list>", "Ensemble quantiles from 0 to 1")
    .option("--include-members", "Include raw ensemble member payloads where supported")
    .option("--percentiles <list>", "Area spatial percentiles, e.g. 10,50,90")
    .option("--gte <number>", "Area fraction at or above this threshold", numberOption("--gte"))
    .option("--lte <number>", "Area fraction at or below this threshold", numberOption("--lte"))
    .option("--extrema", "Area representative min/max locations")
    .option("--max-samples <number>", "Multi-point time-series sample guardrail", numberOption("--max-samples"))
    .option("--max-point-steps <number>", "Point × time-step guardrail", numberOption("--max-point-steps"))
    .option("--max-grid-points <number>", "Area grid-point guardrail", numberOption("--max-grid-points"))
    .option("--max-member-grid-points <number>", "Ensemble area member × grid guardrail", numberOption("--max-member-grid-points"))
    .option("--max-member-samples <number>", "Ensemble raw member payload guardrail", numberOption("--max-member-samples"))
    .option("--json", "Output JSON")
    .action(async (options) => {
      const request = buildUnifiedQuery(options);
      const result = await new UnifiedAtmosphereQueryService({
        progress: reportCliProgress,
      }).query(request);
      printResult(result, Boolean(options.json));
    });
}

function registerDiagnoseCommand(program: Command): void {
  program
    .command("diagnose")
    .description("Derive layer, profile, or parcel meteorology from any atmospheric dataset")
    .option("--dataset <id>", `Atmospheric dataset (${PUBLIC_ATMOSPHERIC_DATASET_IDS.join("|")})`, "gfs")
    .requiredOption("--lat <number>", "Latitude", numberOption("--lat"))
    .requiredOption("--lon <number>", "Longitude", numberOption("--lon"))
    .requiredOption("--kind <layer|profile|parcel>", "Diagnostic family")
    .option("--at <iso>", "One atmospheric valid time")
    .option("--from <iso>", "Inclusive valid-time range start")
    .option("--to <iso>", "Inclusive valid-time range end")
    .option("--cycles <list>", "gfs-analysis range only: UTC cycles such as 0,6,12,18")
    .option("--max-steps <number>", "Maximum time steps", numberOption("--max-steps"))
    .option("--lower <hpa>", "Layer lower pressure surface", numberOption("--lower"))
    .option("--upper <hpa>", "Layer upper pressure surface", numberOption("--upper"))
    .option("--levels <list>", "Profile/parcel pressure levels in hPa", DEFAULT_LEVELS)
    .option("--diagnostics <list>", "Layer/profile diagnostic IDs")
    .option("--parcel <surface_2m|mixed_layer_100hpa|most_unstable_300hpa>", "Parcel definition")
    .option("--run <iso|latest|latest_complete>", "Forecast initialization")
    .option("--forecast-kind <operational|reforecast>", "Forecast population; reforecast currently selects GEFSv12 retrospective forecasts")
    .option("--grid <0p25|0p50>", "GFS horizontal grid")
    .option("--source <nomads|s3|archive>", "GFS source override; omit for automatic AWS/NOMADS/archive routing")
    .option("--members <list>", "Dataset-native ensemble member IDs; use catalog/search_catalog for the supported population")
    .option("--quantiles <list>", "Ensemble quantiles from 0 to 1")
    .option("--include-members", "Ensemble instant diagnostics only: include member payloads")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const request = buildUnifiedDiagnostic(options);
      const result = await new UnifiedAtmosphereDiagnosticService().diagnose(request);
      printResult(result, Boolean(options.json));
    });
}

function registerCompareRunsCommand(program: Command): void {
  program
    .command("compare-runs")
    .description("Compare forecast initialization cycles for supported atmospheric datasets")
    .option(
      `--dataset <${ATMOSPHERIC_RUN_COMPARISON_DATASET_IDS.join("|")}>`,
      "Forecast dataset",
      "gfs",
    )
    .requiredOption("--lat <number>", "Latitude", numberOption("--lat"))
    .requiredOption("--lon <number>", "Longitude", numberOption("--lon"))
    .requiredOption("--at <iso>", "Forecast valid time")
    .option("--vars <list>", "Pressure-level variables", "temperature")
    .option("--levels <list>", "Pressure levels in hPa", "850")
    .option("--fields <list>", "Deterministic GFS/IFS non-isobaric fields")
    .option("--anchor-run <iso|latest>", "Newest initialization cycle to compare", "latest")
    .option("--grid <0p25|0p50>", "GFS horizontal grid")
    .option("--cycles <number>", "Number of consecutive cycles", numberOption("--cycles"), 3)
    .option("--members <list>", "Dataset-native ensemble member IDs; use catalog/search_catalog for the supported population")
    .option("--quantiles <list>", "Ensemble quantiles from 0 to 1")
    .option("--gte <number>", "Ensemble threshold in normalized units", numberOption("--gte"))
    .option("--cycle-stride-hours <6|12>", "IFS ENS only: initialization-cycle stride", numberOption("--cycle-stride-hours"))
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = await new UnifiedRunComparisonService().compare(
        buildUnifiedRunComparison(options),
      );
      printResult(result, Boolean(options.json));
    });
}

function registerCompareDatasetsCommand(program: Command): void {
  program
    .command("compare-datasets")
    .description("Compare scientifically compatible aligned forecast datasets")
    .requiredOption("--lat <number>", "Latitude", numberOption("--lat"))
    .requiredOption("--lon <number>", "Longitude", numberOption("--lon"))
    .requiredOption("--at <iso>", "Forecast valid time")
    .requiredOption(
      "--dataset <id>",
      "Left-side dataset of a registered comparison pair, in registered order (e.g. gfs with --against gefs)",
    )
    .requiredOption(
      "--against <id>",
      "Right-side dataset of the registered comparison pair; see catalog/search_catalog or the compare_datasets tool description for the registry",
    )
    .option("--var <id>", "Canonical pressure-level variable")
    .option("--level <hpa>", "Pressure level in hPa", numberOption("--level"))
    .option("--field <id>", "Canonical non-isobaric field for registered field comparisons")
    .option(
      "--run <iso|latest>",
      "Shared aligned initialization; global↔regional comparisons require an explicit ISO cycle",
      "latest",
    )
    .option("--grid <0p25|0p50>", "GFS horizontal grid; GFS comparison branches only")
    .option("--members <list>", "GFS↔GEFS only: GEFS members (c00,p01..p30)")
    .option("--gefs-members <list>", "GEFS members for cross-ensemble comparisons")
    .option("--aigefs-members <list>", "AIGEFS members (c00,p01..p30)")
    .option("--ifs-ens-members <list>", "IFS ENS perturbations (p01..p50)")
    .option("--aifs-ens-members <list>", "AIFS ENS members (c00,p01..p50)")
    .option("--icon-d2-eps-members <list>", "ICON-D2-EPS members (p01..p20)")
    .option("--pe-arome-members <list>", "PE-AROME members (c00,p01..p24)")
    .option(
      "--hgefs-members <list>",
      "HGEFS population-qualified members (gefs:c00..p30,aigefs:c00..p30)",
    )
    .option("--quantiles <list>", "Ensemble quantiles from 0 to 1")
    .option("--gte <number>", "Compare raw ensemble member fractions at or above this threshold", numberOption("--gte"))
    .option("--json", "Output JSON")
    .action(async (options) => {
      const request = buildUnifiedDatasetComparison(options);
      const result = await new UnifiedDatasetComparisonService().compare(request);
      printResult(result, Boolean(options.json));
    });
}


export function buildUnifiedDatasetComparison(
  options: Record<string, any>,
): CompareAtmosphericDatasetsInput {
  const against = String(options.against).trim().toLowerCase();
  if (!publicAtmosphericDatasetSchema.safeParse(against).success) {
    throw new InvalidRequestError(
      `Expected --against ${PUBLIC_ATMOSPHERIC_DATASET_IDS.join("|")}, received: ${options.against}`,
      { details: { option: "--against", received: options.against } },
    );
  }

  const left = String(options.dataset).trim().toLowerCase();
  if (!publicAtmosphericDatasetSchema.safeParse(left).success) {
    throw new InvalidRequestError(
      `Expected --dataset ${PUBLIC_ATMOSPHERIC_DATASET_IDS.join("|")}, received: ${options.dataset}`,
      { details: { option: "--dataset", received: options.dataset } },
    );
  }

  // Both sides are explicit; the pair schema reports reversed or unregistered
  // pairs together with the registered list.

  const request = {
    datasets: [left, against],
    geometry: { type: "point", latitude: options.lat, longitude: options.lon },
    time: { at: options.at },
    ...(options.var === undefined ? {} : { variable: String(options.var) }),
    ...(options.level === undefined ? {} : { pressureLevelHpa: options.level }),
    ...(options.field === undefined ? {} : { field: String(options.field) }),
    run: options.run ?? "latest",
    ...(options.grid === undefined ? {} : { gfsGrid: options.grid }),
    ...(options.members === undefined
      ? {}
      : { members: parseGefsMembers(options.members) }),
    ...(options.gefsMembers === undefined
      ? {}
      : { gefsMembers: parseGefsMembers(options.gefsMembers) }),
    ...(options.aigefsMembers === undefined
      ? {}
      : { aigefsMembers: parseAigefsMembers(options.aigefsMembers) }),
    ...(options.ifsEnsMembers === undefined
      ? {}
      : { ifsEnsMembers: parseIfsEnsMembers(options.ifsEnsMembers) }),
    ...(options.aifsEnsMembers === undefined
      ? {}
      : { aifsEnsMembers: parseAifsEnsMembers(options.aifsEnsMembers) }),
    ...(options.hgefsMembers === undefined
      ? {}
      : { hgefsMembers: parseStringList(options.hgefsMembers) }),
    ...(options.iconD2EpsMembers === undefined
      ? {}
      : { iconD2EpsMembers: parseStringList(options.iconD2EpsMembers) }),
    ...(options.peAromeMembers === undefined
      ? {}
      : { peAromeMembers: parseStringList(options.peAromeMembers) }),
    ...(options.quantiles === undefined
      ? {}
      : { quantiles: parseNumberList(options.quantiles, "--quantiles") }),
    ...(options.gte === undefined ? {} : { thresholdGte: options.gte }),
  };

  return compareAtmosphericDatasetsSchema.parse(request);
}

function registerVerifyCommand(program: Command): void {
  program
    .command("verify")
    .description("Verify archived GFS forecasts against GFS analysis or IGRA radiosondes")
    .requiredOption("--lat <number>", "Latitude", numberOption("--lat"))
    .requiredOption("--lon <number>", "Longitude", numberOption("--lon"))
    .option("--at <iso>", "One historical valid time")
    .option("--from <iso>", "Skill-summary range start")
    .option("--to <iso>", "Skill-summary range end")
    .requiredOption("--lead-hours <number|list>", "Forecast lead(s) in hours; multiples of 6")
    .option("--reference <gfs-analysis|igra>", "Verification reference", "gfs-analysis")
    .option("--hours <list>", "Skill-summary nominal UTC cycles", "0,12")
    .option("--max-valid-times <number>", "Skill-summary sampling cap (max 8)", numberOption("--max-valid-times"), 8)
    .option("--grid <0p25|0p50>", "GFS forecast grid; IGRA reference only")
    .option("--station <id>", "Explicit 11-character IGRA station ID")
    .option("--max-station-distance-km <number>", "Maximum IGRA station distance", numberOption("--max-station-distance-km"))
    .option("--vars <list>", "Pressure-level variables")
    .option("--levels <list>", "Pressure levels in hPa", DEFAULT_LEVELS)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const hasInstant = options.at !== undefined;
      const hasRange = options.from !== undefined || options.to !== undefined;
      if (hasInstant === hasRange) {
        throw new InvalidRequestError("Choose exactly one verification time form: --at, or --from plus --to");
      }
      if (hasRange && (options.from === undefined || options.to === undefined)) {
        throw new InvalidRequestError("Skill-summary verification requires both --from and --to");
      }

      const referenceDataset = String(options.reference);
      const defaultVariables = referenceDataset === "igra"
        ? DEFAULT_IGRA_VERIFICATION_VARIABLES
        : DEFAULT_UNIFIED_VARIABLES;
      const leads = parseNumberList(options.leadHours, "--lead-hours");
      if (hasInstant && leads.length !== 1) {
        throw new InvalidRequestError("Atomic verification requires exactly one --lead-hours value");
      }

      const common = {
        forecastDataset: "gfs" as const,
        geometry: { type: "point" as const, latitude: options.lat, longitude: options.lon },
        variables: parseStringList(options.vars ?? defaultVariables),
        pressureLevelsHpa: parseNumberList(options.levels, "--levels"),
        ...(options.grid === undefined ? {} : { gfsGrid: options.grid }),
        ...(options.station === undefined ? {} : { stationId: options.station }),
        ...(options.maxStationDistanceKm === undefined
          ? {}
          : { maxStationDistanceKm: options.maxStationDistanceKm }),
      };

      const request: VerifyAtmosphericForecastInput = hasInstant
        ? {
            ...common,
            referenceDataset: referenceDataset as "gfs-analysis" | "igra",
            time: { at: options.at },
            leadHours: leads[0]!,
          }
        : {
            ...common,
            referenceDataset: referenceDataset as "gfs-analysis" | "igra",
            time: {
              from: options.from,
              to: options.to,
              hoursUtc: parseNumberList(options.hours, "--hours") as Array<0 | 6 | 12 | 18>,
              maxValidTimes: options.maxValidTimes,
            },
            leadHours: leads,
          };

      const result = await new UnifiedForecastVerificationService().verify(request);
      printResult(result, Boolean(options.json));
    });
}

function registerAnalogsCommand(program: Command): void {
  program
    .command("analogs")
    .description("Find historical atmospheric analogs in the local materialized index")
    .requiredOption("--lat <number>", "Latitude", numberOption("--lat"))
    .requiredOption("--lon <number>", "Longitude", numberOption("--lon"))
    .requiredOption("--at <iso>", "Target historical analysis time")
    .option("--vars <list>", "Pressure-level variables", DEFAULT_UNIFIED_VARIABLES)
    .option("--levels <list>", "Pressure levels in hPa", DEFAULT_LEVELS)
    .option("--count <number>", "Number of analogs", numberOption("--count"), 5)
    .option("--exclude-within-hours <number>", "Exclude candidates near target time", numberOption("--exclude-within-hours"), 24)
    .option("--no-fetch-target", "Do not fetch and materialize the target when missing")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = await new UnifiedAnalogService().find({
        dataset: "gfs-analysis",
        geometry: { type: "point", latitude: options.lat, longitude: options.lon },
        time: { at: options.at },
        variables: parseStringList(options.vars),
        pressureLevelsHpa: parseNumberList(options.levels, "--levels"),
        count: options.count,
        excludeWithinHours: options.excludeWithinHours,
        fetchTargetIfMissing: options.fetchTarget,
      });
      printResult(result, Boolean(options.json));
    });
}

export function buildUnifiedQuery(options: Record<string, any>): QueryAtmosphereInput {
  const dataset = parseDataset(options.dataset);
  const geometry = parseGeometry(options);
  const time = parseTime(options);
  const selection = parseSelection(options);

  return {
    dataset,
    geometry,
    time,
    selection,
    ...forecastInput(dataset, options),
    ...(options.source === undefined ? {} : { source: options.source }),
    ...ensembleInput(dataset, options),
    ...aggregateInput(options),
    ...limitsInput(options),
  };
}

export function buildUnifiedRunComparison(
  options: Record<string, any>,
): CompareAtmosphericRunsInput {
  const dataset = parseDataset(options.dataset);
  const selection = parseSelection({
    vars: options.vars,
    levels: options.levels,
    fields: options.fields,
  });
  const request = {
    dataset,
    geometry: { type: "point", latitude: options.lat, longitude: options.lon },
    time: { at: options.at },
    selection,
    anchorRun: options.anchorRun ?? "latest",
    ...(options.grid === undefined ? {} : { gfsGrid: options.grid }),
    cycles: options.cycles ?? 3,
    ...(options.members === undefined && options.quantiles === undefined
      ? {}
      : {
          ensemble: {
            ...(options.members === undefined
              ? {}
              : { members: parseEnsembleMembers(dataset, options.members) }),
            ...(options.quantiles === undefined
              ? {}
              : { quantiles: parseNumberList(options.quantiles, "--quantiles") }),
          },
        }),
    ...(options.gte === undefined ? {} : { thresholdGte: options.gte }),
    ...(options.cycleStrideHours === undefined
      ? {}
      : { cycleStrideHours: options.cycleStrideHours }),
  };

  return compareAtmosphericRunsSchema.parse(request);
}

export function buildUnifiedDiagnostic(options: Record<string, any>): DiagnoseAtmosphereInput {
  const dataset = parseDataset(options.dataset);
  const time = parseTime(options);
  const kind = String(options.kind).toLowerCase();

  let diagnostic: DiagnoseAtmosphereInput["diagnostic"];
  if (kind === "layer") {
    if (options.lower === undefined || options.upper === undefined || options.diagnostics === undefined) {
      throw new InvalidRequestError("Layer diagnostics require --lower, --upper and --diagnostics");
    }
    diagnostic = {
      kind: "layer",
      lowerPressureHpa: options.lower,
      upperPressureHpa: options.upper,
      diagnostics: parseStringList(options.diagnostics) as any,
    };
  } else if (kind === "profile") {
    if (options.diagnostics === undefined) {
      throw new InvalidRequestError("Profile diagnostics require --diagnostics");
    }
    diagnostic = {
      kind: "profile",
      pressureLevelsHpa: parseNumberList(options.levels, "--levels"),
      diagnostics: parseStringList(options.diagnostics) as any,
    };
  } else if (kind === "parcel") {
    if (options.parcel === undefined) {
      throw new InvalidRequestError("Parcel diagnostics require --parcel");
    }
    diagnostic = {
      kind: "parcel",
      pressureLevelsHpa: parseNumberList(options.levels, "--levels"),
      parcel: options.parcel,
    } as DiagnoseAtmosphereInput["diagnostic"];
  } else {
    throw new InvalidRequestError(`Expected --kind layer|profile|parcel, received: ${options.kind}`);
  }

  return {
    dataset,
    geometry: { type: "point", latitude: options.lat, longitude: options.lon },
    time,
    diagnostic,
    ...forecastInput(dataset, options),
    ...(options.source === undefined ? {} : { source: options.source }),
    ...ensembleInput(dataset, options),
  };
}

function parseDataset(value: unknown): PublicAtmosphericDataset {
  const normalized = String(value).trim().toLowerCase();
  const parsed = publicAtmosphericDatasetSchema.safeParse(normalized);
  if (parsed.success) return parsed.data;
  throw new InvalidRequestError(
    `Expected --dataset ${PUBLIC_ATMOSPHERIC_DATASET_IDS.join("|")}, received: ${value}`,
  );
}

function parseGeometry(options: Record<string, any>): QueryAtmosphereInput["geometry"] {
  const modes = [
    options.lat !== undefined || options.lon !== undefined,
    options.point !== undefined,
    options.start !== undefined || options.end !== undefined,
    options.west !== undefined || options.east !== undefined || options.south !== undefined || options.north !== undefined,
  ].filter(Boolean).length;
  if (modes !== 1) {
    throw new InvalidRequestError("Choose exactly one geometry: --lat/--lon, repeatable --point, --start/--end, or --west/--east/--south/--north");
  }

  if (options.lat !== undefined || options.lon !== undefined) {
    if (options.lat === undefined || options.lon === undefined) throw new InvalidRequestError("Point geometry requires both --lat and --lon");
    return { type: "point", latitude: options.lat, longitude: options.lon };
  }
  if (options.point !== undefined) {
    return { type: "points", points: options.point as PointCoordinate[] };
  }
  if (options.start !== undefined || options.end !== undefined) {
    if (options.start === undefined || options.end === undefined) throw new InvalidRequestError("Transect geometry requires both --start and --end");
    return {
      type: "transect",
      start: parseCoordinate(options.start, "--start"),
      end: parseCoordinate(options.end, "--end"),
      ...(options.samples === undefined ? {} : { samples: options.samples }),
    };
  }
  for (const key of ["west", "east", "south", "north"]) {
    if (options[key] === undefined) throw new InvalidRequestError("Area geometry requires --west, --east, --south and --north");
  }
  return {
    type: "area",
    westLongitude: options.west,
    eastLongitude: options.east,
    southLatitude: options.south,
    northLatitude: options.north,
  };
}

function parseTime(options: Record<string, any>): QueryAtmosphereInput["time"] {
  const hasInstant = options.at !== undefined;
  const hasRange = options.from !== undefined || options.to !== undefined;
  if (hasInstant === hasRange) {
    throw new InvalidRequestError("Choose exactly one time form: --at, or --from plus --to");
  }
  if (hasInstant) return { at: String(options.at) };
  if (options.from === undefined || options.to === undefined) throw new InvalidRequestError("Time range requires both --from and --to");
  return {
    from: String(options.from),
    to: String(options.to),
    ...(options.cycles === undefined ? {} : { hoursUtc: parseNumberList(options.cycles, "--cycles") as Array<0 | 6 | 12 | 18> }),
    ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
  };
}

function parseSelection(options: Record<string, any>): QueryAtmosphereInput["selection"] {
  const fields = options.fields === undefined ? undefined : parseStringList(options.fields);
  const explicitPressure = options.vars !== undefined || options.levels !== undefined;
  if (fields !== undefined && !explicitPressure) return { fields };
  return {
    variables: parseStringList(options.vars ?? DEFAULT_UNIFIED_VARIABLES),
    pressureLevelsHpa: parseNumberList(options.levels ?? DEFAULT_LEVELS, "--levels"),
    ...(fields === undefined ? {} : { fields }),
  };
}

function forecastInput(
  dataset: PublicAtmosphericDataset,
  options: Record<string, any>,
): Pick<QueryAtmosphereInput, "forecast"> | {} {
  if (
    publicDatasetMetadata(dataset).role === "analysis"
    || (options.run === undefined && options.grid === undefined && options.forecastKind === undefined)
  ) return {};
  return {
    forecast: {
      ...(options.forecastKind === undefined ? {} : { kind: String(options.forecastKind) as "operational" | "reforecast" }),
      ...(options.run === undefined ? {} : { run: String(options.run) }),
      ...(options.grid === undefined ? {} : { grid: options.grid }),
    },
  };
}

function ensembleInput(dataset: PublicAtmosphericDataset, options: Record<string, any>) {
  const hasEnsemble = options.members !== undefined
    || options.quantiles !== undefined
    || Boolean(options.includeMembers)
    || options.maxMemberSamples !== undefined;
  if (!hasEnsemble) return {};

  const members = options.members === undefined
    ? undefined
    : parseEnsembleMembers(dataset, options.members);

  return {
    ensemble: {
      ...(members === undefined ? {} : { members }),
      ...(options.quantiles === undefined ? {} : { quantiles: parseNumberList(options.quantiles, "--quantiles") }),
      ...(options.includeMembers ? { includeMembers: true } : {}),
      ...(options.maxMemberSamples === undefined ? {} : { maxMemberSamples: options.maxMemberSamples }),
    },
  };
}

function parseEnsembleMembers(
  dataset: PublicAtmosphericDataset,
  value: unknown,
): string[] {
  if (dataset === "gefs") return parseGefsMembers(value);
  if (dataset === "ifs-ens") return parseIfsEnsMembers(value);
  return parseStringList(value);
}

function aggregateInput(options: Record<string, any>) {
  const thresholds = [
    ...(options.gte === undefined ? [] : [{ operator: "gte" as const, value: options.gte }]),
    ...(options.lte === undefined ? [] : [{ operator: "lte" as const, value: options.lte }]),
  ];
  const hasAggregate = options.percentiles !== undefined || thresholds.length > 0 || Boolean(options.extrema);
  if (!hasAggregate) return {};
  return {
    aggregate: {
      ...(options.percentiles === undefined ? {} : { percentiles: parseNumberList(options.percentiles, "--percentiles") }),
      ...(thresholds.length === 0 ? {} : { thresholds }),
      ...(options.extrema ? { includeExtremaLocations: true } : {}),
    },
  };
}

function limitsInput(options: Record<string, any>) {
  const limits = {
    ...(options.maxSamples === undefined ? {} : { maxSamples: options.maxSamples }),
    ...(options.maxPointSteps === undefined ? {} : { maxPointSteps: options.maxPointSteps }),
    ...(options.maxGridPoints === undefined ? {} : { maxGridPoints: options.maxGridPoints }),
    ...(options.maxMemberGridPoints === undefined
      ? {}
      : { maxMemberGridPoints: options.maxMemberGridPoints }),
  };
  return Object.keys(limits).length === 0 ? {} : { limits };
}

function reportCliProgress(progress: AtmosphericStepProgress): void {
  const operation = progress.operation === "points_time_series"
    ? "GFS multi-point time series"
    : "GFS time series";
  const source = progress.source === "s3" ? "AWS S3" : "NOMADS";

  if (progress.phase === "start") {
    const pacing = progress.source === "nomads"
      ? " (cache misses are courtesy-paced)"
      : "";
    console.error(`[wfg] ${operation}: 0/${progress.totalSteps} native steps via ${source}${pacing}`);
    return;
  }

  if (progress.phase === "step") {
    const forecastHour = progress.forecastHour === undefined
      ? ""
      : ` f${String(progress.forecastHour).padStart(3, "0")}`;
    const validTime = progress.validTime === undefined ? "" : ` ${progress.validTime}`;
    const cache = progress.cacheHit === undefined ? "" : progress.cacheHit ? " cache-hit" : " fetched";
    console.error(
      `[wfg] ${operation}: ${progress.completedSteps}/${progress.totalSteps}${forecastHour}${validTime}${cache}`,
    );
    return;
  }

  console.error(`[wfg] ${operation}: done ${progress.totalSteps}/${progress.totalSteps}`);
}

function printResult(result: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.dir(result, { depth: null });
}
