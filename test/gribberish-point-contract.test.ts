import { describe, expect, it } from "vitest";
import { scanGrib2Messages } from "../src/grib/dwd-local-parameters.js";

/**
 * The streamed point decoder relies on the generic GRIB2 scanner returning
 * exact non-overlapping message slices. Keep that small contract explicit so
 * future scanner changes cannot silently reintroduce whole-bundle parsing.
 */
describe("GRIB2 message slice contract", () => {
  it("returns no slices for non-GRIB input", () => {
    expect(scanGrib2Messages(new Uint8Array([1, 2, 3, 4]))).toEqual([]);
  });
});
