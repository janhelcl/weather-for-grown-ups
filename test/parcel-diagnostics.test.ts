import { describe, expect, it } from "vitest";
import {
  deriveParcelComputation,
  integratePseudoAdiabaticTemperatureC,
  type ParcelEnvironmentLevel,
} from "../src/derived/parcel-diagnostics.js";
import {
  deriveDryAdiabaticTemperatureC,
  deriveLclState,
  deriveSaturationSpecificHumidityKgKg,
} from "../src/derived/thermodynamics.js";

const surface: ParcelEnvironmentLevel = {
  pressureHpa: 1000,
  geopotentialHeightGpm: 100,
  temperatureC: 30,
  specificHumidityKgKg: 0.018,
};

const unstableProfile: ParcelEnvironmentLevel[] = [
  { pressureHpa: 950, geopotentialHeightGpm: 550, temperatureC: 27, specificHumidityKgKg: 0.015 },
  { pressureHpa: 900, geopotentialHeightGpm: 1000, temperatureC: 23, specificHumidityKgKg: 0.012 },
  { pressureHpa: 850, geopotentialHeightGpm: 1500, temperatureC: 14, specificHumidityKgKg: 0.009 },
  { pressureHpa: 800, geopotentialHeightGpm: 2000, temperatureC: 9, specificHumidityKgKg: 0.007 },
  { pressureHpa: 700, geopotentialHeightGpm: 3000, temperatureC: 0, specificHumidityKgKg: 0.004 },
  { pressureHpa: 600, geopotentialHeightGpm: 4200, temperatureC: -10, specificHumidityKgKg: 0.002 },
  { pressureHpa: 500, geopotentialHeightGpm: 5600, temperatureC: -22, specificHumidityKgKg: 0.001 },
  { pressureHpa: 400, geopotentialHeightGpm: 7200, temperatureC: -32, specificHumidityKgKg: 0.0006 },
  { pressureHpa: 300, geopotentialHeightGpm: 9200, temperatureC: -38, specificHumidityKgKg: 0.0003 },
  { pressureHpa: 250, geopotentialHeightGpm: 10400, temperatureC: -25, specificHumidityKgKg: 0.0002 },
];

describe("parcel thermodynamic primitives", () => {
  it("matches the Bolton LCL construction for a known warm/moist parcel", () => {
    const q = deriveSaturationSpecificHumidityKgKg(28, 943);
    const lcl = deriveLclState(33, q, 943);
    expect(lcl.temperatureC).toBeCloseTo(26.76918, 4);
    expect(lcl.pressureHpa).toBeCloseTo(877.4496, 3);
    expect(lcl.dewPointC).toBeCloseTo(28, 8);
  });

  it("cools on pseudo-adiabatic ascent but less than a dry adiabat", () => {
    const moist = integratePseudoAdiabaticTemperatureC(20, 900, 700);
    const dry = deriveDryAdiabaticTemperatureC(20, 900, 700);
    expect(moist).toBeLessThan(20);
    expect(moist).toBeGreaterThan(dry);
  });
});

describe("deriveParcelComputation", () => {
  it("derives a surface parcel with LCL, first buoyant layer, CAPE and CIN", () => {
    const result = deriveParcelComputation("surface_2m", surface, unstableProfile);
    expect(result.startingState).toMatchObject({ definition: "surface_2m", source: "surface_2m", pressureHpa: 1000 });
    expect(result.lcl.pressureHpa).toBeLessThan(1000);
    expect(result.lcl.withinProfile).toBe(true);
    expect(result.lfc?.pressureHpa).toBeLessThanOrEqual(result.lcl.pressureHpa);
    expect(result.el?.pressureHpa).toBeLessThan(result.lfc?.pressureHpa ?? 1000);
    expect(result.capeJkg).toBeGreaterThan(0);
    expect(result.cinJkg).toBeLessThanOrEqual(0);
    expect(result.capeTop).toBe("equilibrium_level");
    expect(result.cinTop).toBe("lfc");
    expect(result.parcelPath.some((level) => level.source === "interpolated_lcl")).toBe(true);
    expect(result.parcelPath.some((level) => level.source === "interpolated_buoyancy_crossing")).toBe(true);
  });

  it("constructs a 100 hPa mixed-layer parcel at surface pressure", () => {
    const result = deriveParcelComputation("mixed_layer_100hpa", surface, unstableProfile);
    expect(result.startingState).toMatchObject({
      definition: "mixed_layer_100hpa",
      source: "mixed_layer_mean",
      pressureHpa: 1000,
      construction: {
        layerBottomPressureHpa: 1000,
        layerTopPressureHpa: 900,
      },
    });
    expect(result.startingState.construction?.sampledLevels).toBeGreaterThanOrEqual(3);
    expect(result.startingState.temperatureC).toBeLessThan(surface.temperatureC);
  });

  it("selects the sampled maximum-theta-e parcel in the lowest 300 hPa", () => {
    const moist850 = unstableProfile.map((level) =>
      level.pressureHpa === 850
        ? { ...level, temperatureC: 24, specificHumidityKgKg: 0.017 }
        : level,
    );
    const result = deriveParcelComputation("most_unstable_300hpa", surface, moist850);
    expect(result.startingState.definition).toBe("most_unstable_300hpa");
    expect(result.startingState.source).toBe("isobaric_sample");
    expect(result.startingState.pressureHpa).toBe(850);
    expect(result.startingState.construction?.candidateLevels).toBeGreaterThan(1);
    expect(result.startingState.construction?.selectedEquivalentPotentialTemperatureK).toBeGreaterThan(0);
  });

  it("fails a mixed-layer parcel when the explicit sounding does not span 100 hPa", () => {
    expect(() => deriveParcelComputation("mixed_layer_100hpa", surface, [unstableProfile[0]!]))
      .toThrow(/does not reach the top of the 100 hPa mixed layer/);
  });
});
