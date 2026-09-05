import { describe, expect, it, vi } from "vitest";
import {
  buildRdaGfs025ForecastAreaUrl,
  convertRdaGfs025AreaNetcdfToCsv,
  RdaGfsForecastHistorySource,
  type RdaAreaNetcdfReader,
} from "../src/sources/rda-gfs-forecast-history.js";

const request = {
  runTime: new Date("2026-08-24T00:00:00Z"),
  forecastHour: 6,
  westLongitude: 13.5,
  eastLongitude: 14.5,
  southLatitude: 49.5,
  northLatitude: 50.5,
  variables: ["Temperature_isobaric"],
  verticalCoordinate: 85000,
};

describe("GDEX 0.25 area transport", () => {
  it("requests a NetCDF bbox rather than unsupported grid CSV", () => {
    const url = new URL(buildRdaGfs025ForecastAreaUrl(request));
    expect(url.searchParams.get("accept")).toBe("netCDF");
    expect(url.searchParams.get("vertCoord")).toBe("85000");
    expect(url.searchParams.get("north")).toBe("50.5");
    expect(url.searchParams.get("south")).toBe("49.5");
  });

  it("normalizes the NetCDF grid to the existing internal CSV contract", () => {
    const data: Record<string, unknown> = {
      latitude: new Float32Array([50.5, 50.25]),
      longitude: new Float32Array([13.5, 13.75, 14]),
      isobaric: new Float64Array([85000]),
      Temperature_isobaric: new Float32Array([
        278.2, 278.17, 278.08,
        278.5, 278.49, 278.45,
      ]),
    };
    const reader: RdaAreaNetcdfReader = {
      dimensions: [
        { name: "latitude", size: 2 },
        { name: "time", size: 1 },
        { name: "isobaric", size: 1 },
        { name: "longitude", size: 3 },
      ],
      dataVariableExists: (name) => name in data,
      getDataVariable: (name) => data[name],
    };

    const csv = convertRdaGfs025AreaNetcdfToCsv(reader, request);
    expect(csv.split("\n")).toEqual([
      "latitude,longitude,isobaric,Temperature_isobaric",
      "50.5,13.5,85000,278.20001220703125",
      "50.5,13.75,85000,278.1700134277344",
      "50.5,14,85000,278.0799865722656",
      "50.25,13.5,85000,278.5",
      "50.25,13.75,85000,278.489990234375",
      "50.25,14,85000,278.45001220703125",
    ]);
  });

  it("rejects malformed subsets instead of silently reshaping them", () => {
    const reader: RdaAreaNetcdfReader = {
      dimensions: [
        { name: "latitude", size: 2 },
        { name: "longitude", size: 2 },
        { name: "isobaric", size: 1 },
      ],
      dataVariableExists: () => true,
      getDataVariable: (name) => {
        if (name === "latitude") return [50, 49.75];
        if (name === "longitude") return [14, 14.25];
        if (name === "isobaric") return [85000];
        return [278, 279, 280];
      },
    };
    expect(() => convertRdaGfs025AreaNetcdfToCsv(reader, request))
      .toThrow("has 3 values; expected 4");
  });
});


describe("GDEX transient failure handling", () => {

  it("retries transient point failures through the supplied limiter", async () => {
    const run = vi.fn(async <T>(operation: () => Promise<T>) => operation());
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 504, statusText: "Gateway Time-out" }))
      .mockResolvedValueOnce(new Response(
        'time,alt[unit="Pa"],latitude,longitude,Temperature_isobaric[unit="K"]\n2026-08-24T06:00:00Z,85000,50,14,285.15',
        { status: 200 },
      ));
    const source = new RdaGfsForecastHistorySource({
      retryBaseDelayMs: 0,
      retryJitterRatio: 0,
      limiter: { run },
      fetchFn,
    });

    const result = await source.fetch({
      runTime: new Date("2026-08-24T00:00:00Z"),
      forecastHour: 6,
      latitude: 50,
      longitude: 14,
      variables: ["Temperature_isobaric"],
    });
    expect(result.cacheHit).toBe(false);
    expect(result.csv).toContain("285.15");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);

  });

  it("stops after three transient failures", async () => {
    const run = vi.fn(async <T>(operation: () => Promise<T>) => operation());
    const fetchFn = vi.fn(async () =>
      new Response("", { status: 503, statusText: "Service Unavailable" })
    );
    const source = new RdaGfsForecastHistorySource({
      retryBaseDelayMs: 0,
      retryJitterRatio: 0,
      limiter: { run },
      fetchFn,
    });

    await expect(source.fetch({
      runTime: new Date("2026-08-24T00:00:00Z"),
      forecastHour: 6,
      latitude: 50,
      longitude: 14,
      variables: ["Temperature_isobaric"],
    })).rejects.toThrow("HTTP 503 Service Unavailable");
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("retries transient NetCDF area failures and decodes the successful response", async () => {
    const run = vi.fn(async <T>(operation: () => Promise<T>) => operation());
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 502, statusText: "Bad Gateway" }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const data: Record<string, unknown> = {
      latitude: [50, 49.75],
      longitude: [14, 14.25],
      isobaric: [85000],
      Temperature_isobaric: [278, 279, 280, 281],
    };
    const source = new RdaGfsForecastHistorySource({
      retryBaseDelayMs: 0,
      retryJitterRatio: 0,
      limiter: { run },
      fetchFn,
      netcdfReaderFactory: () => ({
        dimensions: [
          { name: "latitude", size: 2 },
          { name: "time", size: 1 },
          { name: "isobaric", size: 1 },
          { name: "longitude", size: 2 },
        ],
        dataVariableExists: (name) => name in data,
        getDataVariable: (name) => data[name],
      }),
    });

    const result = await source.fetchArea(request);
    expect(result.csv).toContain("latitude,longitude,isobaric,Temperature_isobaric");
    expect(result.csv).toContain("49.75,14.25,85000,281");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
  });
});


describe("GDEX terminal and decoder edge cases", () => {

  it("does not retry a missing point forecast", async () => {
    const run = vi.fn(async <T>(operation: () => Promise<T>) => operation());
    const fetchFn = vi.fn(async () => new Response("", { status: 404, statusText: "Not Found" }));
    const source = new RdaGfsForecastHistorySource({
      retryBaseDelayMs: 0,
      retryJitterRatio: 0,
      limiter: { run },
      fetchFn,
    });

    await expect(source.fetch({
      runTime: new Date("2026-08-24T00:00:00Z"),
      forecastHour: 6,
      latitude: 50,
      longitude: 14,
      variables: ["Temperature_isobaric"],
    })).rejects.toThrow("has no archived GFS 0.25° forecast online for run");
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not retry a missing area forecast", async () => {
    const run = vi.fn(async <T>(operation: () => Promise<T>) => operation());
    const fetchFn = vi.fn(async () => new Response("", { status: 404, statusText: "Not Found" }));
    const source = new RdaGfsForecastHistorySource({
      retryBaseDelayMs: 0,
      retryJitterRatio: 0,
      limiter: { run },
      fetchFn,
    });

    await expect(source.fetchArea(request)).rejects.toThrow("has no archived GFS 0.25° forecast online for run");
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  it("normalizes a surface NetCDF subset without inventing a vertical axis", () => {
    const surfaceRequest = { ...request, verticalCoordinate: undefined };
    const data: Record<string, unknown> = {
      latitude: [50],
      longitude: [14, 14.25],
      Temperature_isobaric: [278, 279],
    };
    const reader: RdaAreaNetcdfReader = {
      dimensions: [
        { name: "latitude", size: 1 },
        { name: "time", size: 1 },
        { name: "longitude", size: 2 },
      ],
      dataVariableExists: (name) => name in data,
      getDataVariable: (name) => data[name],
    };
    expect(convertRdaGfs025AreaNetcdfToCsv(reader, surfaceRequest).split("\n")).toEqual([
      "latitude,longitude,Temperature_isobaric",
      "50,14,278",
      "50,14.25,279",
    ]);
  });

  it("rejects a NetCDF subset missing the requested variable", () => {
    const reader: RdaAreaNetcdfReader = {
      dimensions: [
        { name: "latitude", size: 1 },
        { name: "longitude", size: 1 },
        { name: "isobaric", size: 1 },
      ],
      dataVariableExists: (name) => name !== "Temperature_isobaric",
      getDataVariable: (name) => name === "latitude" ? [50] : name === "longitude" ? [14] : [85000],
    };
    expect(() => convertRdaGfs025AreaNetcdfToCsv(reader, request))
      .toThrow("missing variable Temperature_isobaric");
  });

  it("rejects a pressure subset that omits its returned vertical coordinate", () => {
    const data: Record<string, unknown> = {
      latitude: [50],
      longitude: [14],
      Temperature_isobaric: [278],
    };
    const reader: RdaAreaNetcdfReader = {
      dimensions: [
        { name: "latitude", size: 1 },
        { name: "time", size: 1 },
        { name: "longitude", size: 1 },
      ],
      dataVariableExists: (name) => name in data,
      getDataVariable: (name) => data[name],
    };
    expect(() => convertRdaGfs025AreaNetcdfToCsv(reader, request))
      .toThrow("missing the returned vertical coordinate");
  });
});
