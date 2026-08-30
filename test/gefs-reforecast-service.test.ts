import { describe, expect, it, vi } from "vitest";
import { GefsReforecastPointService } from "../src/core/gefs-reforecast.js";

describe("GEFSv12 reforecast member-first point service", () => {
  it("reuses GEFS field physics while preserving retrospective provenance", async () => {
    const source = {
      fetchSelection: vi.fn(async ({ member }: any) => ({
        path: `/tmp/${member}.grib2`,
        cacheHit: member === "c00",
      })),
    };
    const memberValue: Record<string, number> = {
      c00: 280,
      p01: 281,
      p02: 282,
      p03: 283,
      p04: 284,
    };
    const decoder = {
      engine: "gribberish" as const,
      extractPoint: vi.fn(async (path: string) => {
        const member = path.split("/").at(-1)!.replace(".grib2", "");
        return [{
          code: "TMP",
          heightAboveGroundM: 2,
          value: memberValue[member]!,
          gridPoint: { latitude: 50, longitude: 14 },
        }];
      }),
    };

    const service = new GefsReforecastPointService({
      source: source as any,
      decoder: decoder as any,
      concurrency: 2,
    });
    const result = await service.getPoint({
      latitude: 50.08,
      longitude: 14.43,
      run: "2017-03-14T00:00:00Z",
      validTime: "2017-03-14T12:00:00Z",
      fields: ["temperature_2m"],
      includeMembers: true,
    });

    expect(result.model).toBe("gefs_v12_reforecast");
    expect(result.selection.members).toEqual(["c00", "p01", "p02", "p03", "p04"]);
    expect(result.fieldSummaries[0]).toMatchObject({
      field: "temperature_2m",
      outputs: [{
        aggregation: "numeric_distribution",
        field: "temperatureC",
        unit: "degC",
        distribution: {
          memberCount: 5,
        },
      }],
    });
    const distribution = (result.fieldSummaries[0]!.outputs[0] as any).distribution;
    expect(distribution.mean).toBeCloseTo(8.85, 8);
    expect(distribution.min).toBeCloseTo(6.85, 8);
    expect(distribution.max).toBeCloseTo(10.85, 8);
    expect(result.source).toMatchObject({
      archiveType: "reforecast",
      dataset: "GEFSv12/reforecast",
      leadBlock: "Days:1-10",
      horizontalGridDegrees: 0.25,
      allCacheHit: false,
    });
    expect(result.members).toHaveLength(5);
    expect(source.fetchSelection).toHaveBeenCalledTimes(5);
  });
});
