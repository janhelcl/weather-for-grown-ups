import { describe, expect, it } from "vitest";
import { createCliProgram } from "../src/cli/program.js";

describe("model-selectable catalog CLI", () => {
  it("keeps one catalog command with an explicit model selector", () => {
    const command = createCliProgram().commands.find((candidate) => candidate.name() === "catalog");
    expect(command).toBeDefined();
    expect(command?.options.find((option) => option.long === "--model")?.defaultValue).toBe("gfs");
    expect(command?.options.some((option) => option.long === "--search")).toBe(true);
  });
});
