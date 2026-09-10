import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { IfsEnsMember } from "../src/catalog/ifs-ens.js";
import { IfsEnsDiagnosticsService } from "../src/core/ifs-ens-diagnostics.js";
import { IfsEnsMemberBundleService } from "../src/core/ifs-ens-member-bundle.js";
import { IfsEnsMemberProfileEvidenceService } from "../src/core/ifs-ens-profile-evidence-service.js";
import type { IfsProfileSample } from "../src/core/ifs-profile.js";
import type { IfsPointQueryInput } from "../src/schema/ifs.js";

const run = new Date("2026-09-10T00:00:00Z");
const validTime = new Date("2026-09-10T06:00:00Z");
const point = { latitude: 45.77, longitude: 11.73 };
const gridPoint = { latitude: 45.75, longitude: 11.75 };

function sample(member: IfsEnsMember, input: IfsPointQueryInput): IfsProfileSample {
  const warm = member === "p02" ? 2 : 0;
  return {
    model: "ifs_0p25",
    run: new Date(String(input.run)).toISOString(),
    validTime: new Date(String(input.validTime)).toISOString(),
    forecastHour: 6,
    requestedPoint: point,
    gridPoint,
    levels: [
      { pressureHpa: 850, temperatureC: 10 + warm, geopotentialHeightGpm: 1_500 },
      { pressureHpa: 500, temperatureC: -10 - warm, geopotentialHeightGpm: 5_500 },
    ],
    source: {
      provider: "ECMWF Open Data",
      access: "indexed_http_range",
      decoder: "gribberish",
      product: "ifs_0p25_enfo_ef",
      horizontalGridDegrees: 0.25,
      cacheHit: false,
    },
  };
}

describe("IFS ENS atmospheric evidence reuse", () => {
  it("reuses member columns acquired by a compact raw query for a later layer diagnostic", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "wfg-ifs-ens-evidence-"));
    try {
      const firstUpstream = vi.fn(async (member: IfsEnsMember, input: IfsPointQueryInput) => sample(member, input));
      const queryEvidence = new IfsEnsMemberProfileEvidenceService({
        cacheDir,
        profileGetter: { getProfile: firstUpstream },
      });
      const bundle = new IfsEnsMemberBundleService({ profileGetter: queryEvidence });
      const compact = await bundle.getBundle({
        ...point,
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        selection: {
          variables: ["temperature", "geopotential_height"],
          pressureLevelsHpa: [850, 500],
          fields: [],
        },
        members: ["p01", "p02"],
        quantiles: [0.5],
        includeMembers: false,
      });
      expect(compact.members).toBeUndefined();
      expect(firstUpstream).toHaveBeenCalledTimes(2);

      const secondUpstream = vi.fn(async () => {
        throw new Error("diagnostic should reuse persisted IFS ENS member evidence");
      });
      const diagnosticEvidence = new IfsEnsMemberProfileEvidenceService({
        cacheDir,
        profileGetter: { getProfile: secondUpstream },
      });
      const diagnostics = new IfsEnsDiagnosticsService({ profileGetter: diagnosticEvidence });
      const result = await diagnostics.getLayerDiagnostics({
        ...point,
        run: run.toISOString(),
        validTime: validTime.toISOString(),
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["temperature_lapse_rate"],
        members: ["p01", "p02"],
        quantiles: [0.5],
        includeMembers: true,
      });

      expect(secondUpstream).not.toHaveBeenCalled();
      expect(result.source.allCacheHit).toBe(true);
      expect(result.members?.every((member) => member.cacheHit)).toBe(true);
      expect(result.summaries[0]?.id).toBe("temperature_lapse_rate");
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
