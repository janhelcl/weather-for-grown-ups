import { Command } from "commander";
import { WFG_VERSION } from "../version.js";
import { registerIndexCommand } from "./index-command.js";
import { registerCatalogCommand } from "./unified-catalog-command.js";
import { registerUnifiedAtmosphereCommands } from "./unified-atmosphere-command.js";

export function createCliProgram(): Command {
  const program = new Command()
    .name("wfg")
    .description("Weather for Grown Ups — agent-native NOAA atmospheric data access")
    .version(WFG_VERSION);

  registerCatalogCommand(program);
  registerUnifiedAtmosphereCommands(program);
  registerIndexCommand(program);

  return program;
}
