import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { remapGrib2Message, type NearestNeighbourRemapIndex } from "../src/grib/icon-d2-remap.js";
import { decodeBundledPointFile, decodeBundledPointFileMany } from "../src/grib/gribberish-point.js";
import { sampleGribPoints } from "../src/grib/point-decoder.js";
import { decodeWorkerCount } from "../src/grib/grib-decode-pool.js";
import { concat, nativeIconMessage, NATIVE_CELLS, TARGET_GRID } from "./icon-d2-fixtures.js";

const index: NearestNeighbourRemapIndex = {
  sourceSize: NATIVE_CELLS,
  targetGrid: TARGET_GRID,
  sourceIndexByTarget: Int32Array.from([0, 1, 2, 3, 4, 5]),
};

describe("streamed bundled GRIB2 point decode", () => {
  it("samples a remapped regular grid without retaining every expanded message", async () => {
    const remapped = remapGrib2Message(nativeIconMessage({
      values: [1, 2, 3, 4, 5, 6],
      bitsPerValue: 5,
      referenceValue: 0,
      binaryScale: 0,
      decimalScale: 0,
    }), index);
    const dir = await mkdtemp(join(tmpdir(), "wfg-grib-point-"));
    try {
      const path = join(dir, "field.grib2");
      await writeFile(path, remapped);
      const decoded = await decodeBundledPointFile(path, 10, 50);
      expect(decoded).toEqual([{
        code: "TMP",
        pressureHpa: 850,
        value: 1,
        gridPoint: { latitude: 50, longitude: 10 },
      }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("unpacks each message once when sampling several coordinates", async () => {
    const first = remapGrib2Message(nativeIconMessage({
      values: [1, 2, 3, 4, 5, 6],
      bitsPerValue: 5,
      referenceValue: 0,
      binaryScale: 0,
      decimalScale: 0,
    }), index);
    const second = remapGrib2Message(nativeIconMessage({
      values: [11, 12, 13, 14, 15, 16],
      bitsPerValue: 5,
      referenceValue: 0,
      binaryScale: 0,
      decimalScale: 0,
      surfaceValue: 70000,
    }), index);
    const dir = await mkdtemp(join(tmpdir(), "wfg-grib-points-"));
    try {
      const path = join(dir, "fields.grib2");
      await writeFile(path, concat([first, second]));
      const [west, east] = await decodeBundledPointFileMany(path, [
        { longitude: 10, latitude: 50 },
        { longitude: 11, latitude: 50.5 },
      ]);
      expect(west?.map((value) => ({ code: value.code, pressureHpa: value.pressureHpa, value: value.value }))).toEqual([
        { code: "TMP", pressureHpa: 850, value: 1 },
        { code: "TMP", pressureHpa: 700, value: 11 },
      ]);
      expect(east?.map((value) => value.value)).toEqual([6, 16]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("GRIB point decoder helpers", () => {
  it("keeps the decode worker pool off in unit tests", () => {
    expect(decodeWorkerCount()).toBe(0);
  });

  it("uses extractPoints when the decoder provides it", async () => {
    const extracted: Array<{ longitude: number; latitude: number }> = [];
    const decoder = {
      async extractPoint(): Promise<never[]> {
        throw new Error("extractPoint should not run when extractPoints exists");
      },
      async extractPoints(
        _path: string,
        points: readonly { longitude: number; latitude: number }[],
      ) {
        extracted.push(...points);
        return points.map(() => [{ code: "TMP", pressureHpa: 850, value: 1, gridPoint: { latitude: 50, longitude: 10 } }]);
      },
    };
    const decoded = await sampleGribPoints(decoder, "file.grib2", [
      { longitude: 10, latitude: 50 },
      { longitude: 11, latitude: 51 },
    ]);
    expect(extracted).toHaveLength(2);
    expect(decoded).toHaveLength(2);
  });
});
