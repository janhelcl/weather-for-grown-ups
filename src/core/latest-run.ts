import { GfsS3RunProbe, type RunAvailabilityProbe } from "../sources/gfs-s3.js";

const GFS_CYCLE_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_LATEST_RUN_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_LATEST_RUN_LOOKBACK_CYCLES = 8;

export interface LatestRunProvider {
  resolveLatestRun(): Promise<Date>;
}

export class LatestRunResolver implements LatestRunProvider {
  private cached: { run: Date; expiresAt: number } | undefined;

  constructor(
    private readonly probe: RunAvailabilityProbe = new GfsS3RunProbe(),
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEFAULT_LATEST_RUN_TTL_MS,
    private readonly lookbackCycles = DEFAULT_LATEST_RUN_LOOKBACK_CYCLES,
  ) {}

  async resolveLatestRun(): Promise<Date> {
    const nowMs = this.now();
    if (this.cached && this.cached.expiresAt > nowMs) {
      return new Date(this.cached.run.getTime());
    }

    const firstCandidate = floorToGfsCycle(new Date(nowMs));
    for (let offset = 0; offset < this.lookbackCycles; offset += 1) {
      const candidate = new Date(firstCandidate.getTime() - offset * GFS_CYCLE_MS);
      if (await this.probe.isRunComplete(candidate)) {
        this.cached = { run: candidate, expiresAt: nowMs + this.ttlMs };
        return new Date(candidate.getTime());
      }
    }

    throw new Error(`Could not find a complete GFS run in the last ${this.lookbackCycles} cycles`);
  }
}

export function floorToGfsCycle(value: Date): Date {
  const result = new Date(value.getTime());
  const hour = Math.floor(result.getUTCHours() / 6) * 6;
  result.setUTCHours(hour, 0, 0, 0);
  return result;
}
