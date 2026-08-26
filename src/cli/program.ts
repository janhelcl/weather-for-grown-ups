import { Command } from "commander";
import { registerAreaCommand } from "./area-command.js";
import { registerCatalogCommand } from "./catalog-command.js";
import { registerDiagnosticCommands } from "./diagnostic-commands.js";
import { registerEnsembleCommand } from "./ensemble-command.js";
import { registerGefsBundleCommands } from "./gefs-bundle-command.js";
import { registerGefsParcelCommand } from "./gefs-parcel-command.js";
import { registerGefsParcelTimeSeriesCommand } from "./gefs-parcel-timeseries-command.js";
import { registerGefsPointsBundleCommand } from "./gefs-points-bundle-command.js";
import { registerHistoryDiagnosticCommands } from "./history-diagnostic-commands.js";
import { registerHistoryCommand } from "./history-command.js";
import { registerModelComparisonCommand } from "./model-comparison-command.js";
import { registerPointCommands } from "./point-commands.js";
import { registerTransectCommand } from "./transect-command.js";

export function createCliProgram(): Command {
  const program = new Command()
    .name("wfg")
    .description("Weather for Grown Ups — agent-native NOAA GFS and GEFS access")
    .version("0.1.0");

  registerCatalogCommand(program);
  registerPointCommands(program);
  registerHistoryCommand(program);
  registerHistoryDiagnosticCommands(program);
  registerEnsembleCommand(program);
  registerGefsBundleCommands(program);
  registerGefsPointsBundleCommand(program);
  registerGefsParcelCommand(program);
  registerGefsParcelTimeSeriesCommand(program);
  registerModelComparisonCommand(program);
  registerDiagnosticCommands(program);
  registerTransectCommand(program);
  registerAreaCommand(program);

  return program;
}
