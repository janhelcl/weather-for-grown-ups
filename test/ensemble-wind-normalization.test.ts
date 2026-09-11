import { describe, expect, it, vi } from "vitest";
import {
  summarizeWindVectorDistribution,
  windVectorSampleFromSpeedDirection,
} from "../src/core/ensemble-statistics.js";
import { normalizeEnsembleWindResult } from "../src/core/ensemble-wind-normalization.js";
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
});

describe("ensemble wind result normalization", () => {
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
});
