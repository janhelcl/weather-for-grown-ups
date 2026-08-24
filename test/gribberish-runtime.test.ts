import type { GribMessage } from "@mattnucc/gribberish";
import { describe, expect, it } from "vitest";
import {
  decodePointMessages,
  gridPointsInBox,
  selectMessage,
  summarizeMessageInBox,
  temporalForSelector,
} from "../src/grib/gribberish-runtime.js";

interface FakeMessageOptions {
  key: string;
  code?: string;
  reference?: string;
  forecast?: string;
  forecastEnd?: string | null;
  latitudes?: number[];
  longitudes?: number[];
  values?: number[];
}

function fakeMessage(options: FakeMessageOptions): GribMessage {
  const latitudes = options.latitudes ?? [50, 50, 49, 49];
  const longitudes = options.longitudes ?? [14, 15, 14, 15];
  const values = options.values ?? [280, 281, 282, 283];
  return {
    key: options.key,
    varAbbrev: options.code ?? "TMP",
    referenceDate: new Date(options.reference ?? "2026-08-24T00:00:00Z"),
    forecastDate: new Date(options.forecast ?? "2026-08-24T06:00:00Z"),
    forecastEndDate: options.forecastEnd === undefined
      ? null
      : options.forecastEnd === null
        ? null
        : new Date(options.forecastEnd),
    gridShape: { rows: 2, cols: 2 },
    latlngAdjusted: () => ({ latitude: latitudes, longitude: longitudes }),
    dataAdjusted: () => values,
  } as unknown as GribMessage;
}

describe("bundled GRIB2 point decoding", () => {
  it("decodes pressure levels and samples the nearest grid point", () => {
    const result = decodePointMessages([
      fakeMessage({ key: "TMP:202608240600:850 in mb:Forecast" }),
    ], 14.8, 49.2);

    expect(result).toEqual([{
      code: "TMP",
      pressureHpa: 850,
      value: 283,
      gridPoint: { latitude: 49, longitude: 15 },
    }]);
  });

  it.each([
    ["PRES:202608240600: in surface:Forecast", { surface: true }],
    ["TMP:202608240600:2 in above ground:Forecast", { heightAboveGroundM: 2 }],
    ["PWAT:202608240600: in entire atmosphere as a single layer:Forecast", {
      namedVertical: "entire atmosphere (considered as a single layer)",
    }],
    [
      "CAPE:202608240600:18000 in level at specified pressure difference from ground to level:0 in level at specified pressure difference from ground to level:Forecast",
      { namedVertical: "180-0 mb above ground" },
    ],
  ])("maps decoder vertical key %s to WFG semantics", (key, expectedVertical) => {
    const [decoded] = decodePointMessages([fakeMessage({ key, code: key.split(":")[0] })], 14, 50);
    expect(decoded).toMatchObject(expectedVertical);
  });

  it("preserves accumulation rather than tagging every interval as both statistics", () => {
    const [decoded] = decodePointMessages([
      fakeMessage({
        key: "APCP:202608240600: in surface:Accumulation Forecast",
        code: "APCP",
        forecast: "2026-08-24T03:00:00Z",
        forecastEnd: "2026-08-24T06:00:00Z",
      }),
    ], 14, 50);

    expect(decoded?.accumulation).toEqual({ startForecastHour: 3, endForecastHour: 6 });
    expect(decoded?.average).toBeUndefined();
  });

  it("preserves average intervals independently", () => {
    const [decoded] = decodePointMessages([
      fakeMessage({
        key: "TCDC:202608240600: in entire atmosphere:Average Forecast",
        code: "TCDC",
        forecast: "2026-08-24T00:00:00Z",
        forecastEnd: "2026-08-24T06:00:00Z",
      }),
    ], 14, 50);

    expect(decoded?.average).toEqual({ startForecastHour: 0, endForecastHour: 6 });
    expect(decoded?.accumulation).toBeUndefined();
  });
});

describe("bundled GRIB2 exact message selection", () => {
  const instant = fakeMessage({
    key: "LCDC:202608240600: in low cloud layer:Forecast",
    code: "LCDC",
  });
  const average = fakeMessage({
    key: "LCDC:202608240600: in low cloud layer:Average Forecast",
    code: "LCDC",
    forecast: "2026-08-24T03:00:00Z",
    forecastEnd: "2026-08-24T06:00:00Z",
  });

  it("distinguishes instantaneous and averaged messages sharing code and level", () => {
    const selected = selectMessage([instant, average], {
      code: "LCDC",
      gribLevel: "low cloud layer",
      temporalSemantics: "average",
    });
    expect(selected).toBe(average);
    expect(temporalForSelector(selected, {
      code: "LCDC",
      gribLevel: "low cloud layer",
      temporalSemantics: "average",
    })).toEqual({ type: "average", startForecastHour: 3, endForecastHour: 6 });
  });

  it("rejects ambiguous exact matches", () => {
    expect(() => selectMessage([instant, instant], {
      code: "LCDC",
      gribLevel: "low cloud layer",
      temporalSemantics: "instantaneous",
    })).toThrow(/ambiguous/);
  });
});

describe("bundled GRIB2 area decoding", () => {
  it("keeps defined grid points inside the bbox and computes wgrib2-compatible counts", () => {
    const message = fakeMessage({
      key: "TMP:202608240600:850 in mb:Forecast",
      latitudes: [50, 50, 49, 49],
      longitudes: [-10, 20, -10, 20],
      values: [270, 280, Number.NaN, 300],
    });
    const box = {
      westLongitude: -10,
      eastLongitude: 10,
      southLatitude: 49,
      northLatitude: 50,
    };

    expect(gridPointsInBox(message, box)).toEqual([
      { longitude: -10, latitude: 50, value: 270 },
    ]);
    expect(summarizeMessageInBox(message, box)).toEqual({
      totalGridPoints: 4,
      undefinedGridPoints: 3,
      definedGridPoints: 1,
      mean: 270,
      min: 270,
      max: 270,
    });
  });

  it("supports boxes crossing the antimeridian", () => {
    const message = fakeMessage({
      key: "TMP:202608240600:850 in mb:Forecast",
      latitudes: [0, 0, 0, 0],
      longitudes: [-179, -160, 160, 179],
      values: [1, 2, 3, 4],
    });
    const points = gridPointsInBox(message, {
      westLongitude: 170,
      eastLongitude: -170,
      southLatitude: -1,
      northLatitude: 1,
    });
    expect(points.map((point) => point.value)).toEqual([1, 4]);
  });
});
