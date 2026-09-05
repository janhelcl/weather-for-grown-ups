import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DataUnavailableError,
  RateLimitedError,
  UpstreamUnavailableError,
  formatPublicFailure,
  toPublicFailure,
} from "../src/failure.js";
import { toolError } from "../src/mcp-unified-tool.js";

describe("public failure contract", () => {
  it("preserves typed failure semantics", () => {
    expect(toPublicFailure(new DataUnavailableError("Forecast run is absent"))).toEqual({
      code: "DATA_UNAVAILABLE",
      message: "Forecast run is absent",
      retryable: false,
    });
    expect(toPublicFailure(new RateLimitedError("Provider quota exhausted"))).toEqual({
      code: "RATE_LIMITED",
      message: "Provider quota exhausted",
      retryable: true,
    });
    expect(toPublicFailure(new UpstreamUnavailableError("Provider offline"))).toEqual({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Provider offline",
      retryable: true,
    });
  });

  it("turns zod failures into INVALID_REQUEST without exposing a stack", () => {
    let error: unknown;
    try {
      z.object({ latitude: z.number().min(-90).max(90) }).parse({ latitude: 120 });
    } catch (caught) {
      error = caught;
    }

    const failure = toPublicFailure(error);
    expect(failure.code).toBe("INVALID_REQUEST");
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain("Request validation failed");
    expect(failure.details).toEqual({
      issues: [{ path: "latitude", message: expect.any(String) }],
    });
    expect(failure).not.toHaveProperty("stack");
  });

  it("maps terminal transport failures to retryable upstream failures", () => {
    const error = new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    expect(toPublicFailure(error)).toEqual({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Upstream provider could not be reached after retries",
      retryable: true,
    });
  });

  it("preserves actionable plain Error messages under INTERNAL_ERROR for local reporting", () => {
    const failure = toPublicFailure(new Error(
      "Requested time range contains 120 native GFS outputs, exceeding maxSteps=8. Narrow the range or raise maxSteps.",
    ));
    expect(failure).toEqual({
      code: "INTERNAL_ERROR",
      message: "Requested time range contains 120 native GFS outputs, exceeding maxSteps=8. Narrow the range or raise maxSteps.",
      retryable: false,
    });
    expect(failure).not.toHaveProperty("stack");
  });

  it("keeps internal messages single-line, bounded and credential-free", () => {
    const secret = "AbCdEf0123456789.secret-value";
    const failure = toPublicFailure(new Error(
      `Request failed\n  Authorization: Bearer ${secret}\n  url=https://example.test/wcs?apikey=${secret}&x=1 WFG_METEO_FRANCE_TOKEN=${secret}`,
    ));
    expect(failure.code).toBe("INTERNAL_ERROR");
    expect(failure.message).not.toContain(secret);
    expect(failure.message).not.toContain("\n");
    expect(failure.message).toContain("Bearer [redacted]");
    expect(failure.message).toContain("apikey=[redacted]");
    expect(failure.message).toContain("WFG_METEO_FRANCE_TOKEN=[redacted]");

    const long = toPublicFailure(new Error("x".repeat(2000)));
    expect(long.message.length).toBeLessThanOrEqual(600);
    expect(long.message.endsWith("…")).toBe(true);
  });

  it("stays generic for empty messages and non-Error throwables", () => {
    const generic = {
      code: "INTERNAL_ERROR",
      message: "Unexpected internal error while handling the request",
      retryable: false,
    };
    expect(toPublicFailure(new Error("   "))).toEqual(generic);
    expect(toPublicFailure("raw string failure")).toEqual(generic);
    expect(toPublicFailure({ unexpected: true })).toEqual(generic);
    expect(toPublicFailure(undefined)).toEqual(generic);
  });

  it("formats human-readable failures without embedding semantics in prose", () => {
    expect(formatPublicFailure({
      code: "DATA_UNAVAILABLE",
      message: "No matching run",
      retryable: false,
    })).toBe("DATA_UNAVAILABLE: No matching run");
  });
});

describe("MCP failure result", () => {
  it("returns one stable machine-readable typed error envelope", () => {
    const result = toolError(new DataUnavailableError("No matching run", {
      details: { dataset: "gfs-analysis" },
    }));

    const text = result.content[0]?.text;
    expect(typeof text).toBe("string");
    expect(JSON.parse(text!)).toEqual({
      error: {
        code: "DATA_UNAVAILABLE",
        message: "No matching run",
        retryable: false,
        details: { dataset: "gfs-analysis" },
      },
    });
    expect(result).not.toHaveProperty("structuredContent");
    expect(result.isError).toBe(true);
  });

  it("does not expose arbitrary plain Error details remotely", () => {
    const result = toolError(new Error(
      "decoder exploded at /home/user/.cache/wfg/private-object.grib2 while reading implementation detail",
    ));
    const text = result.content[0]?.text;
    expect(JSON.parse(text!)).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected internal error while handling the request",
        retryable: false,
      },
    });
    expect(text).not.toContain("/home/user");
    expect(text).not.toContain("private-object.grib2");
  });
});
