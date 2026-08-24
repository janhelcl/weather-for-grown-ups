import type { Command } from "commander";
import { GefsParcelDiagnosticsService } from "../core/gefs-parcel-diagnostics.js";
import { gefsParcelDiagnosticsResultSchema } from "../schema/gefs-parcel-diagnostics.js";
import type { ParcelDefinitionId } from "../schema/query.js";
import { parseGefsMembers, parseLevels, parseNumbers } from "./shared.js";

export function registerGefsParcelCommand(program: Command): void {
  program
    .command("ensemble-parcel")
    .description("Derive member-first GEFS parcel/LCL/LFC/EL/CAPE/CIN distributions from an explicit sampled sounding")
    .requiredOption("--lat <number>", "Latitude", Number)
    .requiredOption("--lon <number>", "Longitude", Number)
    .option("--run <iso|latest>", "GEFS run initialization; latest = newest cycle satisfying the requested valid time/member selection", "latest")
    .requiredOption("--valid <iso>", "Forecast valid time on the native three-hour GEFS cadence")
    .requiredOption("--levels <list>", "Comma-separated common GEFS pgrb2a pressure levels used as the explicit environmental sounding")
    .requiredOption("--parcel <surface_2m|mixed_layer_100hpa|most_unstable_300hpa>", "Explicit parcel initialization")
    .option("--members <list>", "Comma-separated GEFS members (c00,p01..p30); default all 31")
    .option("--quantiles <list>", "Comma-separated quantiles from 0 to 1", "0.1,0.5,0.9")
    .option("--include-members", "Include each member's environmental levels and complete parcel path")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const result = gefsParcelDiagnosticsResultSchema.parse(
        await new GefsParcelDiagnosticsService().getParcelDiagnostics({
          latitude: options.lat,
          longitude: options.lon,
          run: options.run,
          validTime: options.valid,
          pressureLevelsHpa: parseLevels(options.levels),
          parcel: options.parcel as ParcelDefinitionId,
          ...(options.members === undefined ? {} : { members: parseGefsMembers(options.members) }),
          quantiles: parseNumbers(options.quantiles),
          includeMembers: Boolean(options.includeMembers),
        }),
      );
      if (options.json) return console.log(JSON.stringify(result, null, 2));

      console.log(`GEFS ${result.run}  valid ${result.validTime}  f${String(result.forecastHour).padStart(3, "0")}`);
      console.log(`${result.selection.members.length} members; parcel ${result.selection.parcel}; levels ${result.sampledPressureLevelsHpa.join(",")} hPa`);
      console.log(`CAPE mean=${result.summary.capeJkg.mean.toFixed(1)} J/kg  spread=${result.summary.capeJkg.populationStdDev.toFixed(1)} J/kg`);
      console.log(`CIN mean=${result.summary.cinJkg.mean.toFixed(1)} J/kg  spread=${result.summary.cinJkg.populationStdDev.toFixed(1)} J/kg`);
      console.log(`LCL mean=${result.summary.lclPressureHpa.mean.toFixed(1)} hPa`);
      console.log(`LFC present in ${result.summary.lfc.membersWithBoundary.count}/${result.summary.lfc.membersWithBoundary.memberCount} members; EL present in ${result.summary.el.membersWithBoundary.count}/${result.summary.el.membersWithBoundary.memberCount} members`);
      console.log("Member fractions are raw ensemble fractions, not calibrated probabilities.");
      if (result.members) {
        for (const member of result.members) {
          console.log(`${member.member}${member.forecastCacheHit && member.surfaceOrographyCacheHit ? " (cache)" : ""}`);
          console.log(`CAPE ${member.parcel.capeJkg.toFixed(1)} J/kg; CIN ${member.parcel.cinJkg.toFixed(1)} J/kg; LCL ${member.parcel.lcl.pressureHpa.toFixed(1)} hPa; LFC ${member.parcel.lfc?.pressureHpa.toFixed(1) ?? "none"}; EL ${member.parcel.el?.pressureHpa.toFixed(1) ?? "none"}`);
        }
      }
    });
}
