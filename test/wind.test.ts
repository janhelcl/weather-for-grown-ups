import { describe, expect, it } from "vitest";
import { deriveWind } from "../src/derived/wind.js";

describe("deriveWind", () => {
  it("converts U/V into meteorological speed and direction", () => {
    expect(deriveWind(0, -10)).toEqual({ speedMs: 10, directionDeg: 0 });
    expect(deriveWind(-10, 0).speedMs).toBe(10);
    expect(deriveWind(-10, 0).directionDeg).toBeCloseTo(90);
  });
});
