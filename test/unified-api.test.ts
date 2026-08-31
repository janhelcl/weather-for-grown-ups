import { describe, expect, it, vi } from "vitest";
import {
  createAtmosphericQueryAdapterRegistry,
  type AtmosphericQueryRegistryOptions,
} from "../src/core/query-adapters/registry.js";
import {
  createAtmosphericDiagnosticAdapterRegistry,
  type AtmosphericDiagnosticRegistryOptions,
} from "../src/core/diagnostic-adapters/registry.js";
import { createAtmosphericDatasetComparisonStrategyRegistry } from "../src/core/comparison-strategies/registry.js";
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

function createQueryService(options: AtmosphericQueryRegistryOptions = {}) {
  return new UnifiedAtmosphereQueryService({
    adapters: createAtmosphericQueryAdapterRegistry(options),
  });
}

function createDiagnosticService(options: AtmosphericDiagnosticRegistryOptions = {}) {
  return new UnifiedAtmosphereDiagnosticService({
    adapters: createAtmosphericDiagnosticAdapterRegistry(options),
  });
}

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

  it("keeps explicit GFS source overrides aligned with geometry capabilities", () => {
    expect(() => queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 15,
        southLatitude: 49,
        northLatitude: 50,
      },
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      source: "s3",
    })).toThrow("Operational GFS area queries use NOMADS");

    expect(() => queryAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: {
        type: "points",
        points: [
          { latitude: 50.08, longitude: 14.43 },
          { latitude: 49.2, longitude: 16.61 },
        ],
      },
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      source: "nomads",
    })).toThrow("Operational GFS multi-point and transect queries reuse AWS S3");
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

    const service = createQueryService({
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
    expect(gfsProfile.getProfile).toHaveBeenCalledWith(expect.objectContaining({ source: "s3" }));

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
    const service = createQueryService({ gfsProfile: gfsProfile as any });
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
    const service = createQueryService({
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
    const service = createQueryService({
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

    const service = createQueryService({
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
    expect(gfsTimeSeries.getTimeSeries).toHaveBeenCalledWith(expect.objectContaining({ source: "s3" }));
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
      "aigfs",
      "aigefs",
      "hgefs",
      "gefs",
      "ifs",
      "aifs",
      "aifs-ens",
      "ifs-ens",
      "gfs-analysis",
    ]);
  });
});


describe("unified catalog branch coverage", () => {
  it("exposes dataset run selectors and operation capabilities explicitly", () => {
    const operational = searchAtmosphereCatalog({
      datasets: ["gfs", "gefs", "ifs", "ifs-ens", "gfs-analysis"],
      sections: ["variables"],
      limit: 1,
    });

    expect(operational.datasetCapabilities).toEqual([
      expect.objectContaining({
        dataset: "gfs",
        runSelectors: ["latest", "latest_complete", "explicit"],
      }),
      expect.objectContaining({
        dataset: "gefs",
        runSelectors: ["latest", "explicit"],
      }),
      expect.objectContaining({
        dataset: "ifs",
        runSelectors: ["latest", "explicit"],
      }),
      expect.objectContaining({
        dataset: "ifs-ens",
        runSelectors: ["latest", "explicit"],
      }),
      expect.objectContaining({
        dataset: "gfs-analysis",
        forecastKinds: [],
        runSelectors: [],
      }),
    ]);

    const reforecast = searchAtmosphereCatalog({
      datasets: ["gefs"],
      forecastKind: "reforecast",
      sections: ["variables"],
      limit: 1,
    });
    expect(reforecast.datasetCapabilities[0]).toMatchObject({
      dataset: "gefs",
      forecastKinds: ["operational", "reforecast"],
      runSelectors: ["explicit"],
    });
    expect(reforecast.datasetCapabilities[0]?.operations).toContain("profile");
    expect(reforecast.datasetCapabilities[0]?.operations).not.toContain("area_summary");
    expect(reforecast.datasetCapabilities[0]?.operations).not.toContain("run_comparison");
  });

  it("discovers datasets by spatial scope and declared point/area coverage", () => {
    const covered = searchAtmosphereCatalog({
      datasets: ["gfs", "gefs", "ifs"],
      coverage: { type: "point", latitude: 50.08, longitude: 14.43 },
      sections: ["variables"],
      limit: 1,
    });

    expect(covered.datasetCapabilities).toHaveLength(3);
    expect(covered.datasetCapabilities[0]).toMatchObject({
      dataset: "gfs",
      spatialDomain: { scope: "global" },
      nativeGrid: {
        type: "regular_latlon",
        nominalResolution: { value: 0.25, unit: "degrees" },
      },
      maxForecastHour: 384,
      nativeTimeCadenceHours: [1, 3],
    });
    expect(covered.datasetCapabilities[1]).toMatchObject({
      dataset: "gefs",
      kind: "ensemble",
      members: 31,
      nativeTimeCadenceHours: [3],
    });

    const area = searchAtmosphereCatalog({
      datasets: ["gfs", "ifs"],
      coverage: {
        type: "area",
        westLongitude: 10,
        eastLongitude: 16,
        southLatitude: 48,
        northLatitude: 52,
      },
      search: "temperature",
      limit: 5,
    });
    expect(area.datasetCapabilities.map((capability) => capability.dataset))
      .toEqual(["gfs", "ifs"]);

    const regionalOnly = searchAtmosphereCatalog({
      datasets: ["gfs", "ifs"],
      spatialScope: "limited_area",
      search: "temperature",
      limit: 5,
    });
    expect(regionalOnly.datasetCapabilities).toEqual([]);
    expect(regionalOnly.totalMatches).toBe(0);
    expect(regionalOnly.matches).toEqual([]);
  });

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

  it("restricts GEFS reforecast discovery to the retrospective capability subset", () => {
    const variables = searchAtmosphereCatalog({
      datasets: ["gefs"],
      forecastKind: "reforecast",
      sections: ["variables"],
      limit: 30,
    });
    expect(variables.matches.map((match) => match.id).sort()).toEqual([
      "geopotential_height",
      "specific_humidity",
      "temperature",
      "u_wind",
      "v_wind",
      "vertical_velocity",
    ]);
    expect(variables.matches.some((match) => match.id === "relative_humidity")).toBe(false);
    expect(variables.matches.find((match) => match.id === "specific_humidity")).toMatchObject({
      classification: "raw",
      kind: "raw",
    });
    expect(variables.matches[0]?.support[0]?.semantics).toContain("GEFSv12 retrospective ensemble forecast");

    const fields = searchAtmosphereCatalog({
      datasets: ["gefs"],
      forecastKind: "reforecast",
      sections: ["fields"],
      search: "wind",
      limit: 30,
    });
    expect(fields.matches.some((match) => match.id === "wind_10m")).toBe(true);

    const diagnostics = searchAtmosphereCatalog({
      datasets: ["gefs"],
      forecastKind: "reforecast",
      sections: ["layer_diagnostics", "profile_diagnostics", "parcel_definitions"],
      limit: 30,
    });
    expect(diagnostics.matches.map((match) => match.id).sort()).toEqual([
      "freezing_level_crossings",
      "potential_temperature_gradient",
      "temperature_inversion_layers",
      "temperature_lapse_rate",
      "wind_shear",
    ]);
    expect(diagnostics.matches.every((match) =>
      match.section !== "parcel_definitions")).toBe(true);
    expect(diagnostics.matches[0]?.support[0]?.semantics).toContain("layer/profile diagnostics");
  });

  it("rejects ambiguous forecast-kind catalog filtering outside GEFS-only discovery", () => {
    expect(() => searchAtmosphereCatalog({
      datasets: ["gfs"],
      forecastKind: "reforecast",
    })).toThrow("forecastKind catalog filtering currently requires datasets=[gefs]");
    expect(() => searchAtmosphereCatalog({
      datasets: ["gefs", "ifs-ens"],
      forecastKind: "operational",
    })).toThrow("forecastKind catalog filtering currently requires datasets=[gefs]");
  });

  it("discovers IFS canonical state and diagnostic support", () => {
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

    const diagnostics = searchAtmosphereCatalog({
      datasets: ["ifs", "ifs-ens"],
      sections: ["layer_diagnostics"],
      search: "wind shear",
      limit: 10,
    });
    expect(diagnostics.matches.find((match) => match.id === "wind_shear")?.support
      .map((support) => support.dataset)).toEqual(["ifs", "ifs-ens"]);

    const parcels = searchAtmosphereCatalog({
      datasets: ["ifs", "ifs-ens"],
      sections: ["parcel_definitions"],
      search: "surface",
      limit: 10,
    });
    expect(parcels.matches.find((match) => match.id === "surface_2m")?.support
      .map((support) => support.dataset)).toEqual(["ifs", "ifs-ens"]);
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
  it("dispatches run comparisons by dataset through shared-request adapters", async () => {
    const routes = Object.fromEntries(
      ["gfs", "gefs", "ifs", "ifs-ens"].map((dataset) => [
        dataset,
        { compare: vi.fn(async (request) => ({ route: dataset, request })) },
      ]),
    ) as any;
    const service = new UnifiedRunComparisonService({ adapters: routes });

    for (const dataset of ["gfs", "ifs"] as const) {
      const result = await service.compare({
        dataset,
        geometry: point,
        time: { at: "2026-08-28T12:00:00Z" },
        selection,
      });
      expect((result.result as any).route).toBe(dataset);
    }

    for (const dataset of ["gefs", "ifs-ens"] as const) {
      const result = await service.compare({
        dataset,
        geometry: point,
        time: { at: "2026-08-28T12:00:00Z" },
        selection,
        ensemble: { quantiles: [0.1, 0.9] },
      });
      expect((result.result as any).route).toBe(dataset);
    }
  });

  it("validates run-comparison constraints before adapter dispatch", async () => {
    const adapter = { compare: vi.fn() };
    const service = new UnifiedRunComparisonService({
      adapters: { gefs: adapter as any, gfs: adapter as any },
    });
    await expect(service.compare({
      dataset: "gefs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      gfsGrid: "0p50",
    })).rejects.toThrow("gfsGrid is only valid for GFS run comparison");

    await expect(service.compare({
      dataset: "gefs",
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      ensemble: { includeMembers: true },
    })).rejects.toThrow("includeMembers/maxMemberSamples are not applicable");

    expect(adapter.compare).not.toHaveBeenCalled();
  });

  it("dispatches each dataset comparison pair through its strategy", async () => {
    const defaults = createAtmosphericDatasetComparisonStrategyRegistry();
    const pairs = {
      "gfs:gefs": {
        metadata: defaults["gfs:gefs"].metadata,
        compare: vi.fn(async () => ({ route: "gfs:gefs" })),
      },
      "gfs:ifs": {
        metadata: defaults["gfs:ifs"].metadata,
        compare: vi.fn(async () => ({ route: "gfs:ifs" })),
      },
      "gefs:ifs-ens": {
        metadata: defaults["gefs:ifs-ens"].metadata,
        compare: vi.fn(async () => ({ route: "gefs:ifs-ens" })),
      },
      "ifs:ifs-ens": {
        metadata: defaults["ifs:ifs-ens"].metadata,
        compare: vi.fn(async () => ({ route: "ifs:ifs-ens" })),
      },
    };
    const service = new UnifiedDatasetComparisonService({ strategies: pairs });

    const gfsGefs = await service.compare({
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
    });
    expect((gfsGefs.result as any).route).toBe("gfs:gefs");

    const gfsIfs = await service.compare({
      datasets: ["gfs", "ifs"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
    });
    expect((gfsIfs.result as any).route).toBe("gfs:ifs");

    const gefsIfsEns = await service.compare({
      datasets: ["gefs", "ifs-ens"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
    });
    expect((gefsIfsEns.result as any).route).toBe("gefs:ifs-ens");

    const ifsIfsEns = await service.compare({
      datasets: ["ifs", "ifs-ens"],
      geometry: point,
      time: { at: "2026-08-28T12:00:00Z" },
      variable: "temperature",
      pressureLevelHpa: 850,
    });
    expect((ifsIfsEns.result as any).route).toBe("ifs:ifs-ens");
  });

  it("dispatches verification by reference dataset and analogs by analysis dataset", async () => {
    const analysis = { verify: vi.fn(async () => ({ route: "analysis" })) };
    const igra = { verify: vi.fn(async () => ({ route: "igra" })) };
    const verification = new UnifiedForecastVerificationService({
      adapters: { "gfs-analysis": analysis as any, igra: igra as any },
    });

    const verified = await verification.verify({
      geometry: point,
      time: { at: "2019-12-26T18:00:00Z" },
      leadHours: 54,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });
    expect((verified.result as any).route).toBe("analysis");

    const igraVerified = await verification.verify({
      referenceDataset: "igra",
      geometry: point,
      time: { at: "2026-08-24T12:00:00Z" },
      leadHours: 48,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });
    expect((igraVerified.result as any).route).toBe("igra");

    const analog = { find: vi.fn(async (request) => ({ route: "analogs", request })) };
    const analogs = await new UnifiedAnalogService({
      adapters: { "gfs-analysis": analog as any },
    }).find({
      geometry: point,
      time: { at: "2017-05-09T12:00:00Z" },
      variables: ["temperature"],
      pressureLevelsHpa: [850],
    });
    expect((analogs.result as any).route).toBe("analogs");
  });
});


describe("unified geometry routing coverage", () => {
  it("routes multi-point instant and range queries across all datasets", async () => {
    const gfsPoints = { getPoints: vi.fn(async () => ({ route: "gfs-points" })) };
    const gefsPoints = { getPoints: vi.fn(async () => ({ route: "gefs-points" })) };
    const ifsPoints = { getPoints: vi.fn(async () => ({ route: "ifs-points" })) };
    const ifsEnsPoints = { getPoints: vi.fn(async () => ({ route: "ifs-ens-points" })) };
    const historyPoints = { getPoints: vi.fn(async () => ({ route: "history-points" })) };
    const gfsPointsTimeSeries = { getPointsTimeSeries: vi.fn(async () => ({ route: "gfs-points-series" })) };
    const gefsPointsTimeSeries = { getPointsTimeSeries: vi.fn(async () => ({ route: "gefs-points-series" })) };
    const ifsPointsTimeSeries = { getPointsTimeSeries: vi.fn(async () => ({ route: "ifs-points-series" })) };
    const ifsEnsPointsTimeSeries = {
      getPointsTimeSeries: vi.fn(async () => ({ route: "ifs-ens-points-series" })),
    };
    const historyPointsTimeSeries = { getPointsTimeSeries: vi.fn(async () => ({ route: "history-points-series" })) };
    const service = createQueryService({
      gfsPoints: gfsPoints as any,
      gefsPoints: gefsPoints as any,
      ifsPoints: ifsPoints as any,
      ifsEnsPoints: ifsEnsPoints as any,
      historyPoints: historyPoints as any,
      gfsPointsTimeSeries: gfsPointsTimeSeries as any,
      gefsPointsTimeSeries: gefsPointsTimeSeries as any,
      ifsPointsTimeSeries: ifsPointsTimeSeries as any,
      ifsEnsPointsTimeSeries: ifsEnsPointsTimeSeries as any,
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
      dataset: "ifs-ens",
      geometry,
      time: instant,
      selection,
      ensemble: {
        members: ["p01", "p50"],
        quantiles: [0.1, 0.5, 0.9],
        maxMemberSamples: 100,
      },
    })).result).toEqual({ route: "ifs-ens-points" });
    expect(ifsEnsPoints.getPoints).toHaveBeenCalledWith(expect.objectContaining({
      points: geometry.points,
      members: ["p01", "p50"],
      maxMemberSamples: 100,
    }));
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
      dataset: "ifs-ens",
      geometry,
      time: range,
      selection,
      ensemble: {
        members: ["p01", "p50"],
        quantiles: [0.1, 0.5, 0.9],
        maxMemberSamples: 100,
      },
      limits: { maxPointSteps: 10 },
    })).result).toEqual({ route: "ifs-ens-points-series" });
    expect(ifsEnsPointsTimeSeries.getPointsTimeSeries).toHaveBeenCalledWith(expect.objectContaining({
      points: geometry.points,
      members: ["p01", "p50"],
      maxSteps: 5,
      maxPointSteps: 10,
      maxMemberSamples: 100,
    }));
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
    const ifsEnsTransect = { getTransect: vi.fn(async () => ({ route: "ifs-ens-transect" })) };
    const historyTransect = { getTransect: vi.fn(async () => ({ route: "history-transect" })) };
    const service = createQueryService({
      gfsTransect: gfsTransect as any,
      gefsTransect: gefsTransect as any,
      ifsTransect: ifsTransect as any,
      ifsEnsTransect: ifsEnsTransect as any,
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
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m"],
      },
    })).result).toEqual({ route: "gfs-transect" });
    expect(gfsTransect.getTransect).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: ["temperature_2m"],
      samples: 5,
    }));

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
      dataset: "ifs-ens",
      geometry,
      time: { at: "2026-08-28T12:00:00Z" },
      selection: { fields: ["wind_10m"] },
      ensemble: {
        members: ["p01", "p50"],
        quantiles: [0.1, 0.5, 0.9],
        maxMemberSamples: 100,
      },
    })).result).toEqual({ route: "ifs-ens-transect" });
    expect(ifsEnsTransect.getTransect).toHaveBeenCalledWith(expect.objectContaining({
      samples: 5,
      members: ["p01", "p50"],
      maxMemberSamples: 100,
    }));

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
    const ifsEnsArea = { summarize: vi.fn(async () => ({ route: "ifs-ens-area" })) };
    const historyArea = { summarize: vi.fn(async () => ({ route: "history-area" })) };
    const service = createQueryService({
      gfsArea: gfsArea as any,
      gefsArea: gefsArea as any,
      ifsArea: ifsArea as any,
      ifsEnsArea: ifsEnsArea as any,
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
      dataset: "ifs-ens",
      geometry,
      time: { at: "2026-08-28T12:00:00Z" },
      selection,
      aggregate,
      forecast: { run: "latest" },
      ensemble: {
        members: ["p01", "p50"],
        quantiles: [0.1, 0.5, 0.9],
        includeMembers: true,
      },
      limits: { maxGridPoints: 1000, maxMemberGridPoints: 30000 },
    })).result).toEqual({ route: "ifs-ens-area" });
    expect(ifsEnsArea.summarize).toHaveBeenCalledWith(expect.objectContaining({
      run: "latest",
      validTime: "2026-08-28T12:00:00Z",
      variable: "temperature",
      pressureLevelHpa: 850,
      members: ["p01", "p50"],
      quantiles: [0.1, 0.5, 0.9],
      includeMembers: true,
      percentiles: [10, 50, 90],
      maxGridPoints: 1000,
      maxMemberGridPoints: 30000,
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
    const service = createDiagnosticService({
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
    const service = createDiagnosticService({
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
    const ifsEnsTimeSeries = { getDiagnosticTimeSeries: vi.fn(async () => ({ route: "ifs-ens-series" })) };
    const service = createDiagnosticService({
      timeSeries: timeSeries as any,
      ifsEnsTimeSeries: ifsEnsTimeSeries as any,
    });
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
      dataset: "ifs-ens",
      geometry: point,
      time: {
        from: "2026-08-28T00:00:00Z",
        to: "2026-08-28T12:00:00Z",
        maxSteps: 5,
      },
      diagnostic,
      forecast: { run: "latest" },
      ensemble: { members: ["p01", "p50"], quantiles: [0.1, 0.9] },
    })).result).toEqual({ route: "ifs-ens-series" });
    expect(ifsEnsTimeSeries.getDiagnosticTimeSeries).toHaveBeenCalledWith(expect.objectContaining({
      run: "latest",
      startTime: "2026-08-28T00:00:00Z",
      endTime: "2026-08-28T12:00:00Z",
      members: ["p01", "p50"],
      quantiles: [0.1, 0.9],
      maxSteps: 5,
    }));

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
