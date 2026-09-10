import { describe, expect, it, vi } from "vitest";
import {
  estimateGfsPointMessagesPerStep,
  MAX_AUTO_S3_POINT_MESSAGES_PER_STEP,
  selectAutomaticGfsDiagnosticSource,
  selectAutomaticGfsPointSource,
} from "../src/core/gfs-point-source.js";
import { GfsDiagnosticAdapter } from "../src/core/diagnostic-adapters/gfs.js";
import { GfsQueryAdapter } from "../src/core/query-adapters/gfs.js";
import { diagnoseAtmosphereSchema } from "../src/schema/unified-api.js";
import { normalizeQueryAtmosphereInput } from "../src/schema/unified-query-input.js";

const NOW = new Date("2026-09-10T10:00:00Z");
const WIDE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350];

function rangeRequest(overrides: Record<string, unknown> = {}) {
  return normalizeQueryAtmosphereInput({
    dataset: "gfs",
    geometry: { type: "point", latitude: 45.765, longitude: 11.73 },
    time: {
      from: "2026-09-12T08:00:00Z",
      to: "2026-09-12T18:00:00Z",
    },
    selection: {
      variables: ["temperature", "relative_humidity", "u_wind", "v_wind", "geopotential_height"],
      pressureLevelsHpa: WIDE_LEVELS,
      fields: ["temperature_2m", "total_precipitation", "low_cloud_cover_average"],
    },
    ...overrides,
  });
}

function parcelRequest(source?: "s3" | "nomads") {
  return diagnoseAtmosphereSchema.parse({
    dataset: "gfs",
    geometry: { type: "point", latitude: 45.765, longitude: 11.73 },
    time: { at: "2026-09-12T12:00:00Z" },
    diagnostic: {
      kind: "parcel",
      pressureLevelsHpa: WIDE_LEVELS,
      parcel: "surface_2m",
    },
    ...(source === undefined ? {} : { source }),
  });
}

describe("automatic GFS point source selection", () => {
  it("counts raw GRIB messages after derived-variable expansion", () => {
    expect(estimateGfsPointMessagesPerStep({
      variables: ["wind"],
      pressureLevelsHpa: [850, 700, 500],
      fields: ["wind_10m", "u_wind_10m"],
    })).toBe(8); // 2 pressure components × 3 levels + 2 deduplicated surface components
  });

  it("keeps narrow selections on S3 and routes wide selections to NOMADS", () => {
    const exactlyAtS3Limit = {
      variables: ["temperature", "relative_humidity", "u_wind", "v_wind"] as const,
      pressureLevelsHpa: [1000, 850, 700, 500],
    };
    expect(estimateGfsPointMessagesPerStep(exactlyAtS3Limit)).toBe(MAX_AUTO_S3_POINT_MESSAGES_PER_STEP);
    expect(selectAutomaticGfsPointSource(exactlyAtS3Limit)).toBe("s3");

    expect(selectAutomaticGfsPointSource({
      ...exactlyAtS3Limit,
      pressureLevelsHpa: [1000, 925, 850, 700, 500],
    })).toBe("nomads");
  });

  it("routes wide parcel diagnostics to NOMADS", () => {
    expect(selectAutomaticGfsDiagnosticSource(parcelRequest().diagnostic)).toBe("nomads");
  });

  it("routes a wide unified point time series to NOMADS when source is omitted", async () => {
    const getTimeSeries = vi.fn(async (query) => query);
    const adapter = new GfsQueryAdapter({
      gfsTimeSeries: { getTimeSeries },
      now: () => NOW,
    });

    await adapter.query(rangeRequest());

    expect(getTimeSeries).toHaveBeenCalledOnce();
    expect(getTimeSeries).toHaveBeenCalledWith(expect.objectContaining({ source: "nomads" }));
  });

  it("preserves an explicit S3 override for the same wide request", async () => {
    const getTimeSeries = vi.fn(async (query) => query);
    const adapter = new GfsQueryAdapter({
      gfsTimeSeries: { getTimeSeries },
      now: () => NOW,
    });

    await adapter.query(rangeRequest({ source: "s3" }));

    expect(getTimeSeries).toHaveBeenCalledOnce();
    expect(getTimeSeries).toHaveBeenCalledWith(expect.objectContaining({ source: "s3" }));
  });

  it("keeps a narrow unified point query on S3 when source is omitted", async () => {
    const getProfile = vi.fn(async (query) => query);
    const adapter = new GfsQueryAdapter({
      gfsProfile: { getProfile },
      now: () => NOW,
    });
    const request = normalizeQueryAtmosphereInput({
      dataset: "gfs",
      geometry: { type: "point", latitude: 45.765, longitude: 11.73 },
      time: { at: "2026-09-12T12:00:00Z" },
      selection: {
        variables: ["temperature", "wind"],
        pressureLevelsHpa: [850, 700, 500],
      },
    });

    await adapter.query(request);

    expect(getProfile).toHaveBeenCalledOnce();
    expect(getProfile).toHaveBeenCalledWith(expect.objectContaining({ source: "s3" }));
  });

  it("applies automatic routing to GFS diagnostics and preserves explicit overrides", async () => {
    const getParcelDiagnostics = vi.fn(async (request) => request);
    const adapter = new GfsDiagnosticAdapter({
      parcel: { getParcelDiagnostics },
      now: () => NOW,
    });

    await adapter.diagnose(parcelRequest());
    expect(getParcelDiagnostics).toHaveBeenLastCalledWith(expect.objectContaining({
      query: expect.objectContaining({ source: "nomads" }),
    }));

    await adapter.diagnose(parcelRequest("s3"));
    expect(getParcelDiagnostics).toHaveBeenLastCalledWith(expect.objectContaining({
      query: expect.objectContaining({ source: "s3" }),
    }));
  });
});
