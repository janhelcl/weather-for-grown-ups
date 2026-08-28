import {
  DEFAULT_ACCESS_POLICY_STALE_LOCK_MS,
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
} from "./file-access-policy.js";

export const DEFAULT_NOMADS_COOLDOWN_MS = UPSTREAM_ACCESS_POLICIES.nomads.minIntervalMs;
export const DEFAULT_STALE_LOCK_MS = DEFAULT_ACCESS_POLICY_STALE_LOCK_MS;

export class FileRateLimiter {
  private readonly delegate: FileAccessPolicy;

  constructor(
    rootDir: string,
    cooldownMs: number = DEFAULT_NOMADS_COOLDOWN_MS,
    staleLockMs: number = DEFAULT_STALE_LOCK_MS,
  ) {
    this.delegate = new FileAccessPolicy(rootDir, {
      ...UPSTREAM_ACCESS_POLICIES.nomads,
      minIntervalMs: cooldownMs,
      staleLockMs,
    });
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    return this.delegate.run(operation);
  }
}
