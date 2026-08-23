import { describe, expect, it } from "vitest";
import { profileQuerySchema, runSelectorSchema } from "../src/schema/query.js";

const base = {
  latitude: 50.08,
  longitude: 14.43,
  validTime: "2026-08-20T12:00:00Z",
  variables: ["temperature"],
  pressureLevelsHpa: [850],
};

describe("run selection", () => {
  it("defaults an omitted run to query-aware latest", () => {
    expect(profileQuerySchema.parse(base).run).toBe("latest");
  });

  it("accepts latest explicitly", () => {
    expect(runSelectorSchema.parse("latest")).toBe("latest");
  });

  it("accepts latest_complete as the explicit f384-complete selector", () => {
    expect(runSelectorSchema.parse("latest_complete")).toBe("latest_complete");
  });

  it("retains explicit timezone-aware model cycles", () => {
    expect(runSelectorSchema.parse("2026-08-19T06:00:00Z")).toBe("2026-08-19T06:00:00Z");
  });

  it("rejects arbitrary selectors and timezone-ambiguous timestamps", () => {
    expect(runSelectorSchema.safeParse("newest").success).toBe(false);
    expect(runSelectorSchema.safeParse("2026-08-19T06:00:00").success).toBe(false);
  });
});
