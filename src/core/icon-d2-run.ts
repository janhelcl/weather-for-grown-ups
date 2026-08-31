import type {
  IconD2AvailabilityProbe,
  IconD2AvailabilityRequirement,
} from "../cache/icon-d2-open-data-cache.js";
import {
  ICON_D2_MAX_FORECAST_HOUR,
  floorToIconD2Cycle,
  iconD2ForecastHour,
  iconD2NativeForecastHoursInRange,
  parseIconD2Run,
} from "../sources/icon-d2.js";

const CYCLE_MS = 3 * 60 * 60 * 1000;
const HOUR_MS = 3_600_000;

export const DEFAULT_ICON_D2_LATEST_RUN_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_ICON_D2_LATEST_RUN_LOOKBACK_CYCLES = 8;

export type IconD2RunRequirement =
  | {
      type: "valid_time";
      validTime: Date;
      products: IconD2AvailabilityRequirement;
    }
  | {
      type: "time_range";
      startTime: Date;
      endTime: Date;
      products: IconD2AvailabilityRequirement;
    };

export interface IconD2RunProvider {
  resolveLatestRun(requirement: IconD2RunRequirement): Promise<Date>;
  resolveLatestCompleteRun(products: IconD2AvailabilityRequirement): Promise<Date>;
}

export class IconD2RunResolver implements IconD2RunProvider {
  private readonly cache = new Map<string, { run: Date; expiresAt: number }>();

  constructor(
    private readonly probe: IconD2AvailabilityProbe,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEFAULT_ICON_D2_LATEST_RUN_TTL_MS,
    private readonly lookbackCycles = DEFAULT_ICON_D2_LATEST_RUN_LOOKBACK_CYCLES,
  ) {}

  async resolveLatestRun(requirement: IconD2RunRequirement): Promise<Date> {
    const key = `latest:${requirementKey(requirement)}`;
    const cached = this.cached(key);
    if (cached) return cached;

    const latestEligibleTime = requirement.type === "valid_time"
      ? requirement.validTime
      : requirement.startTime;
    const firstCandidate = earlierCycle(
      floorToIconD2Cycle(new Date(this.now())),
      floorToIconD2Cycle(latestEligibleTime),
    );

    if (requirement.type === "valid_time") {
      iconD2ForecastHour(firstCandidate, requirement.validTime);
    } else {
      if (requirement.endTime.getTime() < requirement.startTime.getTime()) {
        throw new Error("endTime must be at or after startTime");
      }
      if (
        requirement.endTime.getTime()
        > firstCandidate.getTime() + ICON_D2_MAX_FORECAST_HOUR * HOUR_MS
      ) {
        throw new Error("Requested time range extends beyond the 48-hour ICON-D2 horizon");
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
      `Could not find an ICON-D2 run satisfying the requested forecast in the last ${this.lookbackCycles} eligible cycles`,
    );
  }

  async resolveLatestCompleteRun(products: IconD2AvailabilityRequirement): Promise<Date> {
    const key = `complete:${products.pressure ? "p" : ""}${products.surface ? "s" : ""}`;
    const cached = this.cached(key);
    if (cached) return cached;

    const firstCandidate = floorToIconD2Cycle(new Date(this.now()));
    for (let offset = 0; offset < this.lookbackCycles; offset += 1) {
      const candidate = new Date(firstCandidate.getTime() - offset * CYCLE_MS);
      if (await this.probe.isForecastAvailable(
        candidate,
        ICON_D2_MAX_FORECAST_HOUR,
        products,
      )) {
        this.store(key, candidate);
        return candidate;
      }
    }
    throw new Error(
      `Could not find a complete ICON-D2 run in the last ${this.lookbackCycles} cycles`,
    );
  }

  private async satisfies(
    run: Date,
    requirement: IconD2RunRequirement,
  ): Promise<boolean> {
    if (requirement.type === "valid_time") {
      let forecastHour: number;
      try {
        forecastHour = iconD2ForecastHour(run, requirement.validTime);
      } catch (error) {
        if (error instanceof Error && error.message.includes("48")) return false;
        throw error;
      }
      return this.probe.isForecastAvailable(run, forecastHour, requirement.products);
    }

    if (
      requirement.endTime.getTime()
      > run.getTime() + ICON_D2_MAX_FORECAST_HOUR * HOUR_MS
    ) {
      return false;
    }
    let hours: number[];
    try {
      hours = iconD2NativeForecastHoursInRange(
        run,
        requirement.startTime,
        requirement.endTime,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("No native ICON-D2")) return false;
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

export function resolveIconD2Run(
  selector: "latest" | "latest_complete" | string,
  requirement: IconD2RunRequirement,
  provider: IconD2RunProvider,
): Promise<Date> | Date {
  if (selector === "latest") return provider.resolveLatestRun(requirement);
  if (selector === "latest_complete") {
    return provider.resolveLatestCompleteRun(requirement.products);
  }
  return parseIconD2Run(selector);
}

function earlierCycle(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime()
    ? new Date(left.getTime())
    : new Date(right.getTime());
}

function requirementKey(requirement: IconD2RunRequirement): string {
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
