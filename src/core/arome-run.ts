import type {
  AromeAvailabilityProbe,
  AromeAvailabilityRequirement,
} from "../cache/arome-open-data-cache.js";
import {
  AROME_0P01_MAX_FORECAST_HOUR,
  aromeForecastHour,
  aromeNativeForecastHoursInRange,
  floorToAromeCycle,
  parseAromeRun,
} from "../sources/arome.js";

const CYCLE_MS = 3 * 60 * 60 * 1000;
const HOUR_MS = 3_600_000;

export const DEFAULT_AROME_LATEST_RUN_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_AROME_LATEST_RUN_LOOKBACK_CYCLES = 12;

export type AromeRunRequirement =
  | {
      type: "valid_time";
      validTime: Date;
      products: AromeAvailabilityRequirement;
    }
  | {
      type: "time_range";
      startTime: Date;
      endTime: Date;
      products: AromeAvailabilityRequirement;
    };

export interface AromeRunProvider {
  resolveLatestRun(requirement: AromeRunRequirement): Promise<Date>;
  resolveLatestCompleteRun(products: AromeAvailabilityRequirement): Promise<Date>;
}

export class AromeRunResolver implements AromeRunProvider {
  private readonly cache = new Map<string, { run: Date; expiresAt: number }>();

  constructor(
    private readonly probe: AromeAvailabilityProbe,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEFAULT_AROME_LATEST_RUN_TTL_MS,
    private readonly lookbackCycles = DEFAULT_AROME_LATEST_RUN_LOOKBACK_CYCLES,
  ) {}

  async resolveLatestRun(requirement: AromeRunRequirement): Promise<Date> {
    const key = `latest:${requirementKey(requirement)}`;
    const cached = this.cached(key);
    if (cached) return cached;

    const latestEligibleTime = requirement.type === "valid_time"
      ? requirement.validTime
      : requirement.startTime;
    const firstCandidate = earlierCycle(
      floorToAromeCycle(new Date(this.now())),
      floorToAromeCycle(latestEligibleTime),
    );

    if (requirement.type === "valid_time") {
      aromeForecastHour(firstCandidate, requirement.validTime);
    } else {
      if (requirement.endTime.getTime() < requirement.startTime.getTime()) {
        throw new Error("endTime must be at or after startTime");
      }
      if (
        requirement.endTime.getTime()
        > firstCandidate.getTime() + AROME_0P01_MAX_FORECAST_HOUR * HOUR_MS
      ) {
        throw new Error("Requested time range extends beyond the 51-hour AROME horizon");
      }
    }

    for (let offset = 0; offset < this.lookbackCycles; offset += 1) {
      const candidate = new Date(firstCandidate.getTime() - offset * CYCLE_MS);
      if (await this.satisfies(candidate, requirement)) {
        this.store(key, candidate);
        return candidate;
      }
    }
    throw new Error(
      `Could not find an AROME run satisfying the requested forecast in the last ${this.lookbackCycles} eligible cycles`,
    );
  }

  async resolveLatestCompleteRun(products: AromeAvailabilityRequirement): Promise<Date> {
    const key = `complete:${products.sp1 ? "s" : ""}${products.hp1 ? "h" : ""}`;
    const cached = this.cached(key);
    if (cached) return cached;

    const firstCandidate = floorToAromeCycle(new Date(this.now()));
    for (let offset = 0; offset < this.lookbackCycles; offset += 1) {
      const candidate = new Date(firstCandidate.getTime() - offset * CYCLE_MS);
      if (await this.probe.isForecastAvailable(
        candidate,
        AROME_0P01_MAX_FORECAST_HOUR,
        products,
      )) {
        this.store(key, candidate);
        return candidate;
      }
    }
    throw new Error(
      `Could not find a complete AROME run in the last ${this.lookbackCycles} cycles`,
    );
  }

  private async satisfies(
    run: Date,
    requirement: AromeRunRequirement,
  ): Promise<boolean> {
    if (requirement.type === "valid_time") {
      let forecastHour: number;
      try {
        forecastHour = aromeForecastHour(run, requirement.validTime);
      } catch (error) {
        if (error instanceof Error && error.message.includes("51")) return false;
        throw error;
      }
      return this.probe.isForecastAvailable(run, forecastHour, requirement.products);
    }

    if (
      requirement.endTime.getTime()
      > run.getTime() + AROME_0P01_MAX_FORECAST_HOUR * HOUR_MS
    ) {
      return false;
    }
    let hours: number[];
    try {
      hours = aromeNativeForecastHoursInRange(
        run,
        requirement.startTime,
        requirement.endTime,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("No native AROME")) return false;
      throw error;
    }
    const first = hours[0];
    const last = hours.at(-1);
    if (first === undefined || last === undefined) return false;
    if (!(await this.probe.isForecastAvailable(run, first, requirement.products))) return false;
    return last === first
      ? true
      : this.probe.isForecastAvailable(run, last, requirement.products);
  }

  private cached(key: string): Date | undefined {
    const value = this.cache.get(key);
    if (value === undefined || value.expiresAt <= this.now()) return undefined;
    return new Date(value.run.getTime());
  }

  private store(key: string, run: Date): void {
    this.cache.set(key, {
      run: new Date(run.getTime()),
      expiresAt: this.now() + this.ttlMs,
    });
  }
}

export function resolveAromeRun(
  selector: "latest" | "latest_complete" | string,
  requirement: AromeRunRequirement,
  provider: AromeRunProvider,
): Promise<Date> | Date {
  if (selector === "latest") return provider.resolveLatestRun(requirement);
  if (selector === "latest_complete") {
    return provider.resolveLatestCompleteRun(requirement.products);
  }
  return parseAromeRun(selector);
}

function earlierCycle(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime()
    ? new Date(left.getTime())
    : new Date(right.getTime());
}

function requirementKey(requirement: AromeRunRequirement): string {
  return JSON.stringify(requirement.type === "valid_time"
    ? {
        type: requirement.type,
        validTime: requirement.validTime.toISOString(),
        products: requirement.products,
      }
    : {
        type: requirement.type,
        startTime: requirement.startTime.toISOString(),
        endTime: requirement.endTime.toISOString(),
        products: requirement.products,
      });
}
