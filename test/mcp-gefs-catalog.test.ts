import { describe, expect, it } from "vitest";
import { handleGetGefsCatalog, handleSearchGefsCatalog } from "../src/mcp-gefs-catalog-tool.js";

describe("GEFS catalog MCP handlers", () => {
  it("returns matching text and structured catalog content", () => {
    const response = handleGetGefsCatalog();
    expect(response.structuredContent.model).toBe("gefs_0p50");
    expect(response.structuredContent.fields.some((field) => field.id === "temperature_2m")).toBe(true);
    expect(response.content).toEqual([{ type: "text", text: JSON.stringify(response.structuredContent) }]);
  });

  it("returns structured search results", () => {
    const response = handleSearchGefsCatalog({ search: "precipitation" });
    expect("structuredContent" in response && response.structuredContent?.model).toBe("gefs_0p50");
  });

  it("converts invalid input into a tool error", () => {
    const response = handleSearchGefsCatalog({ search: "" });
    expect(response).toMatchObject({ isError: true });
  });
});
