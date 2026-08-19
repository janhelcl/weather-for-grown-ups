import { describe, expect, it } from "vitest";
import { handleGetLatestGfsRun } from "../src/mcp-tool.js";

describe("handleGetLatestGfsRun", () => {
  it("returns structured latest-complete-run metadata", async () => {
    const response = await handleGetLatestGfsRun({
      resolveLatestRun: async () => new Date("2026-08-19T06:00:00Z"),
    });
    const output = {
      model: "gfs_0p25",
      run: "2026-08-19T06:00:00.000Z",
      completeness: "f384",
      discoverySource: "NOAA AWS Open Data",
    };
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: output,
    });
  });

  it("maps resolver errors to MCP tool errors", async () => {
    const response = await handleGetLatestGfsRun({
      resolveLatestRun: async () => {
        throw new Error("AWS unavailable");
      },
    });
    expect(response).toEqual({
      content: [{ type: "text", text: "AWS unavailable" }],
      isError: true,
    });
  });

  it("safely stringifies non-Error failures", async () => {
    const response = await handleGetLatestGfsRun({
      resolveLatestRun: async () => {
        throw "bad discovery";
      },
    });
    expect(response).toEqual({
      content: [{ type: "text", text: "bad discovery" }],
      isError: true,
    });
  });
});
