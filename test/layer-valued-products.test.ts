import { describe, expect, it, vi } from "vitest";
import {
  expandRequestedFields,
  NON_ISOBARIC_FIELD_CATALOG,
} from "../src/catalog/non-isobaric-fields.js";
import { ALL_SUPPORTED_GFS_CODES } from "../src/catalog/variables.js";
import { ProfileService } from "../src/core/profile.js";
import type { DecodedValue } from "../src/types/decoded.js";
import { parseGribIndex, selectNonIsobaricByteRanges } from "../src/grib/index.js";
import { parseWgrib2PointLine } from "../src/grib/wgrib2.js";
import { profileQuerySchema } from "../src/schema/query.js";
import { buildNomadsPointUrl } from "../src/sources/nomads.js";
import type { ProfileDataRequest, ProfileDataSource } from "../src/sources/types.js";

const gridPoint = { latitude: 50, longitude: 14.5 };
const run = "2026-08-20T06:00:00Z";

function profileHarness(values: DecodedValue[]) {
  const fetchMock = vi.fn(async (_request: ProfileDataRequest) => ({ path: "/cache/layers.grib2", cacheHit: false }));
  const source: ProfileDataSource = {
    id: "nomads",
    provider: "NOAA NOMADS",
    access: "nomads_grib_filter",
    fetch: fetchMock,
  };
  return {
    service: new ProfileService({
      sources: { nomads: source },
      decoder: { extractPoint: vi.fn(async () => values) },
    }),
    fetchMock,
  };
}

describe("layer-valued field catalog", () => {
  it("models cloud layers, named cloud boundaries, atmospheric columns and averages explicitly", () => {
    expect(NON_ISOBARIC_FIELD_CATALOG.low_cloud_cover).toMatchObject({
      kind: "raw",
      gfsCode: "LCDC",
      level: { type: "named_layer", id: "low_cloud_layer", gribLevel: "low cloud layer" },
      temporalSemantics: "instantaneous",
    });
    expect(NON_ISOBARIC_FIELD_CATALOG.low_cloud_cover_average).toMatchObject({
      gfsCode: "LCDC",
      level: { type: "named_layer", id: "low_cloud_layer" },
      temporalSemantics: "average",
    });
    expect(NON_ISOBARIC_FIELD_CATALOG.low_cloud_base_pressure).toMatchObject({
      gfsCode: "PRES",
      level: { type: "named_level", id: "low_cloud_base", gribLevel: "low cloud bottom level" },
      temporalSemantics: "average",
    });
    expect(NON_ISOBARIC_FIELD_CATALOG.precipitable_water).toMatchObject({
      gfsCode: "PWAT",
      level: { type: "named_layer", id: "entire_atmosphere_single_layer" },
      temporalSemantics: "instantaneous",
      outputs: [{ field: "precipitableWaterKgM2", unit: "kg/m^2" }],
    });
  });

  it("registers every GFS code needed by layer-valued fields with the decoder", () => {
    expect(ALL_SUPPORTED_GFS_CODES).toEqual(expect.arrayContaining([
      "PWAT", "CWAT", "TOZNE", "LCDC", "MCDC", "HCDC", "CWORK",
    ]));
  });

  it("accepts new field IDs through the shared point-query schema", () => {
    expect(profileQuerySchema.parse({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime: "2026-08-20T09:00:00Z",
      fields: ["low_cloud_cover", "low_cloud_base_pressure", "precipitable_water"],
    }).fields).toEqual(["low_cloud_cover", "low_cloud_base_pressure", "precipitable_water"]);
  });
});

describe("layer-valued GRIB planning and decoding", () => {
  const indexText = [
    "1:0:d=2026082006:LCDC:low cloud layer:0-3 hour ave fcst:",
    "2:10:d=2026082006:LCDC:low cloud layer:3 hour fcst:",
    "3:20:d=2026082006:PRES:low cloud bottom level:0-3 hour ave fcst:",
    "4:30:d=2026082006:PWAT:entire atmosphere (considered as a single layer):3 hour fcst:",
    "5:40:d=2026082006:TCDC:convective cloud layer:3 hour fcst:",
    "6:50:d=2026082006:TCDC:boundary layer cloud layer:0-3 hour ave fcst:",
    "7:60:d=2026082006:TMP:850 mb:3 hour fcst:",
  ].join("\n");

  it("selects instantaneous and averaged records separately even when code + layer are identical", () => {
    const records = parseGribIndex(indexText);
    expect(selectNonIsobaricByteRanges(records, expandRequestedFields([
      "low_cloud_cover",
      "low_cloud_cover_average",
      "low_cloud_base_pressure",
      "precipitable_water",
      "convective_cloud_cover",
      "boundary_layer_cloud_cover",
    ]))).toEqual([
      { start: 0, end: 9 },
      { start: 10, end: 19 },
      { start: 20, end: 29 },
      { start: 30, end: 39 },
      { start: 40, end: 49 },
      { start: 50, end: 59 },
    ]);
  });

  it("fails clearly when only the wrong temporal product exists", () => {
    const records = parseGribIndex([
      "1:0:d=2026082006:LCDC:low cloud layer:0-3 hour ave fcst:",
      "2:10:d=2026082006:TMP:850 mb:3 hour fcst:",
    ].join("\n"));
    expect(() => selectNonIsobaricByteRanges(records, expandRequestedFields(["low_cloud_cover"])))
      .toThrow(/low_cloud_cover.*instantaneous/);
  });

  it("decodes named layers and forecast-average intervals", () => {
    expect(parseWgrib2PointLine(
      "2:10:d=2026082006:LCDC:low cloud layer:3 hour fcst:lon=14.5,lat=50,val=45",
    )).toEqual({
      code: "LCDC",
      namedVertical: "low cloud layer",
      value: 45,
      gridPoint,
    });

    expect(parseWgrib2PointLine(
      "3:20:d=2026082006:PRES:low cloud bottom level:0-3 hour ave fcst:lon=14.5,lat=50,val=81200",
    )).toEqual({
      code: "PRES",
      namedVertical: "low cloud bottom level",
      average: { startForecastHour: 0, endForecastHour: 3 },
      value: 81200,
      gridPoint,
    });
  });

  it("builds NOMADS filters for named layers and levels", () => {
    const url = new URL(buildNomadsPointUrl({
      run: new Date(run),
      forecastHour: 3,
      latitude: 50.08,
      longitude: 14.43,
      variables: [],
      pressureLevelsHpa: [],
      fields: expandRequestedFields(["precipitable_water", "low_cloud_cover", "low_cloud_base_pressure"]),
    }));

    expect(url.searchParams.get("var_PWAT")).toBe("on");
    expect(url.searchParams.get("var_LCDC")).toBe("on");
    expect(url.searchParams.get("var_PRES")).toBe("on");
    expect(url.searchParams.get("lev_entire_atmosphere_(considered_as_a_single_layer)")).toBe("on");
    expect(url.searchParams.get("lev_low_cloud_layer")).toBe("on");
    expect(url.searchParams.get("lev_low_cloud_bottom_level")).toBe("on");
  });
});

describe("ProfileService layer-valued fields", () => {
  it("returns normalized named vertical and average temporal semantics", async () => {
    const values: DecodedValue[] = [
      { code: "LCDC", namedVertical: "low cloud layer", value: 45, gridPoint },
      {
        code: "PRES",
        namedVertical: "low cloud bottom level",
        average: { startForecastHour: 0, endForecastHour: 3 },
        value: 81200,
        gridPoint,
      },
      {
        code: "TMP",
        namedVertical: "low cloud top level",
        average: { startForecastHour: 0, endForecastHour: 3 },
        value: 263.15,
        gridPoint,
      },
      {
        code: "PWAT",
        namedVertical: "entire atmosphere (considered as a single layer)",
        value: 22.5,
        gridPoint,
      },
    ];
    const { service, fetchMock } = profileHarness(values);

    const result = await service.getProfile({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime: "2026-08-20T09:00:00Z",
      fields: [
        "low_cloud_cover",
        "low_cloud_base_pressure",
        "low_cloud_top_temperature",
        "precipitable_water",
      ],
    });

    expect(fetchMock.mock.calls[0]?.[0].fields?.map((field) => field.id)).toEqual([
      "low_cloud_cover",
      "low_cloud_base_pressure",
      "low_cloud_top_temperature",
      "precipitable_water",
    ]);
    expect(result.fields).toEqual([
      {
        id: "low_cloud_cover",
        level: { type: "named_layer", id: "low_cloud_layer" },
        temporal: { type: "instantaneous" },
        values: { cloudCoverPct: 45 },
      },
      {
        id: "low_cloud_base_pressure",
        level: { type: "named_level", id: "low_cloud_base" },
        temporal: {
          type: "average",
          startForecastHour: 0,
          endForecastHour: 3,
          startTime: "2026-08-20T06:00:00.000Z",
          endTime: "2026-08-20T09:00:00.000Z",
        },
        values: { pressurePa: 81200 },
      },
      {
        id: "low_cloud_top_temperature",
        level: { type: "named_level", id: "low_cloud_top" },
        temporal: {
          type: "average",
          startForecastHour: 0,
          endForecastHour: 3,
          startTime: "2026-08-20T06:00:00.000Z",
          endTime: "2026-08-20T09:00:00.000Z",
        },
        values: { temperatureC: -10 },
      },
      {
        id: "precipitable_water",
        level: { type: "named_layer", id: "entire_atmosphere_single_layer" },
        temporal: { type: "instantaneous" },
        values: { precipitableWaterKgM2: 22.5 },
      },
    ]);
  });

  it("rejects an averaged field decoded as instantaneous", async () => {
    const { service } = profileHarness([
      { code: "PRES", namedVertical: "low cloud bottom level", value: 81200, gridPoint },
    ]);

    await expect(service.getProfile({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime: "2026-08-20T09:00:00Z",
      fields: ["low_cloud_base_pressure"],
    })).rejects.toThrow(/low_cloud_base_pressure.*average/);
  });
});
