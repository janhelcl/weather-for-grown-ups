import { describe, expect, it, vi } from "vitest";
import {
  summarizeWindVectorDistribution,
  windVectorSampleFromComponents,
  windVectorSampleFromSpeedDirection,
} from "../src/core/ensemble-statistics.js";
import {
  normalizeEnsembleWindResult,
  queryRequestsEnsembleWindSummary,
  requestWithEnsembleWindMembers,
} from "../src/core/ensemble-wind-normalization.js";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-query.js";
import { queryAtmosphereSchema } from "../src/schema/unified-api.js";

describe("ensemble wind vector statistics", () => {
  it("computes a true vector mean without scalar-averaging direction", () => {
    const summary = summarizeWindVectorDistribution([
      windVectorSampleFromSpeedDirection(5, 350),
      windVectorSampleFromSpeedDirection(5, 10),
    ], [0.5]);

    expect(summary.memberCount).toBe(2);
    expect(summary.vectorMean.speedMs).toBeCloseTo(4.924, 3);
    expect(summary.vectorMean.directionDeg).not.toBeNull();
    expect(summary.vectorMean.directionDeg!).toBeCloseTo(0, 8);
    expect(summary.speedDistribution).toMatchObject({
      memberCount: 2,
      mean: 5,
      min: 5,
      max: 5,
      quantiles: [{ quantile: 0.5, value: 5 }],
    });
    expect(summary.directionalConcentration.memberCount).toBe(2);
    expect(summary.directionalConcentration.meanDirectionDeg).not.toBeNull();
    expect(summary.directionalConcentration.meanDirectionDeg!).toBeCloseTo(0, 8);
    expect(summary.directionalConcentration.resultantLength).toBeCloseTo(
      Math.cos(10 * Math.PI / 180),
      8,
    );
    expect(summary.calm).toEqual({
      operator: "lt",
      thresholdSpeedMs: 0.5,
      count: 0,
      fraction: 0,
    });
  });

  it("derives meteorological direction from native u/v components", () => {
    expect(windVectorSampleFromComponents(-5, 0)).toMatchObject({
      uWindMs: -5,
      vWindMs: 0,
      speedMs: 5,
      directionDeg: 90,
    });
    expect(windVectorSampleFromComponents(0, 4)).toMatchObject({
      uWindMs: 0,
      vWindMs: 4,
      speedMs: 4,
      directionDeg: 180,
    });
  });

  it("reports undefined mean direction for cancelling vectors", () => {
    const summary = summarizeWindVectorDistribution([
      windVectorSampleFromSpeedDirection(5, 90),
      windVectorSampleFromSpeedDirection(5, 270),
    ], [0.5]);

    expect(summary.vectorMean.speedMs).toBeCloseTo(0, 12);
    expect(summary.vectorMean.directionDeg).toBeNull();
    expect(summary.directionalConcentration.resultantLength).toBeCloseTo(0, 12);
    expect(summary.directionalConcentration.meanDirectionDeg).toBeNull();
  });

  it("declares the calm threshold and excludes calm directions from concentration", () => {
    const summary = summarizeWindVectorDistribution([
      windVectorSampleFromSpeedDirection(0.2, 180),
      windVectorSampleFromSpeedDirection(5, 0),
    ], [0.1, 0.5, 0.9]);

    expect(summary.calm).toEqual({
      operator: "lt",
      thresholdSpeedMs: 0.5,
      count: 1,
      fraction: 0.5,
    });
    expect(summary.directionalConcentration).toEqual({
      memberCount: 1,
      meanDirectionDeg: 0,
      resultantLength: 1,
    });
  });

  it("handles an all-calm population without inventing a direction", () => {
    const summary = summarizeWindVectorDistribution([
      windVectorSampleFromSpeedDirection(0.1, 20),
      windVectorSampleFromSpeedDirection(0.2, 220),
    ], [0.5]);

    expect(summary.calm).toMatchObject({ count: 2, fraction: 1 });
    expect(summary.directionalConcentration).toEqual({
      memberCount: 0,
      meanDirectionDeg: null,
      resultantLength: null,
    });
  });

  it("rejects invalid vector inputs and calm thresholds", () => {
    expect(() => summarizeWindVectorDistribution([], [0.5])).toThrow("empty ensemble wind-vector");
    expect(() => summarizeWindVectorDistribution([
      windVectorSampleFromSpeedDirection(1, 0),
    ], [0.5], -0.1)).toThrow("Calm threshold must be nonnegative");
    expect(() => windVectorSampleFromSpeedDirection(-1, 0)).toThrow("Wind speed must be nonnegative");
    expect(() => windVectorSampleFromComponents(Number.NaN, 0)).toThrow("must be finite");
    expect(() => windVectorSampleFromSpeedDirection(1, Number.POSITIVE_INFINITY)).toThrow("must be finite");
  });
});

describe("ensemble wind request detection", () => {
  it("recognizes derived and paired component pressure selections", () => {
    expect(queryRequestsEnsembleWindSummary({
      geometry: { type: "point" },
      selection: { variables: ["wind"], pressureLevelsHpa: [850] },
    } as any)).toBe(true);
    expect(queryRequestsEnsembleWindSummary({
      geometry: { type: "point" },
      selection: { variables: ["u_wind", "v_wind"], pressureLevelsHpa: [850] },
    } as any)).toBe(true);
    expect(queryRequestsEnsembleWindSummary({
      geometry: { type: "point" },
      selection: { variables: ["u_wind"], pressureLevelsHpa: [850] },
    } as any)).toBe(false);
  });

  it("recognizes derived and paired component height winds but ignores gust/scalars", () => {
    expect(queryRequestsEnsembleWindSummary({
      geometry: { type: "point" },
      selection: { fields: ["wind_10m"] },
    } as any)).toBe(true);
    expect(queryRequestsEnsembleWindSummary({
      geometry: { type: "point" },
      selection: { fields: ["u_wind_10m", "v_wind_10m"] },
    } as any)).toBe(true);
    expect(queryRequestsEnsembleWindSummary({
      geometry: { type: "point" },
      selection: { fields: ["u_wind_10m", "temperature_2m"] },
    } as any)).toBe(false);
    expect(queryRequestsEnsembleWindSummary({
      geometry: { type: "point" },
      selection: { fields: ["wind_gust"] },
    } as any)).toBe(false);
  });

  it("does not normalize area summaries", () => {
    expect(queryRequestsEnsembleWindSummary({
      geometry: { type: "area" },
      selection: { fields: ["wind_10m"] },
    } as any)).toBe(false);
  });

  it("forces internal member evidence without mutating the original request", () => {
    const request = {
      ensemble: { quantiles: [0.5] },
      selection: { fields: ["wind_10m"] },
      geometry: { type: "point" },
    } as any;
    const enriched = requestWithEnsembleWindMembers(request);
    expect(enriched).not.toBe(request);
    expect(enriched.ensemble).toEqual({ quantiles: [0.5], includeMembers: true });
    expect(request.ensemble).toEqual({ quantiles: [0.5] });

    expect(requestWithEnsembleWindMembers({
      selection: { fields: ["wind_10m"] },
      geometry: { type: "point" },
    } as any).ensemble).toEqual({ includeMembers: true });
  });
});

describe("ensemble wind result normalization", () => {
  it("returns non-object results unchanged", () => {
    const request = { ensemble: { quantiles: [0.5] } } as any;
    expect(normalizeEnsembleWindResult(request, null)).toBeNull();
    expect(normalizeEnsembleWindResult(request, "opaque")).toBe("opaque");
  });

  it("adds vector summaries from nested member evidence and strips hidden members", () => {
    const request = queryAtmosphereSchema.parse({
      dataset: "aigefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: {
        from: "2026-09-12T06:00:00Z",
        to: "2026-09-12T12:00:00Z",
      },
      selection: { variables: ["wind"], pressureLevelsHpa: [850] },
      ensemble: { quantiles: [0.5] },
    });
    const result: any = {
      series: [
        { validTime: "2026-09-12T06:00:00Z" },
        { validTime: "2026-09-12T12:00:00Z" },
      ],
      members: [
        {
          member: "p01",
          series: [
            { levels: [{ pressureHpa: 850, windSpeedMs: 5, windDirectionDeg: 350 }] },
            { levels: [{ pressureHpa: 850, windSpeedMs: 4, windDirectionDeg: 180 }] },
          ],
        },
        {
          member: "p02",
          series: [
            { levels: [{ pressureHpa: 850, windSpeedMs: 5, windDirectionDeg: 10 }] },
            { levels: [{ pressureHpa: 850, windSpeedMs: 6, windDirectionDeg: 180 }] },
          ],
        },
      ],
    };

    normalizeEnsembleWindResult(request, result);

    expect(result.members).toBeUndefined();
    expect(result.series[0].windVectorSummaries).toHaveLength(1);
    expect(result.series[0].windVectorSummaries[0]).toMatchObject({
      kind: "pressure_level",
      pressureLevelHpa: 850,
      memberCount: 2,
      speedDistribution: { mean: 5 },
      calm: { thresholdSpeedMs: 0.5, fraction: 0 },
    });
    expect(result.series[0].windVectorSummaries[0].vectorMean.directionDeg).toBeCloseTo(0, 8);
    expect(result.series[1].windVectorSummaries[0].vectorMean).toMatchObject({
      speedMs: 5,
      directionDeg: 180,
    });
  });

  it("uses default quantiles and direct u/v profile evidence", () => {
    const request = { ensemble: undefined } as any;
    const result: any = {
      members: [
        { member: "p01", levels: [{ pressureHpa: 700, uWindMs: -2, vWindMs: 0 }] },
        { member: "p02", levels: [{ pressureHpa: 700, uWindMs: -4, vWindMs: 0 }] },
      ],
    };

    normalizeEnsembleWindResult(request, result);

    expect(result.members).toBeUndefined();
    expect(result.windVectorSummaries[0]).toMatchObject({
      kind: "pressure_level",
      pressureLevelHpa: 700,
      vectorMean: { speedMs: 3, directionDeg: 90 },
      speedDistribution: {
        quantiles: [
          { quantile: 0.1, value: 2.2 },
          { quantile: 0.5, value: 3 },
          { quantile: 0.9, value: 3.8 },
        ],
      },
    });
  });

  it("pairs raw component evidence and preserves explicitly requested members", () => {
    const request = queryAtmosphereSchema.parse({
      dataset: "gefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-09-12T06:00:00Z" },
      selection: {
        variables: ["u_wind", "v_wind"],
        pressureLevelsHpa: [850],
        fields: ["u_wind_10m", "v_wind_10m"],
      },
      ensemble: { quantiles: [0.5], includeMembers: true },
    });
    const result: any = {
      members: [
        {
          member: "c00",
          pressureValues: [
            { variable: "u_wind", pressureLevelHpa: 850, value: 0 },
            { variable: "v_wind", pressureLevelHpa: 850, value: -4 },
          ],
          fields: [
            { field: "u_wind_10m", values: { uWindMs: -3 } },
            { field: "v_wind_10m", values: { vWindMs: 0 } },
          ],
        },
        {
          member: "p01",
          pressureValues: [
            { variable: "u_wind", pressureLevelHpa: 850, value: 0 },
            { variable: "v_wind", pressureLevelHpa: 850, value: -6 },
          ],
          fields: [
            { field: "u_wind_10m", values: { uWindMs: -5 } },
            { field: "v_wind_10m", values: { vWindMs: 0 } },
          ],
        },
      ],
    };

    normalizeEnsembleWindResult(request, result);

    expect(result.members).toHaveLength(2);
    expect(result.windVectorSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "pressure_level",
        pressureLevelHpa: 850,
        vectorMean: expect.objectContaining({ speedMs: 5, directionDeg: 0 }),
      }),
      expect.objectContaining({
        kind: "field",
        field: "wind_10m",
        vectorMean: expect.objectContaining({ speedMs: 4, directionDeg: 90 }),
      }),
    ]));
  });

  it("reads IFS-style pressure values and direct derived field values", () => {
    const request = { ensemble: { quantiles: [0.5], includeMembers: true } } as any;
    const result: any = {
      members: [
        {
          member: "p01",
          pressureValues: [
            { pressureLevelHpa: 850, values: { windSpeedMs: 3, windDirectionDeg: 180 } },
            { pressureLevelHpa: 700, values: { uWindMs: -4, vWindMs: 0 } },
          ],
          fields: [{
            field: "wind_10m",
            values: { windSpeedMs: 2, windDirectionDeg: 90 },
          }],
        },
        {
          member: "p02",
          pressureValues: [
            { pressureLevelHpa: 850, values: { windSpeedMs: 5, windDirectionDeg: 180 } },
            { pressureLevelHpa: 700, values: { uWindMs: -6, vWindMs: 0 } },
          ],
          fields: [{
            field: "wind_10m",
            values: { windSpeedMs: 4, windDirectionDeg: 90 },
          }],
        },
      ],
    };

    normalizeEnsembleWindResult(request, result);

    expect(result.windVectorSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ pressureLevelHpa: 850, vectorMean: expect.objectContaining({ speedMs: 4, directionDeg: 180 }) }),
      expect.objectContaining({ pressureLevelHpa: 700, vectorMean: expect.objectContaining({ speedMs: 5, directionDeg: 90 }) }),
      expect.objectContaining({ field: "wind_10m", vectorMean: expect.objectContaining({ speedMs: 3, directionDeg: 90 }) }),
    ]));
  });

  it("normalizes nested points and transect samples by matching member index", () => {
    const request = { ensemble: { quantiles: [0.5] } } as any;
    const points: any = {
      points: [{ requestedPoint: { latitude: 1, longitude: 2 } }],
      members: [
        {
          member: "p01",
          points: [{ levels: [{ pressureHpa: 850, windSpeedMs: 2, windDirectionDeg: 0 }] }],
        },
        {
          member: "p02",
          points: [{ levels: [{ pressureHpa: 850, windSpeedMs: 4, windDirectionDeg: 0 }] }],
        },
      ],
    };
    normalizeEnsembleWindResult(request, points);
    expect(points.points[0].windVectorSummaries[0].vectorMean.speedMs).toBe(3);
    expect(points.members).toBeUndefined();

    const transect: any = {
      samples: [{ index: 0 }],
      members: [
        {
          member: "p01",
          samples: [{ fields: [{ id: "wind_10m", values: { windSpeedMs: 2, windDirectionDeg: 0 } }] }],
        },
        {
          member: "p02",
          samples: [{ fields: [{ id: "wind_10m", values: { windSpeedMs: 4, windDirectionDeg: 0 } }] }],
        },
      ],
    };
    normalizeEnsembleWindResult(request, transect);
    expect(transect.samples[0].windVectorSummaries[0]).toMatchObject({
      kind: "field",
      field: "wind_10m",
      vectorMean: { speedMs: 3, directionDeg: 0 },
    });
  });

  it("leaves non-member arrays and incomplete single-member payloads alone", () => {
    const request = { ensemble: { quantiles: [0.5] } } as any;
    const result: any = {
      selection: { members: ["p01", "p02"] },
      members: [{ member: "p01", levels: [] }],
      metadata: [{ field: "wind_10m" }],
    };
    normalizeEnsembleWindResult(request, result);
    expect(result.selection.members).toEqual(["p01", "p02"]);
    expect(result.members).toHaveLength(1);
    expect(result.windVectorSummaries).toBeUndefined();
  });

  it("rejects inconsistent member evidence and parallel collection lengths", () => {
    const request = { ensemble: { quantiles: [0.5] } } as any;
    expect(() => normalizeEnsembleWindResult(request, {
      members: [
        { member: "p01", levels: [{ pressureHpa: 850, windSpeedMs: 3, windDirectionDeg: 0 }] },
        { member: "p02", levels: [] },
      ],
    })).toThrow("inconsistent member evidence");

    expect(() => normalizeEnsembleWindResult(request, {
      series: [{ validTime: "a" }, { validTime: "b" }],
      members: [
        { member: "p01", series: [{ levels: [] }] },
        { member: "p02", series: [{ levels: [] }] },
      ],
    })).toThrow("inconsistent series lengths");
  });

  it("ignores malformed or incomplete wind records instead of inventing vectors", () => {
    const request = { ensemble: { quantiles: [0.5], includeMembers: true } } as any;
    const result: any = {
      members: [
        {
          member: "p01",
          levels: [{ pressureHpa: 850, windSpeedMs: 3 }],
          pressureValues: [{ pressureLevelHpa: "850", values: { uWindMs: 1 } }],
          fields: [{ field: "temperature_2m", values: { temperatureC: 10 } }],
        },
        {
          member: "p02",
          levels: [{ pressureHpa: 850, windSpeedMs: 5 }],
          pressureValues: [{ pressureLevelHpa: "850", values: { vWindMs: 2 } }],
          fields: [{ id: "temperature_2m", values: { temperatureC: 12 } }],
        },
      ],
    };
    normalizeEnsembleWindResult(request, result);
    expect(result.windVectorSummaries).toBeUndefined();
  });

  it("forces member evidence internally through the unified query service", async () => {
    const query = vi.fn(async (request: any) => {
      expect(request.ensemble?.includeMembers).toBe(true);
      return {
        model: "aigefs_0p25",
        run: "2026-09-12T00:00:00.000Z",
        validTime: "2026-09-12T06:00:00.000Z",
        forecastHour: 6,
        members: [
          {
            member: "p01",
            levels: [{ pressureHpa: 850, windSpeedMs: 5, windDirectionDeg: 350 }],
          },
          {
            member: "p02",
            levels: [{ pressureHpa: 850, windSpeedMs: 5, windDirectionDeg: 10 }],
          },
        ],
      };
    });
    const service = new UnifiedAtmosphereQueryService({
      adapters: { aigefs: { query } } as any,
    });

    const wrapped = await service.query({
      dataset: "aigefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-09-12T06:00:00Z" },
      selection: { variables: ["wind"], pressureLevelsHpa: [850] },
      ensemble: { quantiles: [0.5] },
    });
    const result = wrapped.result as any;

    expect(query).toHaveBeenCalledTimes(1);
    expect(result.members).toBeUndefined();
    expect(result.windVectorSummaries[0]).toMatchObject({
      kind: "pressure_level",
      pressureLevelHpa: 850,
      speedDistribution: { mean: 5 },
    });
    expect(result.windVectorSummaries[0].vectorMean.directionDeg).toBeCloseTo(0, 8);
  });

  it("does not force members for non-wind or deterministic requests", async () => {
    const ensembleQuery = vi.fn(async (request: any) => {
      expect(request.ensemble?.includeMembers).toBeUndefined();
      return { model: "aigefs_0p25" };
    });
    const deterministicQuery = vi.fn(async (request: any) => {
      expect(request.ensemble).toBeUndefined();
      return { model: "gfs_0p25" };
    });
    const service = new UnifiedAtmosphereQueryService({
      adapters: {
        aigefs: { query: ensembleQuery },
        gfs: { query: deterministicQuery },
      } as any,
    });

    await service.query({
      dataset: "aigefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-09-12T06:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });
    await service.query({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-09-12T06:00:00Z" },
      selection: { variables: ["wind"], pressureLevelsHpa: [850] },
    });

    expect(ensembleQuery).toHaveBeenCalledTimes(1);
    expect(deterministicQuery).toHaveBeenCalledTimes(1);
  });
});
