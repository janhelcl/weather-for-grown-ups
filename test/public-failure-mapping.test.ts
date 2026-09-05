import { describe, expect, it, vi } from "vitest";
import { resolveMeteoFranceBearerToken } from "../src/access/meteo-france-auth.js";
import { createCliProgram } from "../src/cli/program.js";
import { runCli } from "../src/cli/run.js";
import {
  buildUnifiedDatasetComparison,
  buildUnifiedQuery,
} from "../src/cli/unified-atmosphere-command.js";
import { nativeGefsValidTimesInRange } from "../src/core/gefs-time.js";
import { HistoricalIndexService } from "../src/core/history-index.js";
import {
  DataUnavailableError,
  InvalidRequestError,
  UnsupportedOperationError,
  toPublicFailure,
} from "../src/failure.js";
import { UNIFIED_CATALOG_SECTIONS } from "../src/schema/unified-catalog.js";
import { resolvePeAromeWcsEndpoint } from "../src/sources/pe-arome.js";
import { parseGefsReforecastRun } from "../src/sources/gefs-reforecast-s3.js";

async function cliFailure(args: string[]): Promise<{ code: string; message: string }> {
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  const previousExitCode = process.exitCode;
  try {
    await runCli(["node", "wfg", ...args, "--json"]);
    const output = stderr.mock.calls.map((call) => String(call[0])).join("\n");
    const parsed = JSON.parse(output) as { error: { code: string; message: string } };
    return parsed.error;
  } finally {
    stderr.mockRestore();
    process.exitCode = previousExitCode;
  }
}

describe("QA-reported failures reach the public boundary with their real message", () => {
  it("rejects unknown catalog sections as INVALID_REQUEST and lists the allowed values", async () => {
    const failure = await cliFailure(["catalog", "--sections", "datasets,diagnostics"]);
    expect(failure.code).toBe("INVALID_REQUEST");
    expect(failure.message).toContain("datasets, diagnostics");
    for (const section of UNIFIED_CATALOG_SECTIONS) expect(failure.message).toContain(section);
  });

  it("documents the allowed --sections values in catalog help", () => {
    const catalog = createCliProgram().commands.find((command) => command.name() === "catalog");
    const option = catalog?.options.find((candidate) => candidate.long === "--sections");
    expect(option?.description).toContain(UNIFIED_CATALOG_SECTIONS.join("|"));
  });

  it("rejects dual coverage filters as INVALID_REQUEST", async () => {
    const failure = await cliFailure([
      "catalog",
      "--covers-point", "50,14",
      "--covers-area", "10,20,45,55",
    ]);
    expect(failure.code).toBe("INVALID_REQUEST");
    expect(failure.message).toContain("--covers-point");
    expect(failure.message).toContain("--covers-area");
  });

  it("rejects incomplete point geometry and unknown datasets as INVALID_REQUEST", () => {
    expect(() => buildUnifiedQuery({ dataset: "gfs", lat: 50.08, at: "2026-09-06T12:00:00Z" }))
      .toThrow(InvalidRequestError);
    expect(toPublicFailure((() => {
      try {
        buildUnifiedQuery({ dataset: "gfs", lat: 50.08, at: "2026-09-06T12:00:00Z" });
      } catch (error) {
        return error;
      }
      return undefined;
    })())).toMatchObject({
      code: "INVALID_REQUEST",
      message: "Point geometry requires both --lat and --lon",
    });

    expect(() => buildUnifiedQuery({ dataset: "ecmwf", lat: 50, lon: 14, at: "2026-09-06T12:00:00Z" }))
      .toThrow(InvalidRequestError);
    expect(() => buildUnifiedDatasetComparison({ lat: 50, lon: 14, at: "2026-09-06T12:00:00Z", against: "nope" }))
      .toThrow(InvalidRequestError);
  });

  it("reports time-step guardrails as INVALID_REQUEST with the limit in the message", () => {
    const start = new Date("2026-09-06T00:00:00Z");
    const end = new Date("2026-09-08T00:00:00Z");
    let error: unknown;
    try {
      nativeGefsValidTimesInRange(start, end, 4);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InvalidRequestError);
    expect(toPublicFailure(error)).toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("maxSteps=4"),
      retryable: false,
    });
  });

  it("reports missing Météo-France credentials and PE-AROME endpoints as UNSUPPORTED_OPERATION", () => {
    expect(() => resolveMeteoFranceBearerToken({})).toThrow(UnsupportedOperationError);
    expect(toPublicFailure((() => {
      try {
        resolveMeteoFranceBearerToken({});
      } catch (error) {
        return error;
      }
      return undefined;
    })())).toMatchObject({
      code: "UNSUPPORTED_OPERATION",
      message: expect.stringContaining("WFG_METEO_FRANCE_TOKEN"),
      details: { dataset: "pe-arome", missingEnv: ["WFG_METEO_FRANCE_TOKEN"] },
    });

    expect(() => resolvePeAromeWcsEndpoint("c00", {})).toThrow(UnsupportedOperationError);
    expect(() => resolvePeAromeWcsEndpoint("c00", { WFG_PEAROME_WCS_ENDPOINTS: "not json" }))
      .toThrow(UnsupportedOperationError);
    expect(() => resolvePeAromeWcsEndpoint("p01", { WFG_PEAROME_WCS_ENDPOINTS: JSON.stringify({ c00: "https://x" }) }))
      .toThrow(UnsupportedOperationError);
  });

  it("reports GEFSv12 reforecast runs outside 2000-2019 as INVALID_REQUEST", () => {
    let error: unknown;
    try {
      parseGefsReforecastRun("2021-05-01T00:00:00Z");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InvalidRequestError);
    expect(toPublicFailure(error)).toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("2000-2019"),
      details: { forecastKind: "reforecast", supportedYears: { from: 2000, to: 2019 } },
    });
    expect(() => parseGefsReforecastRun("2018-05-01T06:00:00Z")).toThrow(InvalidRequestError);
    expect(() => parseGefsReforecastRun("not-a-date")).toThrow(InvalidRequestError);
  });

  it("reports an unmaterialized analog target as DATA_UNAVAILABLE when fetching is disabled", async () => {
    const service = new HistoricalIndexService({
      timeSeriesGetter: {
        getHistoricalTimeSeries: vi.fn(async () => {
          throw new Error("time series should not be requested");
        }),
      } as never,
      profileGetter: {
        getHistoricalProfile: vi.fn(async () => {
          throw new Error("target should not be fetched when fetchTargetIfMissing=false");
        }),
      } as never,
      store: { path: "/tmp/wfg-test-index.jsonl", readAll: async () => [], appendMany: async () => {} } as never,
    });

    let error: unknown;
    try {
      await service.findAnalogs({
        latitude: 50.08,
        longitude: 14.43,
        targetTime: "2017-05-03T12:00:00Z",
        variables: ["temperature"],
        pressureLevelsHpa: [850],
        count: 3,
        fetchTargetIfMissing: false,
      } as never);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DataUnavailableError);
    expect(toPublicFailure(error)).toMatchObject({
      code: "DATA_UNAVAILABLE",
      retryable: false,
      message: expect.stringContaining("not materialized in the local analog index"),
      details: {
        dataset: "gfs-analysis",
        targetTime: "2017-05-03T12:00:00Z",
        indexPath: "/tmp/wfg-test-index.jsonl",
        fetchTargetIfMissing: false,
      },
    });
  });
});
