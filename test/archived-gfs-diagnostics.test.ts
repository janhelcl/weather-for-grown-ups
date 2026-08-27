import { describe, expect, it, vi } from "vitest";
import { ArchivedGfsForecastDiagnosticService } from "../src/core/archived-gfs-diagnostics.js";
import { ARCHIVED_GFS_FORECAST_MODEL } from "../src/core/archived-gfs-query.js";
import { diagnoseAtmosphereSchema } from "../src/schema/unified-api.js";

const run = "2017-05-07T12:00:00Z";

function stateMock() {
  return {
    query: vi.fn(async (request: any) => {
      const validTime = new Date(request.time.at);
      const forecastHour = Math.round(
        (validTime.getTime() - new Date(run).getTime()) / 3_600_000,
      );
      const levels = (request.selection.pressureLevelsHpa ?? []).map((pressureHpa: number) => {
        const height = pressureHpa === 1000 ? 120
          : pressureHpa === 925 ? 750
            : pressureHpa === 850 ? 1500
              : pressureHpa === 700 ? 3000
                : pressureHpa === 500 ? 5500
                  : 7000;
        const temperature = pressureHpa === 1000 ? 18
          : pressureHpa === 925 ? 14
            : pressureHpa === 850 ? 10
              : pressureHpa === 700 ? 1
                : -15;
        return {
          pressureHpa,
          geopotentialHeightGpm: height,
          temperatureC: temperature,
          specificHumidityKgKg: Math.max(0.001, pressureHpa / 100_000),
          uWindMs: pressureHpa >= 850 ? 3 : 10,
          vWindMs: pressureHpa >= 850 ? 4 : 0,
        };
      });
      const fields = request.selection.fields === undefined
        ? undefined
        : [
            {
              id: "surface_pressure",
              level: { type: "surface" },
              temporal: { type: "instantaneous" },
              values: { pressurePa: 100000 },
            },
            {
              id: "surface_geopotential_height",
              level: { type: "surface" },
              temporal: { type: "instantaneous" },
              values: { geopotentialHeightGpm: 100 },
            },
            {
              id: "temperature_2m",
              level: { type: "height_above_ground_m", heightM: 2 },
              temporal: { type: "instantaneous" },
              values: { temperatureC: 20 },
            },
            {
              id: "specific_humidity_2m",
              level: { type: "height_above_ground_m", heightM: 2 },
              temporal: { type: "instantaneous" },
              values: { specificHumidityKgKg: 0.01 },
            },
          ];

      return {
        model: ARCHIVED_GFS_FORECAST_MODEL,
        run: new Date(run).toISOString(),
        validTime: validTime.toISOString(),
        forecastHour,
        requestedPoint: {
          latitude: request.geometry.latitude,
          longitude: request.geometry.longitude,
        },
        gridPoint: { latitude: 50, longitude: 14.5 },
        levels,
        ...(fields === undefined ? {} : { fields }),
        source: {
          provider: "NOAA NCEI",
          access: "ncei_thredds_ncss",
          dataset: `archive-f${String(forecastHour).padStart(3, "0")}`,
          cacheHit: true,
        },
      };
    }),
  };
}

describe("ArchivedGfsForecastDiagnosticService", () => {
  it("derives layer diagnostics from archived forecast state", async () => {
    const state = stateMock();
    const service = new ArchivedGfsForecastDiagnosticService({ state });
    const result: any = await service.diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2017-05-09T12:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear", "temperature_lapse_rate"],
      },
      forecast: { run },
    }));

    expect(result).toMatchObject({
      model: ARCHIVED_GFS_FORECAST_MODEL,
      forecastHour: 48,
      gridPoint: { latitude: 50, longitude: 14.5 },
      layer: { lowerPressureHpa: 850, upperPressureHpa: 500 },
    });
    expect(result.diagnostics.map((item: any) => item.id)).toEqual([
      "wind_shear",
      "temperature_lapse_rate",
    ]);
    expect(state.query).toHaveBeenCalledWith(expect.objectContaining({
      selection: expect.objectContaining({
        variables: expect.arrayContaining(["u_wind", "v_wind", "geopotential_height", "temperature"]),
      }),
    }));
  });

  it("derives whole-profile diagnostics from archived forecast state", async () => {
    const service = new ArchivedGfsForecastDiagnosticService({ state: stateMock() });
    const result: any = await service.diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2017-05-09T15:00:00Z" },
      diagnostic: {
        kind: "profile",
        pressureLevelsHpa: [1000, 850, 700, 500],
        diagnostics: ["freezing_level_crossings", "temperature_inversion_layers"],
      },
      forecast: { run },
    }));

    expect(result.forecastHour).toBe(51);
    expect(result.sampledPressureLevelsHpa).toEqual([1000, 850, 700, 500]);
    expect(result.diagnostics.map((item: any) => item.id)).toEqual([
      "freezing_level_crossings",
      "temperature_inversion_layers",
    ]);
  });

  it("derives parcel diagnostics from archived pressure and surface fields", async () => {
    const state = stateMock();
    const service = new ArchivedGfsForecastDiagnosticService({ state });
    const result: any = await service.diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2017-05-09T12:00:00Z" },
      diagnostic: {
        kind: "parcel",
        parcel: "surface_2m",
        pressureLevelsHpa: [1000, 925, 850, 700, 500],
      },
      forecast: { run },
    }));

    expect(result.parcel.startingState).toMatchObject({
      definition: "surface_2m",
      source: "surface_2m",
      pressureHpa: 1000,
    });
    expect(typeof result.parcel.capeJkg).toBe("number");
    expect(state.query).toHaveBeenCalledWith(expect.objectContaining({
      selection: expect.objectContaining({
        fields: expect.arrayContaining([
          "surface_pressure",
          "surface_geopotential_height",
          "temperature_2m",
          "specific_humidity_2m",
        ]),
      }),
    }));
  });

  it("builds native 3-hour diagnostic ranges from the same instant path", async () => {
    const service = new ArchivedGfsForecastDiagnosticService({ state: stateMock() });
    const result: any = await service.diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: {
        from: "2017-05-07T12:00:00Z",
        to: "2017-05-07T18:00:00Z",
        maxSteps: 3,
      },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear"],
      },
      forecast: { run },
    }));

    expect(result.series.map((step: any) => step.forecastHour)).toEqual([0, 3, 6]);
    expect(result.series.every((step: any) => step.kind === "layer")).toBe(true);
  });

  it("keeps archive routing guards explicit", async () => {
    const service = new ArchivedGfsForecastDiagnosticService({ state: stateMock() });

    await expect(service.diagnose({
      dataset: "gefs",
    } as any)).rejects.toThrow("only accept dataset=gfs");

    await expect(service.diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: { at: "2026-08-28T12:00:00Z" },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear"],
      },
      forecast: { run: "latest" },
    }))).rejects.toThrow("require an explicit forecast.run");

    await expect(service.diagnose(diagnoseAtmosphereSchema.parse({
      dataset: "gfs",
      geometry: { type: "point", latitude: 50, longitude: 14 },
      time: {
        from: "2017-05-07T12:00:00Z",
        to: "2017-05-07T18:00:00Z",
        maxSteps: 2,
      },
      diagnostic: {
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear"],
      },
      forecast: { run },
    }))).rejects.toThrow("exceeding maxSteps=2");
  });
});
