import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scanGrib2Messages } from "../src/grib/dwd-local-parameters.js";
import {
  decodeWorkerCount,
  gribDecodePool,
  shutdownGribDecodePool,
} from "../src/grib/grib-decode-pool.js";
import { decodePointChunk } from "../src/grib/grib-point-chunk.js";
import { decodePointGribBytes } from "../src/grib/gribberish-point.js";
import type { DecodedValue } from "../src/types/decoded.js";

/**
 * Compare sequential main-thread unpack with the process-local worker pool.
 * Must run outside Vitest (the pool refuses to start when VITEST is set).
 */
const gribPath = process.argv[2];
const pointsJson = process.argv[3];
if (gribPath === undefined || pointsJson === undefined) {
  throw new Error("Usage: grib-decode-worker-parity.ts <grib-path> <points-json>");
}

assert.equal(process.env.VITEST, undefined, "Worker parity must not run under Vitest");
assert.equal(decodeWorkerCount(), 2, "Worker parity requires WFG_GRIB_DECODE_WORKERS=2");

const pool = gribDecodePool();
assert.equal(pool.enabled, true, "GRIB decode worker pool failed to start");

const points = JSON.parse(pointsJson) as Array<{ longitude: number; latitude: number }>;
assert.ok(Array.isArray(points) && points.length > 0, "points-json must be a non-empty array");

const bytes = await readFile(gribPath);
const chunks = scanGrib2Messages(bytes);
assert.ok(chunks.length > 1, "Worker overlap needs at least two GRIB messages");

const sequential = mergeChunkValues(
  chunks.map((chunk) => decodePointChunk(bytes.subarray(chunk.start, chunk.end), points)),
  points.length,
);

try {
  const parallel = await decodePointGribBytes(bytes, points);
  assert.deepEqual(parallel, sequential);
} finally {
  shutdownGribDecodePool();
}

function mergeChunkValues(
  perChunk: readonly DecodedValue[][][],
  pointCount: number,
): DecodedValue[][] {
  const valuesByPoint: DecodedValue[][] = Array.from({ length: pointCount }, () => []);
  for (const chunkValues of perChunk) {
    for (let index = 0; index < pointCount; index += 1) {
      const values = chunkValues[index];
      if (values !== undefined && values.length > 0) valuesByPoint[index]!.push(...values);
    }
  }
  return valuesByPoint;
}
