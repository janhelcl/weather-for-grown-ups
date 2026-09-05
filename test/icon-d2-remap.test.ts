import { parseMessagesFromBuffer } from "@mattnucc/gribberish";
import { describe, expect, it } from "vitest";
import {
  parseCdoLonLatGridDescription,
  readScripNearestNeighbourIndex,
  remapGrib2Message,
  remapGrib2Messages,
  type NearestNeighbourRemapIndex,
} from "../src/grib/icon-d2-remap.js";
import {
  NATIVE_CELLS,
  TARGET_GRID,
  concat,
  nativeIconMessage,
  readUint16,
  readUint32,
  scripNetcdf,
  sectionMap,
} from "./icon-d2-fixtures.js";
import { scanGrib2Messages } from "../src/grib/dwd-local-parameters.js";
import { readGribMessages } from "../src/grib/gribberish-runtime.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DWD_TARGET_GRID_TEXT = `# Climate Data Operator (CDO) grid description file
# Input: ICON-D2/ICON-D2-EPS
gridtype = lonlat
xsize    = 1214
ysize    = 745
xfirst   = -3.94
xinc     = 0.02
yfirst   = 43.18
yinc     = 0.02
`;


describe("DWD ICON-D2 target grid description", () => {
  it("parses the official CDO lonlat description", () => {
    expect(parseCdoLonLatGridDescription(DWD_TARGET_GRID_TEXT)).toEqual({
      xsize: 1214,
      ysize: 745,
      xfirst: -3.94,
      xinc: 0.02,
      yfirst: 43.18,
      yinc: 0.02,
    });
  });

  it("rejects non-lonlat grids and incomplete descriptions", () => {
    expect(() => parseCdoLonLatGridDescription("gridtype = unstructured\n"))
      .toThrow("must be a CDO lonlat description, found gridtype=unstructured");
    expect(() => parseCdoLonLatGridDescription("xsize = 3\n"))
      .toThrow("found gridtype=<missing>");
    expect(() => parseCdoLonLatGridDescription("gridtype = lonlat\nxsize = 3\nysize = 0\n"))
      .toThrow("missing a valid ysize");
    expect(() => parseCdoLonLatGridDescription("gridtype = lonlat\nxsize = 3\nysize = 2\nxfirst = abc\n"))
      .toThrow("missing a valid xfirst");
  });
});

describe("DWD SCRIP nearest-neighbour weights", () => {
  it("reads the provider index table into a target -> source gather map", () => {
    const index = readScripNearestNeighbourIndex(
      scripNetcdf({ links: [[1, 1], [2, 2], [3, 3], [4, 6], [5, 5]] }),
      TARGET_GRID,
    );
    expect(index.sourceSize).toBe(NATIVE_CELLS);
    expect(index.targetGrid).toEqual(TARGET_GRID);
    expect([...index.sourceIndexByTarget]).toEqual([0, 1, 2, 5, 4, -1]);
  });

  it("refuses weights that are not a pure nearest-neighbour gather", () => {
    expect(() => readScripNearestNeighbourIndex(
      scripNetcdf({ links: [[1, 1]], mapMethod: "Bilinear remapping" }),
      TARGET_GRID,
    )).toThrow("must use nearest-neighbour remapping, found map_method=Bilinear remapping");
    expect(() => readScripNearestNeighbourIndex(
      scripNetcdf({ links: [[1, 1]], numWeights: 3 }),
      TARGET_GRID,
    )).toThrow("more than one weight per link");
    expect(() => readScripNearestNeighbourIndex(
      scripNetcdf({ links: [[1, 1], [2, 2]], weights: [1, 0.5] }),
      TARGET_GRID,
    )).toThrow("non-unit weight 0.5 at link 2");
  });

  it("validates the target grid against the weights", () => {
    expect(() => readScripNearestNeighbourIndex(
      scripNetcdf({ links: [[1, 1]] }),
      { ...TARGET_GRID, xsize: 4 },
    )).toThrow("address 6 target cells but the target grid has 8");
    expect(() => readScripNearestNeighbourIndex(
      scripNetcdf({ links: [[1, 1]], dstDims: [2, 3] }),
      TARGET_GRID,
    )).toThrow("describe a 2x3 target grid; expected 3x2");
  });

  it("rejects duplicate or out-of-range addresses", () => {
    expect(() => readScripNearestNeighbourIndex(
      scripNetcdf({ links: [[1, 1], [1, 2]] }),
      TARGET_GRID,
    )).toThrow("map target cell 1 more than once");
    expect(() => readScripNearestNeighbourIndex(
      scripNetcdf({ links: [[1, 7]] }),
      TARGET_GRID,
    )).toThrow("reference source cell 7 outside 1..6");
    expect(() => readScripNearestNeighbourIndex(
      scripNetcdf({ links: [[9, 1]] }),
      TARGET_GRID,
    )).toThrow("reference target cell 9 outside 1..6");
    expect(() => readScripNearestNeighbourIndex(
      scripNetcdf({ links: [[1, 1]], sourceAddressOnSourceDim: true }),
      TARGET_GRID,
    )).toThrow("disagree with num_links");
  });
});

describe("ICON-D2 native -> regular lon/lat GRIB2 remap", () => {
  const index: NearestNeighbourRemapIndex = {
    sourceSize: NATIVE_CELLS,
    targetGrid: TARGET_GRID,
    // Target cell 3 gathers the bitmap-masked native cell 6; target cell 5 is unmapped.
    sourceIndexByTarget: Int32Array.from([0, 1, 2, 5, 4, -1]),
  };
  const nativeValues = [280, 281.5, 283, 279.25, 284.75, Number.NaN];

  it("gathers native values through the DWD index and emits a decodable regular grid", async () => {
    const native = nativeIconMessage({ values: nativeValues, perturbation: 7 });
    const remapped = remapGrib2Message(native, index);

    const [message] = parseMessagesFromBuffer(remapped);
    expect(message).toBeDefined();
    expect(message!.gridShape).toEqual({ rows: 2, cols: 3 });
    expect(message!.isRegularGrid).toBe(true);
    expect(message!.perturbationNumber).toBe(7);
    expect(message!.numberOfEnsembleMembers).toBe(20);
    expect(message!.referenceDate.toISOString()).toBe("2026-09-05T00:00:00.000Z");
    expect(message!.forecastDate.toISOString()).toBe("2026-09-05T06:00:00.000Z");
    const coordinates = message!.latlngAdjusted(true, false);
    expect(coordinates.latitude).toEqual([50, 50.5]);
    expect(coordinates.longitude).toEqual([10, 10.5, 11]);
    const data = message!.dataAdjusted(true, false);
    expect(data.slice(0, 3)).toEqual([280, 281.5, 283]);
    expect(data[3]).toBeNaN();
    expect(data[4]).toBe(284.75);
    expect(data[5]).toBeNaN();

    // Section 4 is copied verbatim; section 3 is regular lat/lon; section 5 keeps R/E/D/bits.
    const nativeSections = sectionMap(native);
    const remappedSections = sectionMap(remapped);
    expect(remappedSections.get(4)).toEqual(nativeSections.get(4));
    expect(remappedSections.get(1)).toEqual(nativeSections.get(1));
    expect(remappedSections.get(2)).toEqual(nativeSections.get(2));
    expect(readUint16(remappedSections.get(3)!, 12)).toBe(0);
    expect(readUint32(remappedSections.get(3)!, 6)).toBe(6);
    expect(readUint16(remappedSections.get(5)!, 9)).toBe(0);
    expect(remappedSections.get(5)!.subarray(11, 21)).toEqual(nativeSections.get(5)!.subarray(11, 21));
    expect(readUint32(remappedSections.get(5)!, 5)).toBe(4);
    expect(remappedSections.get(6)![5]).toBe(0);
    expect(remappedSections.get(7)!.byteLength).toBe(5 + 4 * 2);
  });

  it("omits the bitmap when every target cell is defined and packs arbitrary bit widths", () => {
    const fullIndex: NearestNeighbourRemapIndex = {
      ...index,
      sourceIndexByTarget: Int32Array.from([0, 1, 2, 3, 4, 0]),
    };
    const native = nativeIconMessage({
      values: [1, 2, 3, 4, 5, 6],
      bitsPerValue: 5,
      referenceValue: 0,
      binaryScale: 0,
      decimalScale: 0,
    });
    const remapped = remapGrib2Message(native, fullIndex);
    const sections = sectionMap(remapped);
    expect(sections.get(6)![5]).toBe(255);
    expect(sections.get(7)!.byteLength).toBe(5 + Math.ceil((6 * 5) / 8));
    const [message] = parseMessagesFromBuffer(remapped);
    expect(message!.dataAdjusted(true, false)).toEqual([1, 2, 3, 4, 5, 1]);
  });

  it("handles constant fields packed with zero bits", () => {
    const native = nativeIconMessage({
      values: [3, 3, 3, 3, 3, 3],
      bitsPerValue: 0,
      referenceValue: 3,
      binaryScale: 0,
      decimalScale: 0,
    });
    const remapped = remapGrib2Message(native, {
      ...index,
      sourceIndexByTarget: Int32Array.from([0, 1, 2, 3, 4, 5]),
    });
    const sections = sectionMap(remapped);
    expect(sections.get(7)!.byteLength).toBe(5);
    // The constant is carried by the reference value alone (bits per value 0).
    const section5 = sections.get(5)!;
    expect(new DataView(section5.buffer, section5.byteOffset).getFloat32(11)).toBe(3);
    expect(section5[19]).toBe(0);
    expect(readUint32(section5, 5)).toBe(6);
    expect(sections.get(6)![5]).toBe(255);
    expect(parseMessagesFromBuffer(remapped)[0]!.gridShape).toEqual({ rows: 2, cols: 3 });
  });

  it("decodes DWD local parameters for the gather while leaving their identity untouched", async () => {
    // RAIN_CON: DWD-local category 1 / parameter 76 on a statistical-interval template.
    const native = nativeIconMessage({
      values: nativeValues,
      category: 1,
      parameter: 76,
      surfaceType: 1,
      surfaceValue: 0,
      accumulationHours: 6,
    });
    expect(scanGrib2Messages(native)[0]).toMatchObject({ center: 78, category: 1, parameter: 76 });
    const remapped = remapGrib2Message(native, index);
    expect(scanGrib2Messages(remapped)[0]).toMatchObject({ center: 78, category: 1, parameter: 76 });

    const dir = await mkdtemp(join(tmpdir(), "wfg-icon-d2-remap-"));
    try {
      const path = join(dir, "rain.grib2");
      await writeFile(path, remapped);
      const [message] = await readGribMessages(path);
      expect(message!.varAbbrev).toBe("RAIN_CON");
      expect(message!.forecastEndDate?.toISOString()).toBe("2026-09-05T06:00:00.000Z");
      expect(message!.dataAdjusted(true, false).slice(0, 3)).toEqual([280, 281.5, 283]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("remaps every message of a multi-message object in order", () => {
    const first = nativeIconMessage({ values: nativeValues, perturbation: 1 });
    const second = nativeIconMessage({ values: nativeValues.map((value) => value + 1), perturbation: 2 });
    const generator = remapGrib2Messages(concat([first, second]), index);
    const outputs: Uint8Array[] = [];
    for (;;) {
      const step = generator.next();
      if (step.done) {
        expect(step.value).toEqual({ messages: 2 });
        break;
      }
      outputs.push(step.value);
    }
    const parsed = parseMessagesFromBuffer(concat(outputs));
    expect(parsed.map((message) => message.perturbationNumber)).toEqual([1, 2]);
    expect(parsed[1]!.dataAdjusted(true, false)[0]).toBe(281);
    expect(() => [...remapGrib2Messages(new Uint8Array(8), index)])
      .toThrow("contains no GRIB2 messages");
  });

  it("fails loudly on inputs the DWD index cannot describe", () => {
    expect(() => remapGrib2Message(nativeIconMessage({ values: [1, 2, 3] }), index))
      .toThrow("has 3 native cells but the DWD index addresses 6");
    expect(() => remapGrib2Message(
      nativeIconMessage({ values: nativeValues, dataRepresentationTemplate: 4 }),
      index,
    )).toThrow("does not support data representation template 5.4");
    expect(() => remapGrib2Message(nativeIconMessage({ values: nativeValues, category: 250, parameter: 251 }), index))
      .toThrow("could not decode native ICON-D2 message (discipline 0, category 250, parameter 251)");
    expect(() => remapGrib2Message(nativeIconMessage({ values: nativeValues, dropSection: 5 }), index))
      .toThrow("missing GRIB2 section 5");
    expect(() => remapGrib2Message(concat([
      nativeIconMessage({ values: nativeValues }),
      nativeIconMessage({ values: nativeValues }),
    ]), index)).toThrow("expected exactly one GRIB2 message");
  });
});
