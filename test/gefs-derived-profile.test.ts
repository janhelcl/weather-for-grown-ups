import { describe, expect, it, vi } from "vitest";
import { GefsEnsembleProfileService } from "../src/core/gefs-ensemble-profile.js";
import { deriveDewPointC, derivePotentialTemperatureK } from "../src/derived/thermodynamics.js";
import { gefsEnsembleProfileQuerySchema } from "../src/schema/gefs-ensemble-profile.js";

const run = "2026-08-24T00:00:00Z";
const validTime = "2026-08-24T06:00:00Z";

describe("GEFS derived pressure-profile variables", () => {
  it("derives dew point and potential temperature inside each member before aggregation", async () => {
    const requests: unknown[] = [];
    const service = new GefsEnsembleProfileService({
      concurrency: 1,
      source: {
        fetchSelection: vi.fn(async (request) => {
          requests.push(request);
          return { path: request.member, cacheHit: true };
        }),
      },
      decoder: {
        extractPoint: vi.fn(async (path) => {
          const warm = path === "p01";
          return [
            { code: "TMP", pressureHpa: 850, value: 273.15 + (warm ? 12 : 10), gridPoint: { latitude: 50, longitude: 14.5 } },
            { code: "RH", pressureHpa: 850, value: warm ? 70 : 50, gridPoint: { latitude: 50, longitude: 14.5 } },
          ];
        }),
      },
    });

    const result = await service.getProfile({
      latitude: 50.08,
      longitude: 14.43,
      run,
      validTime,
      variables: ["dew_point", "potential_temperature"],
      pressureLevelsHpa: [850],
      members: ["c00", "p01"],
      quantiles: [0, 0.5, 1],
      includeMembers: true,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ variableCodes: ["TMP", "RH"], pressureLevelsHpa: [850] });
    const c00DewPoint = deriveDewPointC(10, 50);
    const p01DewPoint = deriveDewPointC(12, 70);
    const c00Theta = derivePotentialTemperatureK(10, 850);
    const p01Theta = derivePotentialTemperatureK(12, 850);

    expect(result.members?.[0]?.values).toEqual([
      { variable: "dew_point", pressureLevelHpa: 850, value: c00DewPoint },
      { variable: "potential_temperature", pressureLevelHpa: 850, value: c00Theta },
    ]);
    expect(result.summaries[0]).toMatchObject({
      variable: "dew_point",
      dependencies: ["temperature", "relative_humidity"],
      outputField: "dewPointC",
      unit: "degC",
      mean: (c00DewPoint + p01DewPoint) / 2,
    });
    expect(result.summaries[1]).toMatchObject({
      variable: "potential_temperature",
      dependencies: ["temperature"],
      outputField: "potentialTemperatureK",
      unit: "K",
      mean: (c00Theta + p01Theta) / 2,
    });
  });

  it("deduplicates raw dependencies when raw and derived variables are requested together", async () => {
    const fetchSelection = vi.fn(async (request) => ({ path: request.member, cacheHit: true }));
    const service = new GefsEnsembleProfileService({
      source: { fetchSelection },
      decoder: {
        extractPoint: async () => [
          { code: "TMP", pressureHpa: 850, value: 283.15, gridPoint: { latitude: 50, longitude: 14.5 } },
          { code: "RH", pressureHpa: 850, value: 50, gridPoint: { latitude: 50, longitude: 14.5 } },
        ],
      },
    });

    await service.getProfile({
      latitude: 50,
      longitude: 14.5,
      run,
      validTime,
      variables: ["temperature", "dew_point", "potential_temperature"],
      pressureLevelsHpa: [850],
      members: ["c00", "p01"],
    });

    expect(fetchSelection).toHaveBeenCalledTimes(2);
    expect(fetchSelection.mock.calls[0]?.[0]).toMatchObject({ variableCodes: ["TMP", "RH"] });
  });

  it("rejects a derived variable when one dependency is unavailable at a pressure level", () => {
    expect(() => gefsEnsembleProfileQuerySchema.parse({
      latitude: 50,
      longitude: 14,
      run,
      validTime,
      variables: ["dew_point"],
      pressureLevelsHpa: [300],
      members: ["c00", "p01"],
    })).toThrow("raw dependencies are unavailable");
  });
});
