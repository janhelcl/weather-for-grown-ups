import { describe, expect, it } from "vitest";
import { GefsQueryAdapter } from "../src/core/query-adapters/gefs.js";
import { GfsAnalysisQueryAdapter } from "../src/core/query-adapters/gfs-analysis.js";
import { GfsQueryAdapter } from "../src/core/query-adapters/gfs.js";
import { IfsEnsQueryAdapter } from "../src/core/query-adapters/ifs-ens.js";
import { IfsQueryAdapter } from "../src/core/query-adapters/ifs.js";

const stub = {} as any;

describe("dataset query adapter composition", () => {
  it("keeps GFS native services injectable behind the adapter boundary", () => {
    const adapter = new GfsQueryAdapter({
      gfsProfile: stub,
      gfsTimeSeries: stub,
      gfsPoints: stub,
      gfsPointsTimeSeries: stub,
      gfsTransect: stub,
      gfsArea: stub,
      archivedGfs: stub,
      now: () => new Date("2026-08-30T00:00:00Z"),
    });

    expect(() => adapter.query({ dataset: "ifs" } as any))
      .toThrow("GFS query adapter only accepts dataset=gfs");
  });

  it("keeps GEFS native services injectable behind the adapter boundary", () => {
    const adapter = new GefsQueryAdapter({
      gefsBundle: stub,
      gefsTimeSeries: stub,
      gefsPoints: stub,
      gefsPointsTimeSeries: stub,
      gefsTransect: stub,
      gefsArea: stub,
      gefsReforecast: stub,
      gefsReforecastMixed: stub,
      gefsReforecastMixedPoints: stub,
      gefsReforecastMixedTimeSeries: stub,
      gefsReforecastMixedPointsTimeSeries: stub,
      gefsReforecastProfile: stub,
      gefsReforecastPoints: stub,
      gefsReforecastPointsTimeSeries: stub,
      gefsReforecastTimeSeries: stub,
    });

    expect(() => adapter.query({ dataset: "gfs" } as any))
      .toThrow("GEFS query adapter only accepts dataset=gefs");
  });

  it("keeps IFS native services injectable behind the adapter boundary", () => {
    const adapter = new IfsQueryAdapter({
      ifsProfile: stub,
      ifsTimeSeries: stub,
      ifsPoints: stub,
      ifsPointsTimeSeries: stub,
      ifsTransect: stub,
      ifsArea: stub,
    });

    expect(() => adapter.query({ dataset: "gfs" } as any))
      .toThrow("IFS query adapter only accepts dataset=ifs");
  });

  it("keeps IFS ENS native services injectable behind the adapter boundary", () => {
    const adapter = new IfsEnsQueryAdapter({
      ifsEnsBundle: stub,
      ifsEnsTimeSeries: stub,
      ifsEnsPoints: stub,
      ifsEnsPointsTimeSeries: stub,
      ifsEnsTransect: stub,
      ifsEnsArea: stub,
    });

    expect(() => adapter.query({ dataset: "gfs" } as any))
      .toThrow("IFS ENS query adapter only accepts dataset=ifs-ens");
  });

  it("keeps historical analysis services injectable behind the adapter boundary", () => {
    const adapter = new GfsAnalysisQueryAdapter({
      historyProfile: stub,
      historyFields: stub,
      historyTimeSeries: stub,
      historyFieldsTimeSeries: stub,
      historyPoints: stub,
      historyPointsTimeSeries: stub,
      historyTransect: stub,
      historyArea: stub,
    });

    expect(() => adapter.query({ dataset: "gfs" } as any))
      .toThrow("GFS analysis query adapter only accepts dataset=gfs-analysis");
  });
});
