import { Command } from "commander";
import { registerIndexCommand } from "./index-command.js";
import { registerCatalogCommand } from "./unified-catalog-command.js";
import { registerUnifiedAtmosphereCommands } from "./unified-atmosphere-command.js";

export function createCliProgram(): Command {
  const program = new Command()
    .name("wfg")
    .description("Weather for Grown Ups — agent-native NOAA atmospheric data access")
    .version("0.1.0");

  registerCatalogCommand(program);
  registerUnifiedAtmosphereCommands(program);
  registerIndexCommand(program);

  return program;
}
