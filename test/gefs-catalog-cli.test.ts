import { describe, expect, it } from "vitest";
import { createCliProgram } from "../src/cli/program.js";

describe("dataset-selectable catalog CLI", () => {
  it("keeps one catalog command with the unified dataset selector", () => {
    const command = createCliProgram().commands.find((candidate) => candidate.name() === "catalog");
    expect(command).toBeDefined();
    expect(command?.options.find((option) => option.long === "--dataset")?.defaultValue).toBe("all");
    expect(command?.options.some((option) => option.long === "--model")).toBe(false);
    expect(command?.options.some((option) => option.long === "--search")).toBe(true);
  });
});
