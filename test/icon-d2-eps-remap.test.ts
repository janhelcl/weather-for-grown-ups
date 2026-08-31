import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IconD2EpsCdoRemapper,
  IconD2EpsDwdRemapAssetCache,
  IconD2EpsRemappedSubsetCache,
  extractSelectedTarFiles,
} from "../src/cache/icon-d2-eps-remap-cache.js";
import type {
  IconD2DataRequest,
  IconD2SubsetCache,
} from "../src/cache/icon-d2-open-data-cache.js";
import { VARIABLE_CATALOG } from "../src/catalog/variables.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
      "DWD ICON-D2 remapping-asset request failed: HTTP 503",
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

describe("ICON-D2-EPS CDO remap cache", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "wfg-icon-d2-eps-cdo-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("remaps once with the official grid/weights and then reuses the immutable result", async () => {
    const sourcePath = join(rootDir, "native.grib2");
    const targetGridPath = join(rootDir, "target.txt");
    const weightsPath = join(rootDir, "weights.nc");
    await Promise.all([
      writeFile(sourcePath, "GRIB-NATIVE"),
      writeFile(targetGridPath, "grid"),
      writeFile(weightsPath, "weights"),
    ]);
    const runner = vi.fn(async (_executable: string, args: string[]) => {
      await writeFile(args.at(-1)!, "GRIB-REMAPPED");
      return { stdout: "processed" };
    });
    const remapper = new IconD2EpsCdoRemapper(
      join(rootDir, "remapped"),
      { paths: async () => ({ targetGridPath, weightsPath }) },
      "cdo-test",
      runner,
    );

    const first = await remapper.remap(sourcePath);
    expect(first.cacheHit).toBe(false);
    expect(decoder.decode(await readFile(first.path))).toBe("GRIB-REMAPPED");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]![1]).toEqual([
      "-f",
      "grb2",
      `remap,${targetGridPath},${weightsPath}`,
      sourcePath,
      expect.stringContaining(".tmp"),
    ]);

    const second = await remapper.remap(sourcePath);
    expect(second).toMatchObject({ path: first.path, cacheHit: true });
    expect(runner).toHaveBeenCalledTimes(1);
  });


  it("deduplicates concurrent remaps and reports the waiter as a cache hit", async () => {
    const sourcePath = join(rootDir, "native-concurrent.grib2");
    const targetGridPath = join(rootDir, "target-concurrent.txt");
    const weightsPath = join(rootDir, "weights-concurrent.nc");
    await Promise.all([
      writeFile(sourcePath, "GRIB-NATIVE"),
      writeFile(targetGridPath, "grid"),
      writeFile(weightsPath, "weights"),
    ]);

    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const runner = vi.fn(async (_executable: string, args: string[]) => {
      markStarted();
      await gate;
      await writeFile(args.at(-1)!, "GRIB-REMAPPED");
      return { stdout: "processed" };
    });
    const remapper = new IconD2EpsCdoRemapper(
      join(rootDir, "concurrent"),
      { paths: async () => ({ targetGridPath, weightsPath }) },
      "cdo-test",
      runner,
    );

    const firstPending = remapper.remap(sourcePath);
    await started;
    const secondPending = remapper.remap(sourcePath);
    release();
    const [first, second] = await Promise.all([firstPending, secondPending]);

    expect(first.cacheHit).toBe(false);
    expect(second).toEqual({ path: first.path, cacheHit: true });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("preserves non-ENOENT CDO failures unchanged", async () => {
    const sourcePath = join(rootDir, "native-error.grib2");
    await writeFile(sourcePath, "GRIB-NATIVE");
    const remapper = new IconD2EpsCdoRemapper(
      join(rootDir, "generic-error"),
      {
        paths: async () => ({
          targetGridPath: join(rootDir, "target.txt"),
          weightsPath: join(rootDir, "weights.nc"),
        }),
      },
      "cdo-test",
      async () => { throw new Error("CDO processing failed"); },
    );
    await expect(remapper.remap(sourcePath)).rejects.toThrow("CDO processing failed");
  });

  it("surfaces missing CDO and empty remap output clearly", async () => {
    const sourcePath = join(rootDir, "native.grib2");
    await writeFile(sourcePath, "GRIB-NATIVE");
    const assets = {
      paths: async () => ({
        targetGridPath: join(rootDir, "target.txt"),
        weightsPath: join(rootDir, "weights.nc"),
      }),
    };

    const missing = new IconD2EpsCdoRemapper(
      join(rootDir, "missing"),
      assets,
      "missing-cdo",
      async () => { throw new Error("spawn missing-cdo ENOENT"); },
    );
    await expect(missing.remap(sourcePath)).rejects.toThrow(
      "ICON-D2-EPS requires native CDO",
    );

    const empty = new IconD2EpsCdoRemapper(
      join(rootDir, "empty"),
      assets,
      "cdo-test",
      async (_executable, args) => {
        await writeFile(args.at(-1)!, new Uint8Array());
        return { stdout: "" };
      },
    );
    await expect(empty.remap(sourcePath)).rejects.toThrow(
      "CDO produced an empty ICON-D2-EPS remapped GRIB",
    );
  });

  it("preserves source/remap cache provenance in the subset wrapper", async () => {
    const request = sampleRequest();
    const source: IconD2SubsetCache = {
      fetch: vi.fn(async () => ({ path: "/tmp/native.grib2", cacheHit: true })),
      isForecastAvailable: vi.fn(async () => true),
    };
    const remapper = {
      remap: vi.fn(async () => ({ path: "/tmp/remapped.grib2", cacheHit: false })),
    } as unknown as IconD2EpsCdoRemapper;
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
