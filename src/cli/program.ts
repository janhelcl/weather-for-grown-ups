import { Command } from "commander";
import { registerAreaCommand } from "./area-command.js";
import { registerCatalogCommand } from "./catalog-command.js";
import { registerDiagnosticCommands } from "./diagnostic-commands.js";
import { registerPointCommands } from "./point-commands.js";
import { registerTransectCommand } from "./transect-command.js";

export function createCliProgram(): Command {
  const program = new Command()
    .name("wfg")
    .description("Weather for Grown Ups — agent-native NOAA GFS access")
    .version("0.1.0");

  registerCatalogCommand(program);
  registerPointCommands(program);
  registerDiagnosticCommands(program);
  registerTransectCommand(program);
  registerAreaCommand(program);

  return program;
}
