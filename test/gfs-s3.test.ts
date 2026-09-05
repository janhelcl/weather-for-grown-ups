import { describe, expect, it, vi } from "vitest";
import { WFG_USER_AGENT } from "../src/access/user-agent.js";
import { expandRequestedFields } from "../src/catalog/non-isobaric-fields.js";
import {
  buildGfsS3ForecastIndexUrl,
  buildGfsS3RunMarkerUrl,
  COMPLETE_RUN_MARKER_FORECAST_HOUR,
  GfsS3RunProbe,
} from "../src/sources/gfs-s3.js";

const run = new Date("2026-08-19T06:00:00Z");

describe("GFS S3 run discovery", () => {
  it("uses the final f384 index as the complete-run marker", () => {
    expect(COMPLETE_RUN_MARKER_FORECAST_HOUR).toBe(384);
    expect(buildGfsS3RunMarkerUrl(run)).toBe(
      "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20260819/06/atmos/gfs.t06z.pgrb2.0p25.f384.idx",
    );
  });

  it("formats midnight runs and dates with leading zeroes", () => {
    expect(buildGfsS3RunMarkerUrl(new Date("2026-01-02T00:00:00Z"))).toContain(
      "/gfs.20260102/00/atmos/gfs.t00z.pgrb2.0p25.f384.idx",
    );
  });

  it("uses the pre-atmos layout before the GFS v16 directory change", () => {
    expect(buildGfsS3ForecastIndexUrl(new Date("2021-03-22T06:00:00Z"), 0, "0p50")).toBe(
      "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20210322/06/gfs.t06z.pgrb2.0p50.f000.idx",
    );
    expect(buildGfsS3ForecastIndexUrl(new Date("2021-03-22T12:00:00Z"), 0, "0p50")).toBe(
      "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20210322/12/atmos/gfs.t12z.pgrb2.0p50.f000.idx",
    );
  });

  it("reports a run as complete when the marker HEAD succeeds", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    const probe = new GfsS3RunProbe(fetchFn as typeof fetch);

    await expect(probe.isRunComplete(run)).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(buildGfsS3RunMarkerUrl(run), {
      method: "HEAD",
      headers: { "user-agent": WFG_USER_AGENT },
    });
  });

  it("treats a missing marker as an incomplete run", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 404, statusText: "Not Found" }));
    const probe = new GfsS3RunProbe(fetchFn as typeof fetch);
    await expect(probe.isRunComplete(run)).resolves.toBe(false);
  });

  it("checks exact pressure and non-isobaric field availability in the requested forecast index", async () => {
    const index = [
      "1:0:d=2026081906:TMP:850 mb:6 hour fcst:",
      "2:10:d=2026081906:UGRD:850 mb:6 hour fcst:",
      "3:20:d=2026081906:VGRD:850 mb:6 hour fcst:",
      "4:30:d=2026081906:LCDC:low cloud layer:3-6 hour ave fcst:",
    ].join("\n");
    const fetchFn = vi.fn(async () => new Response(index, { status: 200 }));
    const probe = new GfsS3RunProbe(fetchFn as typeof fetch);

    await expect(probe.isForecastAvailable(run, 6, {
      variableCodes: ["TMP", "UGRD", "VGRD"],
      pressureLevelsHpa: [850],
      fields: expandRequestedFields(["low_cloud_cover_average"]),
    })).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(buildGfsS3ForecastIndexUrl(run, 6), {
      headers: { "user-agent": WFG_USER_AGENT },
    });
  });

  it("returns false when the file exists but the exact temporal product is absent", async () => {
    const index = "1:0:d=2026081906:LCDC:low cloud layer:6 hour fcst:";
    const probe = new GfsS3RunProbe(vi.fn(async () => new Response(index, { status: 200 })) as typeof fetch);

    await expect(probe.isForecastAvailable(run, 6, {
      variableCodes: [],
      pressureLevelsHpa: [],
      fields: expandRequestedFields(["low_cloud_cover_average"]),
    })).resolves.toBe(false);
  });

  it("returns false when the requested forecast index is not published yet", async () => {
    const probe = new GfsS3RunProbe(
      vi.fn(async () => new Response(null, { status: 404, statusText: "Not Found" })) as typeof fetch,
    );
    await expect(probe.isForecastAvailable(run, 12, {
      variableCodes: ["TMP"], pressureLevelsHpa: [850], fields: [],
    })).resolves.toBe(false);
  });

  it("does not silently convert unexpected upstream errors into an incomplete run", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 503, statusText: "Unavailable" }));
    const probe = new GfsS3RunProbe(fetchFn as typeof fetch);
    await expect(probe.isRunComplete(run)).rejects.toThrow(/HTTP 503 Unavailable/);
    await expect(probe.isForecastAvailable(run, 6, {
      variableCodes: ["TMP"], pressureLevelsHpa: [850], fields: [],
    })).rejects.toThrow(/HTTP 503 Unavailable/);
  });

  it("propagates network failures from the discovery source", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });
    const probe = new GfsS3RunProbe(fetchFn as typeof fetch);
    await expect(probe.isRunComplete(run)).rejects.toThrow("network down");
  });
});
