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
import {
  formatHistoricalAreaCsv,
  formatHistoricalPointCsv,
  heightMetresFromGribLevel,
  historicalNcssSelectors,
  ncssNameForDecodedValue,
  rowsFromDecodedPointValues,
} from "../src/sources/gfs-analysis-grib.js";
import { AwsGfsAnalysisSource } from "../src/sources/gfs-analysis-aws.js";
import {
  NceiGfsFileServerAnalysisSource,
  buildNceiGfsAnalysisFileServerUrl,
} from "../src/sources/gfs-analysis-fileserver.js";
import { RoutedGfsAnalysisSource } from "../src/sources/gfs-analysis-routed.js";
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

/** Remap a native ICON fixture onto a regular 2×3 grid that gribberish can decode. */
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

const fastRetry = { maxAttempts: 1 as const, baseDelayMs: 0, jitterRatio: 0 };

describe("historical NCSS ↔ GRIB mapping", () => {
  it("maps isobaric and surface NCSS names onto GFS index selectors", () => {
    expect(historicalNcssSelectors([
      "Temperature_isobaric",
      "Pressure_surface",
      "Temperature_height_above_ground",
      "Precipitable_water_entire_atmosphere_single_layer",
    ])).toEqual([
      { ncssName: "Temperature_isobaric", gfsCode: "TMP", kind: "isobaric" },
      { ncssName: "Pressure_surface", gfsCode: "PRES", gribLevel: "surface", kind: "surface_or_column" },
      { ncssName: "Temperature_height_above_ground", gfsCode: "TMP", kind: "surface_or_column" },
      {
        ncssName: "Precipitable_water_entire_atmosphere_single_layer",
        gfsCode: "PWAT",
        gribLevel: "entire atmosphere (considered as a single layer)",
        kind: "surface_or_column",
      },
    ]);
    expect(() => historicalNcssSelectors(["not_a_real_ncss_name"]))
      .toThrow("No GFS GRIB mapping");
  });

  it("formats NCSS-shaped point and area CSV that the historical parsers accept", () => {
    const pointCsv = formatHistoricalPointCsv([
      {
        latitude: 50,
        longitude: 14.5,
        pressurePa: 85000,
        values: { Temperature_isobaric: 285.15, Relative_humidity_isobaric: 65 },
      },
      {
        latitude: 50,
        longitude: 14.5,
        pressurePa: 70000,
        values: { Temperature_isobaric: 273.15, Relative_humidity_isobaric: 40 },
      },
    ]);
    expect(pointCsv).toContain('vertCoord[unit="Pa"]');
    expect(pointCsv).toContain("Temperature_isobaric[unit=\"1\"]");
    expect(pointCsv).toContain("85000");

    const areaCsv = formatHistoricalAreaCsv(
      "Temperature_isobaric",
      [
        { latitude: 50, longitude: 14, value: 283.15 },
        { latitude: 50, longitude: 14.5, value: 285.15 },
      ],
      { pressurePa: 85000 },
    );
    expect(areaCsv.split("\n").filter(Boolean)).toHaveLength(3);
  });

  it("rejects empty CSV payloads", () => {
    expect(() => formatHistoricalPointCsv([])).toThrow(/empty historical analysis CSV/);
    expect(() => formatHistoricalAreaCsv("Temperature_isobaric", [])).toThrow(
      /empty historical area CSV/,
    );
    expect(() => formatHistoricalAreaCsv("Temperature_isobaric", [
      { latitude: 50, longitude: 14, value: Number.NaN },
    ])).toThrow(/no defined grid points/);
  });

  it("parses height metres from GRIB level strings", () => {
    expect(heightMetresFromGribLevel("2 m above ground")).toBe(2);
    expect(heightMetresFromGribLevel("80 m above ground")).toBe(80);
    expect(heightMetresFromGribLevel("surface")).toBeUndefined();
    expect(heightMetresFromGribLevel(undefined)).toBeUndefined();
  });

  it("groups decoded point values into NCSS rows by vertical coordinate", () => {
    const heightSelectors = historicalNcssSelectors([
      "Temperature_isobaric",
      "Temperature_height_above_ground",
    ]);
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
    ], heightSelectors);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      pressurePa: 85000,
      values: { Temperature_isobaric: 285.15 },
    });
    expect(rows[1]).toMatchObject({
      heightAboveGroundM: 2,
      values: { Temperature_height_above_ground: 290 },
    });
  });

  it("matches surface and entire-atmosphere decoded values onto NCSS names", () => {
    const selectors = historicalNcssSelectors([
      "Pressure_surface",
      "Precipitable_water_entire_atmosphere_single_layer",
    ]);
    expect(ncssNameForDecodedValue({
      code: "PRES",
      surface: true,
      value: 101_325,
      gridPoint: { latitude: 50, longitude: 14.5 },
    }, selectors)).toBe("Pressure_surface");
    expect(ncssNameForDecodedValue({
      code: "PWAT",
      namedVertical: "entire atmosphere",
      value: 22,
      gridPoint: { latitude: 50, longitude: 14.5 },
    }, selectors)).toBe("Precipitable_water_entire_atmosphere_single_layer");
    expect(ncssNameForDecodedValue({
      code: "PWAT",
      value: 18,
      gridPoint: { latitude: 50, longitude: 14.5 },
    }, selectors)).toBe("Precipitable_water_entire_atmosphere_single_layer");
  });

  it("matches an explicit height GRIB level onto the shared HAG NCSS name", () => {
    const selectors = [{
      ncssName: "Temperature_height_above_ground",
      gfsCode: "TMP",
      gribLevel: "2 m above ground",
      kind: "surface_or_column" as const,
    }];
    expect(ncssNameForDecodedValue({
      code: "TMP",
      heightAboveGroundM: 2,
      value: 291,
      gridPoint: { latitude: 50, longitude: 14.5 },
    }, selectors)).toBe("Temperature_height_above_ground");
    expect(ncssNameForDecodedValue({
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
      fetch: vi.fn(async () => ({
        csv: "latitude,longitude,Temperature_isobaric\n50,14.5,285.15\n",
        dataset: "ncss-dataset",
        cacheHit: false,
        ...NCEI_NCSS_PROVENANCE,
      })),
      fetchArea: vi.fn(),
    };
    const routed = new RoutedGfsAnalysisSource({ aws, fileServer, ncss });
    const result = await routed.fetch({
      analysisTime: new Date("2024-06-01T00:00:00Z"),
      latitude: 50,
      longitude: 14.5,
      variables: ["Temperature_isobaric"],
    });
    expect(result.access).toBe("ncei_thredds_ncss");
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
      fetch: vi.fn(async () => ({
        csv: "latitude,longitude,Temperature_isobaric\n50,14.5,285.15\n",
        dataset: "ncss",
        cacheHit: false,
        ...NCEI_NCSS_PROVENANCE,
      })),
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
      variables: ["Temperature_isobaric"],
    })).resolves.toMatchObject({ access: "ncei_thredds_ncss" });
  });

  it("does not fall back when the primary fails with a non-upstream error", async () => {
    const aws = {
      fetch: vi.fn(async () => {
        throw new Error("contract bug");
      }),
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
      variables: ["Temperature_isobaric"],
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
      fetch: vi.fn(async () => ({
        csv: "latitude,longitude,Temperature_isobaric\n50,14.5,285.15\n",
        dataset: "legacy",
        cacheHit: true,
        ...NCEI_NCSS_PROVENANCE,
      })),
      fetchArea: vi.fn(),
    };
    const routed = new RoutedGfsAnalysisSource({ aws, fileServer, ncss });
    const result = await routed.fetch({
      analysisTime: new Date("2017-05-09T00:00:00Z"),
      latitude: 50,
      longitude: 14.5,
      variables: ["Temperature_isobaric"],
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
      fetchArea: vi.fn(async () => ({
        csv: "latitude,longitude,Temperature_isobaric\n50,14,285\n",
        dataset: "ncss-area",
        cacheHit: false,
        ...NCEI_NCSS_PROVENANCE,
      })),
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
      variables: ["Temperature_isobaric"],
      verticalCoordinate: 85000,
    });
    expect(result.dataset).toBe("ncss-area");
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
      variables: ["Temperature_isobaric"],
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
      variables: ["Temperature_isobaric"],
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
      variables: ["Temperature_isobaric"],
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
      fetch: vi.fn(async () => {
        throw new Error("ncss contract bug");
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
      variables: ["Temperature_isobaric"],
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
      variables: ["Temperature_isobaric"],
    });
    expect(result).toMatchObject({
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      cacheHit: false,
    });
    expect(result.csv).toContain("Temperature_isobaric");
    expect(result.csv).toContain("85000");
    expect(result.csv).toMatch(/281/);
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
      variables: [
        "Pressure_surface",
        "Temperature_height_above_ground",
        "Precipitable_water_entire_atmosphere_single_layer",
      ],
    });
    expect(result.csv).toContain("Pressure_surface");
    expect(result.csv).toContain("Temperature_height_above_ground");
    expect(result.csv).toContain("Precipitable_water_entire_atmosphere_single_layer");
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
      variables: ["Temperature_isobaric"],
      verticalCoordinate: 85000,
    });
    expect(result.provider).toBe("NOAA AWS Open Data");
    expect(result.csv.split("\n").filter(Boolean).length).toBeGreaterThan(2);
    expect(result.csv).toContain("85000");
  });

  it("narrows multi-height HAG area requests to the requested metre level", async () => {
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
      variables: ["Temperature_height_above_ground"],
      verticalCoordinate: 2,
    });
    expect(result.csv).toContain("Temperature_height_above_ground");
    expect(result.csv).toContain("height_above_ground");
  });

  it("rejects multi-variable area requests", async () => {
    const source = new AwsGfsAnalysisSource({
      fetchFn: vi.fn() as unknown as typeof fetch,
    });
    await expect(source.fetchArea({
      analysisTime,
      westLongitude: 10,
      eastLongitude: 11,
      southLatitude: 50,
      northLatitude: 51,
      variables: ["Temperature_isobaric", "Relative_humidity_isobaric"],
    })).rejects.toThrow(/exactly one NCSS variable/);
  });

  it("maps index and range HTTP failures into the public taxonomy", async () => {
    const indexFail = new AwsGfsAnalysisSource({
      fetchFn: vi.fn(async () => new Response("gone", { status: 404 })) as unknown as typeof fetch,
      retryOptions: fastRetry,
    });
    await expect(indexFail.fetch({
      analysisTime,
      ...point,
      variables: ["Temperature_isobaric"],
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
      variables: ["Temperature_isobaric"],
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
      variables: ["Temperature_isobaric"],
    })).rejects.toThrow(/did not start with a GRIB message/);
  });
});

describe("GFS analysis cache", () => {
  let cacheRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(cacheRoots.map((root) => rm(root, { recursive: true, force: true })));
    cacheRoots = [];
  });

  it("keys by canonical request rather than provider URL and preserves provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-gfs-analysis-cache-"));
    cacheRoots.push(root);
    const source = {
      fetch: vi.fn(async () => ({
        csv: "latitude,longitude,Temperature_isobaric\n50,14,285\n",
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
      variables: ["Temperature_isobaric"] as const,
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
      variables: ["Temperature_isobaric"],
    });
    expect(result).toMatchObject({
      provider: "NOAA NCEI",
      access: "ncei_thredds_fileserver",
      cacheHit: false,
    });
    expect(result.csv).toContain("Temperature_isobaric");
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
      variables: ["Temperature_isobaric"] as const,
    };
    const first = await source.fetch(request);
    const second = await source.fetch(request);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(second.csv).toBe(first.csv);
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
      variables: ["Temperature_isobaric"],
    })).rejects.toThrow(/begins at/);

    await expect(source.fetch({
      analysisTime: new Date("2024-06-01T00:00:00Z"),
      ...point,
      variables: ["Temperature_isobaric"],
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
      variables: ["Temperature_isobaric"],
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
      variables: ["Temperature_isobaric"],
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
      variables: ["Temperature_isobaric"],
    })).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it("fails when the GRIB file has no values matching the requested NCSS names", async () => {
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
      variables: ["Pressure_surface"],
    })).rejects.toThrow(/decoded no values/);
  });
});
