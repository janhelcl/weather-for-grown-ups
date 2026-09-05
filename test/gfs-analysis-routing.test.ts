import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CachedGfsAnalysisFileStore,
  CachedGfsAnalysisSource,
} from "../src/cache/historical-gfs-cache.js";
import {
  DataUnavailableError,
  RateLimitedError,
  UpstreamUnavailableError,
} from "../src/failure.js";
import { remapGrib2Message } from "../src/grib/icon-d2-remap.js";
import { AwsGfsAnalysisSource } from "../src/sources/gfs-analysis-aws.js";
import {
  NceiGfsFileServerAnalysisSource,
  buildNceiGfsAnalysisFileServerUrl,
} from "../src/sources/gfs-analysis-fileserver.js";
import {
  heightMetresFromGribLevel,
  historicalAnalysisSelectors,
  idForDecodedValue,
  ncssNamesForHistoricalAnalysisVariables,
  rowsFromDecodedPointValues,
} from "../src/sources/gfs-analysis-grib.js";
import { RoutedGfsAnalysisSource } from "../src/sources/gfs-analysis-routed.js";
import type {
  HistoricalAnalysisAreaResponse,
  HistoricalAnalysisPointResponse,
} from "../src/sources/gfs-analysis.js";
import { NCEI_NCSS_PROVENANCE } from "../src/sources/ncei-gfs-history.js";
import { buildGfsS3ForecastIndexUrl } from "../src/sources/gfs-s3.js";
import { concat, nativeIconMessage, NATIVE_CELLS, TARGET_GRID } from "./icon-d2-fixtures.js";

const passthroughPolicy = {
  run: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
};

const identityRemap = {
  sourceSize: NATIVE_CELLS,
  targetGrid: TARGET_GRID,
  sourceIndexByTarget: Int32Array.from([0, 1, 2, 3, 4, 5]),
};

const packing = {
  referenceValue: 0,
  binaryScale: 0,
  decimalScale: 0,
  bitsPerValue: 16,
} as const;

function analysisMessage(options: {
  values?: readonly number[];
  category?: number;
  parameter?: number;
  surfaceType?: number;
  surfaceValue?: number;
}): Uint8Array {
  return remapGrib2Message(
    nativeIconMessage({
      values: options.values ?? [280, 281, 282, 283, 284, 285],
      ...packing,
      ...(options.category === undefined ? {} : { category: options.category }),
      ...(options.parameter === undefined ? {} : { parameter: options.parameter }),
      ...(options.surfaceType === undefined ? {} : { surfaceType: options.surfaceType }),
      ...(options.surfaceValue === undefined ? {} : { surfaceValue: options.surfaceValue }),
    }),
    identityRemap,
  );
}

function indexLine(
  message: number,
  startByte: number,
  variable: string,
  level: string,
): string {
  return `${message}:${startByte}:d=2024060100:${variable}:${level}:anl:`;
}

function mockAwsFetch(gribBytes: Uint8Array, indexLines: readonly string[]): typeof fetch {
  const indexText = `${indexLines.join("\n")}\n`;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith(".idx")) {
      return new Response(indexText, { status: 200 });
    }
    const rangeHeader = new Headers(init?.headers).get("range");
    if (rangeHeader === null) {
      return new Response("missing range", { status: 400 });
    }
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (match === null) {
      return new Response("bad range", { status: 400 });
    }
    const start = Number(match[1]);
    const end = match[2] === "" ? gribBytes.byteLength - 1 : Number(match[2]);
    return new Response(gribBytes.subarray(start, end + 1), { status: 206 });
  }) as unknown as typeof fetch;
}

function ncssPointResponse(cacheHit = false): HistoricalAnalysisPointResponse {
  return {
    rows: [{
      latitude: 50,
      longitude: 14.5,
      pressureHpa: 850,
      values: { temperature: 285.15 },
    }],
    dataset: "ncss-dataset",
    cacheHit,
    ...NCEI_NCSS_PROVENANCE,
  };
}

function ncssAreaResponse(): HistoricalAnalysisAreaResponse {
  return {
    variable: "temperature",
    points: [{ latitude: 50, longitude: 14, value: 285.15 }],
    verticalCoordinate: 85000,
    dataset: "ncss-area",
    cacheHit: false,
    ...NCEI_NCSS_PROVENANCE,
  };
}

const fastRetry = { maxAttempts: 1 as const, baseDelayMs: 0, jitterRatio: 0 };

describe("historical analysis GRIB mapping", () => {
  it("maps canonical IDs onto provider selectors", () => {
    expect(historicalAnalysisSelectors([
      "temperature",
      "surface_pressure",
      "temperature_2m",
      "precipitable_water",
    ])).toEqual([
      { id: "temperature", ncssName: "Temperature_isobaric", gfsCode: "TMP", kind: "isobaric" },
      {
        id: "surface_pressure",
        ncssName: "Pressure_surface",
        gfsCode: "PRES",
        gribLevel: "surface",
        kind: "surface_or_column",
      },
      {
        id: "temperature_2m",
        ncssName: "Temperature_height_above_ground",
        gfsCode: "TMP",
        gribLevel: "2 m above ground",
        kind: "surface_or_column",
      },
      {
        id: "precipitable_water",
        ncssName: "Precipitable_water_entire_atmosphere_single_layer",
        gfsCode: "PWAT",
        gribLevel: "entire atmosphere (considered as a single layer)",
        kind: "surface_or_column",
      },
    ]);
    expect(ncssNamesForHistoricalAnalysisVariables([
      "temperature",
      "temperature",
      "surface_pressure",
    ])).toEqual(["Temperature_isobaric", "Pressure_surface"]);
  });

  it("parses height metres from GRIB level strings", () => {
    expect(heightMetresFromGribLevel("2 m above ground")).toBe(2);
    expect(heightMetresFromGribLevel("80 m above ground")).toBe(80);
    expect(heightMetresFromGribLevel("surface")).toBeUndefined();
    expect(heightMetresFromGribLevel(undefined)).toBeUndefined();
  });

  it("groups decoded point values into canonical rows by vertical coordinate", () => {
    const selectors = historicalAnalysisSelectors(["temperature", "temperature_2m"]);
    const rows = rowsFromDecodedPointValues([
      {
        code: "TMP",
        pressureHpa: 850,
        value: 285.15,
        gridPoint: { latitude: 50, longitude: 14.5 },
      },
      {
        code: "TMP",
        heightAboveGroundM: 2,
        value: 290,
        gridPoint: { latitude: 50, longitude: 14.5 },
      },
    ], selectors);
    expect(rows).toEqual([
      {
        latitude: 50,
        longitude: 14.5,
        pressureHpa: 850,
        values: { temperature: 285.15 },
      },
      {
        latitude: 50,
        longitude: 14.5,
        heightAboveGroundM: 2,
        values: { temperature_2m: 290 },
      },
    ]);
  });

  it("matches surface, entire-atmosphere, and exact HAG decoded values onto canonical IDs", () => {
    const selectors = historicalAnalysisSelectors([
      "surface_pressure",
      "precipitable_water",
      "temperature_2m",
    ]);
    expect(idForDecodedValue({
      code: "PRES",
      surface: true,
      value: 101_325,
      gridPoint: { latitude: 50, longitude: 14.5 },
    }, selectors)).toBe("surface_pressure");
    expect(idForDecodedValue({
      code: "PWAT",
      namedVertical: "entire atmosphere",
      value: 22,
      gridPoint: { latitude: 50, longitude: 14.5 },
    }, selectors)).toBe("precipitable_water");
    expect(idForDecodedValue({
      code: "PWAT",
      value: 18,
      gridPoint: { latitude: 50, longitude: 14.5 },
    }, selectors)).toBe("precipitable_water");
    expect(idForDecodedValue({
      code: "TMP",
      heightAboveGroundM: 2,
      value: 291,
      gridPoint: { latitude: 50, longitude: 14.5 },
    }, selectors)).toBe("temperature_2m");
    expect(idForDecodedValue({
      code: "TMP",
      heightAboveGroundM: 80,
      value: 290,
      gridPoint: { latitude: 50, longitude: 14.5 },
    }, selectors)).toBeUndefined();
  });
});

describe("GFS analysis routing", () => {
  it("builds the NCEI fileServer URL from the Grid 4 dataset path", () => {
    expect(buildNceiGfsAnalysisFileServerUrl(new Date("2017-05-09T00:00:00Z"))).toBe(
      "https://www.ncei.noaa.gov/thredds/fileServer/model-gfs-g4-anl-files-old/201705/20170509/gfsanl_4_20170509_0000_000.grb2",
    );
  });

  it("prefers AWS for ≥2021 and falls back to NCSS when AWS is unavailable", async () => {
    const aws = {
      fetch: vi.fn(async () => {
        throw new UpstreamUnavailableError("AWS down", { details: { provider: "NOAA AWS Open Data" } });
      }),
      fetchArea: vi.fn(),
    };
    const fileServer = { fetch: vi.fn() };
    const ncss = {
      fetch: vi.fn(async () => ncssPointResponse()),
      fetchArea: vi.fn(),
    };
    const routed = new RoutedGfsAnalysisSource({ aws, fileServer, ncss });
    const result = await routed.fetch({
      analysisTime: new Date("2024-06-01T00:00:00Z"),
      latitude: 50,
      longitude: 14.5,
      variables: ["temperature"],
    });
    expect(result.access).toBe("ncei_thredds_ncss");
    expect(result.rows[0]?.values.temperature).toBe(285.15);
    expect(aws.fetch).toHaveBeenCalledTimes(1);
    expect(fileServer.fetch).not.toHaveBeenCalled();
    expect(ncss.fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to NCSS when AWS reports data unavailable", async () => {
    const aws = {
      fetch: vi.fn(async () => {
        throw new DataUnavailableError("missing cycle", {
          details: { provider: "NOAA AWS Open Data" },
        });
      }),
      fetchArea: vi.fn(),
    };
    const ncss = {
      fetch: vi.fn(async () => ncssPointResponse()),
      fetchArea: vi.fn(),
    };
    const routed = new RoutedGfsAnalysisSource({
      aws,
      fileServer: { fetch: vi.fn() },
      ncss,
    });
    await expect(routed.fetch({
      analysisTime: new Date("2024-06-01T00:00:00Z"),
      latitude: 50,
      longitude: 14.5,
      variables: ["temperature"],
    })).resolves.toMatchObject({ access: "ncei_thredds_ncss" });
  });

  it("does not fall back when the primary fails with a non-upstream error", async () => {
    const aws = {
      fetch: vi.fn(async () => { throw new Error("contract bug"); }),
      fetchArea: vi.fn(),
    };
    const ncss = { fetch: vi.fn(), fetchArea: vi.fn() };
    const routed = new RoutedGfsAnalysisSource({
      aws,
      fileServer: { fetch: vi.fn() },
      ncss,
    });
    await expect(routed.fetch({
      analysisTime: new Date("2024-06-01T00:00:00Z"),
      latitude: 50,
      longitude: 14.5,
      variables: ["temperature"],
    })).rejects.toThrow(/contract bug/);
    expect(ncss.fetch).not.toHaveBeenCalled();
  });

  it("prefers fileServer for pre-2021 point queries and falls back to NCSS", async () => {
    const aws = { fetch: vi.fn(), fetchArea: vi.fn() };
    const fileServer = {
      fetch: vi.fn(async () => {
        throw new UpstreamUnavailableError("fileServer unavailable", {
          retryable: true,
          details: { provider: "NOAA NCEI" },
        });
      }),
    };
    const ncss = {
      fetch: vi.fn(async () => ncssPointResponse(true)),
      fetchArea: vi.fn(),
    };
    const routed = new RoutedGfsAnalysisSource({ aws, fileServer, ncss });
    const result = await routed.fetch({
      analysisTime: new Date("2017-05-09T00:00:00Z"),
      latitude: 50,
      longitude: 14.5,
      variables: ["temperature"],
    });
    expect(result.cacheHit).toBe(true);
    expect(aws.fetch).not.toHaveBeenCalled();
    expect(fileServer.fetch).toHaveBeenCalledTimes(1);
    expect(ncss.fetch).toHaveBeenCalledTimes(1);
  });

  it("routes pre-2021 area requests directly to NCSS", async () => {
    const fileServer = { fetch: vi.fn() };
    const ncss = {
      fetch: vi.fn(),
      fetchArea: vi.fn(async () => ncssAreaResponse()),
    };
    const routed = new RoutedGfsAnalysisSource({
      aws: { fetch: vi.fn(), fetchArea: vi.fn() },
      fileServer,
      ncss,
    });
    const result = await routed.fetchArea({
      analysisTime: new Date("2017-05-09T00:00:00Z"),
      westLongitude: 13,
      eastLongitude: 15,
      southLatitude: 49,
      northLatitude: 51,
      variable: "temperature",
      verticalCoordinate: 85000,
    });
    expect(result.dataset).toBe("ncss-area");
    expect(result.points).toHaveLength(1);
    expect(fileServer.fetch).not.toHaveBeenCalled();
    expect(ncss.fetchArea).toHaveBeenCalledTimes(1);
  });

  it("surfaces the actual NCSS error for pre-2021 area requests", async () => {
    const terminal = new UpstreamUnavailableError("NCSS IAM failure", {
      retryable: false,
      details: { provider: "NOAA NCEI", status: 403 },
    });
    const ncss = {
      fetch: vi.fn(),
      fetchArea: vi.fn(async () => { throw terminal; }),
    };
    const routed = new RoutedGfsAnalysisSource({
      aws: { fetch: vi.fn(), fetchArea: vi.fn() },
      fileServer: { fetch: vi.fn() },
      ncss,
    });
    await expect(routed.fetchArea({
      analysisTime: new Date("2017-05-09T00:00:00Z"),
      westLongitude: 13,
      eastLongitude: 15,
      southLatitude: 49,
      northLatitude: 51,
      variable: "temperature",
    })).rejects.toBe(terminal);
  });

  it("refuses AWS requests before the Open Data archive start", async () => {
    const source = new AwsGfsAnalysisSource({
      fetchFn: vi.fn() as unknown as typeof fetch,
    });
    await expect(source.fetch({
      analysisTime: new Date("2017-05-09T00:00:00Z"),
      latitude: 50,
      longitude: 14.5,
      variables: ["temperature"],
    })).rejects.toThrow("begins at 2021-01-01");
    expect(buildGfsS3ForecastIndexUrl(new Date("2024-06-01T00:00:00Z"), 0, "0p50"))
      .toContain("/atmos/gfs.t00z.pgrb2.0p50.f000.idx");
  });

  it("requires nceiAccessPolicy when constructing real fileServer/NCSS children", () => {
    expect(() => new RoutedGfsAnalysisSource({})).toThrow(/nceiAccessPolicy/);
    expect(() => new RoutedGfsAnalysisSource({
      nceiAccessPolicy: passthroughPolicy,
      fetchFn: vi.fn() as unknown as typeof fetch,
    })).not.toThrow();
  });

  it("rethrows the primary error when NCSS also fails as unavailable", async () => {
    const aws = {
      fetch: vi.fn(async () => {
        throw new UpstreamUnavailableError("aws primary", {
          details: { provider: "NOAA AWS Open Data" },
        });
      }),
      fetchArea: vi.fn(),
    };
    const ncss = {
      fetch: vi.fn(async () => {
        throw new DataUnavailableError("ncss also gone", {
          details: { provider: "NOAA NCEI" },
        });
      }),
      fetchArea: vi.fn(),
    };
    const routed = new RoutedGfsAnalysisSource({
      aws,
      fileServer: { fetch: vi.fn() },
      ncss,
    });
    await expect(routed.fetch({
      analysisTime: new Date("2024-06-01T00:00:00Z"),
      latitude: 50,
      longitude: 14.5,
      variables: ["temperature"],
    })).rejects.toThrow(/aws primary/);
  });

  it("rethrows a non-fallback NCSS error instead of the primary", async () => {
    const aws = {
      fetch: vi.fn(async () => {
        throw new UpstreamUnavailableError("aws primary", {
          details: { provider: "NOAA AWS Open Data" },
        });
      }),
      fetchArea: vi.fn(),
    };
    const ncss = {
      fetch: vi.fn(async () => { throw new Error("ncss contract bug"); }),
      fetchArea: vi.fn(),
    };
    const routed = new RoutedGfsAnalysisSource({
      aws,
      fileServer: { fetch: vi.fn() },
      ncss,
    });
    await expect(routed.fetch({
      analysisTime: new Date("2024-06-01T00:00:00Z"),
      latitude: 50,
      longitude: 14.5,
      variables: ["temperature"],
    })).rejects.toThrow(/ncss contract bug/);
  });
});

describe("AwsGfsAnalysisSource decode path", () => {
  const analysisTime = new Date("2024-06-01T00:00:00Z");
  const point = { latitude: 50.25, longitude: 10.5 };

  it("decodes an isobaric point subset from mocked AWS range GETs", async () => {
    const msg = analysisMessage({
      category: 0,
      parameter: 0,
      surfaceType: 100,
      surfaceValue: 85000,
    });
    const source = new AwsGfsAnalysisSource({
      fetchFn: mockAwsFetch(msg, [indexLine(1, 0, "TMP", "850 mb")]),
      retryOptions: fastRetry,
      rangeConcurrency: 1,
    });
    const result = await source.fetch({
      analysisTime,
      ...point,
      variables: ["temperature"],
    });
    expect(result).toMatchObject({
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      cacheHit: false,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.pressureHpa).toBe(850);
    expect(result.rows[0]?.values.temperature).toBeDefined();
  });

  it("decodes surface, HAG, and PWAT point selectors from one index", async () => {
    const surface = analysisMessage({
      category: 3,
      parameter: 0,
      surfaceType: 1,
      surfaceValue: 0,
      values: [101_000, 101_100, 101_200, 101_300, 101_400, 101_500],
    });
    const hag = analysisMessage({
      category: 0,
      parameter: 0,
      surfaceType: 103,
      surfaceValue: 2,
      values: [290, 291, 292, 293, 294, 295],
    });
    const pwat = analysisMessage({
      category: 1,
      parameter: 3,
      surfaceType: 10,
      surfaceValue: 0,
      values: [20, 21, 22, 23, 24, 25],
    });
    const blob = concat([surface, hag, pwat]);
    const source = new AwsGfsAnalysisSource({
      fetchFn: mockAwsFetch(blob, [
        indexLine(1, 0, "PRES", "surface"),
        indexLine(2, surface.byteLength, "TMP", "2 m above ground"),
        indexLine(
          3,
          surface.byteLength + hag.byteLength,
          "PWAT",
          "entire atmosphere (considered as a single layer)",
        ),
      ]),
      retryOptions: fastRetry,
      rangeConcurrency: 2,
    });
    const result = await source.fetch({
      analysisTime,
      ...point,
      variables: ["surface_pressure", "temperature_2m", "precipitable_water"],
    });
    expect(result.rows.some((row) => row.values.surface_pressure !== undefined)).toBe(true);
    expect(result.rows.some((row) => row.values.temperature_2m !== undefined)).toBe(true);
    expect(result.rows.some((row) => row.values.precipitable_water !== undefined)).toBe(true);
    expect(result.access).toBe("s3_range");
  });

  it("decodes an isobaric area subset narrowed to one pressure", async () => {
    const msg = analysisMessage({
      category: 0,
      parameter: 0,
      surfaceType: 100,
      surfaceValue: 85000,
    });
    const source = new AwsGfsAnalysisSource({
      fetchFn: mockAwsFetch(msg, [indexLine(1, 0, "TMP", "850 mb")]),
      retryOptions: fastRetry,
    });
    const result = await source.fetchArea({
      analysisTime,
      westLongitude: 9.9,
      eastLongitude: 11.1,
      southLatitude: 49.9,
      northLatitude: 50.6,
      variable: "temperature",
      verticalCoordinate: 85000,
    });
    expect(result.provider).toBe("NOAA AWS Open Data");
    expect(result.variable).toBe("temperature");
    expect(result.verticalCoordinate).toBe(85000);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it("decodes an exact HAG area request", async () => {
    const hag = analysisMessage({
      category: 0,
      parameter: 0,
      surfaceType: 103,
      surfaceValue: 2,
      values: [290, 291, 292, 293, 294, 295],
    });
    const source = new AwsGfsAnalysisSource({
      fetchFn: mockAwsFetch(hag, [indexLine(1, 0, "TMP", "2 m above ground")]),
      retryOptions: fastRetry,
    });
    const result = await source.fetchArea({
      analysisTime,
      westLongitude: 9.9,
      eastLongitude: 11.1,
      southLatitude: 49.9,
      northLatitude: 50.6,
      variable: "temperature_2m",
      verticalCoordinate: 2,
    });
    expect(result.variable).toBe("temperature_2m");
    expect(result.verticalCoordinate).toBe(2);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it("maps index and range HTTP failures into the public taxonomy", async () => {
    const indexFail = new AwsGfsAnalysisSource({
      fetchFn: vi.fn(async () => new Response("gone", { status: 404 })) as unknown as typeof fetch,
      retryOptions: fastRetry,
    });
    await expect(indexFail.fetch({
      analysisTime,
      ...point,
      variables: ["temperature"],
    })).rejects.toBeInstanceOf(DataUnavailableError);

    const msg = analysisMessage({
      category: 0,
      parameter: 0,
      surfaceType: 100,
      surfaceValue: 85000,
    });
    const rangeFail = new AwsGfsAnalysisSource({
      fetchFn: vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith(".idx")) {
          return new Response(`${indexLine(1, 0, "TMP", "850 mb")}\n`, { status: 200 });
        }
        return new Response(msg, { status: 200 });
      }) as unknown as typeof fetch,
      retryOptions: fastRetry,
    });
    await expect(rangeFail.fetch({
      analysisTime,
      ...point,
      variables: ["temperature"],
    })).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it("rejects range bodies that are not GRIB", async () => {
    const source = new AwsGfsAnalysisSource({
      fetchFn: vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith(".idx")) {
          return new Response(`${indexLine(1, 0, "TMP", "850 mb")}\n`, { status: 200 });
        }
        return new Response("NOTGRIB", { status: 206 });
      }) as unknown as typeof fetch,
      retryOptions: fastRetry,
    });
    await expect(source.fetch({
      analysisTime,
      ...point,
      variables: ["temperature"],
    })).rejects.toThrow(/did not start with a GRIB message/);
  });
});

describe("GFS analysis cache", () => {
  let cacheRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(cacheRoots.map((root) => rm(root, { recursive: true, force: true })));
    cacheRoots = [];
  });

  it("keys by canonical request rather than provider URL and preserves typed provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-gfs-analysis-cache-"));
    cacheRoots.push(root);
    const source = {
      fetch: vi.fn(async () => ({
        rows: [{
          latitude: 50,
          longitude: 14,
          pressureHpa: 850,
          values: { temperature: 285.15 },
        }],
        dataset: "aws-object",
        cacheHit: false,
        provider: "NOAA AWS Open Data" as const,
        access: "s3_range" as const,
      })),
      fetchArea: vi.fn(),
    };
    const cache = new CachedGfsAnalysisSource(root, source);
    const request = {
      analysisTime: new Date("2024-06-01T00:00:00Z"),
      latitude: 50,
      longitude: 14,
      variables: ["temperature"] as const,
    };
    const first = await cache.fetch(request);
    const second = await cache.fetch(request);
    expect(first.cacheHit).toBe(false);
    expect(second).toMatchObject({
      cacheHit: true,
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      dataset: "aws-object",
    });
    expect(second.rows[0]?.values.temperature).toBe(285.15);
    expect(source.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("NceiGfsFileServerAnalysisSource decode path", () => {
  const analysisTime = new Date("2017-05-09T00:00:00Z");
  const point = { latitude: 50.25, longitude: 10.5 };
  let cacheRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(cacheRoots.map((root) => rm(root, { recursive: true, force: true })));
    cacheRoots = [];
  });

  it("decodes a full-file point query without a file store", async () => {
    const msg = analysisMessage({
      category: 0,
      parameter: 0,
      surfaceType: 100,
      surfaceValue: 85000,
    });
    const fetchFn = vi.fn(async () => new Response(msg, { status: 200 })) as unknown as typeof fetch;
    const source = new NceiGfsFileServerAnalysisSource({
      accessPolicy: passthroughPolicy,
      fetchFn,
      retryOptions: fastRetry,
    });
    const result = await source.fetch({
      analysisTime,
      ...point,
      variables: ["temperature"],
    });
    expect(result).toMatchObject({
      provider: "NOAA NCEI",
      access: "ncei_thredds_fileserver",
      cacheHit: false,
    });
    expect(result.rows[0]?.values.temperature).toBeDefined();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("caches full analysis objects through CachedGfsAnalysisFileStore", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-gfs-analysis-file-"));
    cacheRoots.push(root);
    const msg = analysisMessage({
      category: 0,
      parameter: 0,
      surfaceType: 100,
      surfaceValue: 85000,
    });
    const fetchFn = vi.fn(async () => new Response(msg, { status: 200 })) as unknown as typeof fetch;
    const source = new NceiGfsFileServerAnalysisSource({
      accessPolicy: passthroughPolicy,
      fetchFn,
      retryOptions: fastRetry,
      fileStore: new CachedGfsAnalysisFileStore(root),
    });
    const request = {
      analysisTime,
      ...point,
      variables: ["temperature"] as const,
    };
    const first = await source.fetch(request);
    const second = await source.fetch(request);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(second.rows).toEqual(first.rows);
  });

  it("refuses AWS-era and pre-history analysis times", async () => {
    const source = new NceiGfsFileServerAnalysisSource({
      accessPolicy: passthroughPolicy,
      fetchFn: vi.fn() as unknown as typeof fetch,
      retryOptions: fastRetry,
    });
    await expect(source.fetch({
      analysisTime: new Date("2000-01-01T00:00:00Z"),
      ...point,
      variables: ["temperature"],
    })).rejects.toThrow(/begins at/);

    await expect(source.fetch({
      analysisTime: new Date("2024-06-01T00:00:00Z"),
      ...point,
      variables: ["temperature"],
    })).rejects.toThrow(/reserved for cycles before/);
  });

  it.each([
    [404, DataUnavailableError],
    [429, RateLimitedError],
    [503, UpstreamUnavailableError],
  ] as const)("maps HTTP %i onto %s", async (status, ErrorType) => {
    const source = new NceiGfsFileServerAnalysisSource({
      accessPolicy: passthroughPolicy,
      fetchFn: vi.fn(async () => new Response("fail", { status })) as unknown as typeof fetch,
      retryOptions: fastRetry,
    });
    await expect(source.fetch({
      analysisTime,
      ...point,
      variables: ["temperature"],
    })).rejects.toBeInstanceOf(ErrorType);
  });

  it("rejects non-GRIB fileServer bodies", async () => {
    const source = new NceiGfsFileServerAnalysisSource({
      accessPolicy: passthroughPolicy,
      fetchFn: vi.fn(async () => new Response("<html>nope</html>", { status: 200 })) as unknown as typeof fetch,
      retryOptions: fastRetry,
    });
    await expect(source.fetch({
      analysisTime,
      ...point,
      variables: ["temperature"],
    })).rejects.toThrow(/non-GRIB/);
  });

  it("maps other non-2xx statuses through upstreamHttpFailure", async () => {
    const source = new NceiGfsFileServerAnalysisSource({
      accessPolicy: passthroughPolicy,
      fetchFn: vi.fn(async () => new Response("forbidden", { status: 403 })) as unknown as typeof fetch,
      retryOptions: fastRetry,
    });
    await expect(source.fetch({
      analysisTime,
      ...point,
      variables: ["temperature"],
    })).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it("fails when the GRIB file has no values matching the requested canonical IDs", async () => {
    const msg = analysisMessage({
      category: 0,
      parameter: 0,
      surfaceType: 100,
      surfaceValue: 85000,
    });
    const source = new NceiGfsFileServerAnalysisSource({
      accessPolicy: passthroughPolicy,
      fetchFn: vi.fn(async () => new Response(msg, { status: 200 })) as unknown as typeof fetch,
      retryOptions: fastRetry,
    });
    await expect(source.fetch({
      analysisTime,
      ...point,
      variables: ["surface_pressure"],
    })).rejects.toThrow(/decoded no values/);
  });
});
