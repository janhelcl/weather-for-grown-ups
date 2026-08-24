import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEFS_TRANSECT_SAMPLES,
  MAX_GEFS_TRANSECT_SAMPLES,
  gefsTransectQuerySchema,
} from "../src/schema/gefs-transect.js";

describe("GEFS transect schema", () => {
  it("defaults to the proven GEFS multi-point sample bound", () => {
    const query = gefsTransectQuerySchema.parse({
      start: { latitude: 50, longitude: 14 },
      end: { latitude: 48, longitude: 17 },
      run: "latest",
      validTime: "2026-08-24T12:00:00Z",
      selection: { fields: ["temperature_2m"] },
      members: ["c00", "p01"],
    });
    expect(query.samples).toBe(DEFAULT_GEFS_TRANSECT_SAMPLES);
    expect(MAX_GEFS_TRANSECT_SAMPLES).toBe(20);
    expect(query.includeMembers).toBe(false);
  });

  it("rejects degenerate paths and sample counts beyond the multi-point bound", () => {
    expect(() => gefsTransectQuerySchema.parse({
      start: { latitude: 50, longitude: 14 },
      end: { latitude: 50, longitude: 14 },
      run: "latest",
      validTime: "2026-08-24T12:00:00Z",
      selection: { fields: ["temperature_2m"] },
      members: ["c00", "p01"],
    })).toThrow();

    expect(() => gefsTransectQuerySchema.parse({
      start: { latitude: 50, longitude: 14 },
      end: { latitude: 48, longitude: 17 },
      run: "latest",
      validTime: "2026-08-24T12:00:00Z",
      selection: { fields: ["temperature_2m"] },
      members: ["c00", "p01"],
      samples: 21,
    })).toThrow();
  });
});
