import { Command } from "commander";
import { WFG_VERSION } from "../version.js";
import { registerIndexCommand } from "./index-command.js";
import { registerCatalogCommand } from "./unified-catalog-command.js";
import { registerUnifiedAtmosphereCommands } from "./unified-atmosphere-command.js";

export function createCliProgram(): Command {
  const program = new Command()
    .name("wfg")
    .description("Weather for Grown Ups — agent-native numerical weather model access")
    .version(WFG_VERSION)
    // Commander would otherwise print its own "error: ..." text and call
    // process.exit, bypassing the public failure envelope that runCli prints.
    // Both settings are inherited by every subcommand registered below.
    .exitOverride()
    .configureOutput({ outputError: () => {} });

  registerCatalogCommand(program);
  registerUnifiedAtmosphereCommands(program);
  registerIndexCommand(program);
  registerTransportCommands(program);

  return program;
}

/**
 * MCP transports are launchers, not domain operations: they expose the same
 * services as the commands above to agent clients over stdio or Streamable HTTP.
 */
function registerTransportCommands(program: Command): void {
  program
    .command("mcp")
    .description("Serve the same operations as MCP tools over stdio (for process-spawned agent clients)")
    .action(async () => {
      await import("../mcp.js");
    });

  program
    .command("mcp-http")
    .description("Serve MCP over Streamable HTTP at /mcp (WFG_MCP_HOST, WFG_MCP_PORT, WFG_MCP_ALLOWED_HOSTS configure the listener)")
    .action(async () => {
      await import("../mcp-http.js");
    });
}
