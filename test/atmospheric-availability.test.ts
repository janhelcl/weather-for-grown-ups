import { describe, expect, it } from "vitest";
import {
  AtmosphericAvailabilityService,
  type AtmosphericAvailabilityRunResolver,
} from "../src/core/atmospheric-availability.js";
import { atmosphereAvailabilityResultSchema } from "../src/schema/availability-inspection.js";
import type { QueryAtmosphereRequest } from "../src/schema/unified-api.js";

const HOUR_MS = 3_600_000;
const RUN = new Date("2026-09-12T06:00:00Z");

class FakeRunResolver implements AtmosphericAvailabilityRunResolver {
  readonly calls: QueryAtmosphereRequest[] = [];

  constructor(
    private readonly availableThrough: Date,
    private readonly declaredMaxHour = 18,
  ) {}

  async resolve(request: QueryAtmosphereRequest): Promise<Date> {
    this.calls.push(request);
    const start = "at" in request.time ? new Date(request.time.at) : new Date(request.time.from);
    const end = "at" in request.time ? start : new Date(request.time.to);
    if (start.getTime() < RUN.getTime() || end.getTime() > this.availableThrough.getTime()) {
      throw new Error(`Published coverage ends at ${this.availableThrough.toISOString()}`);
    }
    return new Date(RUN);
  }

  nativeValidTimes(
    _request: QueryAtmosphereRequest,
    run: Date,
    from: Date,
    to: Date,
  ): Date[] {
    const firstHour = Math.max(0, Math.ceil((from.getTime() - run.getTime()) / HOUR_MS));
    const lastHour = Math.min(
      this.declaredMaxHour,
      Math.floor((to.getTime() - run.getTime()) / HOUR_MS),
    );
    return Array.from(
      { length: Math.max(0, lastHour - firstHour + 1) },
      (_, index) => new Date(run.getTime() + (firstHour + index) * HOUR_MS),
    );
  }
}

function request(from = "2026-09-12T09:00:00Z", to = "2026-09-12T15:00:00Z") {
  return {
    dataset: "gfs" as const,
    geometry: { type: "point" as const, latitude: 50.08, longitude: 14.43 },
    time: { from, to },
    selection: { variables: ["temperature" as const], pressureLevelsHpa: [850] },
  };
}

describe("AtmosphericAvailabilityService", () => {
  it("reports complete coverage with resolved initialization range and requested cadence", async () => {
    const resolver = new FakeRunResolver(new Date("2026-09-12T18:00:00Z"));
    const result = await new AtmosphericAvailabilityService({ runResolver: resolver }).inspect(request());

    expect(result).toMatchObject({
      basis: "live_product_probe",
      dataset: "gfs",
      domainCovered: true,
      coverage: "complete",
      initialization: RUN.toISOString(),
      initializationValidTimeRange: {
        from: "2026-09-12T06:00:00.000Z",
        to: "2026-09-13T00:00:00.000Z",
      },
      availableRequestedTime: {
        from: "2026-09-12T09:00:00.000Z",
        to: "2026-09-12T15:00:00.000Z",
      },
      nativeCadenceHours: [1],
      maxForecastHour: 18,
      issues: [],
    });
    expect(atmosphereAvailabilityResultSchema.parse(result)).toEqual(result);
  });

  it("finds the longest available prefix and reports partial coverage", async () => {
    const resolver = new FakeRunResolver(new Date("2026-09-12T12:00:00Z"));
    const result = await new AtmosphericAvailabilityService({ runResolver: resolver }).inspect(request());

    expect(result.coverage).toBe("partial");
    expect(result.initialization).toBe(RUN.toISOString());
    expect(result.initializationValidTimeRange).toEqual({
      from: "2026-09-12T06:00:00.000Z",
      to: "2026-09-13T00:00:00.000Z",
    });
    expect(result.availableRequestedTime).toEqual({
      from: "2026-09-12T09:00:00.000Z",
      to: "2026-09-12T12:00:00.000Z",
    });
    expect(result.nativeCadenceHours).toEqual([1]);
    expect(result.maxForecastHour).toBe(18);
    expect(result.issues[0]?.reason).toContain("only partially available");
    expect(resolver.calls.length).toBeGreaterThan(2);
  });

  it("does not probe a regional model when geometry is outside its declared domain", async () => {
    const resolver = new FakeRunResolver(new Date("2026-09-12T18:00:00Z"));
    const result = await new AtmosphericAvailabilityService({ runResolver: resolver }).inspect({
      dataset: "icon-d2",
      geometry: { type: "point", latitude: 0, longitude: 0 },
      time: { at: "2026-09-12T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });

    expect(result.coverage).toBe("absent");
    expect(result.domainCovered).toBe(false);
    expect(result.issues.some((issue) => issue.path.join(".") === "geometry")).toBe(true);
    expect(resolver.calls).toHaveLength(0);
  });

  it("labels explicit runs as declared-window checks instead of live probes", async () => {
    const resolver = new FakeRunResolver(new Date("2026-09-12T18:00:00Z"));
    const result = await new AtmosphericAvailabilityService({ runResolver: resolver }).inspect({
      ...request(),
      forecast: { run: RUN.toISOString() },
    });

    expect(result.coverage).toBe("complete");
    expect(result.basis).toBe("declared_explicit_run");
  });

  it("keeps analysis archives outside forecast-initialization availability", async () => {
    const resolver = new FakeRunResolver(new Date("2026-09-12T18:00:00Z"));
    const result = await new AtmosphericAvailabilityService({ runResolver: resolver }).inspect({
      dataset: "gfs-analysis",
      geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
      time: { at: "2024-01-01T12:00:00Z" },
      selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    });

    expect(result.coverage).toBe("absent");
    expect(result.issues[0]?.reason).toContain("forecast datasets");
    expect(resolver.calls).toHaveLength(0);
  });
});