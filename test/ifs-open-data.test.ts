import { describe, expect, it, vi } from "vitest";
import {
  IfsEnsOpenDataRunProbe,
  IfsOpenDataRunProbe,
  buildIfsEnsOpenDataForecastIndexUrl,
  buildIfsEnsOpenDataForecastUrl,
  buildIfsOpenDataForecastIndexUrl,
  buildIfsOpenDataForecastUrl,
  parseIfsOpenDataIndex,
  selectIfsIndexEntries,
} from "../src/sources/ifs-open-data.js";

const run = new Date("2026-08-27T12:00:00Z");

describe("ECMWF IFS Open Data source", () => {
  it("builds current 0.25 degree operational forecast paths", () => {
    expect(buildIfsOpenDataForecastUrl(run, 6)).toBe(
      "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/20260827/12z/ifs/0p25/oper/20260827120000-6h-oper-fc.grib2",
    );
    expect(buildIfsOpenDataForecastIndexUrl(run, 150)).toBe(
      "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/20260827/12z/ifs/0p25/oper/20260827120000-150h-oper-fc.index",
    );
  });

  it("builds current 0.25 degree perturbed-ensemble paths", () => {
    expect(buildIfsEnsOpenDataForecastUrl(run, 6)).toBe(
      "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/20260827/12z/ifs/0p25/enfo/20260827120000-6h-enfo-ef.grib2",
    );
    expect(buildIfsEnsOpenDataForecastIndexUrl(run, 150)).toBe(
      "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/20260827/12z/ifs/0p25/enfo/20260827120000-150h-enfo-ef.index",
    );
  });

  it("selects pressure and surface entries from ECMWF JSON-lines indexes", () => {
    const text = [
      '{"date":"20260827","time":"1200","step":"6","levtype":"pl","levelist":"850","param":"t","_offset":0,"_length":100}',
      '{"date":"20260827","time":"1200","step":"6","levtype":"pl","levelist":"500","param":"t","_offset":100,"_length":110}',
      '{"date":"20260827","time":"1200","step":"6","levtype":"sfc","param":"2t","_offset":210,"_length":120}',
    ].join("\n");
    const entries = parseIfsOpenDataIndex(text);
    expect(selectIfsIndexEntries(entries, [
      { key: "temperature@850", param: "t", levtype: "pl", levelist: 850 },
      { key: "temperature_2m", param: "2t", levtype: "sfc" },
    ])).toMatchObject([
      { offset: 0, length: 100, var: "t" },
      { offset: 210, length: 120, var: "2t" },
    ]);
    expect(() => selectIfsIndexEntries(entries, [
      { key: "wind@850", param: "u", levtype: "pl", levelist: 850 },
    ])).toThrow("missing requested fields");
  });

  it("selects a specific perturbed member from a shared ENS index", () => {
    const text = [
      '{"date":"20260827","time":"1200","step":"6","levtype":"pl","levelist":"850","param":"t","number":"1","_offset":0,"_length":100}',
      '{"date":"20260827","time":"1200","step":"6","levtype":"pl","levelist":"850","param":"t","number":"2","_offset":100,"_length":110}',
    ].join("\n");
    const entries = parseIfsOpenDataIndex(text);
    expect(selectIfsIndexEntries(entries, [
      { key: "temperature@850#p02", param: "t", levtype: "pl", levelist: 850, number: 2 },
    ])).toMatchObject([
      { offset: 100, length: 110, var: "t", keys: { number: "2" } },
    ]);
  });

  it("resolves shared ENS run-static orography from oper without a perturbation number", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/enfo/")) {
        return new Response(
          '{"date":"20260827","time":"1200","step":"0","levtype":"pl","levelist":"850","param":"t","number":"2","_offset":0,"_length":10}',
          { status: 200 },
        );
      }
      if (url.includes("/oper/")) {
        return new Response(
          '{"date":"20260827","time":"1200","step":"0","levtype":"sfc","param":"z","_offset":0,"_length":10}',
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const probe = new IfsEnsOpenDataRunProbe(fetchFn);

    await expect(probe.isForecastAvailable(run, 0, [
      { key: "temperature@850#p02", param: "t", levtype: "pl", levelist: 850, number: 2 },
      {
        key: "surface_geopotential_height#p02",
        param: "z",
        levtype: "sfc",
        number: 2,
        sourceForecastHour: 0,
      },
    ])).resolves.toBe(true);

    expect(fetchFn.mock.calls.some(([input]) => String(input).includes("/enfo/"))).toBe(true);
    expect(fetchFn.mock.calls.some(([input]) => String(input).includes("/oper/"))).toBe(true);
  });

  it("retries transient throttling before resolving availability", async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response("Slow Down", {
          status: 503,
          headers: { "retry-after": "0" },
        });
      }
      return new Response(
        '{"date":"20260827","time":"1200","step":"6","levtype":"pl","levelist":"850","param":"t","_offset":0,"_length":10}',
        { status: 200 },
      );
    }) as typeof fetch;
    const probe = new IfsOpenDataRunProbe(fetchFn);
    await expect(probe.isForecastAvailable(run, 6, [
      { key: "t@850", param: "t", levtype: "pl", levelist: 850 },
    ])).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("fails over from a throttled AWS mirror to another ECMWF replica", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("ecmwf-forecasts.s3.eu-central-1.amazonaws.com")) {
        return new Response("Slow Down", {
          status: 503,
          headers: { "retry-after": "0" },
        });
      }
      if (url.includes("storage.googleapis.com/ecmwf-open-data")) {
        return new Response(
          '{"date":"20260827","time":"1200","step":"6","levtype":"pl","levelist":"850","param":"t","_offset":0,"_length":10}',
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const probe = new IfsOpenDataRunProbe(fetchFn);
    await expect(probe.isForecastAvailable(run, 6, [
      { key: "t@850", param: "t", levtype: "pl", levelist: 850 },
    ])).resolves.toBe(true);
    expect(fetchFn.mock.calls.some(([input]) =>
      String(input).includes("storage.googleapis.com/ecmwf-open-data"))).toBe(true);
  });

  it("treats missing objects and missing selected inventory as unavailable", async () => {
    const notFound = new IfsOpenDataRunProbe(vi.fn(async () => new Response("", { status: 404 })) as typeof fetch);
    await expect(notFound.isForecastAvailable(run, 6, [
      { key: "t@850", param: "t", levtype: "pl", levelist: 850 },
    ])).resolves.toBe(false);

    const fetchFn = vi.fn(async () => new Response(
      '{"date":"20260827","time":"1200","step":"6","levtype":"sfc","param":"2t","_offset":0,"_length":10}',
      { status: 200 },
    )) as typeof fetch;
    const probe = new IfsOpenDataRunProbe(fetchFn);
    await expect(probe.isForecastAvailable(run, 6, [
      { key: "t@850", param: "t", levtype: "pl", levelist: 850 },
    ])).resolves.toBe(false);
  });
});
