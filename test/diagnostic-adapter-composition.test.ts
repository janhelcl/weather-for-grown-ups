import { describe, expect, it } from "vitest";
import { GefsDiagnosticAdapter } from "../src/core/diagnostic-adapters/gefs.js";
import { GfsAnalysisDiagnosticAdapter } from "../src/core/diagnostic-adapters/gfs-analysis.js";
import { GfsDiagnosticAdapter } from "../src/core/diagnostic-adapters/gfs.js";
import { IfsEnsDiagnosticAdapter } from "../src/core/diagnostic-adapters/ifs-ens.js";
import { IfsDiagnosticAdapter } from "../src/core/diagnostic-adapters/ifs.js";

const stub = {} as any;

describe("dataset diagnostic adapter composition", () => {
  it("keeps GFS diagnostic services injectable behind the adapter boundary", () => {
    const adapter = new GfsDiagnosticAdapter({
      layer: stub,
      profile: stub,
      parcel: stub,
      timeSeries: stub,
      archivedGfs: stub,
      now: () => new Date("2026-08-30T00:00:00Z"),
    });
    expect(() => adapter.diagnose({ dataset: "ifs" } as any))
      .toThrow("GFS diagnostic adapter only accepts dataset=gfs");
  });

  it("keeps GEFS diagnostic services injectable behind the adapter boundary", () => {
    const adapter = new GefsDiagnosticAdapter({
      layer: stub,
      profile: stub,
      parcel: stub,
      timeSeries: stub,
      gefsReforecastLayer: stub,
      gefsReforecastProfile: stub,
      gefsReforecastTimeSeries: stub,
    });
    expect(() => adapter.diagnose({ dataset: "gfs" } as any))
      .toThrow("GEFS diagnostic adapter only accepts dataset=gefs");
  });

  it("keeps IFS diagnostic services injectable behind the adapter boundary", () => {
    const adapter = new IfsDiagnosticAdapter({
      layer: stub,
      profile: stub,
      parcel: stub,
      timeSeries: stub,
    });
    expect(() => adapter.diagnose({ dataset: "gfs" } as any))
      .toThrow("IFS diagnostic adapter only accepts dataset=ifs");
  });

  it("keeps IFS ENS diagnostic services injectable behind the adapter boundary", () => {
    const adapter = new IfsEnsDiagnosticAdapter({
      ifsEns: stub,
      ifsEnsTimeSeries: stub,
    });
    expect(() => adapter.diagnose({ dataset: "gfs" } as any))
      .toThrow("IFS ENS diagnostic adapter only accepts dataset=ifs-ens");
  });

  it("keeps analysis diagnostic services injectable behind the adapter boundary", () => {
    const adapter = new GfsAnalysisDiagnosticAdapter({
      layer: stub,
      profile: stub,
      parcel: stub,
      timeSeries: stub,
    });
    expect(() => adapter.diagnose({ dataset: "gfs" } as any))
      .toThrow("GFS analysis diagnostic adapter only accepts dataset=gfs-analysis");
  });
});
