import { formatPublicFailure, toPublicFailure } from "../failure.js";
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
    const failure = toPublicFailure(error);
    if (args.includes("--json")) {
      console.error(JSON.stringify({ error: failure }, null, 2));
    } else {
      console.error(formatPublicFailure(failure));
    }
    process.exitCode = 1;
  }
}
