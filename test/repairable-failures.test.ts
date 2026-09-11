import { describe, expect, it } from "vitest";
import { DataUnavailableError, toPublicFailure } from "../src/failure.js";
import { queryAtmosphereSchema } from "../src/schema/unified-api.js";

const POINT = { type: "point", latitude: 50.08, longitude: 14.43 } as const;
const TIME = { at: "2026-09-11T12:00:00Z" } as const;

function publicValidationFailure(input: unknown) {
  const parsed = queryAtmosphereSchema.safeParse(input);
  expect(parsed.success).toBe(false);
  if (parsed.success) throw new Error("Expected validation to fail");
  return toPublicFailure(parsed.error);
}

describe("repairable capability failures", () => {
  it("returns unsupported pressure levels and dataset-specific alternatives", () => {
    const failure = publicValidationFailure({
      dataset: "icon-d2",
      geometry: POINT,
      time: TIME,
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [777],
      },
    });

    expect(failure.code).toBe("INVALID_REQUEST");
    const issues = failure.details?.issues as Array<Record<string, any>>;
    const issue = issues.find((entry) => entry.path === "selection.pressureLevelsHpa");
    expect(issue?.repair).toMatchObject({
      kind: "unsupported_inventory",
      action: "choose_supported_values",
      dataset: "icon-d2",
      path: "selection.pressureLevelsHpa",
      unsupported: [777],
    });
    expect(issue?.repair.supported).toContain(850);
    expect(issue?.repair.supported).not.toContain(777);
  });

  it("returns valid ensemble members for an unsupported member selection", () => {
    const failure = publicValidationFailure({
      dataset: "aigefs",
      geometry: POINT,
      time: TIME,
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      ensemble: {
        members: ["p01", "not-a-member"],
      },
    });

    const issues = failure.details?.issues as Array<Record<string, any>>;
    const issue = issues.find((entry) => entry.path === "ensemble.members");
    expect(issue?.repair).toMatchObject({
      kind: "unsupported_inventory",
      action: "choose_supported_values",
      dataset: "aigefs",
      path: "ensemble.members",
      unsupported: ["not-a-member"],
    });
    expect(issue?.repair.supported).toContain("p01");
    expect(issue?.repair.supported).not.toContain("not-a-member");
  });

  it("keeps temporary data availability failures distinct from unsupported inventory", () => {
    const failure = toPublicFailure(new DataUnavailableError(
      "Requested field is temporarily unavailable upstream",
      { details: { dataset: "icon-d2", field: "temperature_2m" } },
    ));

    expect(failure).toEqual({
      code: "DATA_UNAVAILABLE",
      message: "Requested field is temporarily unavailable upstream",
      retryable: false,
      details: { dataset: "icon-d2", field: "temperature_2m" },
    });
  });
});
