import { describe, expect, it } from "vitest";
import { handleGetGfsCatalog } from "../src/mcp-tool.js";

describe("handleGetGfsCatalog", () => {
  it("returns matching text and structured catalog content", () => {
    const response = handleGetGfsCatalog();
    expect(response.structuredContent.model).toBe("gfs_0p25");
    expect(response.structuredContent.variables).toHaveLength(13);
    expect(response.content).toEqual([{ type: "text", text: JSON.stringify(response.structuredContent) }]);
  });
});
