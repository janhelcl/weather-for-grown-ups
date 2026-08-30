import { describe, expect, it, vi } from "vitest";
import {
  createAtmosphericQueryAdapterRegistry,
  type AtmosphericQueryRegistryOptions,
} from "../src/core/query-adapters/registry.js";
import { UnifiedAtmosphereQueryService } from "../src/core/unified-atmosphere-api.js";

describe("unified GEFS reforecast routing", () => {
  it("routes forecast.kind=reforecast without changing the public dataset id", async () => {
    const operational = { getBundle: vi.fn(async () => ({ route: "operational" })) };
    const reforecast = {
      getPoint: vi.fn(async () => ({
        model: "gefs_v12_reforecast",
        route: "reforecast",
      })),
    };
    const service = createQueryService({
      gefsBundle: operational as any,
      gefsReforecast: reforecast as any,
    });

    const result = await service.query({
      dataset: "gefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2017-03-14T12:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      forecast: {
        kind: "reforecast",
        run: "2017-03-14T00:00:00Z",
      },
      ensemble: {
        members: ["c00", "p01", "p02", "p03", "p04"],
        quantiles: [0.1, 0.5, 0.9],
      },
    });

    expect(result.dataset).toBe("gefs");
    expect(result.internalDatasetId).toBe("gefs_v12_reforecast");
    expect(result.kind).toBe("ensemble");
    expect(result.role).toBe("forecast");
    expect(result.result).toMatchObject({ route: "reforecast" });
    expect(reforecast.getPoint).toHaveBeenCalledWith(expect.objectContaining({
      run: "2017-03-14T00:00:00Z",
      validTime: "2017-03-14T12:00:00Z",
      fields: ["temperature_2m"],
      members: ["c00", "p01", "p02", "p03", "p04"],
    }));
    expect(operational.getBundle).not.toHaveBeenCalled();
  });

  it("routes reforecast pressure selections through the same unified query shape", async () => {
    const fields = { getPoint: vi.fn() };
    const profile = {
      getProfile: vi.fn(async () => ({
        model: "gefs_v12_reforecast",
        route: "profile",
      })),
    };
    const service = createQueryService({
      gefsReforecast: fields as any,
      gefsReforecastProfile: profile as any,
    });

    const result = await service.query({
      dataset: "gefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2017-03-14T12:00:00Z" },
      selection: {
        variables: ["temperature", "specific_humidity"],
        pressureLevelsHpa: [850, 500],
      },
      forecast: {
        kind: "reforecast",
        run: "2017-03-14T00:00:00Z",
      },
      ensemble: {
        members: ["c00", "p01"],
        quantiles: [0.5],
      },
    });

    expect(result.internalDatasetId).toBe("gefs_v12_reforecast");
    expect(result.result).toMatchObject({ route: "profile" });
    expect(profile.getProfile).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["temperature", "specific_humidity"],
      pressureLevelsHpa: [850, 500],
      members: ["c00", "p01"],
    }));
    expect(fields.getPoint).not.toHaveBeenCalled();
  });

  it("routes mixed reforecast point selections through the dedicated wrapper", async () => {
    const mixed = { getPoint: vi.fn(async () => ({ route: "mixed-point" })) };
    const profile = { getProfile: vi.fn() };
    const fields = { getPoint: vi.fn() };
    const service = createQueryService({
      gefsReforecastMixed: mixed as any,
      gefsReforecastProfile: profile as any,
      gefsReforecast: fields as any,
    });

    const result = await service.query({
      dataset: "gefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2017-03-14T12:00:00Z" },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850, 500],
        fields: ["temperature_2m"],
      },
      forecast: { kind: "reforecast", run: "2017-03-14T00:00:00Z" },
      ensemble: { members: ["c00", "p01"], quantiles: [0.5] },
    });

    expect(result.result).toEqual({ route: "mixed-point" });
    expect(mixed.getPoint).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["temperature"],
      pressureLevelsHpa: [850, 500],
      fields: ["temperature_2m"],
      members: ["c00", "p01"],
      quantiles: [0.5],
    }));
    expect(profile.getProfile).not.toHaveBeenCalled();
    expect(fields.getPoint).not.toHaveBeenCalled();
  });

  it("routes mixed reforecast point ranges through the dedicated wrapper", async () => {
    const mixed = { getTimeSeries: vi.fn(async () => ({ route: "mixed-range" })) };
    const legacy = { getTimeSeries: vi.fn() };
    const service = createQueryService({
      gefsReforecastMixedTimeSeries: mixed as any,
      gefsReforecastTimeSeries: legacy as any,
    });

    const result = await service.query({
      dataset: "gefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: {
        from: "2017-03-14T03:00:00Z",
        to: "2017-03-14T09:00:00Z",
        maxSteps: 3,
      },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m"],
      },
      forecast: { kind: "reforecast", run: "2017-03-14T00:00:00Z" },
      ensemble: { members: ["c00", "p01"], quantiles: [0.5] },
    });

    expect(result.result).toEqual({ route: "mixed-range" });
    expect(mixed.getTimeSeries).toHaveBeenCalledWith(expect.objectContaining({
      startTime: "2017-03-14T03:00:00Z",
      endTime: "2017-03-14T09:00:00Z",
      maxSteps: 3,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: ["temperature_2m"],
    }));
    expect(legacy.getTimeSeries).not.toHaveBeenCalled();
  });

  it("routes compact reforecast field ranges without falling through to operational GEFS", async () => {
    const operational = { getTimeSeries: vi.fn() };
    const reforecastRange = {
      getTimeSeries: vi.fn(async () => ({ route: "reforecast-range" })),
    };
    const service = createQueryService({
      gefsTimeSeries: operational as any,
      gefsReforecastTimeSeries: reforecastRange as any,
    });

    const result = await service.query({
      dataset: "gefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: {
        from: "2017-03-23T21:00:00Z",
        to: "2017-03-24T12:00:00Z",
        maxSteps: 4,
      },
      selection: { fields: ["temperature_2m"] },
      forecast: {
        kind: "reforecast",
        run: "2017-03-14T00:00:00Z",
      },
      ensemble: {
        members: ["c00", "p01"],
        quantiles: [0.5],
      },
    });

    expect(result.internalDatasetId).toBe("gefs_v12_reforecast");
    expect(result.timeType).toBe("range");
    expect(result.result).toEqual({ route: "reforecast-range" });
    expect(reforecastRange.getTimeSeries).toHaveBeenCalledWith(expect.objectContaining({
      run: "2017-03-14T00:00:00Z",
      startTime: "2017-03-23T21:00:00Z",
      endTime: "2017-03-24T12:00:00Z",
      maxSteps: 4,
      members: ["c00", "p01"],
      quantiles: [0.5],
      selection: {
        kind: "fields",
        fields: ["temperature_2m"],
      },
    }));
    expect(operational.getTimeSeries).not.toHaveBeenCalled();
  });

  it("routes reforecast profile ranges and rejects raw member payloads for ranges", async () => {
    const reforecastRange = {
      getTimeSeries: vi.fn(async () => ({ route: "profile-range" })),
    };
    const service = createQueryService({
      gefsReforecastTimeSeries: reforecastRange as any,
    });

    await service.query({
      dataset: "gefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: {
        from: "2017-03-14T03:00:00Z",
        to: "2017-03-14T06:00:00Z",
      },
      selection: {
        variables: ["temperature", "specific_humidity"],
        pressureLevelsHpa: [850, 500],
      },
      forecast: {
        kind: "reforecast",
        run: "2017-03-14T00:00:00Z",
      },
      ensemble: {
        members: ["c00", "p01"],
        quantiles: [0.5],
      },
    });

    expect(reforecastRange.getTimeSeries).toHaveBeenCalledWith(expect.objectContaining({
      selection: {
        kind: "profile",
        variables: ["temperature", "specific_humidity"],
        pressureLevelsHpa: [850, 500],
      },
    }));

    await expect(service.query({
      dataset: "gefs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: {
        from: "2017-03-14T03:00:00Z",
        to: "2017-03-14T06:00:00Z",
      },
      selection: { fields: ["temperature_2m"] },
      forecast: {
        kind: "reforecast",
        run: "2017-03-14T00:00:00Z",
      },
      ensemble: {
        members: ["c00", "p01"],
        includeMembers: true,
      },
    })).rejects.toThrow("time ranges return compact member-first summaries");
  });


  it("routes reforecast multi-point fields without using operational GEFS", async () => {
    const operational = { getPoints: vi.fn() };
    const reforecastPoints = {
      getPoints: vi.fn(async () => ({
        model: "gefs_v12_reforecast",
        kind: "fields",
        route: "reforecast-points",
      })),
    };
    const service = createQueryService({
      gefsPoints: operational as any,
      gefsReforecastPoints: reforecastPoints as any,
    });

    const result = await service.query({
      dataset: "gefs",
      geometry: {
        type: "points",
        points: [
          { latitude: 50.08, longitude: 14.43 },
          { latitude: 49.2, longitude: 16.61 },
        ],
      },
      time: { at: "2017-03-14T12:00:00Z" },
      selection: { fields: ["temperature_2m"] },
      forecast: {
        kind: "reforecast",
        run: "2017-03-14T00:00:00Z",
      },
      ensemble: {
        members: ["c00", "p01"],
        quantiles: [0.5],
        maxMemberSamples: 100,
      },
    });

    expect(result.internalDatasetId).toBe("gefs_v12_reforecast");
    expect(result.geometryType).toBe("points");
    expect(result.result).toMatchObject({ route: "reforecast-points" });
    expect(reforecastPoints.getPoints).toHaveBeenCalledWith(expect.objectContaining({
      run: "2017-03-14T00:00:00Z",
      validTime: "2017-03-14T12:00:00Z",
      points: [
        { latitude: 50.08, longitude: 14.43 },
        { latitude: 49.2, longitude: 16.61 },
      ],
      members: ["c00", "p01"],
      quantiles: [0.5],
      maxMemberSamples: 100,
      selection: {
        kind: "fields",
        fields: ["temperature_2m"],
      },
    }));
    expect(operational.getPoints).not.toHaveBeenCalled();
  });

  it("routes reforecast multi-point pressure profiles through the same geometry vocabulary", async () => {
    const reforecastPoints = {
      getPoints: vi.fn(async () => ({
        model: "gefs_v12_reforecast",
        kind: "profile",
        route: "reforecast-profile-points",
      })),
    };
    const service = createQueryService({
      gefsReforecastPoints: reforecastPoints as any,
    });

    await service.query({
      dataset: "gefs",
      geometry: {
        type: "points",
        points: [
          { latitude: 50.08, longitude: 14.43 },
          { latitude: 48.15, longitude: 17.11 },
        ],
      },
      time: { at: "2017-03-14T12:00:00Z" },
      selection: {
        variables: ["temperature", "specific_humidity"],
        pressureLevelsHpa: [850, 500],
      },
      forecast: {
        kind: "reforecast",
        run: "2017-03-14T00:00:00Z",
      },
      ensemble: {
        members: ["c00", "p01"],
        quantiles: [0.5],
      },
    });

    expect(reforecastPoints.getPoints).toHaveBeenCalledWith(expect.objectContaining({
      selection: {
        kind: "profile",
        variables: ["temperature", "specific_humidity"],
        pressureLevelsHpa: [850, 500],
      },
    }));
  });


  it("routes mixed reforecast multi-point selections through the dedicated wrapper", async () => {
    const mixed = { getPoints: vi.fn(async () => ({ route: "mixed-points" })) };
    const legacy = { getPoints: vi.fn() };
    const service = createQueryService({
      gefsReforecastMixedPoints: mixed as any,
      gefsReforecastPoints: legacy as any,
    });

    const result = await service.query({
      dataset: "gefs",
      geometry: {
        type: "points",
        points: [
          { latitude: 50.08, longitude: 14.43 },
          { latitude: 49.2, longitude: 16.61 },
        ],
      },
      time: { at: "2017-03-14T12:00:00Z" },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m"],
      },
      forecast: { kind: "reforecast", run: "2017-03-14T00:00:00Z" },
      ensemble: {
        members: ["c00", "p01"],
        quantiles: [0.5],
        maxMemberSamples: 100,
      },
    });

    expect(result.result).toEqual({ route: "mixed-points" });
    expect(mixed.getPoints).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: ["temperature_2m"],
      maxMemberSamples: 100,
    }));
    expect(legacy.getPoints).not.toHaveBeenCalled();
  });

  it("routes mixed reforecast multi-point ranges through the dedicated wrapper", async () => {
    const mixed = {
      getPointsTimeSeries: vi.fn(async () => ({ route: "mixed-points-range" })),
    };
    const legacy = { getPointsTimeSeries: vi.fn() };
    const service = createQueryService({
      gefsReforecastMixedPointsTimeSeries: mixed as any,
      gefsReforecastPointsTimeSeries: legacy as any,
    });

    const result = await service.query({
      dataset: "gefs",
      geometry: {
        type: "points",
        points: [
          { latitude: 50.08, longitude: 14.43 },
          { latitude: 49.2, longitude: 16.61 },
        ],
      },
      time: {
        from: "2017-03-14T03:00:00Z",
        to: "2017-03-14T09:00:00Z",
        maxSteps: 3,
      },
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        fields: ["temperature_2m"],
      },
      forecast: { kind: "reforecast", run: "2017-03-14T00:00:00Z" },
      ensemble: { members: ["c00", "p01"], quantiles: [0.5] },
      limits: { maxPointSteps: 6 },
    });

    expect(result.result).toEqual({ route: "mixed-points-range" });
    expect(mixed.getPointsTimeSeries).toHaveBeenCalledWith(expect.objectContaining({
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      fields: ["temperature_2m"],
      maxSteps: 3,
      maxPointSteps: 6,
    }));
    expect(legacy.getPointsTimeSeries).not.toHaveBeenCalled();
  });

  it("routes reforecast multi-point ranges without operational GEFS fallback", async () => {
    const operational = { getPointsTimeSeries: vi.fn() };
    const reforecastRange = {
      getPointsTimeSeries: vi.fn(async () => ({
        model: "gefs_v12_reforecast",
        route: "reforecast-points-range",
      })),
    };
    const service = createQueryService({
      gefsPointsTimeSeries: operational as any,
      gefsReforecastPointsTimeSeries: reforecastRange as any,
    });

    const result = await service.query({
      dataset: "gefs",
      geometry: {
        type: "points",
        points: [
          { latitude: 50.13, longitude: 14.37 },
          { latitude: 49.2, longitude: 16.61 },
        ],
      },
      time: {
        from: "2017-03-23T21:00:00Z",
        to: "2017-03-24T06:00:00Z",
        maxSteps: 3,
      },
      selection: { fields: ["temperature_2m"] },
      forecast: {
        kind: "reforecast",
        run: "2017-03-14T00:00:00Z",
      },
      ensemble: {
        members: ["c00", "p01"],
        quantiles: [0.5],
      },
      limits: { maxPointSteps: 6 },
    });

    expect(result.internalDatasetId).toBe("gefs_v12_reforecast");
    expect(result.geometryType).toBe("points");
    expect(result.timeType).toBe("range");
    expect(result.result).toEqual({
      model: "gefs_v12_reforecast",
      route: "reforecast-points-range",
    });
    expect(reforecastRange.getPointsTimeSeries).toHaveBeenCalledWith(expect.objectContaining({
      points: [
        { latitude: 50.13, longitude: 14.37 },
        { latitude: 49.2, longitude: 16.61 },
      ],
      run: "2017-03-14T00:00:00Z",
      startTime: "2017-03-23T21:00:00Z",
      endTime: "2017-03-24T06:00:00Z",
      maxSteps: 3,
      maxPointSteps: 6,
      members: ["c00", "p01"],
      quantiles: [0.5],
      selection: {
        kind: "fields",
        fields: ["temperature_2m"],
      },
    }));
    expect(operational.getPointsTimeSeries).not.toHaveBeenCalled();
  });

});
