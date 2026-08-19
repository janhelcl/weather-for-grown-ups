import { describe, expect, it, vi } from "vitest";
import type { ProfileResult } from "../src/core/types.js";
import { handleGetGfsProfile } from "../src/mcp-tool.js";
import type { ProfileQuery } from "../src/schema/query.js";

const query: ProfileQuery = {
  latitude: 50.08,
  longitude: 14.43,
  run: "2026-08-19T06:00:00Z",
  validTime: "2026-08-19T12:00:00Z",
  variables: ["temperature"],
  pressureLevelsHpa: [850],
};

const result: ProfileResult = {
  model: "gfs_0p25",
  run: "2026-08-19T06:00:00.000Z",
  validTime: "2026-08-19T12:00:00.000Z",
  forecastHour: 6,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  levels: [{ pressureHpa: 850, temperatureC: 12 }],
  source: { provider: "NOAA NOMADS", decoder: "wgrib2", cacheHit: false },
};

describe("handleGetGfsProfile", () => {
  it("returns both human-readable MCP content and structured content", async () => {
    const getProfile = vi.fn(async (_query: ProfileQuery) => result);
    const response = await handleGetGfsProfile({ getProfile }, query);

    expect(getProfile).toHaveBeenCalledWith(query);
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  });

  it("turns service errors into MCP tool errors", async () => {
    const getProfile = vi.fn(async (_query: ProfileQuery): Promise<ProfileResult> => {
      throw new Error("NOMADS unavailable");
    });
    const response = await handleGetGfsProfile({ getProfile }, query);

    expect(response).toEqual({
      content: [{ type: "text", text: "NOMADS unavailable" }],
      isError: true,
    });
  });

  it("safely stringifies non-Error throws", async () => {
    const getProfile = vi.fn(async (_query: ProfileQuery): Promise<ProfileResult> => {
      throw "bad upstream";
    });
    expect(await handleGetGfsProfile({ getProfile }, query)).toEqual({
      content: [{ type: "text", text: "bad upstream" }],
      isError: true,
    });
  });
});
