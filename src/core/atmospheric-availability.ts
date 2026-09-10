import { inspectAtmosphereCapabilities } from "../catalog/capability-inspection.js";
import {
  publicDatasetCapabilities,
  publicDatasetCoversGeometry,
  publicDatasetMetadata,
  type QueryAtmosphereRequest,
} from "../schema/unified-api.js";
import {
  normalizeQueryAtmosphereInput,
  type PublicQueryAtmosphereInput,
} from "../schema/unified-query-input.js";
import {
  atmosphereAvailabilityResultSchema,
  type AtmosphereAvailabilityResult,
} from "../schema/availability-inspection.js";
import { DefaultAtmosphericAvailabilityRunResolver } from "./availability-run-resolver.js";

export interface AtmosphericAvailabilityRunResolver {
  resolve(request: QueryAtmosphereRequest): Promise<Date>;
  nativeValidTimes(
    request: QueryAtmosphereRequest,
    run: Date,
    from: Date,
    to: Date,
  ): Date[];
}

export interface AtmosphericAvailabilityServiceOptions {
  runResolver?: AtmosphericAvailabilityRunResolver;
}

export class AtmosphericAvailabilityService {
  private readonly runResolver: AtmosphericAvailabilityRunResolver;

  constructor(options: AtmosphericAvailabilityServiceOptions = {}) {
    this.runResolver = options.runResolver ?? new DefaultAtmosphericAvailabilityRunResolver();
  }

  async inspect(input: PublicQueryAtmosphereInput): Promise<AtmosphereAvailabilityResult> {
    const request = normalizeQueryAtmosphereInput(input);
    const capabilities = publicDatasetCapabilities(request.dataset, request.forecast?.kind);
    const domainCovered = publicDatasetCoversGeometry(request.dataset, request.geometry);
    const capability = inspectAtmosphereCapabilities({
      dataset: request.dataset,
      geometry: request.geometry,
      time: request.time,
      selection: request.selection,
      ...(request.forecast === undefined ? {} : { forecast: request.forecast }),
      ...(request.ensemble === undefined ? {} : { ensemble: request.ensemble }),
      ...(request.source === undefined ? {} : { source: request.source }),
    });
    const basis = isExplicitRun(request) ? "declared_explicit_run" as const : "live_product_probe" as const;
    const base = {
      basis,
      dataset: request.dataset,
      geometry: request.geometry,
      requestedTime: request.time,
      domainCovered,
      nativeCadenceHours: capabilities.nativeTimeCadenceHours,
      ...(capabilities.maxForecastHour === undefined ? {} : { maxForecastHour: capabilities.maxForecastHour }),
    };

    if (publicDatasetMetadata(request.dataset).role !== "forecast") {
      return atmosphereAvailabilityResultSchema.parse({
        ...base,
        coverage: "absent",
        issues: [{
          path: ["dataset"],
          reason: "Requested-window initialization availability applies to forecast datasets; analysis archives have no forecast initialization.",
        }],
      });
    }

    if (!domainCovered || !capability.supported) {
      return atmosphereAvailabilityResultSchema.parse({
        ...base,
        coverage: "absent",
        issues: capability.unsupported.length > 0
          ? capability.unsupported
          : [{ path: ["geometry"], reason: "Requested geometry is outside the dataset domain." }],
      });
    }

    const full = await attempt(() => this.runResolver.resolve(request));
    if (full.ok) {
      const range = requestedNativeRange(this.runResolver, request, full.run);
      return atmosphereAvailabilityResultSchema.parse({
        ...base,
        coverage: "complete",
        initialization: full.run.toISOString(),
        ...(range === undefined ? {} : { availableRequestedTime: range }),
        issues: [],
      });
    }

    if ("at" in request.time) {
      return atmosphereAvailabilityResultSchema.parse({
        ...base,
        coverage: "absent",
        issues: [{ path: ["time"], reason: failureMessage(full.error) }],
      });
    }

    const from = new Date(request.time.from);
    const to = new Date(request.time.to);
    const seed = await this.resolveShortestPrefix(request, from, to, capabilities.nativeTimeCadenceHours);
    if (seed === undefined) {
      return atmosphereAvailabilityResultSchema.parse({
        ...base,
        coverage: "absent",
        issues: [{ path: ["time"], reason: failureMessage(full.error) }],
      });
    }

    let nativeTimes: Date[];
    try {
      nativeTimes = this.runResolver.nativeValidTimes(request, seed.run, from, to);
    } catch {
      nativeTimes = [];
    }
    if (nativeTimes.length === 0) {
      return atmosphereAvailabilityResultSchema.parse({
        ...base,
        coverage: "absent",
        issues: [{ path: ["time"], reason: failureMessage(full.error) }],
      });
    }

    const longest = await this.longestAvailablePrefix(request, nativeTimes);
    if (longest === undefined) {
      return atmosphereAvailabilityResultSchema.parse({
        ...base,
        coverage: "absent",
        issues: [{ path: ["time"], reason: failureMessage(full.error) }],
      });
    }

    const first = nativeTimes[0]!;
    return atmosphereAvailabilityResultSchema.parse({
      ...base,
      coverage: "partial",
      initialization: longest.run.toISOString(),
      availableRequestedTime: {
        from: first.toISOString(),
        to: longest.end.toISOString(),
      },
      issues: [{
        path: ["time"],
        reason: `The requested window is only partially available; published coverage reaches ${longest.end.toISOString()} for initialization ${longest.run.toISOString()}.`,
      }],
    });
  }

  private async resolveShortestPrefix(
    request: QueryAtmosphereRequest,
    from: Date,
    to: Date,
    cadenceHours: readonly number[],
  ): Promise<{ run: Date; end: Date } | undefined> {
    const stepHours = Math.max(1, Math.min(...cadenceHours));
    const maxAttempts = Math.min(8, Math.ceil((to.getTime() - from.getTime()) / (stepHours * HOUR_MS)) + 1);
    for (let index = 0; index < maxAttempts; index += 1) {
      const end = new Date(Math.min(to.getTime(), from.getTime() + index * stepHours * HOUR_MS));
      const result = await attempt(() => this.runResolver.resolve(withRangeEnd(request, end)));
      if (result.ok) return { run: result.run, end };
    }
    return undefined;
  }

  private async longestAvailablePrefix(
    request: QueryAtmosphereRequest,
    nativeTimes: readonly Date[],
  ): Promise<{ run: Date; end: Date } | undefined> {
    let low = 0;
    let high = nativeTimes.length - 1;
    let best: { run: Date; end: Date } | undefined;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const end = nativeTimes[middle]!;
      const result = await attempt(() => this.runResolver.resolve(withRangeEnd(request, end)));
      if (result.ok) {
        best = { run: result.run, end };
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return best;
  }
}

const HOUR_MS = 3_600_000;

function withRangeEnd(request: QueryAtmosphereRequest, end: Date): QueryAtmosphereRequest {
  if (!("from" in request.time)) throw new Error("Internal availability routing error: expected a time range");
  return {
    ...request,
    time: {
      ...request.time,
      to: end.toISOString(),
    },
  };
}

function requestedNativeRange(
  resolver: AtmosphericAvailabilityRunResolver,
  request: QueryAtmosphereRequest,
  run: Date,
): { from: string; to: string } | undefined {
  if ("at" in request.time) {
    const at = new Date(request.time.at).toISOString();
    return { from: at, to: at };
  }
  const times = resolver.nativeValidTimes(
    request,
    run,
    new Date(request.time.from),
    new Date(request.time.to),
  );
  const first = times[0];
  const last = times.at(-1);
  return first === undefined || last === undefined
    ? undefined
    : { from: first.toISOString(), to: last.toISOString() };
}

function isExplicitRun(request: QueryAtmosphereRequest): boolean {
  const selector = request.forecast?.run;
  return selector !== undefined && selector !== "latest" && selector !== "latest_complete";
}

async function attempt(action: () => Promise<Date>): Promise<
  { ok: true; run: Date } | { ok: false; error: unknown }
> {
  try {
    return { ok: true, run: await action() };
  } catch (error) {
    return { ok: false, error };
  }
}

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "No published initialization can serve the requested valid-time window.";
}
