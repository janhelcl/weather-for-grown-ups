import { CommanderError } from "commander";
import { formatPublicFailure, toPublicFailure, type PublicFailure } from "../failure.js";
import { createCliProgram } from "./program.js";

export async function runCli(
  args: readonly string[] = process.argv,
  programName?: string,
): Promise<void> {
  const program = createCliProgram();
  if (programName !== undefined) program.name(programName);

  try {
    await program.parseAsync([...args]);
  } catch (error) {
    if (error instanceof CommanderError) {
      // --help and --version resolve through Commander's exitOverride path too.
      if (error.exitCode === 0) return;
      reportFailure(commanderFailure(error, program.name(), [...args]), args);
      return;
    }
    reportFailure(toPublicFailure(error), args);
  }
}

function reportFailure(failure: PublicFailure, args: readonly string[]): void {
  if (args.includes("--json")) {
    console.error(JSON.stringify({ error: failure }, null, 2));
  } else {
    console.error(formatPublicFailure(failure));
  }
  process.exitCode = 1;
}

/**
 * Commander usage errors (unknown option/command, missing required option or
 * argument value) are request errors like any other: same envelope, same code,
 * plus a pointer to the help text that lists the accepted vocabulary.
 */
function commanderFailure(
  error: CommanderError,
  programName: string,
  args: readonly string[],
): PublicFailure {
  const message = error.message.replace(/^error:\s*/i, "").trim();
  const command = args.slice(2).find((arg) => !arg.startsWith("-"));
  const helpCommand = command === undefined || error.code === "commander.unknownCommand"
    ? `${programName} --help`
    : `${programName} ${command} --help`;
  return {
    code: "INVALID_REQUEST",
    message: `${message} (see: ${helpCommand})`,
    retryable: false,
    details: { commanderCode: error.code },
  };
}
