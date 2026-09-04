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

  it("hides unexpected internal exception messages", () => {
    const failure = toPublicFailure(new Error("secret provider response body"));
    expect(failure).toEqual({
      code: "INTERNAL_ERROR",
      message: "Unexpected internal error while handling the request",
      retryable: false,
    });
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
  it("returns one stable machine-readable error envelope", () => {
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
    expect(result.structuredContent).toEqual(JSON.parse(text!));
    expect(result.isError).toBe(true);
  });
});
