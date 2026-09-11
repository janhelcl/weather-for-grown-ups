import type { Command } from "commander";
import type { AtmosphericAvailabilityService } from "../core/atmospheric-availability.js";
import { PUBLIC_ATMOSPHERIC_DATASET_IDS } from "../schema/unified-api.js";
import { collectPoint, numberOption } from "./shared.js";
import { buildUnifiedQuery } from "./unified-atmosphere-command.js";

export function registerAvailabilityCommand(program: Command): void {
  program
    .command("availability")
    .description("Preflight domain, initialization and requested valid-time coverage without downloading forecast payloads")
    .option(`--dataset <${PUBLIC_ATMOSPHERIC_DATASET_IDS.join("|")}>`, "Atmospheric dataset", "gfs")
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
    .option("--vars <list>", "Comma-separated pressure-level variables")
    .option("--levels <list>", "Comma-separated pressure levels in hPa")
    .option("--fields <list>", "Comma-separated non-isobaric fields")
    .option("--run <iso|latest|latest_complete>", "Forecast initialization selector")
    .option("--forecast-kind <operational|reforecast>", "Forecast population")
    .option("--grid <0p25|0p50>", "GFS horizontal grid")
    .option("--source <nomads|s3|archive>", "GFS source override")
    .option("--members <list>", "Dataset-native ensemble member IDs")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const request = buildUnifiedQuery(options);
      const { AtmosphericAvailabilityService } = await import("../core/atmospheric-availability.js");
      const result = await new AtmosphericAvailabilityService().inspect(request);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      printAvailability(result);
    });
}

function printAvailability(result: Awaited<ReturnType<AtmosphericAvailabilityService["inspect"]>>): void {
  console.log(`${result.dataset}: ${result.coverage} (${result.basis})`);
  console.log(`Domain: ${result.domainCovered ? "covered" : "outside"}`);
  if (result.initialization !== undefined) console.log(`Initialization: ${result.initialization}`);
  if (result.initializationValidTimeRange !== undefined) {
    console.log(`Initialization valid times: ${result.initializationValidTimeRange.from} .. ${result.initializationValidTimeRange.to}`);
  }
  if (result.availableRequestedTime !== undefined) {
    console.log(`Available requested time: ${result.availableRequestedTime.from} .. ${result.availableRequestedTime.to}`);
  }
  console.log(`Native cadence over request: ${result.nativeCadenceHours.join(",")}h${result.maxForecastHour === undefined ? "" : `; horizon: f${result.maxForecastHour}`}`);
  for (const issue of result.issues) console.log(`- ${issue.path.join(".") || "request"}: ${issue.reason}`);
}
