import { describe, expect, it, vi } from "vitest";
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
    const service = new UnifiedAtmosphereQueryService({
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
    const service = new UnifiedAtmosphereQueryService({
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

  it("routes compact reforecast field ranges without falling through to operational GEFS", async () => {
    const operational = { getTimeSeries: vi.fn() };
    const reforecastRange = {
      getTimeSeries: vi.fn(async () => ({ route: "reforecast-range" })),
    };
    const service = new UnifiedAtmosphereQueryService({
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
    const service = new UnifiedAtmosphereQueryService({
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
    const service = new UnifiedAtmosphereQueryService({
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
    const service = new UnifiedAtmosphereQueryService({
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

});
