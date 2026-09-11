import { describe, expect, it } from "vitest";
import { toPublicFailure } from "../src/failure.js";
import { queryAtmosphereSchema } from "../src/schema/unified-api.js";

const POINT = { type: "point", latitude: 45.8, longitude: 11.7 } as const;
const TIME = { at: "2026-09-11T12:00:00Z" } as const;

describe("repairable capability fallback branches", () => {
  it("falls back to capability inspection when a dataset has no pressure-level inventory", () => {
    const parsed = queryAtmosphereSchema.safeParse({
      dataset: "arome",
      geometry: POINT,
      time: TIME,
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Expected validation to fail");

    const failure = toPublicFailure(parsed.error);
    const issues = failure.details?.issues as Array<Record<string, any>>;
    const issue = issues.find((entry) => entry.path === "selection.pressureLevelsHpa");

    expect(issue?.repair).toMatchObject({
      kind: "unsupported_capability",
      action: "inspect_capabilities",
      dataset: "arome",
      path: "selection.pressureLevelsHpa",
    });
  });
});
