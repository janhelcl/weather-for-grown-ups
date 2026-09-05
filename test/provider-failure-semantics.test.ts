import { describe, expect, it, vi } from "vitest";
import {
  DataUnavailableError,
  RateLimitedError,
  UpstreamUnavailableError,
} from "../src/failure.js";
import { AifsOpenDataRunProbe } from "../src/sources/aifs-open-data.js";
import { IfsOpenDataRunProbe } from "../src/sources/ifs-open-data.js";
import { NomadsSource } from "../src/sources/nomads.js";

const run = new Date("2026-08-27T12:00:00Z");
const selectors = [
  { key: "t@850", param: "t", levtype: "pl" as const, levelist: 850 },
];

describe("provider failure semantics", () => {
  it("keeps confirmed ECMWF object absence as ordinary run unavailability", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 404 })) as typeof fetch;

    await expect(new IfsOpenDataRunProbe(fetchFn).isForecastAvailable(run, 6, selectors))
      .resolves.toBe(false);
    await expect(new AifsOpenDataRunProbe(fetchFn).isForecastAvailable(run, 6, selectors))
      .resolves.toBe(false);
  });

  it("does not turn exhausted ECMWF 5xx responses into missing data", async () => {
    const fetchFn = vi.fn(async () => new Response("Unavailable", {
      status: 503,
      headers: { "retry-after": "0" },
    })) as typeof fetch;

    await expect(new IfsOpenDataRunProbe(fetchFn).isForecastAvailable(run, 6, selectors))
      .rejects.toBeInstanceOf(UpstreamUnavailableError);
    await expect(new AifsOpenDataRunProbe(fetchFn).isForecastAvailable(run, 6, selectors))
      .rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it("preserves rate limiting as a retryable ECMWF failure", async () => {
    const fetchFn = vi.fn(async () => new Response("Too Many Requests", {
      status: 429,
      headers: { "retry-after": "0" },
    })) as typeof fetch;

    const failure = new IfsOpenDataRunProbe(fetchFn).isForecastAvailable(run, 6, selectors);
    await expect(failure).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("classifies NOMADS 404 separately from transient provider failure", async () => {
    const noData = new NomadsSource(
      undefined,
      vi.fn(async () => new Response("", { status: 404 })) as typeof fetch,
      { maxAttempts: 1 },
    );
    await expect(noData.fetchPoint(nomadsRequest())).rejects.toBeInstanceOf(DataUnavailableError);

    const outage = new NomadsSource(
      undefined,
      vi.fn(async () => new Response("Unavailable", { status: 503 })) as typeof fetch,
      { maxAttempts: 1 },
    );
    await expect(outage.fetchPoint(nomadsRequest())).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });
});

function nomadsRequest() {
  return {
    run,
    forecastHour: 6,
    latitude: 50,
    longitude: 14,
    variables: [],
    pressureLevelsHpa: [],
  };
}
