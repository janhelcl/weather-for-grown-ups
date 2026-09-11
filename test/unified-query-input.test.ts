import { describe, expect, it } from "vitest";
import {
  normalizeQueryAtmosphereInput,
  parseQueryAtmosphereInput,
  queryAtmosphereInputSchema,
} from "../src/schema/unified-query-input.js";

describe("shared atmospheric query defaults", () => {
  it("defaults field-only datasets below the transport layer", () => {
    for (const dataset of ["arome", "pe-arome"] as const) {
      const request = normalizeQueryAtmosphereInput({
        dataset,
        geometry: { type: "point", latitude: 48.7, longitude: 2.35 },
        time: { at: "2026-09-06T12:00:00Z" },
      });
      expect(request.selection).toEqual({ fields: ["temperature_2m"] });
    }
  });

  it("defaults pressure-capable datasets to the canonical profile slice", () => {
    const request = normalizeQueryAtmosphereInput({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-09-06T12:00:00Z" },
    });
    expect(request.selection).toEqual({
      variables: [
        "temperature",
        "relative_humidity",
        "u_wind",
        "v_wind",
        "geopotential_height",
      ],
      pressureLevelsHpa: [1000, 925, 850, 700, 500],
    });
  });

  it("leaves an explicit selection unchanged", () => {
    const request = normalizeQueryAtmosphereInput({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-09-06T12:00:00Z" },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
    });
    expect(request.selection).toEqual({
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });
  });

  it("keeps bundled diagnostics separate from the raw-state request", () => {
    const diagnostic = {
      kind: "layer" as const,
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["wind_shear" as const],
    };
    const parsed = parseQueryAtmosphereInput({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-09-06T12:00:00Z" },
      selection: {
        variables: ["temperature", "u_wind", "v_wind"],
        pressureLevelsHpa: [850, 500],
        fields: ["temperature_2m"],
      },
      diagnostics: [diagnostic],
    });

    expect(parsed.request).not.toHaveProperty("diagnostics");
    expect(parsed.diagnostics).toEqual([diagnostic]);
  });

  it("rejects bundled diagnostics outside point geometry", () => {
    expect(() => queryAtmosphereInputSchema.parse({
      dataset: "gfs",
      geometry: {
        type: "points",
        points: [
          { latitude: 50.08, longitude: 14.43 },
          { latitude: 49.20, longitude: 16.61 },
        ],
      },
      time: { at: "2026-09-06T12:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      diagnostics: [{
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear"],
      }],
    })).toThrow(/Bundled diagnostics require point geometry/);
  });
});
