import { describe, expect, it, vi } from "vitest";
import { AtmosphericParcelDiagnosticsService } from "../src/core/atmospheric-parcel-diagnostics-service.js";

describe("atmospheric parcel diagnostics dispatch", () => {
  it("routes IFS parcel requests without adapting them to GFS", async () => {
    const getParcelDiagnostics = vi.fn(async () => {
      throw new Error("ifs parcel invoked");
    });
    const service = new AtmosphericParcelDiagnosticsService({
      ifs: { getParcelDiagnostics },
    });

    await expect(service.getParcelDiagnostics({
      model: "ifs_0p25",
      query: {
        latitude: 50.08,
        longitude: 14.43,
        run: "2026-08-27T12:00:00Z",
        validTime: "2026-08-27T18:00:00Z",
        pressureLevelsHpa: [925, 850, 700, 500],
        parcel: "surface_2m",
      },
    })).rejects.toThrow("ifs parcel invoked");

    expect(getParcelDiagnostics).toHaveBeenCalledWith({
      latitude: 50.08,
      longitude: 14.43,
      run: "2026-08-27T12:00:00Z",
      validTime: "2026-08-27T18:00:00Z",
      pressureLevelsHpa: [925, 850, 700, 500],
      parcel: "surface_2m",
    });
  });
});
