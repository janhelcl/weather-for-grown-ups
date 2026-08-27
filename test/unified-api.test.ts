import { describe, expect, it, vi } from "vitest";
import { searchAtmosphereCatalog } from "../src/catalog/unified-search.js";
import {
  UnifiedAtmosphereQueryService,
} from "../src/core/unified-atmosphere-api.js";
import {
  queryAtmosphereSchema,
} from "../src/schema/unified-api.js";

const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };
const selection = {
  variables: ["temperature"],
  pressureLevelsHpa: [850],
};

describe("unified atmospheric public contract", () => {
  it("uses friendly dataset, geometry, time and selection vocabulary", () => {
    expect(queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
    })).toMatchObject({
      dataset: "gfs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
    });

    expect(queryAtmosphereSchema.parse({
      dataset: "gfs-analysis",
      geometry: point,
      time: {
        from: "2017-05-01T00:00:00Z",
        to: "2017-05-07T23:59:59Z",
        hoursUtc: [12],
        maxSteps: 7,
      },
      selection,
    }).time).toMatchObject({ hoursUtc: [12], maxSteps: 7 });
  });

  it("rejects modifiers that do not exist for the selected dataset", () => {
    expect(() => queryAtmosphereSchema.parse({
      dataset: "gfs-analysis",
      geometry: point,
      time: { at: "2017-05-09T12:00:00Z" },
      selection,
      forecast: { run: "latest" },
    })).toThrow("Historical GFS analysis has no forecast initialization");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      ensemble: { quantiles: [0.1, 0.5, 0.9] },
    })).toThrow("ensemble controls are only valid for the gefs dataset");
  });

  it("keeps unsupported geometry/time combinations explicit", () => {
    expect(() => queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: {
        type: "transect",
        start: { latitude: 49, longitude: 13 },
        end: { latitude: 50, longitude: 14 },
      },
      time: {
        from: "2026-08-28T00:00:00Z",
        to: "2026-08-28T12:00:00Z",
      },
      selection,
    })).toThrow("transect queries currently support one valid time");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: {
        type: "area",
        westLongitude: 12,
        eastLongitude: 18,
        southLatitude: 48,
        northLatitude: 51,
      },
      time: { at: "2026-08-28T12:00:00Z" },
      selection: {
        variables: ["temperature", "u_wind"],
        pressureLevelsHpa: [850],
      },
    })).toThrow("Area geometry requires exactly one pressure variable");
  });
});

describe("unified atmospheric routing", () => {
  it("routes the same point operation by dataset without changing the public shape", async () => {
    const gfsProfile = { getProfile: vi.fn(async () => ({ route: "gfs-profile" })) };
    const gefsBundle = { getBundle: vi.fn(async () => ({ route: "gefs-bundle" })) };
    const historyProfile = { getHistoricalProfile: vi.fn(async () => ({ route: "history-profile" })) };
    const historyFields = { getHistoricalFields: vi.fn(async () => ({ route: "history-fields" })) };

    const service = new UnifiedAtmosphereQueryService({
      gfsProfile: gfsProfile as any,
      gefsBundle: gefsBundle as any,
      historyProfile: historyProfile as any,
      historyFields: historyFields as any,
    });

    const base = {
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" as const },
      selection,
    };

    const gfs = await service.query({ dataset: "gfs", ...base });
    expect(gfs.result).toEqual({ route: "gfs-profile" });
    expect(gfsProfile.getProfile).toHaveBeenCalledOnce();

    const gefs = await service.query({
      dataset: "gefs",
      ...base,
      selection: { fields: ["wind_10m"] },
    });
    expect(gefs.result).toEqual({ route: "gefs-bundle" });
    expect(gefsBundle.getBundle).toHaveBeenCalledOnce();

    const historicalPressure = await service.query({
      dataset: "gfs-analysis",
      geometry: point,
      time: { at: "2017-05-09T12:00:00Z" },
      selection,
    });
    expect(historicalPressure.result).toEqual({ route: "history-profile" });

    const historicalMixed = await service.query({
      dataset: "gfs-analysis",
      geometry: point,
      time: { at: "2017-05-09T12:00:00Z" },
      selection: { fields: ["wind_10m"] },
    });
    expect(historicalMixed.result).toEqual({ route: "history-fields" });
  });

  it("routes time range semantics to forecast or analysis implementations", async () => {
    const gfsTimeSeries = { getTimeSeries: vi.fn(async () => ({ route: "gfs-series" })) };
    const gefsTimeSeries = { getTimeSeries: vi.fn(async () => ({ route: "gefs-series" })) };
    const historyTimeSeries = { getHistoricalTimeSeries: vi.fn(async () => ({ route: "history-series" })) };

    const service = new UnifiedAtmosphereQueryService({
      gfsTimeSeries: gfsTimeSeries as any,
      gefsTimeSeries: gefsTimeSeries as any,
      historyTimeSeries: historyTimeSeries as any,
    });

    const range = {
      geometry: point,
      time: {
        from: "2017-05-09T00:00:00Z",
        to: "2017-05-09T18:00:00Z",
      },
      selection,
    };

    expect((await service.query({ dataset: "gfs", ...range })).result).toEqual({ route: "gfs-series" });
    expect((await service.query({ dataset: "gefs", ...range })).result).toEqual({ route: "gefs-series" });
    expect((await service.query({
      dataset: "gfs-analysis",
      ...range,
      time: { ...range.time, hoursUtc: [12] },
    })).result).toEqual({ route: "history-series" });
  });

  it("fails explicitly when a shared operation has a narrower dataset capability", async () => {
    const service = new UnifiedAtmosphereQueryService();
    await expect(service.query({
      dataset: "gfs",
      geometry: {
        type: "transect",
        start: { latitude: 49, longitude: 13 },
        end: { latitude: 50, longitude: 14 },
      },
      time: { at: "2026-08-28T12:00:00Z" },
      selection: { fields: ["temperature_2m"] },
    })).rejects.toThrow("GFS transects currently support pressure-level variables only");
  });
});

describe("unified catalog", () => {
  it("merges canonical matches and exposes dataset support", () => {
    const result = searchAtmosphereCatalog({
      search: "temperature",
      sections: ["variables"],
      limit: 20,
    });
    const temperature = result.matches.find((match) => match.id === "temperature");
    expect(temperature).toBeDefined();
    expect(temperature?.support.map((support) => support.dataset)).toEqual([
      "gfs",
      "gefs",
      "gfs-analysis",
    ]);
  });
});
