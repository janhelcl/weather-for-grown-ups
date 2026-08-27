import { describe, expect, it } from "vitest";
import { ifsPointQuerySchema } from "../src/schema/ifs.js";

const base = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-27T12:00:00Z",
  validTime: "2026-08-27T18:00:00Z",
};

describe("IFS point query schema", () => {
  it("requires pressure variables and levels as a pair", () => {
    expect(() => ifsPointQuerySchema.parse({
      ...base,
      variables: ["temperature"],
    })).toThrow("must be supplied together");
    expect(() => ifsPointQuerySchema.parse({
      ...base,
      pressureLevelsHpa: [850],
    })).toThrow("must be supplied together");
  });

  it("requires at least one pressure or field selection", () => {
    expect(() => ifsPointQuerySchema.parse(base)).toThrow("Request at least one IFS pressure variable or field");
  });

  it("rejects unsupported pressure levels and duplicate selections", () => {
    expect(() => ifsPointQuerySchema.parse({
      ...base,
      variables: ["temperature"],
      pressureLevelsHpa: [975],
    })).toThrow("not published by the ECMWF IFS");

    expect(() => ifsPointQuerySchema.parse({
      ...base,
      variables: ["temperature", "temperature"],
      pressureLevelsHpa: [850],
    })).toThrow("variables must not contain duplicates");

    expect(() => ifsPointQuerySchema.parse({
      ...base,
      variables: ["temperature"],
      pressureLevelsHpa: [850, 850],
    })).toThrow("pressureLevelsHpa must not contain duplicates");

    expect(() => ifsPointQuerySchema.parse({
      ...base,
      fields: ["temperature_2m", "temperature_2m"],
    })).toThrow("fields must not contain duplicates");
  });

  it("defaults latest run for a valid field-only request", () => {
    const parsed = ifsPointQuerySchema.parse({
      latitude: 50,
      longitude: 14,
      validTime: "2026-08-27T18:00:00Z",
      fields: ["temperature_2m"],
    });
    expect(parsed.run).toBe("latest");
  });
});
