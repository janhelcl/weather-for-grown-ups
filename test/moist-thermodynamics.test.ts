import { describe, expect, it } from "vitest";
import {
  deriveEquivalentPotentialTemperatureK,
  derivePotentialTemperatureK,
  deriveSaturationVaporPressureHpa,
  deriveVaporPressureHpa,
  deriveWetBulbTemperatureC,
} from "../src/derived/thermodynamics.js";

const EPSILON = 0.622;

function specificHumidityFromVaporPressure(vaporPressureHpa: number, pressureHpa: number): number {
  const mixingRatio = EPSILON * vaporPressureHpa / (pressureHpa - vaporPressureHpa);
  return mixingRatio / (1 + mixingRatio);
}

describe("moist thermodynamic derivations", () => {
  it("uses the Bolton saturation-vapor-pressure relation", () => {
    expect(deriveSaturationVaporPressureHpa(20)).toBeCloseTo(23.36947, 5);
    expect(deriveSaturationVaporPressureHpa(0)).toBeCloseTo(6.112, 8);
  });

  it("recovers vapor pressure from specific humidity and total pressure", () => {
    const pressureHpa = 850;
    const expectedVaporPressureHpa = deriveSaturationVaporPressureHpa(18);
    const q = specificHumidityFromVaporPressure(expectedVaporPressureHpa, pressureHpa);
    expect(deriveVaporPressureHpa(q, pressureHpa)).toBeCloseTo(expectedVaporPressureHpa, 10);
  });

  it("derives Bolton equivalent potential temperature for a warm moist parcel", () => {
    const pressureHpa = 850;
    const q = specificHumidityFromVaporPressure(deriveSaturationVaporPressureHpa(18), pressureHpa);
    expect(deriveEquivalentPotentialTemperatureK(20, q, pressureHpa)).toBeCloseTo(353.92, 2);
  });

  it("reduces equivalent potential temperature to dry potential temperature at zero humidity", () => {
    expect(deriveEquivalentPotentialTemperatureK(12, 0, 850)).toBeCloseTo(
      derivePotentialTemperatureK(12, 850),
      10,
    );
  });

  it("solves pressure-dependent wet-bulb temperature by adiabatic-saturation enthalpy balance", () => {
    const pressureHpa = 993;
    const q = specificHumidityFromVaporPressure(deriveSaturationVaporPressureHpa(15), pressureHpa);
    const wetBulbC = deriveWetBulbTemperatureC(32, q, pressureHpa);
    expect(wetBulbC).toBeCloseTo(20.525, 3);
    expect(wetBulbC).toBeGreaterThan(15);
    expect(wetBulbC).toBeLessThan(32);
  });

  it("returns dry-bulb temperature for an already saturated parcel", () => {
    const pressureHpa = 900;
    const temperatureC = 10;
    const q = specificHumidityFromVaporPressure(deriveSaturationVaporPressureHpa(temperatureC), pressureHpa);
    expect(deriveWetBulbTemperatureC(temperatureC, q, pressureHpa)).toBeCloseTo(temperatureC, 8);
  });

  it("keeps the zero-specific-humidity wet-bulb limit finite", () => {
    const wetBulbC = deriveWetBulbTemperatureC(20, 0, 1000);
    expect(Number.isFinite(wetBulbC)).toBe(true);
    expect(wetBulbC).toBeLessThan(20);
  });

  it("rejects impossible humidity and pressure inputs", () => {
    expect(() => deriveEquivalentPotentialTemperatureK(20, 1, 850)).toThrow(/specific humidity/);
    expect(() => deriveWetBulbTemperatureC(20, -0.001, 850)).toThrow(/specific humidity/);
    expect(() => deriveWetBulbTemperatureC(20, 0.01, 0)).toThrow(/pressure/);
  });
});
