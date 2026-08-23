import { describe, expect, it } from "vitest";
import {
  deriveLayerDepthGpm,
  derivePotentialTemperatureGradientKPerKm,
  deriveTemperatureLapseRateCPerKm,
  deriveWindShear,
} from "../src/derived/layer-diagnostics.js";

describe("pressure-layer derivations", () => {
  it("derives positive environmental lapse rate when temperature decreases upward", () => {
    expect(deriveTemperatureLapseRateCPerKm(12, 0, 1500, 3000)).toBeCloseTo(8, 10);
  });

  it("derives upper-minus-lower vector wind shear and depth-normalized magnitude", () => {
    const shear = deriveWindShear(3, 4, -10, 0, 1500, 3000);
    expect(shear.uWindShearMs).toBe(-13);
    expect(shear.vWindShearMs).toBe(-4);
    expect(shear.windShearMagnitudeMs).toBeCloseTo(Math.hypot(13, 4), 12);
    expect(shear.windShearMsPerKm).toBeCloseTo(Math.hypot(13, 4) / 1.5, 12);
  });

  it("derives upper-minus-lower potential-temperature gradient", () => {
    expect(derivePotentialTemperatureGradientKPerKm(12, 850, 0, 700, 1500, 3000)).toBeCloseTo(2.4881247, 6);
  });

  it("rejects inverted or zero geopotential-height layers", () => {
    expect(() => deriveLayerDepthGpm(3000, 1500)).toThrow(/upper geopotential height/);
    expect(() => deriveLayerDepthGpm(1500, 1500)).toThrow(/upper geopotential height/);
  });
});
