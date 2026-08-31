import { describe, expect, it } from "vitest";
import {
  HGEFS_MEMBERS,
  gefsVariablesForHgefs,
  hgefsMember,
  isHgefsAreaField,
  isHgefsField,
  isHgefsMember,
  isHgefsPressureLevel,
  isHgefsPressureVariable,
  isSupportedHgefsPressureSelection,
  sortHgefsMembers,
  splitHgefsMember,
  splitHgefsMembers,
  type HgefsMember,
} from "../src/catalog/hgefs.js";

describe("HGEFS catalog helpers", () => {
  it("validates, sorts and splits population-qualified member identities", () => {
    expect(isHgefsMember("gefs:c00")).toBe(true);
    expect(isHgefsMember("aigefs:p30")).toBe(true);
    expect(isHgefsMember("c00")).toBe(false);
    expect(isHgefsMember("gefs:p31")).toBe(false);

    expect(sortHgefsMembers([
      "aigefs:p30",
      "gefs:p02",
      "aigefs:c00",
      "gefs:c00",
    ])).toEqual([
      "gefs:c00",
      "gefs:p02",
      "aigefs:c00",
      "aigefs:p30",
    ]);

    expect(splitHgefsMember("gefs:p02")).toEqual({
      population: "gefs",
      member: "p02",
    });
    expect(splitHgefsMember("aigefs:c00")).toEqual({
      population: "aigefs",
      member: "c00",
    });
    expect(splitHgefsMembers([
      "aigefs:p02",
      "gefs:p01",
      "aigefs:c00",
      "gefs:c00",
    ])).toEqual({
      gefs: ["c00", "p01"],
      aigefs: ["c00", "p02"],
    });

    expect(hgefsMember("gefs", "p30")).toBe("gefs:p30");
    expect(hgefsMember("aigefs", "c00")).toBe("aigefs:c00");
    expect(() => hgefsMember("gefs", "p31" as any))
      .toThrow("Unknown HGEFS member");
  });

  it("keeps public pressure and field predicates aligned with the shared constituent inventory", () => {
    expect(isHgefsPressureVariable("temperature")).toBe(true);
    expect(isHgefsPressureVariable("wind")).toBe(true);
    expect(isHgefsPressureVariable("relative_humidity")).toBe(false);
    expect(isHgefsPressureLevel(850)).toBe(true);
    expect(isHgefsPressureLevel(75)).toBe(false);

    expect(isHgefsField("temperature_2m")).toBe(true);
    expect(isHgefsField("wind_10m")).toBe(true);
    expect(isHgefsField("surface_pressure")).toBe(false);
    expect(isHgefsAreaField("temperature_2m")).toBe(true);
    expect(isHgefsAreaField("wind_10m")).toBe(false);
  });

  it("checks the real GEFS/AIGEFS pressure-level intersection", () => {
    expect(isSupportedHgefsPressureSelection("temperature", 850)).toBe(true);
    expect(isSupportedHgefsPressureSelection("wind", 300)).toBe(true);
    expect(isSupportedHgefsPressureSelection("wind", 600)).toBe(false);
    expect(isSupportedHgefsPressureSelection("vertical_velocity", 850)).toBe(true);
    expect(isSupportedHgefsPressureSelection("vertical_velocity", 700)).toBe(false);
    expect(isSupportedHgefsPressureSelection("specific_humidity", 850)).toBe(true);
    expect(isSupportedHgefsPressureSelection("specific_humidity", 300)).toBe(false);
    expect(isSupportedHgefsPressureSelection("relative_humidity", 850)).toBe(false);
    expect(isSupportedHgefsPressureSelection("temperature", 75)).toBe(false);
  });

  it("maps HGEFS requested variables to the GEFS constituent dependencies", () => {
    expect(gefsVariablesForHgefs(["temperature"])).toEqual(["temperature"]);
    expect(gefsVariablesForHgefs(["wind"])).toEqual(["u_wind", "v_wind"]);
    expect(gefsVariablesForHgefs(["wind", "temperature"])).toEqual([
      "u_wind",
      "v_wind",
      "temperature",
    ]);
    expect(new Set(HGEFS_MEMBERS).size).toBe(62);

    const unknown = "not-a-member" as HgefsMember;
    expect(sortHgefsMembers(["gefs:c00", unknown])).toEqual([
      "gefs:c00",
      unknown,
    ]);
  });
});
