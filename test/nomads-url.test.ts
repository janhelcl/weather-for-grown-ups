import { describe, expect, it } from "vitest";
import { expandRequestedVariables } from "../src/catalog/variables.js";
import { buildNomadsPointUrl } from "../src/sources/nomads.js";

describe("buildNomadsPointUrl", () => {
  it("expands derived wind and requests only selected levels", () => {
    const url = new URL(buildNomadsPointUrl({
      run: new Date("2026-08-19T06:00:00Z"),
      forecastHour: 6,
      latitude: 50.08,
      longitude: 14.43,
      variables: expandRequestedVariables(["temperature", "wind"]),
      pressureLevelsHpa: [850, 700],
    }));

    expect(url.searchParams.get("file")).toBe("gfs.t06z.pgrb2.0p25.f006");
    expect(url.searchParams.get("var_TMP")).toBe("on");
    expect(url.searchParams.get("var_UGRD")).toBe("on");
    expect(url.searchParams.get("var_VGRD")).toBe("on");
    expect(url.searchParams.get("lev_850_mb")).toBe("on");
    expect(url.searchParams.get("lev_700_mb")).toBe("on");
  });
});
