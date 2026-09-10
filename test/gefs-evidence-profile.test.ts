import { describe, expect, it, vi } from "vitest";
import {
  GefsEnsembleProfileEvidenceService,
  GefsMemberBundleEvidenceService,
} from "../src/core/gefs-evidence-service.js";
import { ProfileEvidenceCache } from "../src/cache/profile-evidence-cache.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = "2026-09-10T00:00:00.000Z";
const validTime = "2026-09-10T06:00:00.000Z";
const requestedPoint = { latitude: 45.77, longitude: 11.73 };
const gridPoint = { latitude: 45.75, longitude: 11.75 };
const members = ["c00", "p01"] as const;
const distribution = {
  memberCount: 2,
  mean: 10,
  populationStdDev: 1,
  min: 9,
  max: 11,
  quantiles: [{ quantile: 0.5, value: 10 }],
};

describe("GefsEnsembleProfileEvidenceService", () => {
  it("maps reusable member bundles back to the established raw and derived profile contract", async () => {
    const getter = vi.fn(async () => bundleWith(["temperature", "dew_point"]));
    const service = new GefsEnsembleProfileEvidenceService({
      bundleGetter: { getBundle: getter },
    });

    const result = await service.getProfile({
      ...requestedPoint,
      run,
      validTime,
      variables: ["temperature", "dew_point"],
      pressureLevelsHpa: [850],
      members: [...members],
      quantiles: [0.5],
      includeMembers: true,
    });

    expect(getter).toHaveBeenCalledWith(expect.objectContaining({
      includeMembers: true,
      selection: expect.objectContaining({ fields: [] }),
    }), "pgrb2a_0p50");
    expect(result.summaries.find((summary) => summary.variable === "temperature")).toMatchObject({
      gfsCode: "TMP",
      pressureLevelHpa: 850,
    });
    expect(result.summaries.find((summary) => summary.variable === "dew_point")).toMatchObject({
      dependencies: ["temperature", "relative_humidity"],
      pressureLevelHpa: 850,
    });
    expect(result.members).toHaveLength(2);
    expect(result.source).toMatchObject({
      provider: "NOAA AWS Open Data",
      product: "pgrb2a_0p50",
      allCacheHit: true,
    });
  });

  it("keeps member values internal when the profile caller requests compact output", async () => {
    const service = new GefsEnsembleProfileEvidenceService({
      bundleGetter: { getBundle: async () => bundleWith(["temperature"]) },
    });
    const result = await service.getProfile({
      ...requestedPoint,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      members: [...members],
      quantiles: [0.5],
      includeMembers: false,
    });
    expect(result.members).toBeUndefined();
  });

  it("rejects a bundle implementation that discards required member evidence", async () => {
    const service = new GefsEnsembleProfileEvidenceService({
      bundleGetter: {
        getBundle: async () => ({ ...bundleWith(["temperature"]), members: undefined } as any),
      },
    });
    await expect(service.getProfile({
      ...requestedPoint,
      run,
      validTime,
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      members: [...members],
      quantiles: [0.5],
    })).rejects.toThrow("GEFS profile evidence is missing member values");
  });
});

describe("GefsMemberBundleEvidenceService guards", () => {
  it("rejects an upstream bundle that does not retain members for reusable evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-gefs-evidence-"));
    try {
      const service = new GefsMemberBundleEvidenceService({
        bundleGetter: {
          getBundle: async () => ({ ...bundleWith(["temperature"]), members: undefined } as any),
        },
        evidenceCache: new ProfileEvidenceCache(join(root, "cache")),
      });
      await expect(service.getBundle({
        ...requestedPoint,
        run,
        validTime,
        selection: {
          variables: ["temperature"],
          pressureLevelsHpa: [850],
          fields: [],
        },
        members: [...members],
        quantiles: [0.5],
      })).rejects.toThrow("GEFS evidence acquisition must retain member values");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function bundleWith(variables: Array<"temperature" | "dew_point">) {
  const pressureSummaries = variables.map((variable) => ({
    variable,
    pressureLevelHpa: 850,
    outputField: variable === "temperature" ? "temperatureC" : "dewPointC",
    unit: "degC",
    distribution,
  }));
  return {
    model: "gefs_0p50" as const,
    run,
    validTime,
    forecastHour: 6,
    requestedPoint,
    gridPoint,
    selection: {
      variables,
      pressureLevelsHpa: [850],
      fields: [],
      members: [...members],
      quantiles: [0.5],
    },
    pressureSummaries,
    fieldSummaries: [],
    members: members.map((member, index) => ({
      member,
      cacheHit: true,
      pressureValues: variables.map((variable) => ({
        variable,
        pressureLevelHpa: 850,
        value: 9 + index,
      })),
      fields: [],
    })),
    source: {
      provider: "NOAA AWS Open Data" as const,
      access: "s3_range" as const,
      decoder: "gribberish" as const,
      product: "pgrb2a_0p50" as const,
      horizontalGridDegrees: 0.5 as const,
      allCacheHit: true,
    },
  };
}
