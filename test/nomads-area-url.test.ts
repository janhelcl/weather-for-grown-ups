import { describe, expect, it } from "vitest";
import { expandRequestedFields } from "../src/catalog/non-isobaric-fields.js";
import { expandRequestedVariables } from "../src/catalog/variables.js";
import { buildNomadsAreaUrl } from "../src/sources/nomads.js";

describe("buildNomadsAreaUrl", () => {
  it("uses the exact requested bbox and one pressure-level field", () => {
    const url = new URL(buildNomadsAreaUrl({
      run: new Date("2026-08-19T06:00:00Z"), forecastHour: 30,
      westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51,
      variables: expandRequestedVariables(["geopotential_height"]), pressureLevelsHpa: [500],
    }));
    expect(url.searchParams.get("file")).toBe("gfs.t06z.pgrb2.0p25.f030");
    expect(url.searchParams.get("leftlon")).toBe("12");
    expect(url.searchParams.get("rightlon")).toBe("18");
    expect(url.searchParams.get("bottomlat")).toBe("48");
    expect(url.searchParams.get("toplat")).toBe("51");
    expect(url.searchParams.get("var_HGT")).toBe("on");
    expect(url.searchParams.get("lev_500_mb")).toBe("on");
  });

  it("uses exact non-isobaric variable and level selectors for area subsetting", () => {
    const [field] = expandRequestedFields(["low_cloud_cover_average"]);
    const url = new URL(buildNomadsAreaUrl({
      run: new Date("2026-08-19T06:00:00Z"), forecastHour: 30,
      westLongitude: 12, eastLongitude: 18, southLatitude: 48, northLatitude: 51,
      variables: [],
      pressureLevelsHpa: [],
      fields: [field!],
    }));
    expect(url.searchParams.get("var_LCDC")).toBe("on");
    expect(url.searchParams.get("lev_low_cloud_layer")).toBe("on");
    expect(url.searchParams.has("lev_500_mb")).toBe(false);
  });
});
