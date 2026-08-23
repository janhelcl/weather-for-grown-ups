import { Command } from "commander";
import { TransectService } from "./core/transect.js";
import { transectResultSchema } from "./schema/transect-result.js";
import type { PointCoordinate, VariableId } from "./schema/query.js";

const command = new Command("transect")
  .description("Sample an explicit pressure-level cross-section along a great-circle path")
  .requiredOption("--start <lat,lon>", "Transect start coordinate")
  .requiredOption("--end <lat,lon>", "Transect end coordinate")
  .option("--run <iso|latest|latest_complete>", "GFS run initialization", "latest")
  .requiredOption("--valid <iso>", "Forecast valid time")
  .requiredOption("--vars <list>", "Comma-separated pressure-level variables")
  .requiredOption("--levels <list>", "Comma-separated published pressure levels in hPa")
  .option("--samples <number>", "Evenly spaced great-circle samples (2-50)", Number, 21)
  .option("--json", "Output JSON")
  .action(async (options) => {
    const result = transectResultSchema.parse(await new TransectService().getTransect({
      start: parsePoint(options.start),
      end: parsePoint(options.end),
      run: options.run,
      validTime: options.valid,
      variables: parseVariables(options.vars),
      pressureLevelsHpa: parseLevels(options.levels),
      samples: options.samples,
    }));

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`GFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
    console.log(`Great-circle transect ${result.totalDistanceKm.toFixed(1)} km; ${result.samples.length} samples; source ${result.source.provider} (${result.source.access})`);
    console.table(result.samples.flatMap((sample) => sample.levels.map((level) => ({
      sample: sample.index,
      distanceKm: Number(sample.distanceKm.toFixed(1)),
      latitude: Number(sample.requestedPoint.latitude.toFixed(4)),
      longitude: Number(sample.requestedPoint.longitude.toFixed(4)),
      gridLatitude: sample.gridPoint.latitude,
      gridLongitude: sample.gridPoint.longitude,
      ...level,
    }))));
  });

await command.parseAsync(process.argv.slice(3), { from: "user" });

function parsePoint(value: unknown): PointCoordinate {
  const parts = String(value).split(",").map((part) => part.trim());
  if (parts.length !== 2) throw new Error(`Expected lat,lon, received: ${String(value)}`);
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`Expected numeric lat,lon, received: ${String(value)}`);
  }
  return { latitude, longitude };
}

function parseVariables(value: unknown): VariableId[] {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean) as VariableId[];
}

function parseLevels(value: unknown): number[] {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean).map(Number);
}
