import { describe, expect, it } from "vitest";
import {
  GFS_PRESSURE_LEVELS_HPA,
  isSupportedGfsPressureLevel,
} from "../src/catalog/pressure-levels.js";

describe("GFS pressure-level catalog", () => {
  it("contains the full configured 41-level isobaric set in descending pressure order", () => {
    expect(GFS_PRESSURE_LEVELS_HPA).toHaveLength(41);
    expect(GFS_PRESSURE_LEVELS_HPA[0]).toBe(1000);
    expect(GFS_PRESSURE_LEVELS_HPA.at(-1)).toBe(0.01);
    for (let index = 1; index < GFS_PRESSURE_LEVELS_HPA.length; index += 1) {
      expect(GFS_PRESSURE_LEVELS_HPA[index - 1]).toBeGreaterThan(GFS_PRESSURE_LEVELS_HPA[index] ?? Infinity);
    }
  });

  it.each([1000, 925, 500, 70, 1, 0.7, 0.1, 0.01])("recognizes published level %s hPa", (level) => {
    expect(isSupportedGfsPressureLevel(level)).toBe(true);
  });

  it.each([1100, 842, 850.5, 0, -1, 0.05])("rejects unpublished level %s hPa", (level) => {
    expect(isSupportedGfsPressureLevel(level)).toBe(false);
  });
});
