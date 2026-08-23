import { describe, expect, it } from "vitest";
import {
  deriveAirDensityKgM3,
  deriveDewPointC,
  deriveMixingRatioKgKg,
  derivePotentialTemperatureK,
  deriveVirtualTemperatureC,
} from "../src/derived/thermodynamics.js";

describe("thermodynamic derivations", () => {
  it("derives dew point from temperature and relative humidity", () => {
    expect(deriveDewPointC(12, 65)).toBeCloseTo(5.6222, 4);
  });

  it("derives potential temperature from temperature and isobaric pressure", () => {
    expect(derivePotentialTemperatureK(12, 850)).toBeCloseTo(298.6876, 4);
    expect(derivePotentialTemperatureK(12, 1000)).toBeCloseTo(285.15, 8);
  });

  it("converts specific humidity to mixing ratio", () => {
    expect(deriveMixingRatioKgKg(0.006)).toBeCloseTo(0.0060362173, 10);
  });

  it("derives virtual temperature and moist-air density", () => {
    expect(deriveVirtualTemperatureC(12, 0.006)).toBeCloseTo(13.0397, 4);
    expect(deriveAirDensityKgM3(12, 0.006, 850)).toBeCloseTo(1.03468, 5);
  });

  it("keeps the zero-relative-humidity dry limit finite for JSON output", () => {
    expect(Number.isFinite(deriveDewPointC(20, 0))).toBe(true);
  });
});
