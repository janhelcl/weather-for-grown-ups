import { describe, expect, it } from "vitest";
import {
  buildGefsReforecastFieldIndexUrl,
  buildGefsReforecastFieldUrl,
  buildGefsReforecastPressureIndexUrl,
  buildGefsReforecastPressureUrl,
  gefsReforecastForecastHour,
  gefsReforecastHorizontalGridDegrees,
  gefsReforecastLeadBlock,
  gefsReforecastPressureFileGroup,
  gefsReforecastProfileGrid,
  nativeGefsReforecastValidTimesInRange,
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

  it("enumerates one native range across the f240 cadence transition", () => {
    const times = nativeGefsReforecastValidTimesInRange(
      run,
      new Date("2017-03-23T21:00:00Z"),
      new Date("2017-03-24T12:00:00Z"),
      4,
    );
    expect(times.map((time) => gefsReforecastForecastHour(run, time)))
      .toEqual([237, 240, 246, 252]);

    expect(() => nativeGefsReforecastValidTimesInRange(
      run,
      new Date("2017-03-23T21:00:00Z"),
      new Date("2017-03-24T12:00:00Z"),
      3,
    )).toThrow("exceeding maxSteps=3");

    expect(() => nativeGefsReforecastValidTimesInRange(
      run,
      new Date("2017-03-24T06:00:00Z"),
      new Date("2017-03-24T00:00:00Z"),
      10,
    )).toThrow("endTime must be at or after startTime");
  });

  it("models the first-10-day pressure-file split instead of hiding it", () => {
    expect(gefsReforecastPressureFileGroup(12, 850)).toBe("base");
    expect(gefsReforecastPressureFileGroup(12, 500)).toBe("above_700mb");
    expect(gefsReforecastPressureFileGroup(300, 500)).toBe("base");

    expect(buildGefsReforecastPressureUrl(
      run, "c00", 12, "temperature", "base",
    )).toBe(
      "https://noaa-gefs-retrospective.s3.amazonaws.com/GEFSv12/reforecast/2017/2017031400/c00/Days%3A1-10/tmp_pres_2017031400_c00.grib2",
    );
    expect(buildGefsReforecastPressureIndexUrl(
      run, "p04", 12, "temperature", "above_700mb",
    )).toBe(
      "https://noaa-gefs-retrospective.s3.amazonaws.com/GEFSv12/reforecast/2017/2017031400/p04/Days%3A1-10/tmp_pres_abv700mb_2017031400_p04.grib2.idx",
    );

    expect(gefsReforecastProfileGrid(12, [850, 700])).toEqual({
      horizontalGridDegrees: 0.25,
      profileGridPolicy: "native_0p25",
    });
    expect(gefsReforecastProfileGrid(12, [500])).toEqual({
      horizontalGridDegrees: 0.5,
      profileGridPolicy: "native_0p50",
    });
    expect(gefsReforecastProfileGrid(12, [850, 500])).toEqual({
      horizontalGridDegrees: 0.5,
      profileGridPolicy: "coherent_0p50",
    });
    expect(gefsReforecastProfileGrid(300, [850, 500])).toEqual({
      horizontalGridDegrees: 0.5,
      profileGridPolicy: "native_0p50",
    });
  });

  it("requires explicit daily 00Z runs from the public 2000-2019 retrospective", () => {
    expect(parseGefsReforecastRun("2017-03-14T00:00:00Z").toISOString()).toBe(run.toISOString());
    expect(() => parseGefsReforecastRun("2017-03-14T06:00:00Z")).toThrow("once daily at 00Z");
    expect(() => parseGefsReforecastRun("1999-03-14T00:00:00Z")).toThrow("2000-2019");
    expect(() => parseGefsReforecastRun("2020-03-14T00:00:00Z")).toThrow("2000-2019");
  });
});
