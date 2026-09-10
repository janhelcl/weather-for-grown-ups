import { describe, expect, it } from "vitest";
import { inspectAtmosphereCapabilitiesSchema } from "../src/schema/capability-inspection.js";

describe("capability inspection schema", () => {
  it("rejects raw and diagnostic selections in the same planning check", () => {
    const parsed = inspectAtmosphereCapabilitiesSchema.safeParse({
      dataset: "gfs",
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 700],
        diagnostics: ["temperature_inversion_layers"],
      },
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["diagnostic"],
        message: expect.stringContaining("either a query selection or a diagnostic selection"),
      }),
    ]));
  });

  it("accepts latest as a partial planning run selector", () => {
    expect(inspectAtmosphereCapabilitiesSchema.parse({
      dataset: "gfs",
      forecast: { run: "latest" },
    }).forecast).toEqual({ run: "latest" });
  });

  it("accepts latest_complete as a partial planning run selector", () => {
    expect(inspectAtmosphereCapabilitiesSchema.parse({
      dataset: "gfs",
      forecast: { run: "latest_complete" },
    }).forecast).toEqual({ run: "latest_complete" });
  });

  it("accepts an explicit cycle and grid without requiring execution defaults", () => {
    expect(inspectAtmosphereCapabilitiesSchema.parse({
      dataset: "gfs",
      forecast: {
        kind: "operational",
        run: "2026-09-12T00:00:00Z",
        grid: "0p50",
      },
    }).forecast).toEqual({
      kind: "operational",
      run: "2026-09-12T00:00:00Z",
      grid: "0p50",
    });
  });

  it("rejects non-cycle run text rather than silently treating it as a selector", () => {
    expect(inspectAtmosphereCapabilitiesSchema.safeParse({
      dataset: "gfs",
      forecast: { run: "Saturday morning" },
    }).success).toBe(false);
  });

  it("keeps the capability request strict", () => {
    expect(inspectAtmosphereCapabilitiesSchema.safeParse({
      dataset: "gfs",
      model: "gfs",
    }).success).toBe(false);
  });
});
