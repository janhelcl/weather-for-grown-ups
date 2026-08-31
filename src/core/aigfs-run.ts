import type {
  AigfsAvailabilityProbe,
  AigfsAvailabilityRequirement,
} from "../cache/aigfs-nomads-subset-cache.js";
import {
  AIGFS_MAX_FORECAST_HOUR,
  aigfsForecastHour,
  aigfsNativeForecastHoursInRange,
  floorToAigfsCycle,
  parseAigfsRun,
} from "../sources/aigfs.js";

const CYCLE_MS = 6 * 60 * 60 * 1000;
const HOUR_MS = 3_600_000;

export const DEFAULT_AIGFS_LATEST_RUN_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_AIGFS_LATEST_RUN_LOOKBACK_CYCLES = 8;

export type AigfsRunRequirement =
  | {
      type: "valid_time";
      validTime: Date;
      products: AigfsAvailabilityRequirement;
    }
  | {
      type: "time_range";
      startTime: Date;
      endTime: Date;
      products: AigfsAvailabilityRequirement;
    };

export interface AigfsRunProvider {
  resolveLatestRun(requirement: AigfsRunRequirement): Promise<Date>;
  resolveLatestCompleteRun(products: AigfsAvailabilityRequirement): Promise<Date>;
}

export class AigfsRunResolver implements AigfsRunProvider {
  private readonly cache = new Map<string, { run: Date; expiresAt: number }>();

  constructor(
    private readonly probe: AigfsAvailabilityProbe,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEFAULT_AIGFS_LATEST_RUN_TTL_MS,
    private readonly lookbackCycles = DEFAULT_AIGFS_LATEST_RUN_LOOKBACK_CYCLES,
  ) {}

  async resolveLatestRun(requirement: AigfsRunRequirement): Promise<Date> {
    const key = `latest:${requirementKey(requirement)}`;
    const cached = this.cached(key);
    if (cached) return cached;

    const nowMs = this.now();
    const latestEligibleTime = requirement.type === "valid_time"
      ? requirement.validTime
      : requirement.startTime;
    const firstCandidate = earlierCycle(
      floorToAigfsCycle(new Date(nowMs)),
      floorToAigfsCycle(latestEligibleTime),
    );

    if (requirement.type === "valid_time") {
      aigfsForecastHour(firstCandidate, requirement.validTime);
    } else {
      if (requirement.endTime.getTime() < requirement.startTime.getTime()) {
        throw new Error("endTime must be at or after startTime");
      }
      if (requirement.endTime.getTime() > firstCandidate.getTime() + AIGFS_MAX_FORECAST_HOUR * HOUR_MS) {
        throw new Error("Requested time range extends beyond the 384-hour AIGFS horizon");
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
      `Could not find an AIGFS run satisfying the requested forecast in the last ${this.lookbackCycles} eligible cycles`,
    );
  }

  async resolveLatestCompleteRun(products: AigfsAvailabilityRequirement): Promise<Date> {
    const key = `complete:${products.pressure ? "p" : ""}${products.surface ? "s" : ""}`;
    const cached = this.cached(key);
    if (cached) return cached;

    const firstCandidate = floorToAigfsCycle(new Date(this.now()));
    for (let offset = 0; offset < this.lookbackCycles; offset += 1) {
      const candidate = new Date(firstCandidate.getTime() - offset * CYCLE_MS);
      if (await this.probe.isForecastAvailable(candidate, AIGFS_MAX_FORECAST_HOUR, products)) {
        this.store(key, candidate);
        return candidate;
      }
    }
    throw new Error(
      `Could not find a complete AIGFS run in the last ${this.lookbackCycles} cycles`,
    );
  }

  private async satisfies(run: Date, requirement: AigfsRunRequirement): Promise<boolean> {
    if (requirement.type === "valid_time") {
      let forecastHour: number;
      try {
        forecastHour = aigfsForecastHour(run, requirement.validTime);
      } catch (error) {
        if (error instanceof Error && error.message.includes("384")) return false;
        throw error;
      }
      return this.probe.isForecastAvailable(run, forecastHour, requirement.products);
    }

    if (requirement.endTime.getTime() > run.getTime() + AIGFS_MAX_FORECAST_HOUR * HOUR_MS) {
      return false;
    }
    let hours: number[];
    try {
      hours = aigfsNativeForecastHoursInRange(run, requirement.startTime, requirement.endTime);
    } catch (error) {
      if (error instanceof Error && error.message.includes("No native AIGFS")) return false;
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

export function resolveAigfsRun(
  selector: "latest" | "latest_complete" | string,
  requirement: AigfsRunRequirement,
  provider: AigfsRunProvider,
): Promise<Date> | Date {
  if (selector === "latest") return provider.resolveLatestRun(requirement);
  if (selector === "latest_complete") return provider.resolveLatestCompleteRun(requirement.products);
  return parseAigfsRun(selector);
}

function earlierCycle(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime()
    ? new Date(left.getTime())
    : new Date(right.getTime());
}

function requirementKey(requirement: AigfsRunRequirement): string {
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
