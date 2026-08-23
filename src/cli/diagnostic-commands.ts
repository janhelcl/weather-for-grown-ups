import type { Command } from "commander";
import { AtmosphericDiagnosticTimeSeriesService } from "../core/atmospheric-diagnostic-timeseries-service.js";
import { AtmosphericLayerDiagnosticsService } from "../core/atmospheric-layer-diagnostics-service.js";
import { AtmosphericProfileDiagnosticsService } from "../core/atmospheric-profile-diagnostics-service.js";
import { ParcelDiagnosticsService } from "../core/parcel-diagnostics.js";
import type { DiagnosticTimeSeriesQueryInput } from "../schema/diagnostic-time-series.js";
import {
  diagnosticTimeSeriesResultSchema,
  type DiagnosticTimeSeriesResult,
} from "../schema/diagnostic-time-series-result.js";
import {
  GEFS_DIAGNOSTIC_TIME_SERIES_DEFAULT_MAX_STEPS,
  gefsDiagnosticTimeSeriesResultSchema,
  type GefsDiagnosticTimeSeriesQueryInput,
  type GefsDiagnosticTimeSeriesResult,
} from "../schema/gefs-diagnostic-timeseries.js";
import { gefsLayerDiagnosticsResultSchema } from "../schema/gefs-layer-diagnostics.js";
import { gefsProfileDiagnosticsResultSchema } from "../schema/gefs-profile-diagnostics.js";
import {
  DEFAULT_TIME_SERIES_MAX_STEPS,
  type ParcelDefinitionId,
  type ProfileSourceId,
} from "../schema/query.js";
import {
  layerDiagnosticsResultSchema,
  parcelDiagnosticsResultSchema,
  profileDiagnosticsResultSchema,
} from "../schema/result.js";
import {
  DEFAULT_LAYER_DIAGNOSTICS,
  DEFAULT_PROFILE_DIAGNOSTICS,
  RUN_HELP,
  parseAtmosphericModel,
  parseGefsMembers,
  parseLayerDiagnostics,
  parseLevels,
  parseNumbers,
  parseProfileDiagnostics,
} from "./shared.js";

export function registerDiagnosticCommands(program: Command): void {
  program
    .command("layer")
    .description("Derive pressure-layer diagnostics from GFS or GEFS using the same meteorological kernel")
    .option("--model <gfs|gefs>", "Atmospheric model family", "gfs")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest|latest_complete>", "Model initialization; GEFS accepts latest or an explicit cycle", "latest")
    .requiredOption("--valid <iso>", "Forecast valid time")
    .requiredOption("--lower <hpa>", "Lower-altitude pressure surface in hPa", Number)
    .requiredOption("--upper <hpa>", "Upper-altitude pressure surface in hPa", Number)
    .option("--diagnostics <list>", "Comma-separated layer diagnostic IDs", DEFAULT_LAYER_DIAGNOSTICS)
    .option("--source <nomads|s3>", "GFS-only data access path")
    .option("--members <list>", "GEFS-only comma-separated members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "GEFS-only comma-separated quantiles from 0 to 1")
    .option("--include-members", "GEFS-only: include every member's layer and diagnostic values")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const model = parseAtmosphericModel(options.model);
      const service = new AtmosphericLayerDiagnosticsService();
      const diagnostics = parseLayerDiagnostics(options.diagnostics);

      if (model === "gfs") {
        if (options.members !== undefined || options.quantiles !== undefined || options.includeMembers) {
          throw new Error("--members, --quantiles and --include-members are only valid with --model gefs");
        }
        const result = layerDiagnosticsResultSchema.parse(await service.getLayerDiagnostics({
          model: "gfs_0p25",
          query: {
            latitude: options.lat,
            longitude: options.lon,
            run: options.run,
            validTime: options.valid,
            lowerPressureHpa: options.lower,
            upperPressureHpa: options.upper,
            diagnostics,
            source: (options.source ?? "nomads") as ProfileSourceId,
          },
        }));
        if (options.json) return console.log(JSON.stringify(result, null, 2));
        console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
        console.log(`Source ${result.source.provider} (${result.source.access})`);
        console.log(`${result.layer.lowerPressureHpa} → ${result.layer.upperPressureHpa} hPa; ${result.layer.lowerGeopotentialHeightGpm.toFixed(0)} → ${result.layer.upperGeopotentialHeightGpm.toFixed(0)} gpm; depth ${result.layer.depthGpm.toFixed(0)} gpm`);
        console.table(result.diagnostics.map((diagnostic) => ({ id: diagnostic.id, ...diagnostic.values })));
        console.log("Raw endpoint values used by the derivations");
        console.table(result.levels);
        return;
      }

      if (options.source !== undefined) throw new Error("--source is a deterministic GFS option and is not valid with --model gefs");
      const result = gefsLayerDiagnosticsResultSchema.parse(await service.getLayerDiagnostics({
        model: "gefs_0p50",
        query: {
          latitude: options.lat,
          longitude: options.lon,
          run: options.run,
          validTime: options.valid,
          lowerPressureHpa: options.lower,
          upperPressureHpa: options.upper,
          diagnostics,
          ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
          quantiles: parseNumbers(options.quantiles ?? "0.1,0.5,0.9"),
          includeMembers: Boolean(options.includeMembers),
        },
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GEFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`${result.pressureLayer.lowerPressureHpa} → ${result.pressureLayer.upperPressureHpa} hPa; ${result.selection.members.length} members`);
      console.log(`Layer depth mean=${result.layerDepthGpm.mean.toFixed(1)} gpm  populationStdDev=${result.layerDepthGpm.populationStdDev.toFixed(1)} gpm`);
      console.table(result.summaries.map((summary) => ({
        diagnostic: summary.id,
        field: summary.field,
        unit: summary.unit,
        mean: summary.distribution.mean,
        populationStdDev: summary.distribution.populationStdDev,
        min: summary.distribution.min,
        max: summary.distribution.max,
      })));
      if (result.members) {
        for (const member of result.members) {
          console.log(`${member.member}${member.cacheHit ? " (cache)" : ""}; depth ${member.layer.depthGpm.toFixed(1)} gpm`);
          console.table(member.diagnostics.map((diagnostic) => ({ id: diagnostic.id, ...diagnostic.values })));
        }
      }
    });

  program
    .command("profile-diagnostics")
    .description("Derive sampled whole-profile diagnostics from GFS or member-by-member GEFS")
    .option("--model <gfs|gefs>", "Atmospheric model family", "gfs")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest|latest_complete>", "Model initialization; GEFS accepts latest or an explicit cycle", "latest")
    .requiredOption("--valid <iso>", "Forecast valid time")
    .requiredOption("--levels <list>", "Comma-separated published pressure levels in hPa; vertical resolution controls diagnostic resolution")
    .option("--diagnostics <list>", "Comma-separated profile diagnostic IDs", DEFAULT_PROFILE_DIAGNOSTICS)
    .option("--source <nomads|s3>", "GFS-only data access path")
    .option("--members <list>", "GEFS-only comma-separated members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "GEFS-only comma-separated quantiles from 0 to 1")
    .option("--include-members", "GEFS-only: include each member's sampled profile and complete diagnostic structures")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const model = parseAtmosphericModel(options.model);
      const service = new AtmosphericProfileDiagnosticsService();
      const pressureLevelsHpa = parseLevels(options.levels);
      const diagnostics = parseProfileDiagnostics(options.diagnostics);

      if (model === "gfs") {
        if (options.members !== undefined || options.quantiles !== undefined || options.includeMembers) {
          throw new Error("--members, --quantiles and --include-members are only valid with --model gefs");
        }
        const result = profileDiagnosticsResultSchema.parse(await service.getProfileDiagnostics({
          model: "gfs_0p25",
          query: {
            latitude: options.lat,
            longitude: options.lon,
            run: options.run,
            validTime: options.valid,
            pressureLevelsHpa,
            diagnostics,
            source: (options.source ?? "nomads") as ProfileSourceId,
          },
        }));
        if (options.json) return console.log(JSON.stringify(result, null, 2));
        console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
        console.log(`Source ${result.source.provider} (${result.source.access})`);
        console.log(`Sampled pressure levels (hPa): ${result.sampledPressureLevelsHpa.join(", ")}`);
        for (const diagnostic of result.diagnostics) {
          console.log(diagnostic.id);
          if (diagnostic.id === "freezing_level_crossings") console.dir(diagnostic.crossings, { depth: null });
          else console.table(diagnostic.layers);
        }
        console.log("Raw sampled levels used by the derivations");
        console.table(result.levels);
        return;
      }

      if (options.source !== undefined) throw new Error("--source is a deterministic GFS option and is not valid with --model gefs");
      const result = gefsProfileDiagnosticsResultSchema.parse(await service.getProfileDiagnostics({
        model: "gefs_0p50",
        query: {
          latitude: options.lat,
          longitude: options.lon,
          run: options.run,
          validTime: options.valid,
          pressureLevelsHpa,
          diagnostics,
          ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
          quantiles: parseNumbers(options.quantiles ?? "0.1,0.5,0.9"),
          includeMembers: Boolean(options.includeMembers),
        },
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GEFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`${result.selection.members.length} members; sampled pressure levels (hPa): ${result.sampledPressureLevelsHpa.join(", ")}`);
      for (const summary of result.summaries) {
        if (summary.id === "freezing_level_crossings") {
          console.log(`freezing_level_crossings: ${summary.membersWithAnyCrossing.count}/${summary.membersWithAnyCrossing.memberCount} members have >=1 crossing; mean count=${summary.crossingCount.mean.toFixed(2)}`);
          if (summary.lowestCrossing) {
            console.log(`lowest crossing among contributing members: mean ${summary.lowestCrossing.geopotentialHeightGpm.mean.toFixed(0)} gpm / ${summary.lowestCrossing.pressureHpa.mean.toFixed(1)} hPa`);
          }
        } else {
          console.log(`temperature_inversion_layers: ${summary.membersWithAnyLayer.count}/${summary.membersWithAnyLayer.memberCount} members have >=1 layer; mean count=${summary.layerCount.mean.toFixed(2)}; mean total depth=${summary.totalLayerDepthGpm.mean.toFixed(0)} gpm`);
          if (summary.strongestTemperatureIncreaseC) {
            console.log(`strongest inversion among contributing members: mean temperature increase ${summary.strongestTemperatureIncreaseC.distribution.mean.toFixed(2)} °C`);
          }
        }
      }
      if (result.members) {
        for (const member of result.members) {
          console.log(`${member.member}${member.cacheHit ? " (cache)" : ""}`);
          for (const diagnostic of member.diagnostics) {
            console.log(diagnostic.id);
            if (diagnostic.id === "freezing_level_crossings") console.dir(diagnostic.crossings, { depth: null });
            else console.table(diagnostic.layers);
          }
        }
      }
    });

  program
    .command("parcel")
    .description("Lift an explicit parcel through a sampled GFS pressure profile and derive LCL/LFC/EL/CAPE/CIN")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest|latest_complete>", RUN_HELP, "latest")
    .requiredOption("--valid <iso>", "Forecast valid time")
    .requiredOption("--levels <list>", "Comma-separated published pressure levels in hPa; vertical resolution controls parcel diagnostics")
    .requiredOption("--parcel <surface_2m|mixed_layer_100hpa|most_unstable_300hpa>", "Explicit parcel initialization")
    .option("--source <nomads|s3>", "Data access path", "nomads")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = await new ParcelDiagnosticsService().getParcelDiagnostics({
        latitude: options.lat,
        longitude: options.lon,
        run: options.run,
        validTime: options.valid,
        pressureLevelsHpa: parseLevels(options.levels),
        parcel: options.parcel as ParcelDefinitionId,
        source: options.source as ProfileSourceId,
      });
      parcelDiagnosticsResultSchema.parse(result);
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`Source ${result.source.provider} (${result.source.access})`);
      console.log(`Parcel ${result.parcel.startingState.definition} from ${result.parcel.startingState.pressureHpa.toFixed(1)} hPa, ${result.parcel.startingState.temperatureC.toFixed(2)} °C`);
      console.log(`LCL ${result.parcel.lcl.pressureHpa.toFixed(1)} hPa${result.parcel.lcl.geopotentialHeightGpm === undefined ? "" : ` / ${result.parcel.lcl.geopotentialHeightGpm.toFixed(0)} gpm`}`);
      console.log(`LFC ${result.parcel.lfc ? `${result.parcel.lfc.pressureHpa.toFixed(1)} hPa` : "none"}; EL ${result.parcel.el ? `${result.parcel.el.pressureHpa.toFixed(1)} hPa` : "none"}`);
      console.log(`CAPE ${result.parcel.capeJkg.toFixed(1)} J/kg (${result.parcel.capeTop}); CIN ${result.parcel.cinJkg.toFixed(1)} J/kg (${result.parcel.cinTop})`);
      console.log("Parcel path");
      console.table(result.parcel.parcelPath);
      console.log("Raw sampled environmental levels");
      console.table(result.levels);
    });

  program
    .command("diagnostic-timeseries")
    .description("Evaluate diagnostic families across native GFS or GEFS forecast times")
    .option("--model <gfs|gefs>", "Atmospheric model family", "gfs")
    .requiredOption("--kind <layer|profile|parcel>", "Diagnostic family; GEFS currently supports layer and profile")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest|latest_complete>", "Model initialization; GEFS accepts latest or an explicit cycle", "latest")
    .requiredOption("--start <iso>", "Inclusive start of valid-time range")
    .requiredOption("--end <iso>", "Inclusive end of valid-time range")
    .option("--lower <hpa>", "Layer lower-altitude pressure surface in hPa", Number)
    .option("--upper <hpa>", "Layer upper-altitude pressure surface in hPa", Number)
    .option("--levels <list>", "Profile/parcel published pressure levels in hPa")
    .option("--diagnostics <list>", "Comma-separated diagnostic IDs; defaults depend on --kind")
    .option("--parcel <surface_2m|mixed_layer_100hpa|most_unstable_300hpa>", "GFS-only parcel initialization for --kind parcel")
    .option("--source <nomads|s3>", "GFS-only data access path")
    .option("--members <list>", "GEFS-only comma-separated members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "GEFS-only comma-separated quantiles from 0 to 1")
    .option("--max-steps <number>", "Maximum native forecast outputs", Number)
    .option("--json", "Output JSON")
    .action(async (options) => {
      const model = parseAtmosphericModel(options.model);
      const service = new AtmosphericDiagnosticTimeSeriesService();

      if (model === "gfs") {
        if (options.members !== undefined || options.quantiles !== undefined) {
          throw new Error("--members and --quantiles are only valid with --model gefs");
        }
        const query: DiagnosticTimeSeriesQueryInput = {
          latitude: options.lat,
          longitude: options.lon,
          run: options.run,
          startTime: options.start,
          endTime: options.end,
          diagnostic: diagnosticSelectionFromCli(options),
          source: (options.source ?? "s3") as ProfileSourceId,
          maxSteps: options.maxSteps ?? DEFAULT_TIME_SERIES_MAX_STEPS,
        };
        const result = diagnosticTimeSeriesResultSchema.parse(await service.getDiagnosticTimeSeries({
          model: "gfs_0p25",
          query,
        }));
        if (options.json) return console.log(JSON.stringify(result, null, 2));
        printDiagnosticTimeSeries(result);
        return;
      }

      if (options.source !== undefined) throw new Error("--source is a deterministic GFS option and is not valid with --model gefs");
      if (options.parcel !== undefined || options.kind === "parcel") {
        throw new Error("GEFS diagnostic time series currently support --kind layer or profile; ensemble parcel diagnostics are not implemented");
      }
      const query: GefsDiagnosticTimeSeriesQueryInput = {
        latitude: options.lat,
        longitude: options.lon,
        run: options.run,
        startTime: options.start,
        endTime: options.end,
        diagnostic: gefsDiagnosticSelectionFromCli(options),
        ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
        quantiles: parseNumbers(options.quantiles ?? "0.1,0.5,0.9"),
        maxSteps: options.maxSteps ?? GEFS_DIAGNOSTIC_TIME_SERIES_DEFAULT_MAX_STEPS,
      };
      const result = gefsDiagnosticTimeSeriesResultSchema.parse(await service.getDiagnosticTimeSeries({
        model: "gefs_0p50",
        query,
      }));
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      printGefsDiagnosticTimeSeries(result);
    });
}

function diagnosticSelectionFromCli(options: Record<string, unknown>): DiagnosticTimeSeriesQueryInput["diagnostic"] {
  switch (options.kind) {
    case "layer":
      return {
        kind: "layer",
        lowerPressureHpa: Number(options.lower),
        upperPressureHpa: Number(options.upper),
        diagnostics: parseLayerDiagnostics(options.diagnostics ?? DEFAULT_LAYER_DIAGNOSTICS),
      };
    case "profile":
      return {
        kind: "profile",
        pressureLevelsHpa: parseLevels(options.levels ?? ""),
        diagnostics: parseProfileDiagnostics(options.diagnostics ?? DEFAULT_PROFILE_DIAGNOSTICS),
      };
    case "parcel":
      return {
        kind: "parcel",
        pressureLevelsHpa: parseLevels(options.levels ?? ""),
        parcel: String(options.parcel ?? "") as ParcelDefinitionId,
      };
    default:
      throw new Error(`Expected --kind layer, profile, or parcel; received ${String(options.kind)}`);
  }
}

function gefsDiagnosticSelectionFromCli(options: Record<string, unknown>): GefsDiagnosticTimeSeriesQueryInput["diagnostic"] {
  switch (options.kind) {
    case "layer":
      return {
        kind: "layer",
        lowerPressureHpa: Number(options.lower),
        upperPressureHpa: Number(options.upper),
        diagnostics: parseLayerDiagnostics(options.diagnostics ?? DEFAULT_LAYER_DIAGNOSTICS),
      };
    case "profile":
      return {
        kind: "profile",
        pressureLevelsHpa: parseLevels(options.levels ?? ""),
        diagnostics: parseProfileDiagnostics(options.diagnostics ?? DEFAULT_PROFILE_DIAGNOSTICS),
      };
    default:
      throw new Error(`GEFS diagnostic time series support --kind layer or profile; received ${String(options.kind)}`);
  }
}

function printDiagnosticTimeSeries(result: DiagnosticTimeSeriesResult): void {
  console.log(`GFS ${result.run}  ${result.requestedStartTime} → ${result.requestedEndTime}`);
  console.log(`Source ${result.source.provider} (${result.source.access}); ${result.series.length} native outputs`);

  switch (result.diagnostic.kind) {
    case "layer":
      console.table(result.series.map((step) => {
        if (step.kind !== "layer") throw new Error("Unexpected diagnostic step kind");
        const values = Object.fromEntries(step.diagnostics.flatMap((diagnostic) =>
          Object.entries(diagnostic.values).map(([field, value]) => [`${diagnostic.id}.${field}`, value])));
        return { validTime: step.validTime, forecastHour: step.forecastHour, ...values };
      }));
      break;
    case "profile":
      console.table(result.series.map((step) => {
        if (step.kind !== "profile") throw new Error("Unexpected diagnostic step kind");
        const freezingCrossings = step.diagnostics.reduce(
          (count, diagnostic) => count + (diagnostic.id === "freezing_level_crossings" ? diagnostic.crossings.length : 0),
          0,
        );
        const inversionLayers = step.diagnostics.reduce(
          (count, diagnostic) => count + (diagnostic.id === "temperature_inversion_layers" ? diagnostic.layers.length : 0),
          0,
        );
        return { validTime: step.validTime, forecastHour: step.forecastHour, freezingCrossings, inversionLayers };
      }));
      break;
    case "parcel":
      console.table(result.series.map((step) => {
        if (step.kind !== "parcel") throw new Error("Unexpected diagnostic step kind");
        return {
          validTime: step.validTime,
          forecastHour: step.forecastHour,
          capeJkg: step.parcel.capeJkg,
          cinJkg: step.parcel.cinJkg,
          lclPressureHpa: step.parcel.lcl.pressureHpa,
          lclHeightGpm: step.parcel.lcl.geopotentialHeightGpm,
          lfcPressureHpa: step.parcel.lfc?.pressureHpa,
          elPressureHpa: step.parcel.el?.pressureHpa,
        };
      }));
      break;
  }
}

function printGefsDiagnosticTimeSeries(result: GefsDiagnosticTimeSeriesResult): void {
  console.log(`GEFS ${result.run}  ${result.startTime} → ${result.endTime}; ${result.series.length} native 3-hour outputs`);
  console.log(`${result.selection.members.length} members; source ${result.source.provider} (${result.source.access})`);
  if (result.selection.diagnostic.kind === "layer") {
    console.table(result.series.map((step) => {
      if (step.kind !== "layer") throw new Error("Unexpected GEFS diagnostic step kind");
      const distributions = Object.fromEntries(step.summaries.map((summary) => [
        `${summary.id}.${summary.field}.mean`,
        summary.distribution.mean,
      ]));
      return {
        validTime: step.validTime,
        forecastHour: step.forecastHour,
        layerDepthGpmMean: step.layerDepthGpm.mean,
        ...distributions,
        cache: step.allCacheHit,
      };
    }));
    return;
  }

  console.table(result.series.map((step) => {
    if (step.kind !== "profile") throw new Error("Unexpected GEFS diagnostic step kind");
    const freezing = step.summaries.find((summary) => summary.id === "freezing_level_crossings");
    const inversion = step.summaries.find((summary) => summary.id === "temperature_inversion_layers");
    return {
      validTime: step.validTime,
      forecastHour: step.forecastHour,
      freezingMemberFraction: freezing?.id === "freezing_level_crossings" ? freezing.membersWithAnyCrossing.fraction : undefined,
      freezingCountMean: freezing?.id === "freezing_level_crossings" ? freezing.crossingCount.mean : undefined,
      lowestFreezingHeightGpmMean: freezing?.id === "freezing_level_crossings" ? freezing.lowestCrossing?.geopotentialHeightGpm.mean : undefined,
      inversionMemberFraction: inversion?.id === "temperature_inversion_layers" ? inversion.membersWithAnyLayer.fraction : undefined,
      inversionLayerCountMean: inversion?.id === "temperature_inversion_layers" ? inversion.layerCount.mean : undefined,
      inversionTotalDepthGpmMean: inversion?.id === "temperature_inversion_layers" ? inversion.totalLayerDepthGpm.mean : undefined,
      cache: step.allCacheHit,
    };
  }));
}
