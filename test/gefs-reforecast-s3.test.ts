import { describe, expect, it } from "vitest";
import {
  buildGefsReforecastFieldIndexUrl,
  buildGefsReforecastFieldUrl,
  gefsReforecastForecastHour,
  gefsReforecastHorizontalGridDegrees,
  gefsReforecastLeadBlock,
  parseGefsReforecastRun,
} from "../src/sources/gefs-reforecast-s3.js";

const run = new Date("2017-03-14T00:00:00Z");

describe("GEFSv12 reforecast source semantics", () => {
  it("builds NOAA retrospective variable/member object and index URLs", () => {
    expect(buildGefsReforecastFieldUrl(run, "c00", 12, "temperature_2m")).toBe(
      "https://noaa-gefs-retrospective.s3.amazonaws.com/GEFSv12/reforecast/2017/2017031400/c00/Days%3A1-10/tmp_2m_2017031400_c00.grib2",
    );
    expect(buildGefsReforecastFieldIndexUrl(run, "p04", 300, "u_wind_10m")).toBe(
      "https://noaa-gefs-retrospective.s3.amazonaws.com/GEFSv12/reforecast/2017/2017031400/p04/Days%3A10-16/ugrd_hgt_2017031400_p04.grib2.idx",
    );
  });

  it("preserves the retrospective cadence and grid transition", () => {
    expect(gefsReforecastForecastHour(run, new Date("2017-03-14T03:00:00Z"))).toBe(3);
    expect(gefsReforecastForecastHour(run, new Date("2017-03-24T00:00:00Z"))).toBe(240);
    expect(gefsReforecastForecastHour(run, new Date("2017-03-24T06:00:00Z"))).toBe(246);
    expect(gefsReforecastLeadBlock(240)).toBe("Days:1-10");
    expect(gefsReforecastLeadBlock(246)).toBe("Days:10-16");
    expect(gefsReforecastHorizontalGridDegrees(240)).toBe(0.25);
    expect(gefsReforecastHorizontalGridDegrees(246)).toBe(0.5);

    expect(() => gefsReforecastForecastHour(run, new Date("2017-03-24T03:00:00Z")))
      .toThrow("every 6 hours");
    expect(() => gefsReforecastForecastHour(run, new Date("2017-03-30T03:00:00Z")))
      .toThrow("through +384");
  });

  it("requires explicit daily 00Z runs from the public 2000-2019 retrospective", () => {
    expect(parseGefsReforecastRun("2017-03-14T00:00:00Z").toISOString()).toBe(run.toISOString());
    expect(() => parseGefsReforecastRun("2017-03-14T06:00:00Z")).toThrow("once daily at 00Z");
    expect(() => parseGefsReforecastRun("1999-03-14T00:00:00Z")).toThrow("2000-2019");
    expect(() => parseGefsReforecastRun("2020-03-14T00:00:00Z")).toThrow("2000-2019");
  });
});
