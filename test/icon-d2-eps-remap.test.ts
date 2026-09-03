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
import { scanGrib2Messages } from "../src/grib/dwd-local-parameters.js";

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


  it("round-trips DWD local precipitation metadata around CDO", async () => {
    const sourcePath = join(rootDir, "native-rain-con.grib2");
    const targetGridPath = join(rootDir, "target-local.txt");
    const weightsPath = join(rootDir, "weights-local.nc");
    await Promise.all([
      writeFile(sourcePath, minimalDwdLocalGrib2(76)),
      writeFile(targetGridPath, "grid"),
      writeFile(weightsPath, "weights"),
    ]);
    const runner = vi.fn(async (_executable: string, args: string[]) => {
      const preparedPath = args.at(-2)!;
      expect(preparedPath).not.toBe(sourcePath);
      const prepared = await readFile(preparedPath);
      expect(scanGrib2Messages(prepared)[0]).toMatchObject({
        center: 78,
        category: 1,
        parameter: 10,
      });
      await writeFile(args.at(-1)!, prepared);
      return { stdout: "processed local parameter" };
    });
    const remapper = new IconD2EpsCdoRemapper(
      join(rootDir, "remapped-local"),
      { paths: async () => ({ targetGridPath, weightsPath }) },
      "cdo-test",
      runner,
    );

    const result = await remapper.remap(sourcePath);
    expect(scanGrib2Messages(await readFile(result.path))[0]).toMatchObject({
      center: 78,
      category: 1,
      parameter: 76,
    });
  });

  it("restores mean-layer CAPE/CIN fixed-surface identity after CDO", async () => {
    const sourcePath = join(rootDir, "native-mean-layer.grib2");
    const targetGridPath = join(rootDir, "target-mean-layer.txt");
    const weightsPath = join(rootDir, "weights-mean-layer.nc");
    await Promise.all([
      writeFile(sourcePath, concatBytes([
        minimalDwdMeanLayerGrib2(6),
        minimalDwdMeanLayerGrib2(7),
      ])),
      writeFile(targetGridPath, "grid"),
      writeFile(weightsPath, "weights"),
    ]);
    const runner = vi.fn(async (_executable: string, args: string[]) => {
      const prepared = Uint8Array.from(await readFile(args.at(-2)!));
      const chunks = scanGrib2Messages(prepared);
      expect(chunks.map((chunk) => [
        chunk.category,
        chunk.parameter,
        chunk.firstFixedSurfaceType,
      ])).toEqual([
        [7, 6, 192],
        [7, 7, 192],
      ]);
      for (const chunk of chunks) {
        expect(chunk.firstFixedSurfaceTypeOffset).toBeDefined();
        prepared[chunk.firstFixedSurfaceTypeOffset!] = 1;
        writeUint16Be(prepared, chunk.centerOffset!, 255);
        prepared[chunk.localTableOffset!] = 0;
      }
      await writeFile(args.at(-1)!, prepared);
      return { stdout: "processed mean-layer fields" };
    });
    const remapper = new IconD2EpsCdoRemapper(
      join(rootDir, "remapped-mean-layer"),
      { paths: async () => ({ targetGridPath, weightsPath }) },
      "cdo-test",
      runner,
    );

    const result = await remapper.remap(sourcePath);
    expect(scanGrib2Messages(await readFile(result.path)).map((chunk) => [
      chunk.center,
      chunk.localTable,
      chunk.category,
      chunk.parameter,
      chunk.firstFixedSurfaceType,
    ])).toEqual([
      [78, 1, 7, 6, 192],
      [78, 1, 7, 7, 192],
    ]);
  });

  it("restores DWD UH_MAX provider identity after CDO", async () => {
    const sourcePath = join(rootDir, "native-uh-max.grib2");
    const targetGridPath = join(rootDir, "target-uh-max.txt");
    const weightsPath = join(rootDir, "weights-uh-max.nc");
    await Promise.all([
      writeFile(sourcePath, minimalDwdUpdraftHelicityGrib2()),
      writeFile(targetGridPath, "grid"),
      writeFile(weightsPath, "weights"),
    ]);
    const runner = vi.fn(async (_executable: string, args: string[]) => {
      const prepared = Uint8Array.from(await readFile(args.at(-2)!));
      const chunk = scanGrib2Messages(prepared)[0]!;
      expect(chunk).toMatchObject({
        center: 78,
        category: 7,
        parameter: 15,
        firstFixedSurfaceType: 102,
      });
      writeUint16Be(prepared, chunk.centerOffset!, 255);
      prepared[chunk.localTableOffset!] = 0;
      prepared[chunk.firstFixedSurfaceTypeOffset!] = 1;
      await writeFile(args.at(-1)!, prepared);
      return { stdout: "processed UH_MAX" };
    });
    const remapper = new IconD2EpsCdoRemapper(
      join(rootDir, "remapped-uh-max"),
      { paths: async () => ({ targetGridPath, weightsPath }) },
      "cdo-test",
      runner,
    );

    const result = await remapper.remap(sourcePath);
    expect(scanGrib2Messages(await readFile(result.path))[0]).toMatchObject({
      center: 78,
      localTable: 1,
      category: 7,
      parameter: 15,
      firstFixedSurfaceType: 102,
    });
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

function minimalDwdMeanLayerGrib2(parameter: 6 | 7): Uint8Array {
  const section1 = new Uint8Array(21);
  writeUint32Be(section1, 0, section1.length);
  section1[4] = 1;
  writeUint16Be(section1, 5, 78);
  writeUint16Be(section1, 7, 0);
  section1[9] = 34;
  section1[10] = 1;

  const section4 = new Uint8Array(23);
  writeUint32Be(section4, 0, section4.length);
  section4[4] = 4;
  section4[9] = 7;
  section4[10] = parameter;
  section4[22] = 192;

  const totalLength = 16 + section1.length + section4.length + 4;
  const message = new Uint8Array(totalLength);
  message.set(encoder.encode("GRIB"), 0);
  message[6] = 0;
  message[7] = 2;
  writeUint64Be(message, 8, totalLength);
  message.set(section1, 16);
  message.set(section4, 16 + section1.length);
  message.set(encoder.encode("7777"), totalLength - 4);
  return message;
}

function minimalDwdUpdraftHelicityGrib2(): Uint8Array {
  const section1 = new Uint8Array(21);
  writeUint32Be(section1, 0, section1.length);
  section1[4] = 1;
  writeUint16Be(section1, 5, 78);
  writeUint16Be(section1, 7, 0);
  section1[9] = 34;
  section1[10] = 1;

  const section4 = new Uint8Array(23);
  writeUint32Be(section4, 0, section4.length);
  section4[4] = 4;
  section4[9] = 7;
  section4[10] = 15;
  section4[22] = 102;

  const totalLength = 16 + section1.length + section4.length + 4;
  const message = new Uint8Array(totalLength);
  message.set(encoder.encode("GRIB"), 0);
  message[6] = 0;
  message[7] = 2;
  writeUint64Be(message, 8, totalLength);
  message.set(section1, 16);
  message.set(section4, 16 + section1.length);
  message.set(encoder.encode("7777"), totalLength - 4);
  return message;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function minimalDwdLocalGrib2(parameter: number): Uint8Array {
  const section1 = new Uint8Array(21);
  writeUint32Be(section1, 0, section1.length);
  section1[4] = 1;
  writeUint16Be(section1, 5, 78);
  writeUint16Be(section1, 7, 0);
  section1[9] = 34;
  section1[10] = 1;

  const section4 = new Uint8Array(11);
  writeUint32Be(section4, 0, section4.length);
  section4[4] = 4;
  section4[9] = 1;
  section4[10] = parameter;

  const totalLength = 16 + section1.length + section4.length + 4;
  const message = new Uint8Array(totalLength);
  message.set(encoder.encode("GRIB"), 0);
  message[6] = 0;
  message[7] = 2;
  writeUint64Be(message, 8, totalLength);
  message.set(section1, 16);
  message.set(section4, 16 + section1.length);
  message.set(encoder.encode("7777"), totalLength - 4);
  return message;
}

function writeUint16Be(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeUint32Be(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeUint64Be(bytes: Uint8Array, offset: number, value: number): void {
  let remaining = BigInt(value);
  for (let index = 7; index >= 0; index -= 1) {
    bytes[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}
