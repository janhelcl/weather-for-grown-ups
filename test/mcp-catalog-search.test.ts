import { describe, expect, it } from "vitest";
import { handleSearchGfsCatalog } from "../src/mcp-tool.js";
import { catalogSearchResultSchema } from "../src/schema/catalog-search.js";

describe("handleSearchGfsCatalog", () => {
  it("returns compact structured search results", () => {
    const response = handleSearchGfsCatalog({
      search: "low cloud cover",
      sections: ["fields"],
      temporalSemantics: "average",
      limit: 5,
    });

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toBeDefined();
    const output = catalogSearchResultSchema.parse(response.structuredContent);
    expect(output.matches[0]).toMatchObject({
      section: "fields",
      id: "low_cloud_cover_average",
      temporalSemantics: "average",
    });
    expect(response.content).toEqual([{ type: "text", text: JSON.stringify(output) }]);
  });

  it("maps invalid search input to an MCP error", () => {
    const response = handleSearchGfsCatalog({ sections: [] } as never);
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toMatch(/Too small|at least|array/i);
  });
});
