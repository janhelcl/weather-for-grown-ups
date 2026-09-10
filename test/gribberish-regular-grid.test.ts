import type { GribMessage } from "@mattnucc/gribberish";
import { describe, expect, it } from "vitest";
import {
  decodePointMessages,
  decodePointMessagesMany,
  gridPointsInBox,
  summarizeMessageInBox,
} from "../src/grib/gribberish-runtime.js";

function regularGridMessage(values: number[] = [280, 281, 282, 283]): GribMessage {
  return {
    key: "TMP:202608240600:850 in mb:Forecast",
    varAbbrev: "TMP",
    referenceDate: new Date("2026-08-24T00:00:00Z"),
    forecastDate: new Date("2026-08-24T06:00:00Z"),
    forecastEndDate: null,
    gridShape: { rows: 2, cols: 2 },
    latlngAdjusted: () => ({
      latitude: [50, 49],
      longitude: [14, 15],
    }),
    dataAdjusted: () => values,
  } as unknown as GribMessage;
}

describe("bundled GRIB2 regular-grid axes", () => {
  it("samples row-major data from separate latitude and longitude axes", () => {
    const result = decodePointMessages([regularGridMessage()], 14.8, 49.2);
    expect(result).toEqual([{
      code: "TMP",
      pressureHpa: 850,
      value: 283,
      gridPoint: { latitude: 49, longitude: 15 },
    }]);
  });

  it("extracts a bounded area without expanding axes into million-point coordinate arrays", () => {
    const message = regularGridMessage([270, 280, 290, 300]);
    const box = {
      westLongitude: 13.5,
      eastLongitude: 14.5,
      southLatitude: 49,
      northLatitude: 50,
    };

    expect(gridPointsInBox(message, box)).toEqual([
      { longitude: 14, latitude: 50, value: 270 },
      { longitude: 14, latitude: 49, value: 290 },
    ]);
    expect(summarizeMessageInBox(message, box)).toEqual({
      totalGridPoints: 4,
      undefinedGridPoints: 2,
      definedGridPoints: 2,
      mean: 280,
      min: 270,
      max: 290,
    });
  });

  it("rejects regular axes with no finite coordinate", () => {
    const message = {
      ...regularGridMessage(),
      latlngAdjusted: () => ({
        latitude: [Number.NaN, Number.NaN],
        longitude: [14, 15],
      }),
    } as unknown as GribMessage;
    expect(() => decodePointMessages([message], 14.8, 49.2)).toThrow(/no grid coordinates/);
  });

  it("rejects an undefined value at the nearest regular-grid point", () => {
    expect(() => decodePointMessages([
      regularGridMessage([280, 281, 282, Number.NaN]),
    ], 14.8, 49.2)).toThrow(/nearest GRIB2 grid point is undefined/i);
  });

  it("samples every coordinate from one unpacked grid", () => {
    let dataReads = 0;
    const message = regularGridMessage([270, 280, 290, 300]);
    (message as { dataAdjusted: () => number[] }).dataAdjusted = () => {
      dataReads += 1;
      return [270, 280, 290, 300];
    };

    const [first, second] = decodePointMessagesMany([message], [
      { longitude: 14, latitude: 50 },
      { longitude: 15, latitude: 49 },
    ]);

    expect(dataReads).toBe(1);
    expect(first?.[0]?.value).toBe(270);
    expect(second?.[0]?.value).toBe(300);
  });

  it("finds the nearest neighbour on an unrolled 0-360 longitude axis", () => {
    const message = {
      ...regularGridMessage([1, 2, 3, 4]),
      latlngAdjusted: () => ({
        latitude: [50, 49],
        longitude: [0, 359.5],
      }),
      dataAdjusted: () => [10, 20, 30, 40],
    } as unknown as GribMessage;

    const [decoded] = decodePointMessages([message], -0.1, 50);
    expect(decoded).toMatchObject({
      value: 10,
      gridPoint: { latitude: 50, longitude: 0 },
    });
  });
});
