import { describe, expect, it } from "vitest";
import {
  handleGetGefsFields,
  handleGetGefsFieldsTimeSeries,
} from "../src/mcp-gefs-bundle-tool.js";
import type { GefsBundleTimeSeriesResult } from "../src/schema/gefs-bundle-timeseries.js";
import type { GefsMemberBundleResult } from "../src/schema/gefs-member-bundle.js";

const distribution = {
  memberCount: 2,
  mean: 15,
  populationStdDev: 1,
  min: 14,
  max: 16,
  quantiles: [{ quantile: 0.5, value: 15 }],
};

const bundle: GefsMemberBundleResult = {
  model: "gefs_0p50",
  run: "2026-08-24T00:00:00Z",
  validTime: "2026-08-24T03:00:00Z",
  forecastHour: 3,
  requestedPoint: { latitude: 50.08, longitude: 14.43 },
  gridPoint: { latitude: 50, longitude: 14.5 },
  selection: {
    variables: [],
    pressureLevelsHpa: [],
    fields: ["temperature_2m"],
    members: ["c00", "p01"],
    quantiles: [0.5],
  },
  pressureSummaries: [],
  fieldSummaries: [{
    field: "temperature_2m",
    level: { gribLevel: "2 m above ground", description: "2 m above ground" },
    temporal: { type: "instantaneous" },
    outputs: [{
      aggregation: "numeric_distribution",
      field: "temperatureC",
      unit: "degC",
      distribution,
    }],
  }],
  source: {
    provider: "NOAA AWS Open Data",
    access: "s3_range",
    decoder: "wgrib2",
    product: "pgrb2a_0p50",
    allCacheHit: true,
  },
};

const timeSeries: GefsBundleTimeSeriesResult = {
  model: "gefs_0p50",
  run: bundle.run,
  startTime: bundle.validTime,
  endTime: bundle.validTime,
  stepHours: 3,
  requestedPoint: bundle.requestedPoint,
  gridPoint: bundle.gridPoint,
  selection: bundle.selection,
  includeMembers: false,
  series: [{
    validTime: bundle.validTime,
    forecastHour: 3,
    pressureSummaries: [],
    fieldSummaries: bundle.fieldSummaries,
    allCacheHit: true,
  }],
  source: bundle.source,
};

describe("GEFS mixed bundle MCP handlers", () => {
  it("returns single-time mixed distributions as structured MCP content", async () => {
    const response = await handleGetGefsFields(
      { getBundle: async () => bundle },
      {
        latitude: 50.08,
        longitude: 14.43,
        run: bundle.run,
        validTime: bundle.validTime,
        selection: { fields: ["temperature_2m"] },
        members: ["c00", "p01"],
        quantiles: [0.5],
      },
    );
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(bundle) }],
      structuredContent: bundle,
    });
  });

  it("returns mixed field time series as structured MCP content", async () => {
    const response = await handleGetGefsFieldsTimeSeries(
      { getTimeSeries: async () => timeSeries },
      {
        latitude: 50.08,
        longitude: 14.43,
        run: bundle.run,
        startTime: bundle.validTime,
        endTime: bundle.validTime,
        selection: { fields: ["temperature_2m"] },
        members: ["c00", "p01"],
        quantiles: [0.5],
      },
    );
    expect(response).toEqual({
      content: [{ type: "text", text: JSON.stringify(timeSeries) }],
      structuredContent: timeSeries,
    });
  });

  it("turns bundle failures into MCP tool errors", async () => {
    const response = await handleGetGefsFields(
      { getBundle: async () => { throw new Error("bundle failed"); } },
      {
        latitude: 50.08,
        longitude: 14.43,
        run: bundle.run,
        validTime: bundle.validTime,
        selection: { fields: ["temperature_2m"] },
        members: ["c00", "p01"],
      },
    );
    expect(response).toEqual({
      content: [{ type: "text", text: "bundle failed" }],
      isError: true,
    });
  });
});
