import { describe, expect, it, vi } from "vitest";
import {
  prepareGefsBundleSelection,
  summarizeGefsMemberBundles,
  type DecodedGefsMemberBundle,
} from "../src/core/gefs-bundle-decoder.js";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-query.js";
import { gefsPointsBundleResultSchema } from "../src/schema/gefs-points-bundle.js";

const gridPoint = { latitude: 50, longitude: 14 };

function member(
  id: "c00" | "p01",
  u850: number,
  v850: number,
  wind10mSpeed: number,
  wind10mDirection: number,
): DecodedGefsMemberBundle {
  return {
    member: id,
    cacheHit: false,
    gridPoint,
    pressureValues: [
      { variable: "u_wind", pressureLevelHpa: 850, value: u850 },
      { variable: "v_wind", pressureLevelHpa: 850, value: v850 },
    ],
    fields: [{
      field: "wind_10m",
      temporal: { type: "instantaneous" },
      values: {
        windSpeedMs: wind10mSpeed,
        windDirectionDeg: wind10mDirection,
      },
    }],
  };
}

describe("native GEFS wind vector summaries", () => {
  it("summarizes pressure components and derived 10 m wind before raw members are exposed", () => {
    const selection = prepareGefsBundleSelection({
      variables: ["u_wind", "v_wind"],
      pressureLevelsHpa: [850],
      fields: ["wind_10m"],
    });
    const result = summarizeGefsMemberBundles([
      member("c00", 0, -4, 3, 350),
      member("p01", 0, -6, 3, 10),
    ], selection, [0.5]);

    expect(result.windVectorSummaries).toHaveLength(2);
    expect(result.windVectorSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "pressure_level",
        pressureLevelHpa: 850,
        memberCount: 2,
        vectorMean: expect.objectContaining({
          uWindMs: 0,
          vWindMs: -5,
          speedMs: 5,
          directionDeg: 0,
        }),
        speedDistribution: expect.objectContaining({
          quantiles: [{ quantile: 0.5, value: 5 }],
        }),
        calm: {
          operator: "lt",
          thresholdSpeedMs: 0.5,
          count: 0,
          fraction: 0,
        },
      }),
      expect.objectContaining({
        kind: "field",
        field: "wind_10m",
        memberCount: 2,
        speedDistribution: expect.objectContaining({ mean: 3 }),
      }),
    ]));
    const surface = result.windVectorSummaries.find((summary) => summary.kind === "field");
    expect(surface?.vectorMean.directionDeg).toBeCloseTo(0, 8);
    expect(surface?.directionalConcentration.resultantLength).toBeCloseTo(
      Math.cos(10 * Math.PI / 180),
      8,
    );
  });

  it("pairs raw 10 m components into one canonical field vector summary", () => {
    const selection = prepareGefsBundleSelection({
      variables: [],
      pressureLevelsHpa: [],
      fields: ["u_wind_10m", "v_wind_10m"],
    });
    const samples: DecodedGefsMemberBundle[] = [
      {
        member: "c00",
        cacheHit: false,
        gridPoint,
        pressureValues: [],
        fields: [
          { field: "u_wind_10m", temporal: { type: "instantaneous" }, values: { uWindMs: -3 } },
          { field: "v_wind_10m", temporal: { type: "instantaneous" }, values: { vWindMs: 0 } },
        ],
      },
      {
        member: "p01",
        cacheHit: false,
        gridPoint,
        pressureValues: [],
        fields: [
          { field: "u_wind_10m", temporal: { type: "instantaneous" }, values: { uWindMs: -5 } },
          { field: "v_wind_10m", temporal: { type: "instantaneous" }, values: { vWindMs: 0 } },
        ],
      },
    ];

    const result = summarizeGefsMemberBundles(samples, selection, [0.5]);
    expect(result.windVectorSummaries).toEqual([
      expect.objectContaining({
        kind: "field",
        field: "wind_10m",
        vectorMean: expect.objectContaining({ speedMs: 4, directionDeg: 90 }),
        speedDistribution: expect.objectContaining({
          quantiles: [{ quantile: 0.5, value: 4 }],
        }),
      }),
    ]);
  });

  it("keeps vector summaries when multi-point result schemas omit raw members", () => {
    const parsed = gefsPointsBundleResultSchema.parse({
      model: "gefs_0p50",
      run: "2026-09-12T00:00:00.000Z",
      validTime: "2026-09-12T06:00:00.000Z",
      forecastHour: 6,
      selection: {
        variables: [],
        pressureLevelsHpa: [],
        fields: ["wind_10m"],
        members: ["c00", "p01"],
        quantiles: [0.5],
      },
      includeMembers: false,
      points: [{
        requestedPoint: gridPoint,
        gridPoint,
        pressureSummaries: [],
        fieldSummaries: [],
        windVectorSummaries: [{
          kind: "field",
          field: "wind_10m",
          memberCount: 2,
          vectorMean: { uWindMs: 0, vWindMs: -4, speedMs: 4, directionDeg: 0 },
          speedDistribution: {
            memberCount: 2,
            mean: 4,
            populationStdDev: 1,
            min: 3,
            max: 5,
            quantiles: [{ quantile: 0.5, value: 4 }],
          },
          directionalConcentration: {
            memberCount: 2,
            meanDirectionDeg: 0,
            resultantLength: 1,
          },
          calm: {
            operator: "lt",
            thresholdSpeedMs: 0.5,
            count: 0,
            fraction: 0,
          },
        }],
      }],
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: "wgrib2",
        product: "pgrb2a_0p50",
        horizontalGridDegrees: 0.5,
        memberFiles: [
          { member: "c00", cacheHit: false },
          { member: "p01", cacheHit: false },
        ],
        allCacheHit: false,
      },
    });

    expect(parsed.points[0]?.members).toBeUndefined();
    expect(parsed.points[0]?.windVectorSummaries[0]).toMatchObject({
      kind: "field",
      field: "wind_10m",
      vectorMean: { speedMs: 4, directionDeg: 0 },
    });
  });

  it("does not force raw member output for operational GEFS unified queries", async () => {
    const query = vi.fn(async (request: any) => {
      expect(request.ensemble?.includeMembers).toBeUndefined();
      return {
        model: "gefs_0p50",
        windVectorSummaries: [{ kind: "field", field: "wind_10m" }],
      };
    });
    const service = new UnifiedAtmosphereQueryService({
      adapters: { gefs: { query } } as any,
    });

    const wrapped = await service.query({
      dataset: "gefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2026-09-12T06:00:00Z" },
      selection: { fields: ["wind_10m"] },
      ensemble: { quantiles: [0.5] },
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect((wrapped.result as any).windVectorSummaries).toEqual([
      { kind: "field", field: "wind_10m" },
    ]);
  });
});
