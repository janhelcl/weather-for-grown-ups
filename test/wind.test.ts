import { describe, expect, it } from "vitest";
import { deriveWind } from "../src/derived/wind.js";

describe("deriveWind", () => {
  it.each([
    { u: 0, v: -10, direction: 0, label: "north" },
    { u: -10, v: 0, direction: 90, label: "east" },
    { u: 0, v: 10, direction: 180, label: "south" },
    { u: 10, v: 0, direction: 270, label: "west" },
    { u: -10, v: -10, direction: 45, label: "north-east" },
  ])("returns meteorological direction from $label", ({ u, v, direction }) => {
    const wind = deriveWind(u, v);
    expect(wind.speedMs).toBeCloseTo(Math.hypot(u, v));
    expect(wind.directionDeg).toBeCloseTo(direction);
  });

  it("preserves vector magnitude", () => {
    expect(deriveWind(3, 4).speedMs).toBe(5);
    expect(deriveWind(-5, 12).speedMs).toBe(13);
  });

  it("always normalizes direction into [0, 360)", () => {
    for (let u = -20; u <= 20; u += 5) {
      for (let v = -20; v <= 20; v += 5) {
        const wind = deriveWind(u, v);
        expect(Number.isFinite(wind.speedMs)).toBe(true);
        expect(Number.isFinite(wind.directionDeg)).toBe(true);
        expect(wind.directionDeg).toBeGreaterThanOrEqual(0);
        expect(wind.directionDeg).toBeLessThan(360);
      }
    }
  });
});
