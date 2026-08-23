import { describe, expect, it } from "vitest";
import {
  deriveFreezingLevelCrossings,
  deriveTemperatureInversionLayers,
  orderProfileByHeight,
} from "../src/derived/profile-diagnostics.js";

const level = (pressureHpa: number, geopotentialHeightGpm: number, temperatureC: number) => ({
  pressureHpa,
  geopotentialHeightGpm,
  temperatureC,
});

describe("whole-profile thermodynamic derivations", () => {
  it("finds and interpolates multiple freezing-level crossings in height order", () => {
    const crossings = deriveFreezingLevelCrossings([
      level(900, 1000, 5),
      level(800, 2000, -5),
      level(700, 3000, 3),
    ]);

    expect(crossings).toHaveLength(2);
    expect(crossings[0]).toMatchObject({
      geopotentialHeightGpm: 1500,
      method: "interpolated",
      transition: "warm_to_cold",
    });
    expect(crossings[0]?.pressureHpa).toBeCloseTo(Math.sqrt(900 * 800), 10);
    expect(crossings[1]?.geopotentialHeightGpm).toBeCloseTo(2625, 10);
    expect(crossings[1]?.transition).toBe("cold_to_warm");
  });

  it("reports an exact sampled 0 C level once and does not duplicate adjacent segments", () => {
    const crossings = deriveFreezingLevelCrossings([
      level(900, 1000, 4),
      level(800, 2000, 0),
      level(700, 3000, -6),
    ]);
    expect(crossings).toEqual([{
      pressureHpa: 800,
      geopotentialHeightGpm: 2000,
      method: "exact_sample",
      transition: "warm_to_cold",
      lowerLevel: level(900, 1000, 4),
      upperLevel: level(700, 3000, -6),
    }]);
  });

  it("returns no freezing crossing when the sampled profile remains on one side of zero", () => {
    expect(deriveFreezingLevelCrossings([
      level(900, 1000, 8),
      level(800, 2000, 2),
      level(700, 3000, 1),
    ])).toEqual([]);
  });

  it("merges contiguous warming-with-height segments into one sampled inversion layer", () => {
    const inversions = deriveTemperatureInversionLayers([
      level(900, 1000, 10),
      level(850, 1500, 8),
      level(800, 2000, 9),
      level(750, 2500, 11),
      level(700, 3000, 5),
    ]);
    expect(inversions).toEqual([{
      basePressureHpa: 850,
      topPressureHpa: 750,
      baseGeopotentialHeightGpm: 1500,
      topGeopotentialHeightGpm: 2500,
      baseTemperatureC: 8,
      topTemperatureC: 11,
      depthGpm: 1000,
      temperatureIncreaseC: 3,
      meanTemperatureGradientCPerKm: 3,
      sampledSegments: 2,
    }]);
  });

  it("can return multiple separate sampled inversion layers", () => {
    const inversions = deriveTemperatureInversionLayers([
      level(900, 1000, 10),
      level(850, 1500, 11),
      level(800, 2000, 5),
      level(750, 2500, 6),
    ]);
    expect(inversions.map((inversion) => [inversion.basePressureHpa, inversion.topPressureHpa])).toEqual([
      [900, 850],
      [800, 750],
    ]);
  });

  it("sorts by geopotential height and rejects duplicate heights", () => {
    expect(orderProfileByHeight([
      level(700, 3000, -5),
      level(900, 1000, 5),
      level(800, 2000, 0),
    ]).map((item) => item.pressureHpa)).toEqual([900, 800, 700]);
    expect(() => orderProfileByHeight([
      level(900, 1000, 5),
      level(800, 1000, 0),
    ])).toThrow(/strictly increasing geopotential heights/);
  });
});
