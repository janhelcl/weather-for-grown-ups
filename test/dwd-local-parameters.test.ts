import { describe, expect, it } from "vitest";
import {
  knownDwdLocalParameter,
  prepareDwdLocalParametersForGenericProcessing,
  restoreDwdLocalParametersAfterGenericProcessing,
  scanGrib2Messages,
} from "../src/grib/dwd-local-parameters.js";

describe("DWD local GRIB2 parameter normalization", () => {
  it("maps only the exact DWD convective precipitation tuples", () => {
    expect(knownDwdLocalParameter(0, 78, 1, 76)).toMatchObject({
      alias: "RAIN_CON",
      localParameter: 76,
      surrogate: [1, 10],
    });
    expect(knownDwdLocalParameter(0, 78, 1, 55)).toMatchObject({
      alias: "SNOW_CON",
      localParameter: 55,
      surrogate: [1, 53],
    });
    expect(knownDwdLocalParameter(0, 7, 1, 76)).toBeUndefined();
    expect(knownDwdLocalParameter(0, 78, 2, 76)).toBeUndefined();
    expect(knownDwdLocalParameter(1, 78, 1, 76)).toBeUndefined();
  });

  it("distinguishes DWD mean-layer CAPE/CIN by fixed-surface type", () => {
    expect(knownDwdLocalParameter(0, 78, 7, 6, 192)).toMatchObject({
      alias: "CAPE_ML",
      firstFixedSurfaceType: 192,
      genericProcessing: true,
    });
    expect(knownDwdLocalParameter(0, 78, 7, 7, 192)).toMatchObject({
      alias: "CIN_ML",
      firstFixedSurfaceType: 192,
      genericProcessing: true,
    });
    expect(knownDwdLocalParameter(0, 78, 7, 6, 193)).toBeUndefined();
    expect(knownDwdLocalParameter(0, 78, 7, 6, 1)).toBeUndefined();

    const meanLayer = minimalGrib2({
      center: 78,
      subcenter: 0,
      masterTable: 34,
      localTable: 1,
      category: 7,
      parameter: 6,
      firstFixedSurfaceType: 192,
    });
    expect(scanGrib2Messages(meanLayer)[0]).toMatchObject({
      firstFixedSurfaceType: 192,
      firstFixedSurfaceTypeOffset: expect.any(Number),
    });
  });

  it("records standard DWD updraft helicity so provider identity survives CDO", () => {
    expect(knownDwdLocalParameter(0, 78, 7, 15, 102)).toMatchObject({
      alias: "UH_MAX",
      firstFixedSurfaceType: 102,
      genericProcessing: true,
      surrogate: [7, 15],
    });
    expect(knownDwdLocalParameter(0, 78, 7, 15, 1)).toBeUndefined();

    const updraftHelicity = minimalGrib2({
      center: 78,
      subcenter: 0,
      masterTable: 34,
      localTable: 1,
      category: 7,
      parameter: 15,
      firstFixedSurfaceType: 102,
    });
    const prepared = prepareDwdLocalParametersForGenericProcessing(updraftHelicity);
    expect(prepared.bytes).not.toBe(updraftHelicity);
    expect(prepared.bytes).toEqual(updraftHelicity);
    expect(prepared.rewrites).toEqual([
      expect.objectContaining({
        alias: "UH_MAX",
        count: 1,
        surrogate: [7, 15],
        firstFixedSurfaceType: 102,
      }),
    ]);

    const genericOutput = Uint8Array.from(prepared.bytes);
    const chunk = scanGrib2Messages(genericOutput)[0]!;
    writeUint16Be(genericOutput, chunk.centerOffset!, 255);
    genericOutput[chunk.localTableOffset!] = 0;
    genericOutput[chunk.firstFixedSurfaceTypeOffset!] = 1;

    const restored = restoreDwdLocalParametersAfterGenericProcessing(
      genericOutput,
      prepared.rewrites,
    );
    expect(scanGrib2Messages(restored)[0]).toMatchObject({
      center: 78,
      localTable: 1,
      category: 7,
      parameter: 15,
      firstFixedSurfaceType: 102,
    });
  });

  it("restores DWD mean-layer parcel identity after generic processing", () => {
    const original = concat([
      minimalGrib2({
        center: 78,
        subcenter: 0,
        masterTable: 34,
        localTable: 1,
        category: 7,
        parameter: 6,
        firstFixedSurfaceType: 192,
      }),
      minimalGrib2({
        center: 78,
        subcenter: 0,
        masterTable: 34,
        localTable: 1,
        category: 7,
        parameter: 7,
        firstFixedSurfaceType: 192,
      }),
    ]);
    const prepared = prepareDwdLocalParametersForGenericProcessing(original);
    expect(prepared.rewrites).toEqual([
      expect.objectContaining({
        alias: "CAPE_ML",
        count: 1,
        firstFixedSurfaceType: 192,
      }),
      expect.objectContaining({
        alias: "CIN_ML",
        count: 1,
        firstFixedSurfaceType: 192,
      }),
    ]);

    const genericOutput = Uint8Array.from(prepared.bytes);
    for (const chunk of scanGrib2Messages(genericOutput)) {
      expect(chunk.firstFixedSurfaceTypeOffset).toBeDefined();
      genericOutput[chunk.firstFixedSurfaceTypeOffset!] = 1;
      writeUint16Be(genericOutput, chunk.centerOffset!, 255);
      genericOutput[chunk.localTableOffset!] = 0;
    }

    const restored = restoreDwdLocalParametersAfterGenericProcessing(
      genericOutput,
      prepared.rewrites,
    );
    expect(scanGrib2Messages(restored).map((chunk) => ({
      center: chunk.center,
      localTable: chunk.localTable,
      category: chunk.category,
      parameter: chunk.parameter,
      firstFixedSurfaceType: chunk.firstFixedSurfaceType,
    }))).toEqual([
      {
        center: 78,
        localTable: 1,
        category: 7,
        parameter: 6,
        firstFixedSurfaceType: 192,
      },
      {
        center: 78,
        localTable: 1,
        category: 7,
        parameter: 7,
        firstFixedSurfaceType: 192,
      },
    ]);
  });

  it("is a zero-copy no-op when no supported DWD-local parameter is present", () => {
    const standard = minimalGrib2({
      center: 7,
      subcenter: 0,
      masterTable: 34,
      localTable: 0,
      category: 1,
      parameter: 8,
    });
    const prepared = prepareDwdLocalParametersForGenericProcessing(standard);
    expect(prepared.bytes).toBe(standard);
    expect(prepared.rewrites).toEqual([]);
    expect(restoreDwdLocalParametersAfterGenericProcessing(
      standard,
      prepared.rewrites,
    )).toBe(standard);
    expect(knownDwdLocalParameter(0, 78, 1, 99)).toBeUndefined();
  });

  it("counts repeated local messages and rejects inconsistent DWD identification", () => {
    const rain = {
      center: 78,
      subcenter: 0,
      masterTable: 34,
      localTable: 1,
      category: 1,
      parameter: 76,
    };
    const repeated = prepareDwdLocalParametersForGenericProcessing(concat([
      minimalGrib2(rain),
      minimalGrib2(rain),
    ]));
    expect(repeated.rewrites).toEqual([
      expect.objectContaining({ alias: "RAIN_CON", count: 2 }),
    ]);

    expect(() => prepareDwdLocalParametersForGenericProcessing(concat([
      minimalGrib2(rain),
      minimalGrib2({ ...rain, localTable: 2 }),
    ]))).toThrow("inconsistent GRIB2 identification metadata");
  });

  it("ignores noise, non-GRIB2 data, and malformed GRIB2 lengths", () => {
    expect(scanGrib2Messages(new Uint8Array(32))).toEqual([]);

    const wrongEdition = minimalGrib2({
      center: 78,
      subcenter: 0,
      masterTable: 34,
      localTable: 1,
      category: 1,
      parameter: 76,
    });
    wrongEdition[7] = 1;
    expect(scanGrib2Messages(wrongEdition)).toEqual([]);

    const tooShort = minimalGrib2({
      center: 78,
      subcenter: 0,
      masterTable: 34,
      localTable: 1,
      category: 1,
      parameter: 76,
    });
    writeUint64Be(tooShort, 8, 10);
    expect(scanGrib2Messages(tooShort)).toEqual([]);

    const tooLong = minimalGrib2({
      center: 78,
      subcenter: 0,
      masterTable: 34,
      localTable: 1,
      category: 1,
      parameter: 76,
    });
    writeUint64Be(tooLong, 8, tooLong.length + 100);
    expect(scanGrib2Messages(tooLong)).toEqual([]);
  });

  it("rewrites only parameter metadata and restores the exact DWD identity", () => {
    const original = concat([
      minimalGrib2({ center: 78, subcenter: 0, masterTable: 34, localTable: 1, category: 1, parameter: 76 }),
      minimalGrib2({ center: 78, subcenter: 0, masterTable: 34, localTable: 1, category: 1, parameter: 55 }),
      minimalGrib2({ center: 7, subcenter: 0, masterTable: 34, localTable: 0, category: 1, parameter: 8 }),
    ]);
    const originalCopy = Uint8Array.from(original);

    const prepared = prepareDwdLocalParametersForGenericProcessing(original);
    expect(original).toEqual(originalCopy);
    expect(prepared.rewrites).toEqual([
      expect.objectContaining({ alias: "RAIN_CON", count: 1 }),
      expect.objectContaining({ alias: "SNOW_CON", count: 1 }),
    ]);
    expect(scanGrib2Messages(prepared.bytes).map((chunk) => [
      chunk.center,
      chunk.category,
      chunk.parameter,
    ])).toEqual([
      [78, 1, 10],
      [78, 1, 53],
      [7, 1, 8],
    ]);

    const genericOutput = Uint8Array.from(prepared.bytes);
    // Simulate a generic tool replacing GRIB identification metadata.
    for (const chunk of scanGrib2Messages(genericOutput).slice(0, 2)) {
      expect(chunk.centerOffset).toBeDefined();
      expect(chunk.subcenterOffset).toBeDefined();
      expect(chunk.masterTableOffset).toBeDefined();
      expect(chunk.localTableOffset).toBeDefined();
      writeUint16Be(genericOutput, chunk.centerOffset!, 255);
      writeUint16Be(genericOutput, chunk.subcenterOffset!, 42);
      genericOutput[chunk.masterTableOffset!] = 99;
      genericOutput[chunk.localTableOffset!] = 0;
    }

    const restored = restoreDwdLocalParametersAfterGenericProcessing(
      genericOutput,
      prepared.rewrites,
    );
    expect(scanGrib2Messages(restored).map((chunk) => [
      chunk.center,
      chunk.subcenter,
      chunk.masterTable,
      chunk.localTable,
      chunk.category,
      chunk.parameter,
    ])).toEqual([
      [78, 0, 34, 1, 1, 76],
      [78, 0, 34, 1, 1, 55],
      [7, 0, 34, 0, 1, 8],
    ]);
  });

  it("refuses to relabel an ambiguous standard surrogate", () => {
    const original = minimalGrib2({
      center: 78,
      subcenter: 0,
      masterTable: 34,
      localTable: 1,
      category: 1,
      parameter: 76,
    });
    const prepared = prepareDwdLocalParametersForGenericProcessing(original);
    const ambiguous = concat([
      prepared.bytes,
      minimalGrib2({
        center: 7,
        subcenter: 0,
        masterTable: 34,
        localTable: 0,
        category: 1,
        parameter: 10,
      }),
    ]);

    expect(() => restoreDwdLocalParametersAfterGenericProcessing(
      ambiguous,
      prepared.rewrites,
    )).toThrow("message cardinality");
  });
});

interface MinimalGribOptions {
  center: number;
  subcenter: number;
  masterTable: number;
  localTable: number;
  category: number;
  parameter: number;
  firstFixedSurfaceType?: number;
}

function minimalGrib2(options: MinimalGribOptions): Uint8Array {
  const section1 = new Uint8Array(21);
  writeUint32Be(section1, 0, section1.length);
  section1[4] = 1;
  writeUint16Be(section1, 5, options.center);
  writeUint16Be(section1, 7, options.subcenter);
  section1[9] = options.masterTable;
  section1[10] = options.localTable;

  const section4 = new Uint8Array(options.firstFixedSurfaceType === undefined ? 11 : 23);
  writeUint32Be(section4, 0, section4.length);
  section4[4] = 4;
  section4[9] = options.category;
  section4[10] = options.parameter;
  if (options.firstFixedSurfaceType !== undefined) {
    section4[22] = options.firstFixedSurfaceType;
  }

  const totalLength = 16 + section1.length + section4.length + 4;
  const message = new Uint8Array(totalLength);
  message.set(new TextEncoder().encode("GRIB"), 0);
  message[6] = 0;
  message[7] = 2;
  writeUint64Be(message, 8, totalLength);
  message.set(section1, 16);
  message.set(section4, 16 + section1.length);
  message.set(new TextEncoder().encode("7777"), totalLength - 4);
  return message;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
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
