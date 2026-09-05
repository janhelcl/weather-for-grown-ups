import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type * as z from "zod/v4";

/**
 * MCP tool schema that advertises the Zod contract for discovery (JSON Schema in
 * tools/list) but performs no validation itself.
 *
 * The SDK validates inputSchema before invoking a handler and reports failures as a
 * JSON-RPC protocol error whose message is a flattened issue list. WFG's public
 * failure contract promises every MCP failure as the same `{ code, message,
 * retryable, details }` envelope the CLI prints, so handlers validate explicitly with
 * `validateSchema` (or a service-level parse) and route failures through toolError.
 */
export function describedSchema<S extends z.ZodType>(
  schema: S,
): StandardSchemaWithJSON<unknown, unknown> {
  const standard = schema["~standard"];
  return {
    "~standard": {
      version: 1,
      vendor: "weather-for-grown-ups",
      validate: (value: unknown) => ({ value }),
      jsonSchema: {
        input: (options) => standard.jsonSchema.input(options),
        output: (options) => standard.jsonSchema.output(options),
      },
    },
  };
}
