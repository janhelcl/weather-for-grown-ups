import { describe, expect, it, vi } from "vitest";
import { HistoricalParcelService } from "../src/core/history-parcel.js";
import { deriveSpecificHumidityFromRelativeHumidityKgKg } from "../src/derived/thermodynamics.js";
import type { HistoricalFieldsResult } from "../src/schema/history-fields.js";

const pressureLevelsHpa = [950, 900, 850, 800, 700, 600, 500, 400, 300, 250];
const levels = [
  { pressureHpa: 950, geopotentialHeightGpm: 550, temperatureC: 27, specificHumidityKgKg: 0.015 },
  { pressureHpa: 900, geopotentialHeightGpm: 1000, temperatureC: 23, specificHumidityKgKg: 0.012 },
  { pressureHpa: 850, geopotentialHeightGpm: 1500, temperatureC: 14, specificHumidityKgKg: 0.009 },
  { pressureHpa: 800, geopotentialHeightGpm: 2000, temperatureC: 9, specificHumidityKgKg: 0.007 },
  { pressureHpa: 700, geopotentialHeightGpm: 3000, temperatureC: 0, specificHumidityKgKg: 0.004 },
  { pressureHpa: 600, geopotentialHeightGpm: 4200, temperatureC: -10, specificHumidityKgKg: 0.002 },
  { pressureHpa: 500, geopotentialHeightGpm: 5600, temperatureC: -22, specificHumidityKgKg: 0.001 },
  { pressureHpa: 400, geopotentialHeightGpm: 7200, temperatureC: -32, specificHumidityKgKg: 0.0006 },
  { pressureHpa: 300, geopotentialHeightGpm: 9200, temperatureC: -38, specificHumidityKgKg: 0.0003 },
  { pressureHpa: 250, geopotentialHeightGpm: 10400, temperatureC: -25, specificHumidityKgKg: 0.0002 },
];

const historicalState: HistoricalFieldsResult = {
  model: "gfs_grid4_analysis_0p5",
  analysisTime: "2017-05-09T12:00:00.000Z",
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  selection: {
    variables: ["temperature", "specific_humidity", "geopotential_height"],
    pressureLevelsHpa,
    fields: ["surface_pressure", "surface_geopotential_height", "temperature_2m", "relative_humidity_2m"],
  },
  levels,
  fields: [
    { id: "surface_pressure", level: { type: "surface" }, temporal: { type: "instantaneous" }, values: { pressurePa: 100000 } },
    { id: "surface_geopotential_height", level: { type: "surface" }, temporal: { type: "instantaneous" }, values: { geopotentialHeightGpm: 100 } },
    { id: "temperature_2m", level: { type: "height_above_ground_m", heightM: 2 }, temporal: { type: "instantaneous" }, values: { temperatureC: 30 } },
    { id: "relative_humidity_2m", level: { type: "height_above_ground_m", heightM: 2 }, temporal: { type: "instantaneous" }, values: { relativeHumidityPct: 67 } },
  ],
  source: {
    provider: "NOAA NCEI",
    access: "ncei_thredds_ncss",
    dataset: "model-gfs-g4-anl-files-old/201705/20170509/gfsanl_4_20170509_1200_000.grb2",
    cacheHit: true,
  },
  caveat: "GFS model analysis fields; not direct observations or homogeneous climatological reanalysis",
};

const query = {
  latitude: 50.08,
  longitude: 14.43,
  analysisTime: "2017-05-09T12:00:00Z",
  pressureLevelsHpa,
  parcel: "surface_2m" as const,
};

describe("HistoricalParcelService", () => {
  it("constructs with the default historical fields service", () => {
    expect(new HistoricalParcelService()).toBeInstanceOf(HistoricalParcelService);
  });

  it("uses one mixed historical state request and derives 2 m q from T/RH/surface pressure", async () => {
    const getHistoricalFields = vi.fn(async () => historicalState);
    const service = new HistoricalParcelService({ fieldsGetter: { getHistoricalFields } });

    const result = await service.getHistoricalParcel(query);

    expect(getHistoricalFields).toHaveBeenCalledTimes(1);
    expect(getHistoricalFields).toHaveBeenCalledWith({
      latitude: 50.08,
      longitude: 14.43,
      analysisTime: "2017-05-09T12:00:00Z",
      variables: ["temperature", "specific_humidity", "geopotential_height"],
      pressureLevelsHpa,
      fields: ["surface_pressure", "surface_geopotential_height", "temperature_2m", "relative_humidity_2m"],
    });
    expect(result.parcel.startingState.definition).toBe("surface_2m");
    expect(result.parcel.startingState.specificHumidityKgKg).toBeCloseTo(
      deriveSpecificHumidityFromRelativeHumidityKgKg(30, 67, 1000),
      12,
    );
    expect(result.parcel.capeJkg).toBeGreaterThan(0);
    expect(result.source).toEqual(historicalState.source);
    expect(result.levels).toEqual(levels);
  });

  it.each(["mixed_layer_100hpa", "most_unstable_300hpa"] as const)(
    "reuses the shared parcel engine for %s",
    async (parcel) => {
      const service = new HistoricalParcelService({
        fieldsGetter: { getHistoricalFields: async () => historicalState },
      });
      const result = await service.getHistoricalParcel({ ...query, parcel });
      expect(result.parcel.startingState.definition).toBe(parcel);
      expect(Number.isFinite(result.parcel.capeJkg)).toBe(true);
      expect(Number.isFinite(result.parcel.cinJkg)).toBe(true);
    },
  );

  it("fails loudly when the mixed historical state has no pressure profile", async () => {
    const state = { ...historicalState, levels: undefined } as unknown as HistoricalFieldsResult;
    const service = new HistoricalParcelService({
      fieldsGetter: { getHistoricalFields: async () => state },
    });
    await expect(service.getHistoricalParcel(query)).rejects.toThrow(/missing the pressure profile/);
  });

  it("fails loudly when a required historical surface field is absent", async () => {
    const state = {
      ...historicalState,
      fields: historicalState.fields.filter((field) => field.id !== "relative_humidity_2m"),
    } as HistoricalFieldsResult;
    const service = new HistoricalParcelService({
      fieldsGetter: { getHistoricalFields: async () => state },
    });
    await expect(service.getHistoricalParcel(query)).rejects.toThrow(/relative_humidity_2m\.relativeHumidityPct/);
  });

  it("fails loudly when a required historical surface field has no numeric value", async () => {
    const state = {
      ...historicalState,
      fields: historicalState.fields.map((field) => field.id === "relative_humidity_2m"
        ? { ...field, values: {} }
        : field),
    } as HistoricalFieldsResult;
    const service = new HistoricalParcelService({
      fieldsGetter: { getHistoricalFields: async () => state },
    });
    await expect(service.getHistoricalParcel(query)).rejects.toThrow(/relative_humidity_2m\.relativeHumidityPct/);
  });

  it("fails loudly when a required pressure-level parcel value is absent", async () => {
    const state = {
      ...historicalState,
      levels: historicalState.levels?.map((level, index) => index === 0
        ? { ...level, specificHumidityKgKg: undefined }
        : level),
    } as unknown as HistoricalFieldsResult;
    const service = new HistoricalParcelService({
      fieldsGetter: { getHistoricalFields: async () => state },
    });
    await expect(service.getHistoricalParcel(query)).rejects.toThrow(/specific_humidity@950mb/);
  });
});
