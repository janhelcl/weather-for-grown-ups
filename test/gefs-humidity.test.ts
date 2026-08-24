import { describe, expect, it } from "vitest";
import { deriveSpecificHumidityFromRelativeHumidityKgKg } from "../src/derived/humidity.js";
import {
  deriveSaturationSpecificHumidityKgKg,
  deriveVaporPressureHpa,
  deriveSaturationVaporPressureHpa,
} from "../src/derived/thermodynamics.js";

describe("relative humidity to specific humidity", () => {
  it("matches saturation specific humidity at 100% RH", () => {
    expect(deriveSpecificHumidityFromRelativeHumidityKgKg(20, 100, 900))
      .toBeCloseTo(deriveSaturationSpecificHumidityKgKg(20, 900), 12);
  });

  it("round-trips the implied vapor pressure", () => {
    const q = deriveSpecificHumidityFromRelativeHumidityKgKg(25, 65, 1000);
    expect(deriveVaporPressureHpa(q, 1000))
      .toBeCloseTo(0.65 * deriveSaturationVaporPressureHpa(25), 12);
  });

  it("returns dry air at zero RH and rejects invalid states", () => {
    expect(deriveSpecificHumidityFromRelativeHumidityKgKg(20, 0, 1000)).toBe(0);
    expect(() => deriveSpecificHumidityFromRelativeHumidityKgKg(20, -1, 1000)).toThrow("relative humidity");
    expect(() => deriveSpecificHumidityFromRelativeHumidityKgKg(20, 50, 0)).toThrow("pressure");
  });
});
