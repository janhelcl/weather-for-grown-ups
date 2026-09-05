import type { LonLatGridDescription } from "../src/grib/icon-d2-remap.js";

/** 3 x 2 regular target grid used by the synthetic ICON-D2 fixtures. */
export const TARGET_GRID: LonLatGridDescription = {
  xsize: 3,
  ysize: 2,
  xfirst: 10,
  xinc: 0.5,
  yfirst: 50,
  yinc: 0.5,
};
export const NATIVE_CELLS = 6;

export interface NativeMessageOptions {
  values: readonly number[];
  perturbation?: number;
  category?: number;
  parameter?: number;
  surfaceType?: number;
  surfaceValue?: number;
  accumulationHours?: number;
  bitsPerValue?: number;
  referenceValue?: number;
  binaryScale?: number;
  decimalScale?: number;
  dataRepresentationTemplate?: number;
  dropSection?: number;
}

/**
 * Build a DWD-style native ICON message: section 3 template 3.101, simple
 * packing, optional bitmap for NaN values, PDT 4.1 (or 4.11 when an
 * accumulation is requested) with a perturbation number.
 */
export function nativeIconMessage(options: NativeMessageOptions): Uint8Array {
  const values = options.values;
  const bitsPerValue = options.bitsPerValue ?? 16;
  const referenceValue = options.referenceValue ?? 279.25;
  const binaryScale = options.binaryScale ?? -2;
  const decimalScale = options.decimalScale ?? 0;

  const section1 = new Uint8Array(21);
  setUint32(section1, 0, 21);
  section1[4] = 1;
  setUint16(section1, 5, 78);
  setUint16(section1, 7, 255);
  section1[9] = 19;
  section1[10] = 1;
  section1[11] = 1;
  setUint16(section1, 12, 2026);
  section1[14] = 9;
  section1[15] = 5;
  section1[16] = 0;
  section1[17] = 0;
  section1[18] = 0;
  section1[19] = 0;
  section1[20] = 1;

  const section2 = new Uint8Array(9);
  setUint32(section2, 0, 9);
  section2[4] = 2;
  section2.set([0xde, 0xad, 0xbe, 0xef], 5);

  const section3 = new Uint8Array(35);
  setUint32(section3, 0, 35);
  section3[4] = 3;
  section3[5] = 0;
  setUint32(section3, 6, values.length);
  section3[10] = 0;
  section3[11] = 0;
  setUint16(section3, 12, 101);
  section3[14] = 6;
  section3[15] = 47;
  section3[16] = 1;

  const interval = options.accumulationHours !== undefined;
  const section4 = new Uint8Array(interval ? 61 : 37);
  setUint32(section4, 0, section4.byteLength);
  section4[4] = 4;
  setUint16(section4, 5, 0);
  setUint16(section4, 7, interval ? 11 : 1);
  section4[9] = options.category ?? 0;
  section4[10] = options.parameter ?? 0;
  section4[11] = 2;
  section4[12] = 0;
  section4[13] = 11;
  setUint16(section4, 14, 0);
  section4[16] = 0;
  section4[17] = 1;
  setUint32(section4, 18, interval ? 0 : 6);
  section4[22] = options.surfaceType ?? 100;
  section4[23] = 0;
  setUint32(section4, 24, options.surfaceValue ?? 85000);
  section4[28] = 255;
  section4[29] = 255;
  setUint32(section4, 30, 0xffffffff);
  section4[34] = 192;
  section4[35] = options.perturbation ?? 1;
  section4[36] = 20;
  if (interval) {
    setUint16(section4, 37, 2026);
    section4[39] = 9;
    section4[40] = 5;
    section4[41] = options.accumulationHours!;
    section4[42] = 0;
    section4[43] = 0;
    section4[44] = 1;
    setUint32(section4, 45, 0);
    section4[49] = 1;
    section4[50] = 2;
    section4[51] = 1;
    setUint32(section4, 52, options.accumulationHours!);
    section4[56] = 1;
    setUint32(section4, 57, 0);
  }

  const defined = values.filter((value) => !Number.isNaN(value));
  const section5 = new Uint8Array(21);
  setUint32(section5, 0, 21);
  section5[4] = 5;
  setUint32(section5, 5, defined.length);
  setUint16(section5, 9, options.dataRepresentationTemplate ?? 0);
  new DataView(section5.buffer).setFloat32(11, referenceValue);
  setUint16(section5, 15, signedScale(binaryScale));
  setUint16(section5, 17, signedScale(decimalScale));
  section5[19] = bitsPerValue;
  section5[20] = 0;

  const hasBitmap = defined.length !== values.length;
  const section6 = new Uint8Array(hasBitmap ? 6 + Math.ceil(values.length / 8) : 6);
  setUint32(section6, 0, section6.byteLength);
  section6[4] = 6;
  section6[5] = hasBitmap ? 0 : 255;
  if (hasBitmap) {
    values.forEach((value, cell) => {
      if (!Number.isNaN(value)) section6[6 + (cell >> 3)]! |= 0x80 >> (cell & 7);
    });
  }

  const section7 = new Uint8Array(5 + Math.ceil((defined.length * bitsPerValue) / 8));
  setUint32(section7, 0, section7.byteLength);
  section7[4] = 7;
  let bitOffset = 0;
  for (const value of defined) {
    const quantised = bitsPerValue === 0
      ? 0
      : Math.round((value * 10 ** decimalScale - referenceValue) / 2 ** binaryScale);
    for (let bit = bitsPerValue - 1; bit >= 0; bit -= 1) {
      if ((quantised >>> bit) & 1) section7[5 + (bitOffset >> 3)]! |= 0x80 >> (bitOffset & 7);
      bitOffset += 1;
    }
  }

  const sections = [section1, section2, section3, section4, section5, section6, section7]
    .filter((section) => section[4] !== options.dropSection);
  const total = 16 + sections.reduce((sum, section) => sum + section.byteLength, 0) + 4;
  const message = new Uint8Array(total);
  message.set([0x47, 0x52, 0x49, 0x42, 0, 0, 0, 2], 0);
  new DataView(message.buffer).setBigUint64(8, BigInt(total));
  let offset = 16;
  for (const section of sections) {
    message.set(section, offset);
    offset += section.byteLength;
  }
  message.set([0x37, 0x37, 0x37, 0x37], total - 4);
  return message;
}

export interface ScripOptions {
  links: ReadonlyArray<readonly [target: number, source: number]>;
  weights?: readonly number[];
  mapMethod?: string;
  numWeights?: number;
  dstDims?: readonly [number, number];
  sourceAddressOnSourceDim?: boolean;
}

/** Minimal classic NetCDF-3 writer producing the SCRIP layout CDO emits. */
export function scripNetcdf(options: ScripOptions): Uint8Array {
  const links = options.links;
  const weights = options.weights ?? links.map(() => 1);
  const numLinks = links.length;
  const dstDims = options.dstDims ?? [TARGET_GRID.xsize, TARGET_GRID.ysize];
  const dimensions: Array<[string, number]> = [
    ["src_grid_size", NATIVE_CELLS],
    ["dst_grid_size", TARGET_GRID.xsize * TARGET_GRID.ysize],
    ["src_grid_rank", 1],
    ["dst_grid_rank", 2],
    ["num_links", numLinks],
    ["num_wgts", options.numWeights ?? 1],
  ];
  const attributes: Array<[string, string]> = [
    ["title", "SCRIP remapping with CDO"],
    ["map_method", options.mapMethod ?? "Nearest neighbor"],
    ["conventions", "SCRIP"],
  ];
  interface Variable { name: string; dims: number[]; type: number; data: number[] }
  const variables: Variable[] = [
    { name: "src_grid_dims", dims: [2], type: 4, data: [NATIVE_CELLS] },
    { name: "dst_grid_dims", dims: [3], type: 4, data: [...dstDims] },
    {
      name: "src_address",
      dims: [options.sourceAddressOnSourceDim ? 0 : 4],
      type: 4,
      data: links.map(([, source]) => source),
    },
    { name: "dst_address", dims: [4], type: 4, data: links.map(([target]) => target) },
    { name: "remap_matrix", dims: [4, 5], type: 6, data: [...weights] },
  ];

  const chunks: Uint8Array[] = [];
  const push = (bytes: Uint8Array) => chunks.push(bytes);
  const pushInt = (value: number) => { const out = new Uint8Array(4); setUint32(out, 0, value >>> 0); push(out); };
  const pushName = (name: string) => {
    const encoded = new TextEncoder().encode(name);
    pushInt(encoded.length);
    const padded = new Uint8Array(Math.ceil(encoded.length / 4) * 4);
    padded.set(encoded);
    push(padded);
  };

  push(new Uint8Array([0x43, 0x44, 0x46, 0x01]));
  pushInt(0);
  pushInt(0x0a);
  pushInt(dimensions.length);
  for (const [name, size] of dimensions) { pushName(name); pushInt(size); }
  pushInt(0x0c);
  pushInt(attributes.length);
  for (const [name, value] of attributes) {
    pushName(name);
    pushInt(2);
    const encoded = new TextEncoder().encode(value);
    pushInt(encoded.length);
    const padded = new Uint8Array(Math.ceil(encoded.length / 4) * 4);
    padded.set(encoded);
    push(padded);
  }
  pushInt(0x0b);
  pushInt(variables.length);
  const headerSizeWithoutOffsets = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    + variables.reduce((sum, variable) =>
      sum + 4 + Math.ceil(new TextEncoder().encode(variable.name).length / 4) * 4
      + 4 + variable.dims.length * 4 + 8 + 4 + 4 + 4, 0);
  let dataOffset = headerSizeWithoutOffsets;
  const payloads: Uint8Array[] = [];
  for (const variable of variables) {
    const elementSize = variable.type === 6 ? 8 : 4;
    const count = variable.dims.reduce((product, dim) => product * dimensions[dim]![1], 1);
    const payload = new Uint8Array(Math.ceil((count * elementSize) / 4) * 4);
    const view = new DataView(payload.buffer);
    variable.data.forEach((value, cell) => {
      if (cell >= count) return;
      if (variable.type === 6) view.setFloat64(cell * 8, value);
      else view.setInt32(cell * 4, value);
    });
    pushName(variable.name);
    pushInt(variable.dims.length);
    for (const dim of variable.dims) pushInt(dim);
    pushInt(0);
    pushInt(0);
    pushInt(variable.type);
    pushInt(payload.byteLength);
    pushInt(dataOffset);
    dataOffset += payload.byteLength;
    payloads.push(payload);
  }
  return concat([...chunks, ...payloads]);
}

export function sectionMap(message: Uint8Array): Map<number, Uint8Array> {
  const sections = new Map<number, Uint8Array>();
  let cursor = 16;
  while (cursor < message.byteLength - 4) {
    const length = readUint32(message, cursor);
    sections.set(message[cursor + 4]!, message.subarray(cursor, cursor + length));
    cursor += length;
  }
  return sections;
}

export function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function signedScale(value: number): number {
  return value < 0 ? 0x8000 | -value : value;
}

function setUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function setUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

export function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

export function readUint32(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x1000000 + bytes[offset + 1]! * 0x10000 + bytes[offset + 2]! * 0x100 + bytes[offset + 3]!;
}
