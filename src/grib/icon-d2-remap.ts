import { NetCDFReader } from "netcdfjs";
import { parseMessagesFromBuffer } from "@mattnucc/gribberish";
import {
  knownDwdLocalParameter,
  scanGrib2Messages,
  type Grib2MessageSlice,
} from "./dwd-local-parameters.js";

/**
 * Pure-JS replacement for `cdo remap,<target grid>,<weights>` on DWD's
 * ICON-D2 nearest-neighbour bundle.
 *
 * DWD ships the official ICON-D2 0.02 degree conversion as two provider
 * artifacts: a CDO lon/lat grid description and a SCRIP-format NetCDF-3
 * weights file whose `map_method` is "Nearest neighbor". With a single
 * unit weight per target cell that remap is a gather: each regular target
 * cell takes the value of exactly one native triangular cell. Reproducing it
 * in JS therefore needs no interpolation kernel, only the provider's index
 * table, and the resulting values are identical to CDO's output.
 */

export interface LonLatGridDescription {
  xsize: number;
  ysize: number;
  xfirst: number;
  xinc: number;
  yfirst: number;
  yinc: number;
}

export interface NearestNeighbourRemapIndex {
  /** Number of native (source) cells the index addresses. */
  sourceSize: number;
  targetGrid: LonLatGridDescription;
  /** For each target cell (row-major, first row = yfirst) the zero-based source cell or -1 when the provider left the cell unmapped. */
  sourceIndexByTarget: Int32Array;
}

export interface RemappedGrib2Summary {
  messages: number;
}

interface Grib2Section {
  number: number;
  start: number;
  length: number;
}

interface SimplePackingParameters {
  referenceValue: number;
  binaryScaleFactorRaw: number;
  decimalScaleFactorRaw: number;
  bitsPerValue: number;
  originalFieldType: number;
}

const GRID_TEMPLATE_LAT_LON = 0;
const SHAPE_OF_EARTH_SPHERE_6371229 = 6;
const RESOLUTION_FLAGS_BOTH_INCREMENTS_GIVEN = 0x30;
const SCANNING_MODE_WEST_EAST_SOUTH_NORTH = 0x40;
const MISSING_UINT32 = 0xffffffff;
const LON_LAT_SECTION3_LENGTH = 72;
const SIMPLE_PACKING_SECTION5_LENGTH = 21;
/** Data representation templates whose octets 12-21 share the simple-packing header (R, E, D, bits, type). */
const SIMPLE_PACKING_HEADER_TEMPLATES = new Set([0, 2, 3, 40, 41, 42]);

export function parseCdoLonLatGridDescription(text: string): LonLatGridDescription {
  const entries = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    entries.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  const gridType = entries.get("gridtype");
  if (gridType !== "lonlat") {
    throw new Error(`DWD ICON-D2 target grid must be a CDO lonlat description, found gridtype=${gridType ?? "<missing>"}`);
  }
  const numeric = (key: string, integer: boolean): number => {
    const raw = entries.get(key);
    const value = raw === undefined ? Number.NaN : Number(raw);
    if (!Number.isFinite(value) || (integer && (!Number.isInteger(value) || value <= 0))) {
      throw new Error(`DWD ICON-D2 target grid is missing a valid ${key}`);
    }
    return value;
  };
  return {
    xsize: numeric("xsize", true),
    ysize: numeric("ysize", true),
    xfirst: numeric("xfirst", false),
    xinc: numeric("xinc", false),
    yfirst: numeric("yfirst", false),
    yinc: numeric("yinc", false),
  };
}

export function readScripNearestNeighbourIndex(
  netcdfBytes: Uint8Array,
  targetGrid: LonLatGridDescription,
): NearestNeighbourRemapIndex {
  const reader = new NetCDFReader(netcdfBytes);
  const attribute = (name: string): string | undefined => {
    const found = reader.globalAttributes.find((entry) => entry.name === name);
    return found === undefined ? undefined : String(found.value);
  };
  const mapMethod = attribute("map_method");
  if (mapMethod === undefined || !/nearest\s*neighbou?r/i.test(mapMethod)) {
    throw new Error(`DWD ICON-D2 weights must use nearest-neighbour remapping, found map_method=${mapMethod ?? "<missing>"}`);
  }
  const dimension = (name: string): number => {
    const found = reader.dimensions.find((entry) => entry.name === name);
    if (found === undefined) throw new Error(`DWD ICON-D2 weights are missing dimension ${name}`);
    return found.size;
  };
  const sourceSize = dimension("src_grid_size");
  const targetSize = dimension("dst_grid_size");
  const linkCount = dimension("num_links");
  if (dimension("num_wgts") !== 1) {
    throw new Error("DWD ICON-D2 weights carry more than one weight per link; nearest-neighbour gather is not applicable");
  }
  const expectedTargetSize = targetGrid.xsize * targetGrid.ysize;
  if (targetSize !== expectedTargetSize) {
    throw new Error(
      `DWD ICON-D2 weights address ${targetSize} target cells but the target grid has ${expectedTargetSize}`,
    );
  }
  const targetDims = numericVariable(reader, "dst_grid_dims");
  if (targetDims.length !== 2 || targetDims[0] !== targetGrid.xsize || targetDims[1] !== targetGrid.ysize) {
    throw new Error(
      `DWD ICON-D2 weights describe a ${targetDims.join("x")} target grid; expected ${targetGrid.xsize}x${targetGrid.ysize}`,
    );
  }

  const sourceAddresses = numericVariable(reader, "src_address");
  const targetAddresses = numericVariable(reader, "dst_address");
  const weights = numericVariable(reader, "remap_matrix");
  if (
    sourceAddresses.length !== linkCount
    || targetAddresses.length !== linkCount
    || weights.length !== linkCount
  ) {
    throw new Error("DWD ICON-D2 weights link tables disagree with num_links");
  }

  const sourceIndexByTarget = new Int32Array(targetSize).fill(-1);
  for (let link = 0; link < linkCount; link += 1) {
    const source = sourceAddresses[link]! - 1;
    const target = targetAddresses[link]! - 1;
    if (weights[link] !== 1) {
      throw new Error(`DWD ICON-D2 weights contain a non-unit weight ${weights[link]} at link ${link + 1}`);
    }
    if (!Number.isInteger(source) || source < 0 || source >= sourceSize) {
      throw new Error(`DWD ICON-D2 weights reference source cell ${source + 1} outside 1..${sourceSize}`);
    }
    if (!Number.isInteger(target) || target < 0 || target >= targetSize) {
      throw new Error(`DWD ICON-D2 weights reference target cell ${target + 1} outside 1..${targetSize}`);
    }
    if (sourceIndexByTarget[target] !== -1) {
      throw new Error(`DWD ICON-D2 weights map target cell ${target + 1} more than once`);
    }
    sourceIndexByTarget[target] = source;
  }

  return { sourceSize, targetGrid, sourceIndexByTarget };
}

/**
 * Remap every GRIB2 message in `bytes` from the native ICON grid onto the
 * regular lon/lat target, yielding one complete GRIB2 message per input
 * message. Sections 1, 2 and 4 are copied verbatim so provider identification,
 * local-use data, ensemble metadata and statistical intervals are untouched.
 * Section 5 keeps the source's reference value, binary/decimal scale factors
 * and bit width, so emitted values are the exact quantised integers DWD
 * published, now in simple packing.
 */
export function* remapGrib2Messages(
  bytes: Uint8Array,
  index: NearestNeighbourRemapIndex,
): Generator<Uint8Array, RemappedGrib2Summary, undefined> {
  const slices = scanGrib2Messages(bytes);
  if (slices.length === 0) throw new Error("ICON-D2 remap input contains no GRIB2 messages");
  let messages = 0;
  for (const slice of slices) {
    yield remapGrib2Message(bytes.subarray(slice.start, slice.end), index, slice);
    messages += 1;
  }
  return { messages };
}

export function remapGrib2Message(
  message: Uint8Array,
  index: NearestNeighbourRemapIndex,
  slice: Grib2MessageSlice = scanSingleMessage(message),
): Uint8Array {
  const sections = splitSections(message);
  const section3 = requireSection(sections, 3);
  const section5 = requireSection(sections, 5);
  const nativePoints = readUint32(message, section3.start + 6);
  if (nativePoints !== index.sourceSize) {
    throw new Error(
      `ICON-D2 remap input has ${nativePoints} native cells but the DWD index addresses ${index.sourceSize}`,
    );
  }

  const packing = readSimplePackingParameters(message, section5);
  const decoded = decodeNativeValues(message, section3, slice);
  if (decoded.length !== nativePoints) {
    throw new Error(
      `Bundled GRIB2 decoder returned ${decoded.length} native ICON-D2 values, expected ${nativePoints}`,
    );
  }

  const gathered = gatherAndQuantise(decoded, index, packing);
  const section1 = sectionBytes(message, requireSection(sections, 1));
  const section2 = sections.find((section) => section.number === 2);
  const section4 = sectionBytes(message, requireSection(sections, 4));

  const parts: Uint8Array[] = [
    message.subarray(0, 16),
    section1,
    ...(section2 === undefined ? [] : [sectionBytes(message, section2)]),
    encodeLonLatSection3(index.targetGrid),
    section4,
    encodeSimplePackingSection5(packing, gathered.definedCount),
    encodeBitmapSection6(gathered.bitmap),
    encodeDataSection7(gathered.values, gathered.definedCount, packing.bitsPerValue),
    new Uint8Array([0x37, 0x37, 0x37, 0x37]),
  ];
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  writeUint64(output, 8, total);
  return output;
}

function decodeNativeValues(
  message: Uint8Array,
  section3: Grib2Section,
  slice: Grib2MessageSlice,
): readonly number[] {
  const nativePoints = readUint32(message, section3.start + 6);
  const patched = new Uint8Array(message.byteLength - section3.length + LON_LAT_SECTION3_LENGTH);
  patched.set(message.subarray(0, section3.start), 0);
  patched.set(encodeLonLatSection3({
    xsize: nativePoints,
    ysize: 1,
    xfirst: 0,
    xinc: 0.000001,
    yfirst: 0,
    yinc: 0.000001,
  }), section3.start);
  patched.set(message.subarray(section3.start + section3.length), section3.start + LON_LAT_SECTION3_LENGTH);
  writeUint64(patched, 8, patched.byteLength);

  const local = knownDwdLocalParameter(
    slice.discipline,
    slice.center,
    slice.category,
    slice.parameter,
    slice.firstFixedSurfaceType,
  );
  if (local !== undefined && slice.categoryOffset !== undefined && slice.parameterOffset !== undefined) {
    // Section 4 follows section 3, so its offsets move by the section 3 size change.
    const shift = LON_LAT_SECTION3_LENGTH - section3.length;
    patched[slice.categoryOffset - slice.start + shift] = local.surrogate[0];
    patched[slice.parameterOffset - slice.start + shift] = local.surrogate[1];
  }

  const parsed = parseMessagesFromBuffer(patched);
  if (parsed.length !== 1) {
    throw new Error(
      `Bundled GRIB2 decoder could not decode native ICON-D2 message (discipline ${slice.discipline}, category ${slice.category}, parameter ${slice.parameter})`,
    );
  }
  return parsed[0]!.data;
}

function gatherAndQuantise(
  decoded: readonly number[],
  index: NearestNeighbourRemapIndex,
  packing: SimplePackingParameters,
): { values: Uint32Array; bitmap: Uint8Array | undefined; definedCount: number } {
  const targetSize = index.sourceIndexByTarget.length;
  const values = new Uint32Array(targetSize);
  const bitmap = new Uint8Array(Math.ceil(targetSize / 8));
  const binaryScale = 2 ** binaryScaleFactor(packing.binaryScaleFactorRaw);
  const decimalScale = 10 ** binaryScaleFactor(packing.decimalScaleFactorRaw);
  const maxValue = packing.bitsPerValue === 0 ? 0 : 2 ** packing.bitsPerValue - 1;
  let definedCount = 0;

  for (let target = 0; target < targetSize; target += 1) {
    const source = index.sourceIndexByTarget[target]!;
    if (source < 0) continue;
    const value = decoded[source];
    if (value === undefined || !Number.isFinite(value)) continue;
    const quantised = packing.bitsPerValue === 0
      ? 0
      : Math.round((value * decimalScale - packing.referenceValue) / binaryScale);
    if (quantised < 0 || quantised > maxValue) {
      throw new Error(
        `ICON-D2 remap could not re-quantise value ${value} into the provider's ${packing.bitsPerValue}-bit packing`,
      );
    }
    bitmap[target >> 3]! |= 0x80 >> (target & 7);
    values[definedCount] = quantised;
    definedCount += 1;
  }

  return {
    values,
    bitmap: definedCount === targetSize ? undefined : bitmap,
    definedCount,
  };
}

function readSimplePackingParameters(message: Uint8Array, section5: Grib2Section): SimplePackingParameters {
  if (section5.length < SIMPLE_PACKING_SECTION5_LENGTH) {
    throw new Error("ICON-D2 remap input has a truncated data representation section");
  }
  const template = readUint16(message, section5.start + 9);
  if (!SIMPLE_PACKING_HEADER_TEMPLATES.has(template)) {
    throw new Error(`ICON-D2 remap does not support data representation template 5.${template}`);
  }
  const view = new DataView(message.buffer, message.byteOffset + section5.start, section5.length);
  return {
    referenceValue: view.getFloat32(11),
    binaryScaleFactorRaw: view.getUint16(15),
    decimalScaleFactorRaw: view.getUint16(17),
    bitsPerValue: message[section5.start + 19]!,
    originalFieldType: message[section5.start + 20]!,
  };
}

function encodeLonLatSection3(grid: LonLatGridDescription): Uint8Array {
  const section = new Uint8Array(LON_LAT_SECTION3_LENGTH);
  const view = new DataView(section.buffer);
  view.setUint32(0, LON_LAT_SECTION3_LENGTH);
  section[4] = 3;
  section[5] = 0;
  view.setUint32(6, grid.xsize * grid.ysize);
  section[10] = 0;
  section[11] = 0;
  view.setUint16(12, GRID_TEMPLATE_LAT_LON);
  section[14] = SHAPE_OF_EARTH_SPHERE_6371229;
  section[15] = 0;
  view.setUint32(16, 0);
  section[20] = 0;
  view.setUint32(21, 0);
  section[25] = 0;
  view.setUint32(26, 0);
  view.setUint32(30, grid.xsize);
  view.setUint32(34, grid.ysize);
  view.setUint32(38, 0);
  view.setUint32(42, MISSING_UINT32);
  view.setInt32(46, microDegrees(grid.yfirst));
  view.setUint32(50, microDegreesLongitude(grid.xfirst));
  section[54] = RESOLUTION_FLAGS_BOTH_INCREMENTS_GIVEN;
  view.setInt32(55, microDegrees(grid.yfirst + (grid.ysize - 1) * grid.yinc));
  view.setUint32(59, microDegreesLongitude(grid.xfirst + (grid.xsize - 1) * grid.xinc));
  view.setUint32(63, microDegrees(grid.xinc));
  view.setUint32(67, microDegrees(grid.yinc));
  section[71] = SCANNING_MODE_WEST_EAST_SOUTH_NORTH;
  return section;
}

function encodeSimplePackingSection5(packing: SimplePackingParameters, definedCount: number): Uint8Array {
  const section = new Uint8Array(SIMPLE_PACKING_SECTION5_LENGTH);
  const view = new DataView(section.buffer);
  view.setUint32(0, SIMPLE_PACKING_SECTION5_LENGTH);
  section[4] = 5;
  view.setUint32(5, definedCount);
  view.setUint16(9, 0);
  view.setFloat32(11, packing.referenceValue);
  view.setUint16(15, packing.binaryScaleFactorRaw);
  view.setUint16(17, packing.decimalScaleFactorRaw);
  section[19] = packing.bitsPerValue;
  section[20] = packing.originalFieldType;
  return section;
}

function encodeBitmapSection6(bitmap: Uint8Array | undefined): Uint8Array {
  if (bitmap === undefined) {
    const section = new Uint8Array(6);
    new DataView(section.buffer).setUint32(0, 6);
    section[4] = 6;
    section[5] = 255;
    return section;
  }
  const section = new Uint8Array(6 + bitmap.byteLength);
  new DataView(section.buffer).setUint32(0, section.byteLength);
  section[4] = 6;
  section[5] = 0;
  section.set(bitmap, 6);
  return section;
}

function encodeDataSection7(values: Uint32Array, definedCount: number, bitsPerValue: number): Uint8Array {
  const dataBytes = Math.ceil((definedCount * bitsPerValue) / 8);
  const section = new Uint8Array(5 + dataBytes);
  new DataView(section.buffer).setUint32(0, section.byteLength);
  section[4] = 7;
  if (bitsPerValue === 0) return section;

  if (bitsPerValue === 16) {
    for (let index = 0, offset = 5; index < definedCount; index += 1, offset += 2) {
      const value = values[index]!;
      section[offset] = (value >>> 8) & 0xff;
      section[offset + 1] = value & 0xff;
    }
    return section;
  }

  let bitOffset = 0;
  for (let index = 0; index < definedCount; index += 1) {
    const value = values[index]!;
    for (let bit = bitsPerValue - 1; bit >= 0; bit -= 1) {
      if ((value >>> bit) & 1) {
        section[5 + (bitOffset >> 3)]! |= 0x80 >> (bitOffset & 7);
      }
      bitOffset += 1;
    }
  }
  return section;
}

function binaryScaleFactor(raw: number): number {
  return (raw & 0x8000) !== 0 ? -(raw & 0x7fff) : raw;
}

function microDegrees(degrees: number): number {
  return Math.round(degrees * 1_000_000);
}

function microDegreesLongitude(degrees: number): number {
  return microDegrees(((degrees % 360) + 360) % 360);
}

function splitSections(message: Uint8Array): Grib2Section[] {
  const sections: Grib2Section[] = [];
  let cursor = 16;
  const end = message.byteLength - 4;
  while (cursor + 5 <= end) {
    const length = readUint32(message, cursor);
    if (length < 5 || cursor + length > end) {
      throw new Error("ICON-D2 remap input contains a malformed GRIB2 section");
    }
    sections.push({ number: message[cursor + 4]!, start: cursor, length });
    cursor += length;
  }
  return sections;
}

function requireSection(sections: readonly Grib2Section[], number: number): Grib2Section {
  const section = sections.find((candidate) => candidate.number === number);
  if (section === undefined) throw new Error(`ICON-D2 remap input is missing GRIB2 section ${number}`);
  return section;
}

function sectionBytes(message: Uint8Array, section: Grib2Section): Uint8Array {
  return message.subarray(section.start, section.start + section.length);
}

function scanSingleMessage(message: Uint8Array): Grib2MessageSlice {
  const slices = scanGrib2Messages(message);
  if (slices.length !== 1 || slices[0]!.start !== 0) {
    throw new Error("ICON-D2 remap expected exactly one GRIB2 message");
  }
  return slices[0]!;
}

function numericVariable(reader: NetCDFReader, name: string): number[] {
  if (!reader.dataVariableExists(name)) {
    throw new Error(`DWD ICON-D2 weights are missing variable ${name}`);
  }
  const value = reader.getDataVariable(name);
  if (!value.every((entry) => typeof entry === "number")) {
    throw new Error(`DWD ICON-D2 weights variable ${name} is not numeric`);
  }
  return value as number[];
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000
    + bytes[offset + 1]! * 0x10000
    + bytes[offset + 2]! * 0x100
    + bytes[offset + 3]!
  );
}

function writeUint64(bytes: Uint8Array, offset: number, value: number): void {
  let remaining = BigInt(value);
  for (let index = 7; index >= 0; index -= 1) {
    bytes[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}
