import { describe, expect, it } from "vitest";
import {
  normalizeQueryAtmosphereInput,
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
});
