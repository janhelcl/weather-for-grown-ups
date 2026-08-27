import {
  GfsS3RunProbe,
  type ForecastAvailabilitySelection,
  type RunAvailabilityProbe,
} from "../sources/gfs-s3.js";
import type { GfsGrid } from "../schema/gfs-grid.js";
import {
  forecastHour,
  nativeForecastHoursInRange,
} from "./forecast-hour.js";

const GFS_CYCLE_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_LATEST_RUN_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_LATEST_RUN_LOOKBACK_CYCLES = 8;

export type LatestRunRequirement =
  | {
      type: "valid_time";
      validTime: Date;
      selection: ForecastAvailabilitySelection;
    }
  | {
      type: "time_range";
      startTime: Date;
      endTime: Date;
      selection: ForecastAvailabilitySelection;
    };

export interface LatestRunProvider {
  resolveLatestRun(requirement?: LatestRunRequirement, grid?: GfsGrid): Promise<Date>;
}

export class LatestRunResolver implements LatestRunProvider {
  private readonly cache = new Map<string, { run: Date; expiresAt: number }>();

  constructor(
    private readonly probe: RunAvailabilityProbe = new GfsS3RunProbe(),
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEFAULT_LATEST_RUN_TTL_MS,
    private readonly lookbackCycles = DEFAULT_LATEST_RUN_LOOKBACK_CYCLES,
  ) {}

  async resolveLatestRun(requirement?: LatestRunRequirement, grid: GfsGrid = "0p25"): Promise<Date> {
    const nowMs = this.now();
    const cacheKey = `${grid}:${requirementKey(requirement)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > nowMs) {
      return new Date(cached.run.getTime());
    }

    const run = requirement === undefined
      ? await this.resolveLatestCompleteRun(nowMs, grid)
      : await this.resolveLatestAvailableRun(nowMs, requirement, grid);

    this.cache.set(cacheKey, { run, expiresAt: nowMs + this.ttlMs });
    return new Date(run.getTime());
  }

  private async resolveLatestCompleteRun(nowMs: number, grid: GfsGrid): Promise<Date> {
    const firstCandidate = floorToGfsCycle(new Date(nowMs));
    for (let offset = 0; offset < this.lookbackCycles; offset += 1) {
      const candidate = new Date(firstCandidate.getTime() - offset * GFS_CYCLE_MS);
      const complete = grid === "0p50"
        ? await this.probe.isRunComplete(candidate, grid)
        : await this.probe.isRunComplete(candidate);
      if (complete) return candidate;
    }

    throw new Error(`Could not find a complete GFS run in the last ${this.lookbackCycles} cycles`);
  }

  private async resolveLatestAvailableRun(
    nowMs: number,
    requirement: LatestRunRequirement,
    grid: GfsGrid,
  ): Promise<Date> {
    const latestEligibleTime = requirement.type === "valid_time"
      ? requirement.validTime
      : requirement.startTime;
    const firstCandidate = earlierCycle(
      floorToGfsCycle(new Date(nowMs)),
      floorToGfsCycle(latestEligibleTime),
    );

    if (requirement.type === "valid_time") {
      // All GFS cycles differ by six hours, so native-cadence validity is invariant
      // while walking backward. Fail early with the normal forecast-hour error.
      forecastHour(firstCandidate, requirement.validTime, grid);
    } else {
      if (requirement.endTime.getTime() < requirement.startTime.getTime()) {
        throw new Error("endTime must be at or after startTime");
      }
      const newestHorizonEnd = firstCandidate.getTime() + 384 * 3_600_000;
      if (requirement.endTime.getTime() > newestHorizonEnd) {
        throw new Error("Requested time range extends beyond the 384-hour GFS horizon");
      }
    }

    for (let offset = 0; offset < this.lookbackCycles; offset += 1) {
      const candidate = new Date(firstCandidate.getTime() - offset * GFS_CYCLE_MS);
      const available = requirement.type === "valid_time"
        ? await this.isValidTimeAvailable(candidate, requirement, grid)
        : await this.isTimeRangeAvailable(candidate, requirement, grid);
      if (available) return candidate;
    }

    throw new Error(
      `Could not find a GFS run satisfying the requested forecast in the last ${this.lookbackCycles} eligible cycles`,
    );
  }

  private async isValidTimeAvailable(
    candidate: Date,
    requirement: Extract<LatestRunRequirement, { type: "valid_time" }>,
    grid: GfsGrid,
  ): Promise<boolean> {
    let fh: number;
    try {
      fh = forecastHour(candidate, requirement.validTime, grid);
    } catch (error) {
      if (error instanceof Error && error.message.includes("<= 384")) return false;
      throw error;
    }
    return grid === "0p50"
      ? this.probe.isForecastAvailable(candidate, fh, requirement.selection, grid)
      : this.probe.isForecastAvailable(candidate, fh, requirement.selection);
  }

  private async isTimeRangeAvailable(
    candidate: Date,
    requirement: Extract<LatestRunRequirement, { type: "time_range" }>,
    grid: GfsGrid,
  ): Promise<boolean> {
    if (requirement.endTime.getTime() > candidate.getTime() + 384 * 3_600_000) return false;

    let forecastHours: number[];
    try {
      forecastHours = nativeForecastHoursInRange(candidate, requirement.startTime, requirement.endTime, grid);
    } catch (error) {
      if (error instanceof Error && error.message.includes("No native GFS forecast outputs")) return false;
      throw error;
    }

    const first = forecastHours[0];
    const last = forecastHours.at(-1);
    if (first === undefined || last === undefined) return false;

    const firstAvailable = grid === "0p50"
      ? await this.probe.isForecastAvailable(candidate, first, requirement.selection, grid)
      : await this.probe.isForecastAvailable(candidate, first, requirement.selection);
    if (!firstAvailable) return false;
    if (last !== first) {
      const lastAvailable = grid === "0p50"
        ? await this.probe.isForecastAvailable(candidate, last, requirement.selection, grid)
        : await this.probe.isForecastAvailable(candidate, last, requirement.selection);
      if (!lastAvailable) return false;
    }
    return true;
  }
}

export function floorToGfsCycle(value: Date): Date {
  const result = new Date(value.getTime());
  const hour = Math.floor(result.getUTCHours() / 6) * 6;
  result.setUTCHours(hour, 0, 0, 0);
  return result;
}

function earlierCycle(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime()
    ? new Date(left.getTime())
    : new Date(right.getTime());
}

function requirementKey(requirement: LatestRunRequirement | undefined): string {
  if (requirement === undefined) return "complete";
  const selection = {
    variableCodes: [...new Set(requirement.selection.variableCodes)].sort(),
    pressureLevelsHpa: [...new Set(requirement.selection.pressureLevelsHpa)].sort((a, b) => b - a),
    fields: [...new Set(requirement.selection.fields.map((field) => field.id))].sort(),
  };
  return JSON.stringify(requirement.type === "valid_time"
    ? { type: requirement.type, validTime: requirement.validTime.toISOString(), selection }
    : {
        type: requirement.type,
        startTime: requirement.startTime.toISOString(),
        endTime: requirement.endTime.toISOString(),
        selection,
      });
}


export function resolveLatestRunForGrid(
  provider: LatestRunProvider,
  requirement: LatestRunRequirement,
  grid?: GfsGrid,
): Promise<Date> {
  return grid === "0p50"
    ? provider.resolveLatestRun(requirement, grid)
    : provider.resolveLatestRun(requirement);
}

export function resolveLatestCompleteRunForGrid(
  provider: LatestRunProvider,
  grid?: GfsGrid,
): Promise<Date> {
  return grid === "0p50"
    ? provider.resolveLatestRun(undefined, grid)
    : provider.resolveLatestRun();
}
