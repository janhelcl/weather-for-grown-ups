import { describe, expect, it } from "vitest";
import {
  buildRdaGfs025ForecastAreaUrl,
  convertRdaGfs025AreaNetcdfToCsv,
  type RdaAreaNetcdfReader,
} from "../src/sources/rda-gfs-forecast-history.js";

const request = {
  runTime: new Date("2026-08-24T00:00:00Z"),
  forecastHour: 6,
  westLongitude: 13.5,
  eastLongitude: 14.5,
  southLatitude: 49.5,
  northLatitude: 50.5,
  variables: ["Temperature_isobaric"],
  verticalCoordinate: 85000,
};

describe("GDEX 0.25 area transport", () => {
  it("requests a NetCDF bbox rather than unsupported grid CSV", () => {
    const url = new URL(buildRdaGfs025ForecastAreaUrl(request));
    expect(url.searchParams.get("accept")).toBe("netCDF");
    expect(url.searchParams.get("vertCoord")).toBe("85000");
    expect(url.searchParams.get("north")).toBe("50.5");
    expect(url.searchParams.get("south")).toBe("49.5");
  });

  it("normalizes the NetCDF grid to the existing internal CSV contract", () => {
    const data: Record<string, unknown> = {
      latitude: new Float32Array([50.5, 50.25]),
      longitude: new Float32Array([13.5, 13.75, 14]),
      isobaric: new Float64Array([85000]),
      Temperature_isobaric: new Float32Array([
        278.2, 278.17, 278.08,
        278.5, 278.49, 278.45,
      ]),
    };
    const reader: RdaAreaNetcdfReader = {
      dimensions: [
        { name: "latitude", size: 2 },
        { name: "time", size: 1 },
        { name: "isobaric", size: 1 },
        { name: "longitude", size: 3 },
      ],
      dataVariableExists: (name) => name in data,
      getDataVariable: (name) => data[name],
    };

    const csv = convertRdaGfs025AreaNetcdfToCsv(reader, request);
    expect(csv.split("\n")).toEqual([
      "latitude,longitude,isobaric,Temperature_isobaric",
      "50.5,13.5,85000,278.20001220703125",
      "50.5,13.75,85000,278.1700134277344",
      "50.5,14,85000,278.0799865722656",
      "50.25,13.5,85000,278.5",
      "50.25,13.75,85000,278.489990234375",
      "50.25,14,85000,278.45001220703125",
    ]);
  });

  it("rejects malformed subsets instead of silently reshaping them", () => {
    const reader: RdaAreaNetcdfReader = {
      dimensions: [
        { name: "latitude", size: 2 },
        { name: "longitude", size: 2 },
        { name: "isobaric", size: 1 },
      ],
      dataVariableExists: () => true,
      getDataVariable: (name) => {
        if (name === "latitude") return [50, 49.75];
        if (name === "longitude") return [14, 14.25];
        if (name === "isobaric") return [85000];
        return [278, 279, 280];
      },
    };
    expect(() => convertRdaGfs025AreaNetcdfToCsv(reader, request))
      .toThrow("has 3 values; expected 4");
  });
});
