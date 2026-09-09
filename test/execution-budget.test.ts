import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPOSED_EXECUTION_BUDGET,
  composedFanOut,
  nestedConcurrency,
} from "../src/core/execution-budget.js";
import { DEFAULT_AIFS_STEP_CONCURRENCY } from "../src/core/aifs.js";
import { DEFAULT_AIFS_ENS_MEMBER_CONCURRENCY } from "../src/core/aifs-ens.js";
import { DEFAULT_AIGEFS_MEMBER_CONCURRENCY } from "../src/core/aigefs.js";
import { DEFAULT_AIGFS_STEP_CONCURRENCY } from "../src/core/aigfs.js";
import { DEFAULT_GEFS_MEMBER_CONCURRENCY } from "../src/core/gefs-ensemble.js";
import { DEFAULT_GEFS_TIME_STEP_CONCURRENCY } from "../src/core/gefs-ensemble-timeseries.js";
import { DEFAULT_IFS_ENS_MEMBER_CONCURRENCY } from "../src/core/ifs-ens-member-bundle.js";
import { DEFAULT_IFS_ENS_TIME_STEP_CONCURRENCY } from "../src/core/ifs-ens-timeseries.js";

describe("composed execution budget", () => {
  it("allocates child concurrency from the remaining multiplicative fan-out", () => {
    expect(nestedConcurrency(8, 8)).toBe(4);
    expect(nestedConcurrency(4, 8)).toBe(8);
    expect(nestedConcurrency(2, 4)).toBe(4);
  });

  it("keeps aggressive ensemble range defaults inside the WFG budget", () => {
    expect(composedFanOut(
      DEFAULT_AIFS_ENS_MEMBER_CONCURRENCY,
      nestedConcurrency(DEFAULT_AIFS_ENS_MEMBER_CONCURRENCY, DEFAULT_AIFS_STEP_CONCURRENCY),
    )).toBeLessThanOrEqual(DEFAULT_COMPOSED_EXECUTION_BUDGET);
    expect(composedFanOut(
      DEFAULT_AIGEFS_MEMBER_CONCURRENCY,
      nestedConcurrency(DEFAULT_AIGEFS_MEMBER_CONCURRENCY, DEFAULT_AIGFS_STEP_CONCURRENCY),
    )).toBeLessThanOrEqual(DEFAULT_COMPOSED_EXECUTION_BUDGET);
    expect(composedFanOut(
      DEFAULT_GEFS_TIME_STEP_CONCURRENCY,
      nestedConcurrency(DEFAULT_GEFS_TIME_STEP_CONCURRENCY, DEFAULT_GEFS_MEMBER_CONCURRENCY),
    )).toBeLessThanOrEqual(DEFAULT_COMPOSED_EXECUTION_BUDGET);
    expect(composedFanOut(
      DEFAULT_IFS_ENS_TIME_STEP_CONCURRENCY,
      nestedConcurrency(DEFAULT_IFS_ENS_TIME_STEP_CONCURRENCY, DEFAULT_IFS_ENS_MEMBER_CONCURRENCY),
    )).toBeLessThanOrEqual(DEFAULT_COMPOSED_EXECUTION_BUDGET);
  });

  it("rejects an already-oversubscribed parent", () => {
    expect(() => nestedConcurrency(DEFAULT_COMPOSED_EXECUTION_BUDGET + 1, 1)).toThrow(/exceeds/);
  });
});
