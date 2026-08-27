import { describe, expect, it } from "vitest";
import { expandRequestedVariables } from "../src/catalog/variables.js";
import { buildNomadsPointUrl } from "../src/sources/nomads.js";

const request = (overrides: Partial<Parameters<typeof buildNomadsPointUrl>[0]> = {}) => ({
  run: new Date("2026-08-19T06:00:00Z"),
  forecastHour: 6,
  latitude: 50.08,
  longitude: 14.43,
  variables: expandRequestedVariables(["temperature", "wind"]),
  pressureLevelsHpa: [850, 700],
  ...overrides,
});

describe("buildNomadsPointUrl", () => {
  it("builds the correct GFS 0.25° Grib Filter request", () => {
    const url = new URL(buildNomadsPointUrl(request()));

    expect(url.origin).toBe("https://nomads.ncep.noaa.gov");
    expect(url.pathname).toBe("/cgi-bin/filter_gfs_0p25.pl");
    expect(url.searchParams.get("dir")).toBe("/gfs.20260819/06/atmos");
    expect(url.searchParams.get("file")).toBe("gfs.t06z.pgrb2.0p25.f006");
    expect(url.searchParams.get("var_TMP")).toBe("on");
    expect(url.searchParams.get("var_UGRD")).toBe("on");
    expect(url.searchParams.get("var_VGRD")).toBe("on");
    expect(url.searchParams.get("var_RH")).toBeNull();
    expect(url.searchParams.get("lev_850_mb")).toBe("on");
    expect(url.searchParams.get("lev_700_mb")).toBe("on");
  });

  it("uses the NOMADS full-product filename required by the 0.5° filter", () => {
    const url = new URL(buildNomadsPointUrl(request({ grid: "0p50" })));

    expect(url.pathname).toBe("/cgi-bin/filter_gfs_0p50.pl");
    expect(url.searchParams.get("dir")).toBe("/gfs.20260819/06/atmos");
    expect(url.searchParams.get("file")).toBe("gfs.t06z.pgrb2full.0p50.f006");
  });

  it("pads run and forecast hours", () => {
    const f0 = new URL(buildNomadsPointUrl(request({ run: new Date("2026-08-19T00:00:00Z"), forecastHour: 0 })));
    const f123 = new URL(buildNomadsPointUrl(request({ run: new Date("2026-08-19T18:00:00Z"), forecastHour: 123 })));

    expect(f0.searchParams.get("file")).toBe("gfs.t00z.pgrb2.0p25.f000");
    expect(f123.searchParams.get("file")).toBe("gfs.t18z.pgrb2.0p25.f123");
  });

  it("canonicalizes variables and pressure levels so equivalent queries share a cache key", () => {
    const first = buildNomadsPointUrl(
      request({
        variables: expandRequestedVariables(["temperature", "wind"]),
        pressureLevelsHpa: [700, 850, 700],
      }),
    );
    const second = buildNomadsPointUrl(
      request({
        variables: expandRequestedVariables(["wind", "temperature", "u_wind"]),
        pressureLevelsHpa: [850, 700],
      }),
    );

    expect(first).toBe(second);
  });

  it("clips the request box at geographic bounds", () => {
    const northEast = new URL(buildNomadsPointUrl(request({ latitude: 89.9, longitude: 179.9 })));
    expect(northEast.searchParams.get("toplat")).toBe("90");
    expect(northEast.searchParams.get("bottomlat")).toBe("89.4");
    expect(northEast.searchParams.get("leftlon")).toBe("179.4");
    expect(northEast.searchParams.get("rightlon")).toBe("180");

    const southWest = new URL(buildNomadsPointUrl(request({ latitude: -89.9, longitude: -179.9 })));
    expect(southWest.searchParams.get("toplat")).toBe("-89.4");
    expect(southWest.searchParams.get("bottomlat")).toBe("-90");
    expect(southWest.searchParams.get("leftlon")).toBe("-180");
    expect(southWest.searchParams.get("rightlon")).toBe("-179.4");
  });

  it("deduplicates repeated variables and levels", () => {
    const url = new URL(
      buildNomadsPointUrl(
        request({
          variables: expandRequestedVariables(["wind", "wind", "u_wind"]),
          pressureLevelsHpa: [850, 850, 700, 700],
        }),
      ),
    );

    expect(url.searchParams.getAll("var_UGRD")).toEqual(["on"]);
    expect(url.searchParams.getAll("var_VGRD")).toEqual(["on"]);
    expect(url.searchParams.getAll("lev_850_mb")).toEqual(["on"]);
    expect(url.searchParams.getAll("lev_700_mb")).toEqual(["on"]);
  });
});
