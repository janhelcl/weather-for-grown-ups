import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMessagesFromBuffer } from "@mattnucc/gribberish";
import {
  IconD2EpsDwdRemapAssetCache,
  IconD2EpsGridRemapper,
  IconD2EpsRemapIndexLoader,
  IconD2EpsRemappedSubsetCache,
  extractSelectedTarFiles,
} from "../src/cache/icon-d2-eps-remap-cache.js";
import type {
  IconD2DataRequest,
  IconD2SubsetCache,
} from "../src/cache/icon-d2-open-data-cache.js";
import { VARIABLE_CATALOG } from "../src/catalog/variables.js";
import { scanGrib2Messages } from "../src/grib/dwd-local-parameters.js";
import type { NearestNeighbourRemapIndex } from "../src/grib/icon-d2-remap.js";
import {
  NATIVE_CELLS,
  TARGET_GRID,
  concat,
  nativeIconMessage,
  scripNetcdf,
} from "./icon-d2-fixtures.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
/** Pack small integers exactly: reference 0, no binary/decimal scaling. */
const INTEGER_PACKING = { referenceValue: 0, binaryScale: 0, decimalScale: 0 } as const;

describe("ICON-D2-EPS official DWD remapping assets", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "wfg-icon-d2-eps-remap-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("extracts the two provider files from a plain tar despite the .tar.bz2 name", async () => {
    const tar = makeTar([
      ["nested/target_grid_icon_d2_002.txt", encoder.encode("grid")],
      ["weights_icon_d2_002.nc", encoder.encode("weights")],
      ["ignored.txt", encoder.encode("ignore")],
    ]);
    const fetchFn = vi.fn(async () => new Response(tar, { status: 200 }));
    const decompress = vi.fn(async () => {
      throw new Error("plain tar must not be decompressed");
    });
    const cache = new IconD2EpsDwdRemapAssetCache(
      rootDir,
      fetchFn as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
      decompress,
    );

    const first = await cache.paths();
    expect(decoder.decode(await readFile(first.targetGridPath))).toBe("grid");
    expect(decoder.decode(await readFile(first.weightsPath))).toBe("weights");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0]![0])).toBe(
      "https://opendata.dwd.de/weather/lib/cdo/ICON_D2_002_EASY.tar.bz2",
    );
    expect(decompress).not.toHaveBeenCalled();

    const second = await cache.paths();
    expect(second).toEqual(first);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("accepts a genuinely bzip2-wrapped bundle too", async () => {
    const tar = makeTar([
      ["target_grid_icon_d2_002.txt", encoder.encode("grid")],
      ["weights_icon_d2_002.nc", encoder.encode("weights")],
    ]);
    const fetchFn = vi.fn(async () =>
      new Response(new Uint8Array([0x42, 0x5a, 0x68, 0x01]), { status: 200 }),
    );
    const decompress = vi.fn(async () => tar);
    const cache = new IconD2EpsDwdRemapAssetCache(
      rootDir,
      fetchFn as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
      decompress,
    );

    await expect(cache.paths()).resolves.toMatchObject({
      targetGridPath: expect.stringContaining("target_grid_icon_d2_002.txt"),
      weightsPath: expect.stringContaining("weights_icon_d2_002.nc"),
    });
    expect(decompress).toHaveBeenCalledTimes(1);
  });

  it("reuses provider assets that are already materialized", async () => {
    const targetGridPath = join(rootDir, "target_grid_icon_d2_002.txt");
    const weightsPath = join(rootDir, "weights_icon_d2_002.nc");
    await writeFile(targetGridPath, "grid");
    await writeFile(weightsPath, "weights");
    const fetchFn = vi.fn();

    const cache = new IconD2EpsDwdRemapAssetCache(
      rootDir,
      fetchFn as unknown as typeof fetch,
    );
    await expect(cache.paths()).resolves.toEqual({ targetGridPath, weightsPath });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fails explicitly on upstream errors and incomplete bundles", async () => {
    const failed = new IconD2EpsDwdRemapAssetCache(
      join(rootDir, "failed"),
      vi.fn(async () => new Response("nope", { status: 503 })) as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
    );
    await expect(failed.paths()).rejects.toThrow(
      "DWD Open Data is unavailable after retries during the ICON-D2 remapping-asset request (HTTP 503",
    );

    const incomplete = new IconD2EpsDwdRemapAssetCache(
      join(rootDir, "incomplete"),
      vi.fn(async () => new Response(makeTar([
        ["target_grid_icon_d2_002.txt", encoder.encode("grid")],
      ]), { status: 200 })) as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
    );
    await expect(incomplete.paths()).rejects.toThrow(
      "did not contain the expected target grid and weights",
    );
  });


  it("retries asset initialization after a transient failure", async () => {
    const tar = makeTar([
      ["target_grid_icon_d2_002.txt", encoder.encode("grid")],
      ["weights_icon_d2_002.nc", encoder.encode("weights")],
    ]);
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response("retry", { status: 404 })
        : new Response(tar, { status: 200 });
    });
    const cache = new IconD2EpsDwdRemapAssetCache(
      join(rootDir, "retry"),
      fetchFn as typeof fetch,
      { run: <T>(operation: () => Promise<T>) => operation() },
    );

    await expect(cache.paths()).rejects.toThrow("HTTP 404");
    await expect(cache.paths()).resolves.toMatchObject({
      targetGridPath: expect.stringContaining("target_grid_icon_d2_002.txt"),
      weightsPath: expect.stringContaining("weights_icon_d2_002.nc"),
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("handles zero-size tar entries and rejects invalid octal sizes", () => {
    const zero = makeTar([["empty.txt", new Uint8Array()]]);
    const extracted = extractSelectedTarFiles(zero, new Set(["empty.txt"]));
    expect(extracted.get("empty.txt")?.byteLength).toBe(0);

    const invalidHeader = tarHeader("bad.txt", 1);
    writeAscii(invalidHeader, 124, 12, "99999999999");
    const invalid = new Uint8Array(1024);
    invalid.set(invalidHeader, 0);
    expect(() => extractSelectedTarFiles(invalid, new Set(["bad.txt"])))
      .toThrow("Invalid tar size field");
  });

  it("rejects truncated tar entries rather than returning partial support data", () => {
    const header = tarHeader("weights_icon_d2_002.nc", 1024);
    const truncated = new Uint8Array(512 + 12);
    truncated.set(header, 0);
    expect(() => extractSelectedTarFiles(
      truncated,
      new Set(["weights_icon_d2_002.nc"]),
    )).toThrow("contains a truncated tar entry");
  });
});

describe("ICON-D2-EPS pure-JS remap cache", () => {
  let rootDir: string;
  let index: NearestNeighbourRemapIndex;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "wfg-icon-d2-eps-js-remap-"));
    index = {
      sourceSize: NATIVE_CELLS,
      targetGrid: TARGET_GRID,
      sourceIndexByTarget: Int32Array.from([0, 1, 2, 3, 4, 5]),
    };
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("loads the DWD index once from the provider grid/weights and shares it", async () => {
    const targetGridPath = join(rootDir, "target_grid_icon_d2_002.txt");
    const weightsPath = join(rootDir, "weights_icon_d2_002.nc");
    await Promise.all([
      writeFile(targetGridPath, [
        "gridtype = lonlat",
        `xsize = ${TARGET_GRID.xsize}`,
        `ysize = ${TARGET_GRID.ysize}`,
        `xfirst = ${TARGET_GRID.xfirst}`,
        `xinc = ${TARGET_GRID.xinc}`,
        `yfirst = ${TARGET_GRID.yfirst}`,
        `yinc = ${TARGET_GRID.yinc}`,
      ].join("\n")),
      writeFile(weightsPath, scripNetcdf({ links: [[1, 2], [2, 1], [3, 3], [4, 4], [5, 5], [6, 6]] })),
    ]);
    const paths = vi.fn(async () => ({ targetGridPath, weightsPath }));
    const loader = new IconD2EpsRemapIndexLoader({ paths });

    const [first, second] = await Promise.all([loader.index(), loader.index()]);
    expect(first).toBe(second);
    expect(first.targetGrid).toEqual(TARGET_GRID);
    expect([...first.sourceIndexByTarget]).toEqual([1, 0, 2, 3, 4, 5]);
    expect(paths).toHaveBeenCalledTimes(1);
  });

  it("retries index loading after an asset failure instead of caching the rejection", async () => {
    let calls = 0;
    const targetGridPath = join(rootDir, "grid.txt");
    const weightsPath = join(rootDir, "weights.nc");
    await Promise.all([
      writeFile(targetGridPath, "gridtype = lonlat\nxsize = 3\nysize = 2\nxfirst = 10\nxinc = 0.5\nyfirst = 50\nyinc = 0.5\n"),
      writeFile(weightsPath, scripNetcdf({ links: [[1, 1]] })),
    ]);
    const loader = new IconD2EpsRemapIndexLoader({
      paths: async () => {
        calls += 1;
        if (calls === 1) throw new Error("DWD Open Data is unavailable");
        return { targetGridPath, weightsPath };
      },
    });
    await expect(loader.index()).rejects.toThrow("DWD Open Data is unavailable");
    await expect(loader.index()).resolves.toMatchObject({ sourceSize: NATIVE_CELLS });
    expect(calls).toBe(2);
  });

  it("remaps once through the DWD index and then reuses the immutable result", async () => {
    const sourcePath = join(rootDir, "native.grib2");
    const native = concat([
      nativeIconMessage({ values: [1, 2, 3, 4, 5, 6], perturbation: 1, ...INTEGER_PACKING }),
      nativeIconMessage({ values: [7, 8, 9, 10, 11, 12], perturbation: 2, ...INTEGER_PACKING }),
    ]);
    await writeFile(sourcePath, native);
    const provider = { index: vi.fn(async () => index) };
    const remapper = new IconD2EpsGridRemapper(join(rootDir, "remapped"), provider);

    const first = await remapper.remap(sourcePath);
    expect(first.cacheHit).toBe(false);
    const remapped = await readFile(first.path);
    const messages = parseMessagesFromBuffer(new Uint8Array(remapped));
    expect(messages.map((message) => message.perturbationNumber)).toEqual([1, 2]);
    expect(messages.map((message) => message.gridShape)).toEqual([
      { rows: 2, cols: 3 },
      { rows: 2, cols: 3 },
    ]);
    expect(messages[1]!.dataAdjusted(true, false)).toEqual([7, 8, 9, 10, 11, 12]);
    expect(provider.index).toHaveBeenCalledTimes(1);

    const second = await remapper.remap(sourcePath);
    expect(second).toMatchObject({ path: first.path, cacheHit: true });
    expect(provider.index).toHaveBeenCalledTimes(1);
  });

  it("keeps DWD local parameters, mean-layer surfaces and UH_MAX identity verbatim", async () => {
    const sourcePath = join(rootDir, "native-identity.grib2");
    await writeFile(sourcePath, concat([
      nativeIconMessage({
        values: [1, 2, 3, 4, 5, 6],
        category: 1,
        parameter: 76,
        surfaceType: 1,
        surfaceValue: 0,
        accumulationHours: 6,
        ...INTEGER_PACKING,
      }),
      nativeIconMessage({ values: [1, 2, 3, 4, 5, 6], category: 7, parameter: 6, surfaceType: 192, surfaceValue: 0, ...INTEGER_PACKING }),
      nativeIconMessage({ values: [1, 2, 3, 4, 5, 6], category: 7, parameter: 15, surfaceType: 102, surfaceValue: 0, ...INTEGER_PACKING }),
    ]));
    const remapper = new IconD2EpsGridRemapper(join(rootDir, "remapped-identity"), { index: async () => index });

    const result = await remapper.remap(sourcePath);
    expect(scanGrib2Messages(new Uint8Array(await readFile(result.path))).map((chunk) => [
      chunk.center,
      chunk.localTable,
      chunk.category,
      chunk.parameter,
      chunk.firstFixedSurfaceType,
    ])).toEqual([
      [78, 1, 1, 76, 1],
      [78, 1, 7, 6, 192],
      [78, 1, 7, 15, 102],
    ]);
  });

  it("deduplicates concurrent remaps and reports the waiter as a cache hit", async () => {
    const sourcePath = join(rootDir, "native-concurrent.grib2");
    await writeFile(sourcePath, nativeIconMessage({ values: [1, 2, 3, 4, 5, 6], ...INTEGER_PACKING }));

    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const provider = {
      index: vi.fn(async () => {
        markStarted();
        await gate;
        return index;
      }),
    };
    const remapper = new IconD2EpsGridRemapper(join(rootDir, "concurrent"), provider);

    const firstPending = remapper.remap(sourcePath);
    await started;
    const secondPending = remapper.remap(sourcePath);
    release();
    const [first, second] = await Promise.all([firstPending, secondPending]);

    expect(first.cacheHit).toBe(false);
    expect(second).toEqual({ path: first.path, cacheHit: true });
    expect(provider.index).toHaveBeenCalledTimes(1);
  });

  it("fails loudly and leaves no partial output when the input is not remappable", async () => {
    const remapper = new IconD2EpsGridRemapper(join(rootDir, "errors"), { index: async () => index });

    const emptyPath = join(rootDir, "empty.grib2");
    await writeFile(emptyPath, new Uint8Array(32));
    await expect(remapper.remap(emptyPath)).rejects.toThrow("contains no GRIB2 messages");

    const mismatchedPath = join(rootDir, "mismatched.grib2");
    await writeFile(mismatchedPath, nativeIconMessage({ values: [1, 2, 3], ...INTEGER_PACKING }));
    await expect(remapper.remap(mismatchedPath)).rejects.toThrow(
      "has 3 native cells but the DWD index addresses 6",
    );

    // Neither a partial .grib2 nor a stray .tmp file may survive a failed remap.
    expect(await readdir(join(rootDir, "errors"))).toEqual([]);
  });

  it("preserves source/remap cache provenance in the subset wrapper", async () => {
    const request = sampleRequest();
    const source: IconD2SubsetCache = {
      fetch: vi.fn(async () => ({ path: "/tmp/native.grib2", cacheHit: true })),
      isForecastAvailable: vi.fn(async () => true),
    };
    const remapper = {
      remap: vi.fn(async () => ({ path: "/tmp/remapped.grib2", cacheHit: false })),
    };
    const cache = new IconD2EpsRemappedSubsetCache(source, remapper);

    await expect(cache.fetch(request)).resolves.toEqual({
      path: "/tmp/remapped.grib2",
      cacheHit: false,
    });
    await expect(cache.isForecastAvailable(
      request.run,
      request.forecastHour,
      { pressure: true, surface: false },
    )).resolves.toBe(true);
  });
});

function sampleRequest(): IconD2DataRequest {
  return {
    run: new Date("2026-08-31T00:00:00Z"),
    forecastHour: 6,
    variables: [VARIABLE_CATALOG.temperature],
    pressureLevelsHpa: [850],
    fields: [],
  };
}

function makeTar(entries: Array<[string, Uint8Array]>): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const [name, data] of entries) {
    const header = tarHeader(name, data.byteLength);
    chunks.push(header, data);
    const padding = (512 - (data.byteLength % 512)) % 512;
    if (padding > 0) chunks.push(new Uint8Array(padding));
  }
  chunks.push(new Uint8Array(1024));
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function tarHeader(name: string, size: number): Uint8Array {
  const header = new Uint8Array(512);
  writeAscii(header, 0, 100, name);
  writeAscii(header, 100, 8, "0000644");
  writeAscii(header, 108, 8, "0000000");
  writeAscii(header, 116, 8, "0000000");
  writeAscii(header, 124, 12, size.toString(8).padStart(11, "0"));
  writeAscii(header, 136, 12, "00000000000");
  writeAscii(header, 156, 1, "0");
  writeAscii(header, 257, 6, "ustar");
  return header;
}

function writeAscii(
  target: Uint8Array,
  offset: number,
  width: number,
  value: string,
): void {
  target.set(encoder.encode(value).subarray(0, width), offset);
}
