import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { GribMessage } from "@mattnucc/gribberish";
import { parseMessagesFromBuffer } from "@mattnucc/gribberish";
import { describe, expect, it } from "vitest";
import { remapGrib2Message, type LonLatGridDescription } from "../src/grib/icon-d2-remap.js";
import {
  decodePointMessages,
  decodePointMessagesMany,
  gridPointsInBox,
  summarizeMessageInBox,
  type GribBox,
  type GribGridPoint,
  type GribPointSample,
} from "../src/grib/gribberish-runtime.js";
import { concat, nativeIconMessage } from "./icon-d2-fixtures.js";

const execFileAsync = promisify(execFile);
const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const workerParityScript = fileURLToPath(new URL("../scripts/grib-decode-worker-parity.ts", import.meta.url));

const EUROPE_GRID: LonLatGridDescription = {
  xsize: 3,
  ysize: 2,
  xfirst: 10,
  xinc: 0.5,
  yfirst: 50,
  yinc: 0.5,
};

/** 0°–315° axis that gribberish *does* roll into [-180, 135]. */
const WRAPPING_GRID: LonLatGridDescription = {
  xsize: 8,
  ysize: 3,
  xfirst: 0,
  xinc: 45,
  yfirst: 0,
  yinc: 30,
};

/** GFS-like 0°–359.75° axis; gribberish leaves this unrolled. */
const GFS_LIKE_GRID: LonLatGridDescription = {
  xsize: 5,
  ysize: 2,
  xfirst: 0,
  xinc: 89.9375,
  yfirst: 0,
  yinc: 45,
};

const WRAPPING_POINTS: readonly GribPointSample[] = [
  { longitude: 0, latitude: 0 },
  { longitude: 45, latitude: 30 },
  { longitude: 180, latitude: 0 },
  { longitude: -180, latitude: 0 },
  { longitude: -179.9, latitude: 0 },
  { longitude: 179.9, latitude: 0 },
  { longitude: -0.1, latitude: 0 },
  { longitude: 359.9, latitude: 0 },
  { longitude: 360, latitude: 30 },
  { longitude: 200, latitude: 60 },
  { longitude: 181, latitude: 0 },
  { longitude: -90, latitude: 30 },
  { longitude: 315, latitude: 60 },
  { longitude: 14.4, latitude: 1 },
];

describe("GRIB skip-roll matches previous rolled unpack", () => {
  it("is a no-op on a European patch and a GFS-like 0-360 axis, and still matches samples", () => {
    const europe = parsePacked(remappedLonLat(EUROPE_GRID));
    const gfsLike = parsePacked(remappedLonLat(GFS_LIKE_GRID));
    expect(longitudeAxisRolled(europe)).toBe(false);
    expect(longitudeAxisRolled(gfsLike)).toBe(false);
    expectSameSamples(europe, [{ longitude: 10, latitude: 50 }, { longitude: 11, latitude: 50.5 }]);
    expectSameSamples(gfsLike, [
      { longitude: 0, latitude: 0 },
      { longitude: 359.75, latitude: 45 },
      { longitude: -0.1, latitude: 1 },
      { longitude: 180, latitude: 20 },
    ]);
  });

  it("keeps nearest-neighbour samples identical when gribberish reorders a wrapping longitude axis", () => {
    const message = parsePacked(remappedLonLat(WRAPPING_GRID));
    expect(longitudeAxisRolled(message)).toBe(true);
    expectSameSamples(message, WRAPPING_POINTS);
  });

  it("unpacks once for every coordinate with the same values as rolled per-point decode", () => {
    const first = parsePacked(remappedLonLat(WRAPPING_GRID, 85000));
    const second = parsePacked(remappedLonLat(WRAPPING_GRID, 70000));
    expect(longitudeAxisRolled(first)).toBe(true);

    const current = decodePointMessagesMany([first, second], WRAPPING_POINTS);
    const previous = WRAPPING_POINTS.map((point) => decodePointMessages(
      [asRolledUnpack(first), asRolledUnpack(second)],
      point.longitude,
      point.latitude,
    ));
    expect(current).toEqual(previous);
    expect(current[0]?.map((value) => value.pressureHpa)).toEqual([850, 700]);
  });

  it("keeps bbox membership and summary statistics identical across the dateline", () => {
    const message = parsePacked(remappedLonLat(WRAPPING_GRID));
    const boxes: GribBox[] = [
      { westLongitude: 10, eastLongitude: 50, southLatitude: -10, northLatitude: 40 },
      { westLongitude: 170, eastLongitude: -170, southLatitude: -10, northLatitude: 70 },
      { westLongitude: -10, eastLongitude: 10, southLatitude: -10, northLatitude: 10 },
      { westLongitude: -135, eastLongitude: -45, southLatitude: 20, northLatitude: 40 },
    ];
    for (const box of boxes) {
      expect(sortedPoints(gridPointsInBox(message, box))).toEqual(
        sortedPoints(gridPointsInBox(asRolledUnpack(message), box)),
      );
      expect(summarizeMessageInBox(message, box)).toEqual(
        summarizeMessageInBox(asRolledUnpack(message), box),
      );
    }
  });

  it("matches sequential unpack when the worker pool runs outside Vitest", async () => {
    const bytes = concat([
      remappedLonLat(WRAPPING_GRID, 85000),
      remappedLonLat(WRAPPING_GRID, 70000),
    ]);
    const dir = await mkdtemp(join(tmpdir(), "wfg-grib-parity-"));
    const path = join(dir, "fields.grib2");
    try {
      await writeFile(path, bytes);
      const { stdout, stderr } = await execFileAsync(process.execPath, [
        tsxCli,
        workerParityScript,
        path,
        JSON.stringify(WRAPPING_POINTS),
      ], {
        env: envWithoutVitest(),
        timeout: 30_000,
        maxBuffer: 2_000_000,
      });
      expect(stderr).toBe("");
      expect(stdout).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 40_000);
});

function remappedLonLat(grid: LonLatGridDescription, surfaceValue = 85000): Uint8Array {
  const count = grid.xsize * grid.ysize;
  return remapGrib2Message(nativeIconMessage({
    values: Array.from({ length: count }, (_, index) => index + 1),
    bitsPerValue: 8,
    referenceValue: 0,
    binaryScale: 0,
    decimalScale: 0,
    surfaceValue,
  }), {
    sourceSize: count,
    targetGrid: grid,
    sourceIndexByTarget: Int32Array.from({ length: count }, (_, index) => index),
  });
}

function parsePacked(bytes: Uint8Array): GribMessage {
  const [message] = parseMessagesFromBuffer(bytes);
  if (message === undefined) throw new Error("Expected one GRIB2 message");
  return message;
}

function asRolledUnpack(message: GribMessage): GribMessage {
  const coordinates = message.latlngAdjusted(true, false);
  const data = message.dataAdjusted(true, false);
  return {
    key: message.key,
    varAbbrev: message.varAbbrev,
    referenceDate: message.referenceDate,
    forecastDate: message.forecastDate,
    forecastEndDate: message.forecastEndDate,
    gridShape: message.gridShape,
    isRegularGrid: message.isRegularGrid,
    latlngAdjusted: () => coordinates,
    dataAdjusted: () => data,
  } as unknown as GribMessage;
}

function longitudeAxisRolled(message: GribMessage): boolean {
  const raw = message.latlngAdjusted(false, false).longitude;
  const rolled = message.latlngAdjusted(true, false).longitude;
  if (raw.length !== rolled.length) return true;
  return raw.some((value, index) => value !== rolled[index]);
}

function expectSameSamples(message: GribMessage, points: readonly GribPointSample[]): void {
  const current = decodePointMessagesMany([message], points);
  const previous = points.map((point) => decodePointMessages(
    [asRolledUnpack(message)],
    point.longitude,
    point.latitude,
  ));
  expect(current).toEqual(previous);
}

function sortedPoints(points: readonly GribGridPoint[]): GribGridPoint[] {
  return [...points].sort((left, right) =>
    left.latitude - right.latitude
    || left.longitude - right.longitude
    || left.value - right.value);
}

function envWithoutVitest(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, WFG_GRIB_DECODE_WORKERS: "2" };
  for (const key of Object.keys(env)) {
    if (key === "VITEST" || key.startsWith("VITEST_")) delete env[key];
  }
  return env;
}
