import { describe, expect, it, vi } from "vitest";
import { HgefsForecastService } from "../src/core/hgefs.js";
import {
  diagnoseAtmosphereSchema,
  queryAtmosphereSchema,
} from "../src/schema/unified-api.js";

const run = "2026-08-31T00:00:00.000Z";
const validTime = "2026-08-31T06:00:00.000Z";
const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };

function serviceWith(
  aigefsQuery: any,
  gefsQuery: any,
  options: Record<string, unknown> = {},
) {
  return new HgefsForecastService({
    aigefs: {
      query: aigefsQuery,
      diagnose: (options.aigefsDiagnose as any) ?? vi.fn(),
    } as any,
    gefsQuery: { query: gefsQuery },
    gefsDiagnostics: {
      diagnose: (options.gefsDiagnose as any) ?? vi.fn(),
    },
    ...(options.runProvider === undefined ? {} : { runProvider: options.runProvider as any }),
    stepConcurrency: 1,
  });
}

describe("HGEFS population subsets and defaults", () => {
  it("uses the complete 62-member population and default quantiles when ensemble controls are omitted", async () => {
    const aigefsQuery = vi.fn(async (request: any) => ({
      model: "aigefs_0p25",
      run,
      validTime,
      forecastHour: 6,
      gridPoint: { latitude: 50, longitude: 14.5 },
      members: request.ensemble.members.map((member: string, index: number) => ({
        member,
        cacheHit: true,
        levels: [{ pressureHpa: 850, temperatureC: 10 + index / 10 }],
      })),
      source: { allCacheHit: true },
    }));
    const gefsQuery = vi.fn(async (request: any) => ({
      model: "gefs_0p50",
      run,
      validTime,
      forecastHour: 6,
      gridPoint: { latitude: 50, longitude: 14 },
      members: request.ensemble.members.map((member: string, index: number) => ({
        member,
        cacheHit: true,
        pressureValues: [{
          variable: "temperature",
          pressureLevelHpa: 850,
          value: 8 + index / 10,
        }],
        fields: [],
      })),
      source: { allCacheHit: true },
    }));

    const result = await serviceWith(aigefsQuery, gefsQuery).query(
      queryAtmosphereSchema.parse({
        dataset: "hgefs",
        geometry: point,
        time: { at: validTime },
        selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
        forecast: { run },
      }),
    ) as any;

    expect(result.selection.members).toHaveLength(62);
    expect(result.selection.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(result.pressureSummaries[0].distribution.memberCount).toBe(62);
    expect(aigefsQuery.mock.calls[0][0].ensemble.members).toHaveLength(31);
    expect(gefsQuery.mock.calls[0][0].ensemble.members).toHaveLength(31);
  });

  it("supports a GEFS-only subset, field-only selection and member-derived cache provenance", async () => {
    const aigefsQuery = vi.fn();
    const accumulation = {
      type: "accumulation" as const,
      startForecastHour: 0,
      endForecastHour: 6,
      startTime: run,
      endTime: validTime,
    };
    const gefsQuery = vi.fn(async (request: any) => ({
      model: "gefs_0p50",
      run,
      validTime,
      forecastHour: 6,
      gridPoint: { latitude: 50, longitude: 14 },
      members: request.ensemble.members.map((member: string, index: number) => ({
        member,
        cacheHit: true,
        pressureValues: [],
        fields: [
          {
            field: "total_precipitation",
            temporal: accumulation,
            values: { totalPrecipitationMm: 2 + index },
          },
          {
            field: "mean_sea_level_pressure",
            temporal: { type: "instantaneous" },
            values: { pressurePa: 101000 + index * 100 },
          },
        ],
      })),
      source: {},
    }));

    const result = await serviceWith(aigefsQuery, gefsQuery).query(
      queryAtmosphereSchema.parse({
        dataset: "hgefs",
        geometry: point,
        time: { at: validTime },
        selection: {
          fields: ["total_precipitation", "mean_sea_level_pressure"],
        },
        forecast: { run },
        ensemble: {
          members: ["gefs:c00", "gefs:p01"],
          includeMembers: true,
        },
      }),
    ) as any;

    expect(aigefsQuery).not.toHaveBeenCalled();
    expect(result.selection.populations).toEqual([
      { population: "gefs", modelClass: "physics", selectedMemberCount: 2 },
    ]);
    expect(result.constituentGridPoints).toHaveLength(1);
    expect(result.fieldSummaries).toHaveLength(2);
    expect(result.members).toHaveLength(2);
    expect(result.source.allCacheHit).toBe(true);
    expect(gefsQuery.mock.calls[0][0].selection.variables).toBeUndefined();
  });

  it("supports an AIGEFS-only pressure subset and resolves latest from pressure inventory", async () => {
    const runProvider = {
      resolveLatestRun: vi.fn(async () => new Date(run)),
    };
    const aigefsQuery = vi.fn(async (request: any) => ({
      model: "aigefs_0p25",
      run,
      validTime,
      forecastHour: 6,
      gridPoint: { latitude: 50, longitude: 14.5 },
      members: request.ensemble.members.map((member: string, index: number) => ({
        member,
        cacheHit: false,
        levels: [{
          pressureHpa: 850,
          uWindMs: 3,
          vWindMs: index === 0 ? 4 : -4,
          windSpeedMs: 5,
          windDirectionDeg: index === 0 ? 216.86989764584402 : 323.13010235415595,
        }],
      })),
      source: { cacheHit: false },
    }));
    const gefsQuery = vi.fn();

    const result = await serviceWith(aigefsQuery, gefsQuery, { runProvider }).query(
      queryAtmosphereSchema.parse({
        dataset: "hgefs",
        geometry: point,
        time: { at: validTime },
        selection: { variables: ["wind"], pressureLevelsHpa: [850] },
        forecast: { run: "latest" },
        ensemble: {
          members: ["aigefs:c00", "aigefs:p01"],
          quantiles: [0.5],
        },
      }),
    ) as any;

    expect(gefsQuery).not.toHaveBeenCalled();
    expect(runProvider.resolveLatestRun).toHaveBeenCalledWith(expect.objectContaining({
      type: "valid_time",
      products: { pressure: true, surface: false },
    }));
    expect(result.selection.populations).toEqual([
      { population: "aigefs", modelClass: "ai", selectedMemberCount: 2 },
    ]);
    expect(result.pressureSummaries.find((summary: any) =>
      summary.field === "windDirectionDeg")).toMatchObject({
        aggregation: "circular_direction",
        memberCount: 2,
      });
    expect(result.source.allCacheHit).toBe(false);
  });
});

describe("HGEFS latest-range diagnostics and guardrails", () => {
  it("resolves a latest diagnostic range once and returns compact layer summaries", async () => {
    const runProvider = {
      resolveLatestRun: vi.fn(async () => new Date(run)),
    };
    const gefsDiagnose = vi.fn(async (request: any) => ({
      model: "gefs_0p50",
      run,
      validTime: request.time.at,
      forecastHour: (new Date(request.time.at).getTime() - new Date(run).getTime()) / 3_600_000,
      gridPoint: { latitude: 50, longitude: 14 },
      members: request.ensemble.members.map((member: string, index: number) => ({
        member,
        cacheHit: true,
        layer: {
          lowerPressureHpa: 850,
          upperPressureHpa: 700,
          lowerGeopotentialHeightGpm: 1500,
          upperGeopotentialHeightGpm: 3000 + index * 100,
          depthGpm: 1500 + index * 100,
        },
        diagnostics: [{
          id: "temperature_lapse_rate",
          values: { temperatureLapseRateCPerKm: 6 + index },
        }],
      })),
      source: { allCacheHit: true },
    }));

    const service = serviceWith(vi.fn(), vi.fn(), { runProvider, gefsDiagnose });
    const result = await service.diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: point,
      time: {
        from: "2026-08-31T06:00:00.000Z",
        to: "2026-08-31T12:00:00.000Z",
      },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 700,
        diagnostics: ["temperature_lapse_rate"],
      },
      forecast: { run: "latest" },
      ensemble: {
        members: ["gefs:c00", "gefs:p01"],
        quantiles: [0.5],
      },
    })) as any;

    expect(runProvider.resolveLatestRun).toHaveBeenCalledTimes(1);
    expect(runProvider.resolveLatestRun).toHaveBeenCalledWith(expect.objectContaining({
      type: "time_range",
      products: { pressure: true, surface: false },
    }));
    expect(result.series.map((step: any) => step.kind)).toEqual(["layer", "layer"]);
    expect(result.constituentGridPoints).toEqual([{
      population: "gefs",
      modelClass: "physics",
      gridPoint: { latitude: 50, longitude: 14 },
    }]);
  });

  it("rejects invalid service-level dataset, member, selector and horizon inputs before data access", async () => {
    const aigefsQuery = vi.fn();
    const gefsQuery = vi.fn();
    const service = serviceWith(aigefsQuery, gefsQuery);

    const base = {
      dataset: "hgefs",
      geometry: point,
      time: { at: validTime },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run },
      ensemble: { members: ["gefs:c00", "aigefs:c00"] },
    } as any;

    await expect(service.query({ ...base, dataset: "gefs" }))
      .rejects.toThrow("only accepts dataset=hgefs");
    await expect(service.query({
      ...base,
      ensemble: { members: ["gefs:c00"] },
    })).rejects.toThrow("at least two selected members");
    await expect(service.query({
      ...base,
      ensemble: { members: ["gefs:c00", "aigefs:not-a-member"] },
    })).rejects.toThrow("unsupported");
    await expect(service.query({
      ...base,
      forecast: { run: "latest_complete" },
    })).rejects.toThrow("supports latest or an explicit run");
    await expect(service.query({
      ...base,
      time: { at: "2026-09-10T06:00:00.000Z" },
    })).rejects.toThrow("at most 240");

    expect(aigefsQuery).not.toHaveBeenCalled();
    expect(gefsQuery).not.toHaveBeenCalled();
  });

  it("rejects direct diagnostic misuse before constituent access", async () => {
    const aigefsDiagnose = vi.fn();
    const gefsDiagnose = vi.fn();
    const service = serviceWith(vi.fn(), vi.fn(), { aigefsDiagnose, gefsDiagnose });

    const profile = {
      dataset: "hgefs",
      geometry: point,
      time: { at: validTime },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [850, 700],
        diagnostics: ["freezing_level_crossings"],
      },
      forecast: { run },
      ensemble: { members: ["gefs:c00", "aigefs:c00"] },
    } as any;

    await expect(service.diagnose({ ...profile, dataset: "gefs" }))
      .rejects.toThrow("only accepts dataset=hgefs");
    await expect(service.diagnose({
      ...profile,
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [1000, 925, 850],
        parcel: "surface_2m",
      },
    })).rejects.toThrow("does not expose parcel diagnostics");

    expect(aigefsDiagnose).not.toHaveBeenCalled();
    expect(gefsDiagnose).not.toHaveBeenCalled();
  });

  it("detects constituent run and valid-time drift explicitly", async () => {
    const goodAigefs = vi.fn(async () => ({
      model: "aigefs_0p25",
      run,
      validTime,
      forecastHour: 6,
      gridPoint: { latitude: 50, longitude: 14.5 },
      members: [
        { member: "c00", levels: [{ pressureHpa: 850, temperatureC: 10 }] },
        { member: "p01", levels: [{ pressureHpa: 850, temperatureC: 11 }] },
      ],
      source: { allCacheHit: true },
    }));
    const badRunGefs = vi.fn(async () => ({
      model: "gefs_0p50",
      run: "2026-08-30T18:00:00.000Z",
      validTime,
      forecastHour: 12,
      gridPoint: { latitude: 50, longitude: 14 },
      members: [
        { member: "c00", pressureValues: [{ variable: "temperature", pressureLevelHpa: 850, value: 9 }], fields: [] },
        { member: "p01", pressureValues: [{ variable: "temperature", pressureLevelHpa: 850, value: 10 }], fields: [] },
      ],
      source: { allCacheHit: true },
    }));
    const request = queryAtmosphereSchema.parse({
      dataset: "hgefs",
      geometry: point,
      time: { at: validTime },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
      forecast: { run },
      ensemble: {
        members: ["gefs:c00", "gefs:p01", "aigefs:c00", "aigefs:p01"],
      },
    });

    await expect(serviceWith(goodAigefs, badRunGefs).query(request))
      .rejects.toThrow("drifted from the common initialization cycle");

    const badTimeGefs = vi.fn(async () => ({
      ...(await badRunGefs()),
      run,
      validTime: "2026-08-31T12:00:00.000Z",
    }));
    await expect(serviceWith(goodAigefs, badTimeGefs).query(request))
      .rejects.toThrow("inconsistent valid time");
  });
});
