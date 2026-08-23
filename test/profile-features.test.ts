import { describe, expect, it } from "vitest";
import {
  deriveAdjacentGradients,
  findContiguousLayers,
  findProfileExtrema,
  findThresholdCrossings,
  orderSamplesByHeight,
} from "../src/derived/profile-features.js";

interface Sample {
  geopotentialHeightGpm: number;
  value: number;
  id: string;
}

const samples: Sample[] = [
  { id: "c", geopotentialHeightGpm: 2000, value: 4 },
  { id: "a", geopotentialHeightGpm: 0, value: -2 },
  { id: "b", geopotentialHeightGpm: 1000, value: 2 },
  { id: "d", geopotentialHeightGpm: 3000, value: 1 },
  { id: "e", geopotentialHeightGpm: 4000, value: 3 },
];

const valueOf = (sample: Sample) => sample.value;

describe("profile feature primitives", () => {
  it("orders samples by geopotential height and rejects duplicate heights", () => {
    expect(orderSamplesByHeight(samples).map((sample) => sample.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(() => orderSamplesByHeight([
      { id: "a", geopotentialHeightGpm: 1000, value: 1 },
      { id: "b", geopotentialHeightGpm: 1000, value: 2 },
    ])).toThrow(/strictly increasing geopotential heights/);
  });

  it("derives adjacent value gradients using geometric depth", () => {
    const gradients = deriveAdjacentGradients(samples, valueOf);
    expect(gradients).toHaveLength(4);
    expect(gradients[0]).toMatchObject({ depthGpm: 1000, lowerValue: -2, upperValue: 2, deltaValue: 4, gradientPerKm: 4 });
    expect(gradients[2]).toMatchObject({ depthGpm: 1000, lowerValue: 4, upperValue: 1, deltaValue: -3, gradientPerKm: -3 });
  });

  it("finds interpolated and exact threshold crossings without duplicate adjacent crossings", () => {
    const crossings = findThresholdCrossings(samples, valueOf, 2);
    expect(crossings).toHaveLength(2);
    expect(crossings[0]).toMatchObject({
      method: "exact_sample",
      sample: { id: "b" },
      direction: "increasing",
    });
    expect(crossings[1]).toMatchObject({
      method: "interpolated",
      lowerSample: { id: "d" },
      upperSample: { id: "e" },
      fraction: 0.5,
      direction: "increasing",
    });
  });

  it("groups contiguous matching adjacent segments into layers", () => {
    const layers = findContiguousLayers(samples, (gradient) => gradient.deltaValue > 0, valueOf);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toMatchObject({ baseSample: { id: "a" }, topSample: { id: "c" }, sampledSegments: 2 });
    expect(layers[1]).toMatchObject({ baseSample: { id: "d" }, topSample: { id: "e" }, sampledSegments: 1 });
  });

  it("finds profile extrema while retaining the source sample", () => {
    const extrema = findProfileExtrema(samples, valueOf);
    expect(extrema.min).toMatchObject({ sample: { id: "a" }, value: -2 });
    expect(extrema.max).toMatchObject({ sample: { id: "c" }, value: 4 });
    expect(() => findProfileExtrema([], valueOf)).toThrow(/at least one sample/);
  });
});
