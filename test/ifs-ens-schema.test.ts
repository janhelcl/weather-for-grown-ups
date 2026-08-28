import { describe, expect, it } from "vitest";
import {
  IFS_ENS_MEMBERS,
  getIfsEnsCatalog,
  ifsEnsMemberNumber,
  sortIfsEnsMembers,
} from "../src/catalog/ifs-ens.js";
import {
  ifsEnsMemberBundleQuerySchema,
  ifsEnsSelectionSchema,
} from "../src/schema/ifs-ens.js";

const base = {
  latitude: 50.08,
  longitude: 14.43,
  run: "latest" as const,
  validTime: "2026-08-28T12:00:00Z",
};

describe("IFS ENS catalog and schema", () => {
  it("models all 50 perturbations and keeps member ordering numeric", () => {
    expect(IFS_ENS_MEMBERS).toHaveLength(50);
    expect(IFS_ENS_MEMBERS[0]).toBe("p01");
    expect(IFS_ENS_MEMBERS[49]).toBe("p50");
    expect(ifsEnsMemberNumber("p50")).toBe(50);
    expect(sortIfsEnsMembers(["p50", "p02", "p10"])).toEqual(["p02", "p10", "p50"]);

    const catalog = getIfsEnsCatalog();
    expect(catalog).toMatchObject({
      model: "ifs_ens_0p25",
      provider: "ECMWF Open Data",
      horizontalGridDegrees: 0.25,
      cyclesUtc: [0, 6, 12, 18],
    });
    expect(catalog.members).toHaveLength(50);
    expect(catalog.memberSemantics).toContain("50 perturbed ENS members");
  });

  it("requires pressure variables and levels together, or a field-only selection", () => {
    expect(ifsEnsSelectionSchema.parse({ fields: ["wind_10m"] })).toEqual({
      variables: [],
      pressureLevelsHpa: [],
      fields: ["wind_10m"],
    });

    expect(() => ifsEnsSelectionSchema.parse({
      variables: ["temperature"],
    })).toThrow("pressure variables and pressureLevelsHpa must be supplied together");

    expect(() => ifsEnsSelectionSchema.parse({
      pressureLevelsHpa: [850],
    })).toThrow("pressure variables and pressureLevelsHpa must be supplied together");

    expect(() => ifsEnsSelectionSchema.parse({}))
      .toThrow("Request at least one IFS ENS pressure variable or field");
  });

  it("rejects duplicate selection coordinates", () => {
    expect(() => ifsEnsSelectionSchema.parse({
      variables: ["temperature", "temperature"],
      pressureLevelsHpa: [850],
    })).toThrow("variables must not contain duplicates");

    expect(() => ifsEnsSelectionSchema.parse({
      variables: ["temperature"],
      pressureLevelsHpa: [850, 850],
    })).toThrow("pressureLevelsHpa must not contain duplicates");

    expect(() => ifsEnsSelectionSchema.parse({
      fields: ["wind_10m", "wind_10m"],
    })).toThrow("fields must not contain duplicates");
  });

  it("defaults to all perturbations and standard quantiles", () => {
    const query = ifsEnsMemberBundleQuerySchema.parse({
      ...base,
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
    });
    expect(query.members).toEqual([...IFS_ENS_MEMBERS]);
    expect(query.quantiles).toEqual([0.1, 0.5, 0.9]);
    expect(query.includeMembers).toBe(false);
  });

  it("rejects duplicate members and quantiles", () => {
    expect(() => ifsEnsMemberBundleQuerySchema.parse({
      ...base,
      selection: { fields: ["wind_10m"] },
      members: ["p01", "p01"],
    })).toThrow("members must not contain duplicates");

    expect(() => ifsEnsMemberBundleQuerySchema.parse({
      ...base,
      selection: { fields: ["wind_10m"] },
      members: ["p01", "p50"],
      quantiles: [0.5, 0.5],
    })).toThrow("Quantiles must not contain duplicates");
  });
});
