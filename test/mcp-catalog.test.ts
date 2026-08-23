import { describe, expect, it } from "vitest";
import { handleGetGfsCatalog } from "../src/mcp-tool.js";

describe("handleGetGfsCatalog", () => {
  it("returns matching text and structured catalog content", () => {
    const response = handleGetGfsCatalog();
    expect(response.structuredContent.model).toBe("gfs_0p25");
    expect(response.structuredContent.variables).toHaveLength(20);
    expect(response.structuredContent.variables.find((variable) => variable.id === "dew_point")).toMatchObject({
      kind: "derived",
      dependencies: ["temperature", "relative_humidity"],
    });
    expect(response.structuredContent.variables.find((variable) => variable.id === "wet_bulb_temperature")).toMatchObject({
      kind: "derived",
      dependencies: ["temperature", "specific_humidity"],
    });
    expect(response.structuredContent.variables.find((variable) => variable.id === "equivalent_potential_temperature")).toMatchObject({
      kind: "derived",
      dependencies: ["temperature", "specific_humidity"],
    });
    expect(response.content).toEqual([{ type: "text", text: JSON.stringify(response.structuredContent) }]);
  });
});
