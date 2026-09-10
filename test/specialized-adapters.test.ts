import { describe, expect, it, vi } from "vitest";
import { GfsAnalysisAnalogAdapter } from "../src/core/specialized-adapters/analogs.js";
import { findAtmosphericAnalogsSchema } from "../src/schema/unified-specialized.js";

const point = { type: "point" as const, latitude: 50.08, longitude: 14.43 };

describe("specialized analog adapter", () => {
  it("translates the common analysis request into the historical index service", async () => {
    const native = { findAnalogs: vi.fn(async (query) => ({ route: "analogs", query })) };
    const adapter = new GfsAnalysisAnalogAdapter(native as any);
    const request = findAtmosphericAnalogsSchema.parse({
      geometry: point,
      time: { at: "2017-05-09T12:00:00Z" },
      variables: ["temperature"],
      pressureLevelsHpa: [850],
      count: 7,
      excludeWithinHours: 48,
      fetchTargetIfMissing: false,
    });
    const result = await adapter.find(request);
    expect((result as any).route).toBe("analogs");
    expect(native.findAnalogs).toHaveBeenCalledWith(expect.objectContaining({
      targetTime: "2017-05-09T12:00:00Z",
      count: 7,
      excludeWithinHours: 48,
      fetchTargetIfMissing: false,
    }));
  });
});
