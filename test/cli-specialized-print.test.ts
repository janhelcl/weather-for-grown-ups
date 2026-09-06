import { afterEach, describe, expect, it, vi } from "vitest";
import { printAtmosphericResult } from "../src/cli/print-result.js";

describe("specialized CLI result rendering", () => {
  afterEach(() => vi.restoreAllMocks());
  it("renders a specialized envelope as tables instead of util.inspect", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    const dir = vi.spyOn(console, "dir").mockImplementation(() => {});
    printAtmosphericResult({
      operation: "verify_forecast",
      datasets: ["gfs", "gfs-analysis"],
      result: { model: "verification", pressureLevels: [{ pressureHpa: 850, changes: [] }] },
    }, false);
    expect(log.mock.calls.map((call) => call[0])).toContain("Operation:");
    expect(table.mock.calls[0]?.[0]).toEqual([{ operation: "verify_forecast", datasets: "gfs, gfs-analysis" }]);
    expect(dir).not.toHaveBeenCalled();
  });
});
