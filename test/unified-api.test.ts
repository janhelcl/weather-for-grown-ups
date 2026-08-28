import { describe, expect, it, vi } from "vitest";
import { searchAtmosphereCatalog } from "../src/catalog/unified-search.js";
import {
  UnifiedAtmosphereDiagnosticService,
  UnifiedAtmosphereQueryService,
} from "../src/core/unified-atmosphere-api.js";
import {
  UnifiedAnalogService,
  UnifiedDatasetComparisonService,
  UnifiedForecastVerificationService,
  UnifiedRunComparisonService,
} from "../src/core/unified-specialized-api.js";
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
    })).toThrow("ensemble controls are only valid for ensemble datasets");
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
    const ifsProfile = { getProfile: vi.fn(async () => ({ route: "ifs-profile" })) };
    const ifsEnsBundle = { getBundle: vi.fn(async () => ({ route: "ifs-ens-bundle" })) };
    const historyProfile = { getHistoricalProfile: vi.fn(async () => ({ route: "history-profile" })) };
    const historyFields = { getHistoricalFields: vi.fn(async () => ({ route: "history-fields" })) };

    const service = new UnifiedAtmosphereQueryService({
      gfsProfile: gfsProfile as any,
      gefsBundle: gefsBundle as any,
      ifsProfile: ifsProfile as any,
      ifsEnsBundle: ifsEnsBundle as any,
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

    const ifs = await service.query({
      dataset: "ifs",
      ...base,
      forecast: { run: "latest" },
    });
    expect(ifs.result).toEqual({ route: "ifs-profile" });
    expect(ifs.internalDatasetId).toBe("ifs_0p25");
    expect(ifs.kind).toBe("deterministic");
    expect(ifsProfile.getProfile).toHaveBeenCalledWith(expect.objectContaining({
      run: "latest",
      validTime: "2026-08-28T12:00:00Z",
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    }));

    const ifsEns = await service.query({
      dataset: "ifs-ens",
      ...base,
      ensemble: { members: ["p01", "p50"], quantiles: [0.1, 0.5, 0.9] },
    });
    expect(ifsEns.result).toEqual({ route: "ifs-ens-bundle" });
    expect(ifsEns.internalDatasetId).toBe("ifs_ens_0p25");
    expect(ifsEns.kind).toBe("ensemble");
    expect(ifsEnsBundle.getBundle).toHaveBeenCalledWith(expect.objectContaining({
      run: "latest",
      validTime: "2026-08-28T12:00:00Z",
      members: ["p01", "p50"],
      selection: expect.objectContaining({
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      }),
    }));

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

  it("preserves explicit operational 0.5 identity through the unified wrapper", async () => {
    const gfsProfile = {
      getProfile: vi.fn(async (query: any) => ({
        model: "gfs_0p50",
        route: "gfs-0p50",
        grid: query.grid,
      })),
    };
    const service = new UnifiedAtmosphereQueryService({ gfsProfile: gfsProfile as any });
    const result = await service.query({
      dataset: "gfs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      forecast: { run: "latest", grid: "0p50" },
      source: "s3",
    });
    expect(result.internalDatasetId).toBe("gfs_0p50");
    expect((result.result as any).grid).toBe("0p50");
    expect(gfsProfile.getProfile).toHaveBeenCalledWith(
      expect.objectContaining({ grid: "0p50" }),
    );
  });

  it("preserves explicit 0.25 archive identity through the unified wrapper", async () => {
    const archivedGfs = {
      query: vi.fn(async () => ({
        model: "gfs_0p25_forecast_archive",
        route: "archive-0p25",
      })),
    };
    const service = new UnifiedAtmosphereQueryService({
      archivedGfs: archivedGfs as any,
      now: () => new Date("2026-08-27T12:00:00Z"),
    });
    const result = await service.query({
      dataset: "gfs",
      geometry: point,
      time: { at: "2026-08-24T06:00:00Z" },
      selection,
      forecast: { run: "2026-08-24T00:00:00Z", grid: "0p25" },
      source: "archive",
    });
    expect(result.internalDatasetId).toBe("gfs_0p25_forecast_archive");
    expect((result.result as any).route).toBe("archive-0p25");
  });

  it("routes old explicit GFS runs through the archive without changing dataset=gfs", async () => {
    const gfsProfile = { getProfile: vi.fn(async () => ({ route: "operational-gfs" })) };
    const archivedGfs = {
      query: vi.fn(async () => ({
        model: "gfs_grid4_forecast_0p5_archive",
        route: "archived-gfs",
      })),
    };
    const service = new UnifiedAtmosphereQueryService({
      gfsProfile: gfsProfile as any,
      archivedGfs: archivedGfs as any,
      now: () => new Date("2026-08-27T12:00:00Z"),
    });

    const archived = await service.query({
      dataset: "gfs",
      geometry: point,
      time: { at: "2017-05-09T12:00:00Z" },
      selection,
      forecast: { run: "2017-05-07T12:00:00Z" },
    });
    expect(archived.dataset).toBe("gfs");
    expect(archived.internalDatasetId).toBe("gfs_grid4_forecast_0p5_archive");
    expect(archived.result).toEqual({
      model: "gfs_grid4_forecast_0p5_archive",
      route: "archived-gfs",
    });
    expect(archivedGfs.query).toHaveBeenCalledOnce();
    expect(gfsProfile.getProfile).not.toHaveBeenCalled();

    const recent = await service.query({
      dataset: "gfs",
      geometry: point,
      time: { at: "2026-08-21T12:00:00Z" },
      selection,
      forecast: { run: "2026-08-20T12:00:00Z" },
    });
    expect(recent.internalDatasetId).toBe("gfs_0p25");
    expect(recent.result).toEqual({ route: "operational-gfs" });
  });

  it("routes time range semantics to forecast or analysis implementations", async () => {
    const gfsTimeSeries = { getTimeSeries: vi.fn(async () => ({ route: "gfs-series" })) };
    const gefsTimeSeries = { getTimeSeries: vi.fn(async () => ({ route: "gefs-series" })) };
    const ifsEnsTimeSeries = { getTimeSeries: vi.fn(async () => ({ route: "ifs-ens-series" })) };
    const ifsTimeSeries = { getTimeSeries: vi.fn(async () => ({ route: "ifs-series" })) };
    const historyTimeSeries = { getHistoricalTimeSeries: vi.fn(async () => ({ route: "history-series" })) };

    const service = new UnifiedAtmosphereQueryService({
      gfsTimeSeries: gfsTimeSeries as any,
      gefsTimeSeries: gefsTimeSeries as any,
      ifsEnsTimeSeries: ifsEnsTimeSeries as any,
      ifsTimeSeries: ifsTimeSeries as any,
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
    expect((await service.query({ dataset: "ifs", ...range })).result).toEqual({ route: "ifs-series" });
    expect((await service.query({
      dataset: "ifs-ens",
      ...range,
      ensemble: { members: ["p01", "p50"], quantiles: [0.1, 0.5, 0.9] },
    })).result).toEqual({ route: "ifs-ens-series" });
    expect(ifsEnsTimeSeries.getTimeSeries).toHaveBeenCalledWith(expect.objectContaining({
      members: ["p01", "p50"],
      startTime: range.time.from,
      endTime: range.time.to,
    }));
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
      "ifs",
      "ifs-ens",
      "gfs-analysis",
    ]);
  });
});


describe("unified catalog branch coverage", () => {
  it("supports GEFS-only search without a GFS representative", () => {
    const result = searchAtmosphereCatalog({
      datasets: ["gefs"],
      sections: ["variables"],
      search: "temp",
      limit: 5,
    });

    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.every((match) =>
      match.support.every((support) => support.dataset === "gefs"))).toBe(true);
  });

  it("discovers IFS canonical pressure and field support", () => {
    const pressure = searchAtmosphereCatalog({
      datasets: ["ifs"],
      sections: ["variables"],
      search: "temperature",
      limit: 10,
    });
    expect(pressure.matches.find((match) => match.id === "temperature")?.support)
      .toEqual([{ dataset: "ifs", semantics: "deterministic ECMWF IFS 0.25° operational forecast" }]);

    const fields = searchAtmosphereCatalog({
      datasets: ["ifs"],
      sections: ["fields"],
      search: "wind 10m",
      limit: 10,
    });
    expect(fields.matches.some((match) => match.id === "wind_10m")).toBe(true);
  });

  it("filters historical instantaneous raw fields and truncates deterministically", () => {
    const result = searchAtmosphereCatalog({
      datasets: ["gfs-analysis"],
      sections: ["fields"],
      classification: "raw",
      temporalSemantics: "instantaneous",
      limit: 1,
    });

    expect(result.totalMatches).toBeGreaterThan(1);
    expect(result.truncated).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.support[0]?.dataset).toBe("gfs-analysis");
  });

  it("returns zero matches for an impossible unified search", () => {
    const result = searchAtmosphereCatalog({
      datasets: ["gfs", "gefs", "ifs", "gfs-analysis"],
      search: "definitely impossible atmospheric token",
    });

    expect(result.totalMatches).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.matches).toEqual([]);
  });
});

describe("unified specialized operations", () => {
  it("keeps compare-runs dataset-aware while delegating to native semantics", async () => {
    const gfs = { compareRuns: vi.fn(async (query) => ({ route: "gfs-runs", query })) };
    const gefs = { compareRuns: vi.fn(async (query) => ({ route: "gefs-runs", query })) };
    const ifs = { compareRuns: vi.fn(async (query) => ({ route: "ifs-runs", query })) };
    const service = new UnifiedRunComparisonService(gfs as any, gefs as any, ifs as any);

    const gfsResult = await service.compare({
      dataset: "gfs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      cycles: 3,
    });
    expect((gfsResult.result as any).route).toBe("gfs-runs");
    expect(gfs.compareRuns).toHaveBeenCalledOnce();

    const gefsResult = await service.compare({
      dataset: "gefs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      cycles: 3,
    });
    expect((gefsResult.result as any).route).toBe("gefs-runs");
    expect(gefs.compareRuns).toHaveBeenCalledOnce();

    const ifsResult = await service.compare({
      dataset: "ifs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: {
        variables: ["temperature", "wind"],
        pressureLevelsHpa: [850],
        fields: ["wind_10m"],
      },
      cycles: 2,
    });
    expect((ifsResult.result as any).route).toBe("ifs-runs");
    expect(ifs.compareRuns).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["temperature", "wind"],
      pressureLevelsHpa: [850],
      fields: ["wind_10m"],
      cycles: 2,
    }));
  });

  it("rejects a GFS grid selector on GEFS run comparison", async () => {
    const service = new UnifiedRunComparisonService(
      { compareRuns: vi.fn() } as any,
      { compareRuns: vi.fn() } as any,
    );
    await expect(service.compare({
      dataset: "gefs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      gfsGrid: "0p50",
      cycles: 2,
    })).rejects.toThrow("gfsGrid is only valid for GFS run comparison");
  });

  it("rejects ensemble controls on deterministic GFS run comparison", async () => {
    const service = new UnifiedRunComparisonService(
      { compareRuns: vi.fn() } as any,
      { compareRuns: vi.fn() } as any,
    );
    await expect(service.compare({
      dataset: "gfs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      ensemble: { members: ["c00", "p01"] },
    })).rejects.toThrow("ensemble controls are only valid for gefs");
  });

  it("rejects GEFS run comparison selections outside one raw pressure variable", async () => {
    const service = new UnifiedRunComparisonService(
      { compareRuns: vi.fn() } as any,
      { compareRuns: vi.fn() } as any,
    );

    await expect(service.compare({
      dataset: "gefs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: { fields: ["temperature_2m"] },
    })).rejects.toThrow(
      "GEFS run comparison currently requires exactly one raw pressure variable at one pressure level",
    );

    await expect(service.compare({
      dataset: "gefs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: {
        variables: ["temperature", "u_wind"],
        pressureLevelsHpa: [850],
      },
    })).rejects.toThrow(
      "GEFS run comparison currently requires exactly one raw pressure variable at one pressure level",
    );
  });

  it("passes explicit GEFS comparison controls without member-trajectory semantics", async () => {
    const gfs = { compareRuns: vi.fn() };
    const gefs = { compareRuns: vi.fn(async (query) => ({ route: "gefs-runs", query })) };
    const service = new UnifiedRunComparisonService(gfs as any, gefs as any);

    const result = await service.compare({
      dataset: "gefs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      anchorRun: "2026-08-27T12:00:00Z",
      cycles: 4,
      ensemble: {
        members: ["c00", "p01"],
        quantiles: [0.1, 0.9],
      },
      thresholdGte: 5,
    });

    expect((result.result as any).route).toBe("gefs-runs");
    expect(gefs.compareRuns).toHaveBeenCalledWith(expect.objectContaining({
      members: ["c00", "p01"],
      quantiles: [0.1, 0.9],
      thresholdGte: 5,
      cycles: 4,
    }));
  });

  it("rejects member payload controls on GEFS run comparison", async () => {
    const service = new UnifiedRunComparisonService(
      { compareRuns: vi.fn() } as any,
      { compareRuns: vi.fn() } as any,
    );

    await expect(service.compare({
      dataset: "gefs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      ensemble: {
        quantiles: [0.1, 0.9],
        includeMembers: true,
      },
    })).rejects.toThrow("includeMembers/maxMemberSamples are not applicable");

    await expect(service.compare({
      dataset: "gefs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      ensemble: {
        quantiles: [0.1, 0.9],
        maxMemberSamples: 100,
      },
    })).rejects.toThrow("includeMembers/maxMemberSamples are not applicable");
  });

  it("passes optional GFS fields and cross-dataset member controls", async () => {
    const gfs = { compareRuns: vi.fn(async (query) => ({ route: "gfs-runs", query })) };
    const runService = new UnifiedRunComparisonService(gfs as any, { compareRuns: vi.fn() } as any);

    await runService.compare({
      dataset: "gfs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      gfsGrid: "0p50",
      cycles: 2,
    });
    expect(gfs.compareRuns).toHaveBeenCalledWith(expect.objectContaining({
      fields: ["temperature_2m"],
      grid: "0p50",
      cycles: 2,
    }));

    const compare = { compare: vi.fn(async (query) => ({ route: "dataset-compare", query })) };
    const datasetService = new UnifiedDatasetComparisonService(compare as any);
    await datasetService.compare({
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
      gfsGrid: "0p50",
      members: ["c00", "p01"],
      quantiles: [0.25, 0.75],
    });
    expect(compare.compare).toHaveBeenCalledWith(expect.objectContaining({
      gfsGrid: "0p50",
      members: ["c00", "p01"],
      quantiles: [0.25, 0.75],
    }));
  });

  it("rejects historical verification leads off the native six-hour analysis cadence", async () => {
    const service = new UnifiedForecastVerificationService({ verify: vi.fn() } as any);
    await expect(service.verify({
      geometry: point,
      time: { at: "2017-05-09T12:00:00Z" },
      leadHours: 5,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    })).rejects.toThrow("leadHours must be a multiple of 6");
  });

  it("maps generic dataset comparison, verification and analog operations to existing primitives", async () => {
    const compare = { compare: vi.fn(async (query) => ({ route: "dataset-compare", query })) };
    const verify = { verify: vi.fn(async (query) => ({ route: "verify", query })) };
    const analog = { findAnalogs: vi.fn(async (query) => ({ route: "analogs", query })) };

    const compared = await new UnifiedDatasetComparisonService(compare as any).compare({
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
    });
    expect((compared.result as any).route).toBe("dataset-compare");
    expect(compare.compare).toHaveBeenCalledWith(expect.objectContaining({
      validTime: "2026-08-28T12:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
    }));

    const verified = await new UnifiedForecastVerificationService(verify as any).verify({
      geometry: point,
      time: { at: "2019-12-26T18:00:00Z" },
      leadHours: 54,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });
    expect((verified.result as any).route).toBe("verify");
    expect(verify.verify).toHaveBeenCalledWith(expect.objectContaining({
      validTime: "2019-12-26T18:00:00Z",
      leadHours: 54,
    }));

    const analogs = await new UnifiedAnalogService(analog as any).find({
      geometry: point,
      time: { at: "2017-05-09T12:00:00Z" },
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });
    expect((analogs.result as any).route).toBe("analogs");
    expect(analog.findAnalogs).toHaveBeenCalledWith(expect.objectContaining({
      targetTime: "2017-05-09T12:00:00Z",
    }));
  });
});


describe("unified geometry routing coverage", () => {
  it("routes multi-point instant and range queries across all datasets", async () => {
    const gfsPoints = { getPoints: vi.fn(async () => ({ route: "gfs-points" })) };
    const gefsPoints = { getPoints: vi.fn(async () => ({ route: "gefs-points" })) };
    const ifsPoints = { getPoints: vi.fn(async () => ({ route: "ifs-points" })) };
    const historyPoints = { getPoints: vi.fn(async () => ({ route: "history-points" })) };
    const gfsPointsTimeSeries = { getPointsTimeSeries: vi.fn(async () => ({ route: "gfs-points-series" })) };
    const gefsPointsTimeSeries = { getPointsTimeSeries: vi.fn(async () => ({ route: "gefs-points-series" })) };
    const ifsPointsTimeSeries = { getPointsTimeSeries: vi.fn(async () => ({ route: "ifs-points-series" })) };
    const historyPointsTimeSeries = { getPointsTimeSeries: vi.fn(async () => ({ route: "history-points-series" })) };
    const service = new UnifiedAtmosphereQueryService({
      gfsPoints: gfsPoints as any,
      gefsPoints: gefsPoints as any,
      ifsPoints: ifsPoints as any,
      historyPoints: historyPoints as any,
      gfsPointsTimeSeries: gfsPointsTimeSeries as any,
      gefsPointsTimeSeries: gefsPointsTimeSeries as any,
      ifsPointsTimeSeries: ifsPointsTimeSeries as any,
      historyPointsTimeSeries: historyPointsTimeSeries as any,
    });

    const geometry = {
      type: "points" as const,
      points: [
        { latitude: 50.08, longitude: 14.43 },
        { latitude: 49.20, longitude: 16.61 },
      ],
    };
    const instant = { at: "2026-08-28T12:00:00Z" };

    expect((await service.query({ dataset: "gfs", geometry, time: instant, selection })).result)
      .toEqual({ route: "gfs-points" });
    expect((await service.query({ dataset: "gefs", geometry, time: instant, selection })).result)
      .toEqual({ route: "gefs-points" });
    expect((await service.query({ dataset: "ifs", geometry, time: instant, selection })).result)
      .toEqual({ route: "ifs-points" });
    expect((await service.query({
      dataset: "gfs-analysis",
      geometry,
      time: { at: "2017-05-09T12:00:00Z" },
      selection,
    })).result).toEqual({ route: "history-points" });

    const range = {
      from: "2026-08-28T00:00:00Z",
      to: "2026-08-28T12:00:00Z",
      maxSteps: 5,
    };
    expect((await service.query({
      dataset: "gfs",
      geometry,
      time: range,
      selection,
      limits: { maxSamples: 10 },
    })).result).toEqual({ route: "gfs-points-series" });
    expect((await service.query({
      dataset: "gefs",
      geometry,
      time: range,
      selection,
      ensemble: { quantiles: [0.1, 0.5, 0.9], maxMemberSamples: 100 },
      limits: { maxPointSteps: 10 },
    })).result).toEqual({ route: "gefs-points-series" });
    expect((await service.query({
      dataset: "ifs",
      geometry,
      time: range,
      selection,
      limits: { maxPointSteps: 10 },
    })).result).toEqual({ route: "ifs-points-series" });
    expect((await service.query({
      dataset: "gfs-analysis",
      geometry,
      time: {
        from: "2017-05-09T00:00:00Z",
        to: "2017-05-09T18:00:00Z",
        hoursUtc: [0, 12],
        maxSteps: 2,
      },
      selection,
      limits: { maxPointSteps: 10 },
    })).result).toEqual({ route: "history-points-series" });
  });

  it("routes transects through dataset-native implementations", async () => {
    const gfsTransect = { getTransect: vi.fn(async () => ({ route: "gfs-transect" })) };
    const gefsTransect = { getTransect: vi.fn(async () => ({ route: "gefs-transect" })) };
    const ifsTransect = { getTransect: vi.fn(async () => ({ route: "ifs-transect" })) };
    const historyTransect = { getTransect: vi.fn(async () => ({ route: "history-transect" })) };
    const service = new UnifiedAtmosphereQueryService({
      gfsTransect: gfsTransect as any,
      gefsTransect: gefsTransect as any,
      ifsTransect: ifsTransect as any,
      historyTransect: historyTransect as any,
    });
    const geometry = {
      type: "transect" as const,
      start: { latitude: 49.5, longitude: 14.0 },
      end: { latitude: 50.0, longitude: 15.0 },
      samples: 5,
    };

    expect((await service.query({
      dataset: "gfs",
      geometry,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
    })).result).toEqual({ route: "gfs-transect" });

    expect((await service.query({
      dataset: "gefs",
      geometry,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: { fields: ["wind_10m"] },
      ensemble: { quantiles: [0.1, 0.5, 0.9], includeMembers: false, maxMemberSamples: 100 },
    })).result).toEqual({ route: "gefs-transect" });

    expect((await service.query({
      dataset: "ifs",
      geometry,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: { fields: ["wind_10m"] },
    })).result).toEqual({ route: "ifs-transect" });

    expect((await service.query({
      dataset: "gfs-analysis",
      geometry,
      time: { at: "2017-05-09T12:00:00Z" },
      selection: { fields: ["wind_10m"] },
    })).result).toEqual({ route: "history-transect" });
  });

  it("routes scalar area summaries with shared aggregation controls", async () => {
    const gfsArea = { summarize: vi.fn(async () => ({ route: "gfs-area" })) };
    const gefsArea = { summarize: vi.fn(async () => ({ route: "gefs-area" })) };
    const ifsArea = { summarize: vi.fn(async () => ({ route: "ifs-area" })) };
    const historyArea = { summarize: vi.fn(async () => ({ route: "history-area" })) };
    const service = new UnifiedAtmosphereQueryService({
      gfsArea: gfsArea as any,
      gefsArea: gefsArea as any,
      ifsArea: ifsArea as any,
      historyArea: historyArea as any,
    });
    const geometry = {
      type: "area" as const,
      westLongitude: 14,
      eastLongitude: 14.5,
      southLatitude: 49.75,
      northLatitude: 50.25,
    };
    const aggregate = {
      percentiles: [10, 50, 90],
      thresholds: [{ operator: "gte" as const, value: 0 }],
      includeExtremaLocations: true,
    };

    expect((await service.query({
      dataset: "gfs",
      geometry,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      aggregate,
      limits: { maxGridPoints: 1000 },
    })).result).toEqual({ route: "gfs-area" });

    expect((await service.query({
      dataset: "gefs",
      geometry,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      aggregate,
      ensemble: { quantiles: [0.1, 0.5, 0.9] },
      limits: { maxGridPoints: 1000, maxMemberGridPoints: 30000 },
    })).result).toEqual({ route: "gefs-area" });

    expect((await service.query({
      dataset: "ifs",
      geometry,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      aggregate,
      forecast: { run: "latest" },
      limits: { maxGridPoints: 1000 },
    })).result).toEqual({ route: "ifs-area" });
    expect(ifsArea.summarize).toHaveBeenCalledWith(expect.objectContaining({
      run: "latest",
      validTime: "2026-08-28T12:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      percentiles: [10, 50, 90],
      maxGridPoints: 1000,
    }));

    expect((await service.query({
      dataset: "gfs-analysis",
      geometry,
      time: { at: "2017-05-09T12:00:00Z" },
      selection,
      aggregate,
      limits: { maxGridPoints: 1000 },
    })).result).toEqual({ route: "history-area" });
  });
});

describe("unified archived forecast diagnostic routing", () => {
  it("keeps dataset=gfs while routing old explicit runs to archived diagnostics", async () => {
    const operational = { getLayerDiagnostics: vi.fn(async () => ({ route: "operational" })) };
    const archivedGfs = {
      diagnose: vi.fn(async () => ({
        model: "gfs_grid4_forecast_0p5_archive",
        route: "archive-diagnostic",
      })),
    };
    const service = new UnifiedAtmosphereDiagnosticService({
      layer: operational as any,
      archivedGfs: archivedGfs as any,
      now: () => new Date("2026-08-27T12:00:00Z"),
    });

    const archived = await service.diagnose({
      dataset: "gfs",
      geometry: point,
      time: { at: "2017-05-09T12:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear"],
      },
      forecast: { run: "2017-05-07T12:00:00Z" },
    });
    expect(archived.dataset).toBe("gfs");
    expect(archived.internalDatasetId).toBe("gfs_grid4_forecast_0p5_archive");
    expect(archived.result).toEqual({
      model: "gfs_grid4_forecast_0p5_archive",
      route: "archive-diagnostic",
    });
    expect(archivedGfs.diagnose).toHaveBeenCalledOnce();
    expect(operational.getLayerDiagnostics).not.toHaveBeenCalled();

    await service.diagnose({
      dataset: "gfs",
      geometry: point,
      time: { at: "2026-08-21T12:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear"],
      },
      forecast: { run: "2026-08-20T12:00:00Z" },
    });
    expect(operational.getLayerDiagnostics).toHaveBeenCalledOnce();
  });
});

describe("unified diagnostic routing coverage", () => {
  it("routes instant layer, profile and parcel diagnostics", async () => {
    const layer = { getLayerDiagnostics: vi.fn(async () => ({ route: "layer" })) };
    const profile = { getProfileDiagnostics: vi.fn(async () => ({ route: "profile" })) };
    const parcel = { getParcelDiagnostics: vi.fn(async () => ({ route: "parcel" })) };
    const ifsEns = {
      getLayerDiagnostics: vi.fn(async () => ({ route: "ifs-ens-layer" })),
      getProfileDiagnostics: vi.fn(async () => ({ route: "ifs-ens-profile" })),
      getParcelDiagnostics: vi.fn(async () => ({ route: "ifs-ens-parcel" })),
    };
    const timeSeries = { getDiagnosticTimeSeries: vi.fn(async () => ({ route: "series" })) };
    const service = new UnifiedAtmosphereDiagnosticService({
      layer: layer as any,
      profile: profile as any,
      parcel: parcel as any,
      ifsEns: ifsEns as any,
      timeSeries: timeSeries as any,
    });

    expect((await service.diagnose({
      dataset: "gfs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear"],
      },
      forecast: { run: "latest" },
      source: "s3",
    })).result).toEqual({ route: "layer" });

    expect((await service.diagnose({
      dataset: "gefs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 850, 700, 500],
        diagnostics: ["freezing_level_crossings"],
      },
      ensemble: { quantiles: [0.1, 0.5, 0.9], includeMembers: true },
    })).result).toEqual({ route: "profile" });

    expect((await service.diagnose({
      dataset: "ifs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear"],
      },
      forecast: { run: "latest" },
    })).result).toEqual({ route: "layer" });

    expect((await service.diagnose({
      dataset: "ifs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [925, 850, 700, 500],
        diagnostics: ["freezing_level_crossings"],
      },
      forecast: { run: "latest" },
    })).result).toEqual({ route: "profile" });

    expect((await service.diagnose({
      dataset: "ifs-ens",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear"],
      },
      ensemble: { members: ["p01", "p50"], quantiles: [0.1, 0.9], includeMembers: true },
    })).result).toEqual({ route: "ifs-ens-layer" });

    expect((await service.diagnose({
      dataset: "ifs-ens",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [925, 850, 700, 500],
        diagnostics: ["freezing_level_crossings"],
      },
      ensemble: { members: ["p01", "p50"] },
    })).result).toEqual({ route: "ifs-ens-profile" });

    expect((await service.diagnose({
      dataset: "ifs-ens",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [925, 850, 700, 500],
        parcel: "surface_2m",
      },
      ensemble: { members: ["p01", "p50"] },
    })).result).toEqual({ route: "ifs-ens-parcel" });

    expect((await service.diagnose({
      dataset: "gfs-analysis",
      geometry: point,
      time: { at: "2017-05-09T12:00:00Z" },
      diagnostic: {
        kind: "parcel",
        pressureLevelsHpa: [1000, 925, 850, 700, 500, 300],
        parcel: "surface_2m",
      },
    })).result).toEqual({ route: "parcel" });

    expect(layer.getLayerDiagnostics).toHaveBeenCalledWith(expect.objectContaining({ model: "gfs_0p25" }));
    expect(profile.getProfileDiagnostics).toHaveBeenCalledWith(expect.objectContaining({ model: "gefs_0p50" }));
    expect(layer.getLayerDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      model: "ifs_0p25",
      query: expect.objectContaining({ run: "latest", validTime: "2026-08-28T12:00:00Z" }),
    }));
    expect(profile.getProfileDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      model: "ifs_0p25",
      query: expect.objectContaining({ run: "latest", validTime: "2026-08-28T12:00:00Z" }),
    }));
    expect(parcel.getParcelDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      model: "gfs_grid4_analysis_0p5",
    }));
    expect(ifsEns.getLayerDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      run: "latest",
      validTime: "2026-08-28T12:00:00Z",
      members: ["p01", "p50"],
      quantiles: [0.1, 0.9],
      includeMembers: true,
    }));
    expect(ifsEns.getProfileDiagnostics).toHaveBeenCalledOnce();
    expect(ifsEns.getParcelDiagnostics).toHaveBeenCalledOnce();
  });

  it("routes diagnostic ranges while preserving dataset time semantics", async () => {
    const timeSeries = { getDiagnosticTimeSeries: vi.fn(async (input) => ({ route: input.model })) };
    const service = new UnifiedAtmosphereDiagnosticService({ timeSeries: timeSeries as any });
    const diagnostic = {
      kind: "layer" as const,
      lowerPressureHpa: 850,
      upperPressureHpa: 500,
      diagnostics: ["wind_shear" as const],
    };

    expect((await service.diagnose({
      dataset: "gfs",
      geometry: point,
      time: {
        from: "2026-08-28T00:00:00Z",
        to: "2026-08-28T12:00:00Z",
        maxSteps: 5,
      },
      diagnostic,
      forecast: { run: "latest" },
      source: "s3",
    })).result).toEqual({ route: "gfs_0p25" });

    expect((await service.diagnose({
      dataset: "gefs",
      geometry: point,
      time: {
        from: "2026-08-28T00:00:00Z",
        to: "2026-08-28T12:00:00Z",
        maxSteps: 5,
      },
      diagnostic,
      ensemble: { members: ["c00", "p01"], quantiles: [0.1, 0.9] },
    })).result).toEqual({ route: "gefs_0p50" });

    expect((await service.diagnose({
      dataset: "ifs",
      geometry: point,
      time: {
        from: "2026-08-28T00:00:00Z",
        to: "2026-08-28T12:00:00Z",
        maxSteps: 5,
      },
      diagnostic,
      forecast: { run: "latest" },
    })).result).toEqual({ route: "ifs_0p25" });

    expect((await service.diagnose({
      dataset: "gfs-analysis",
      geometry: point,
      time: {
        from: "2017-05-09T00:00:00Z",
        to: "2017-05-09T18:00:00Z",
        hoursUtc: [0, 12],
        maxSteps: 2,
      },
      diagnostic,
    })).result).toEqual({ route: "gfs_grid4_analysis_0p5" });

    expect(timeSeries.getDiagnosticTimeSeries).toHaveBeenCalledTimes(4);
    expect(timeSeries.getDiagnosticTimeSeries).toHaveBeenCalledWith(expect.objectContaining({
      model: "ifs_0p25",
      query: expect.objectContaining({
        run: "latest",
        startTime: "2026-08-28T00:00:00Z",
        endTime: "2026-08-28T12:00:00Z",
      }),
    }));
  });
});
