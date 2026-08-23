#!/usr/bin/env node
import { Command } from "commander";
import { registerAreaCommand } from "./cli/area-command.js";
import { registerCatalogCommand } from "./cli/catalog-command.js";
import { registerDiagnosticCommands } from "./cli/diagnostic-commands.js";
import { registerPointCommands } from "./cli/point-commands.js";
import { registerTransectCommand } from "./cli/transect-command.js";

const program = new Command()
  .name("wfg")
  .description("Weather for Grown Ups — agent-native NOAA GFS access")
  .version("0.1.0");

registerCatalogCommand(program);
registerPointCommands(program);
registerDiagnosticCommands(program);
registerTransectCommand(program);
registerAreaCommand(program);

await program.parseAsync();
