import { describe, expect, it } from "vitest";
import {
  deriveParcelComputation,
  type ParcelEnvironmentLevel,
} from "../src/derived/parcel-diagnostics.js";
import {
  deriveAirDensityKgM3,
  deriveDewPointC,
  deriveEquivalentPotentialTemperatureK,
  deriveLclState,
  derivePotentialTemperatureK,
  deriveSaturationMixingRatioKgKg,
  deriveSpecificHumidityFromMixingRatioKgKg,
  deriveVirtualTemperatureK,
  deriveWetBulbTemperatureC,
} from "../src/derived/thermodynamics.js";

interface GoldenCase {
  reference: number;
  tolerance: number;
  source: string;
}

function expectWithin(actual: number, golden: GoldenCase): void {
  expect(Math.abs(actual - golden.reference), `reference: ${golden.source}`).toBeLessThanOrEqual(golden.tolerance);
}

function specificHumidityFromDewPoint(dewPointC: number, pressureHpa: number): number {
  return deriveSpecificHumidityFromMixingRatioKgKg(
    deriveSaturationMixingRatioKgKg(dewPointC, pressureHpa),
  );
}

function environmentLevel(
  pressureHpa: number,
  temperatureC: number,
  dewPointC: number,
  surfacePressureHpa: number,
): ParcelEnvironmentLevel {
  return {
    pressureHpa,
    // Height is not part of the CAPE pressure-coordinate integral. A smooth,
    // monotonic hypsometric-style coordinate keeps the interpolation contract
    // realistic without introducing another external reference dependency.
    geopotentialHeightGpm: 8000 * Math.log(surfacePressureHpa / pressureHpa),
    temperatureC,
    specificHumidityKgKg: specificHumidityFromDewPoint(dewPointC, pressureHpa),
  };
}

/**
 * Golden meteorology validation.
 *
 * These cases are intentionally independent of the ordinary implementation-oriented
 * unit tests. Expected values come from MetPy's published examples/tests, while the
 * tolerances document places where WFG deliberately uses a different established
 * formulation (for example Bolton LCL versus MetPy 1.7's Romps LCL, and an
 * adiabatic-saturation wet-bulb solve versus MetPy's Normand construction).
 *
 * The suite stays TypeScript-only: MetPy is not a runtime or CI dependency.
 */
describe("golden meteorology references", () => {
  it("matches MetPy dew point from temperature and relative humidity", () => {
    const golden: GoldenCase = {
      reference: 0.047900916,
      tolerance: 0.01,
      source: "MetPy 1.7 dewpoint_from_relative_humidity example: 10 degC, 50% RH",
    };
    expectWithin(deriveDewPointC(10, 50), golden);
  });

  it("matches MetPy dry potential temperature", () => {
    const golden: GoldenCase = {
      reference: 290.972015,
      tolerance: 0.05,
      source: "MetPy 1.7 potential_temperature example: 800 hPa, 273 K",
    };
    expectWithin(derivePotentialTemperatureK(-0.15, 800), golden);
  });

  it("matches MetPy equivalent potential temperature using the same Bolton family", () => {
    const q = specificHumidityFromDewPoint(18, 850);
    const golden: GoldenCase = {
      reference: 353.898874,
      tolerance: 0.05,
      source: "MetPy 1.7 equivalent_potential_temperature example: 850 hPa, 20 degC, 18 degC dew point",
    };
    expectWithin(deriveEquivalentPotentialTemperatureK(20, q, 850), golden);
  });

  it("stays close to MetPy's current LCL despite the documented formulation difference", () => {
    const q = specificHumidityFromDewPoint(28, 943);
    const actual = deriveLclState(33, q, 943);
    expectWithin(actual.pressureHpa, {
      reference: 877.033549,
      tolerance: 0.5,
      source: "MetPy 1.7 lcl example: 943 hPa, 33 degC, 28 degC dew point (Romps 2017)",
    });
    expectWithin(actual.temperatureC, {
      reference: 26.7591908,
      tolerance: 0.05,
      source: "MetPy 1.7 lcl example: LCL temperature for the same parcel",
    });
  });

  it("stays close to MetPy wet-bulb temperature across the different solution methods", () => {
    const q = specificHumidityFromDewPoint(15, 993);
    const golden: GoldenCase = {
      reference: 20.3937601,
      tolerance: 0.25,
      source: "MetPy 1.7 wet_bulb_temperature example: 993 hPa, 32 degC, 15 degC dew point (Normand method)",
    };
    expectWithin(deriveWetBulbTemperatureC(32, q, 993), golden);
  });

  it("matches MetPy virtual temperature when mixing ratio is converted to WFG specific humidity", () => {
    const q = deriveSpecificHumidityFromMixingRatioKgKg(0.0016);
    const golden: GoldenCase = {
      reference: 288.2796,
      tolerance: 0.001,
      source: "MetPy test_thermo.py virtual_temperature reference: 288 K, mixing ratio 0.0016 kg/kg",
    };
    expectWithin(deriveVirtualTemperatureK(14.85, q), golden);
  });

  it("matches MetPy moist-air density for the same parcel state", () => {
    const q = deriveSpecificHumidityFromMixingRatioKgKg(0.0016);
    const golden: GoldenCase = {
      reference: 1.2072,
      tolerance: 0.0001,
      source: "MetPy test_thermo.py density reference: 999 hPa, 288 K, mixing ratio 0.0016 kg/kg",
    };
    expectWithin(deriveAirDensityKgM3(14.85, q, 999), golden);
  });

  it("tracks MetPy's basic surface-parcel CAPE/CIN/LFC/EL sounding", () => {
    const pressures = [959, 779.2, 751.3, 724.3, 700, 269];
    const temperatures = [22.2, 14.6, 12, 9.4, 7, -38];
    const dewPoints = [19, -11.2, -10.8, -10.4, -10, -53.2];
    const levels = pressures.map((pressureHpa, index) => environmentLevel(
      pressureHpa,
      temperatures[index]!,
      dewPoints[index]!,
      pressures[0]!,
    ));
    const [surface, ...sampled] = levels;
    const actual = deriveParcelComputation("surface_2m", surface!, sampled);

    expectWithin(actual.capeJkg, {
      reference: 223.927212,
      tolerance: 50,
      source: "MetPy test_cape_cin basic sounding",
    });
    expectWithin(actual.cinJkg, {
      reference: -21.4414153,
      tolerance: 10,
      source: "MetPy test_cape_cin basic sounding",
    });
    expect(actual.lfc).toBeDefined();
    expect(actual.el).toBeDefined();
    expectWithin(actual.lfc!.pressureHpa, {
      reference: 727.055,
      tolerance: 20,
      source: "MetPy test_lfc_basic lower-profile crossing",
    });
    expectWithin(actual.el!.pressureHpa, {
      reference: 476.30710,
      tolerance: 35,
      source: "MetPy test_el basic sounding",
    });
  });
});
