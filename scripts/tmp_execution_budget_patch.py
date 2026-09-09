from pathlib import Path


def replace(path: str, old: str, new: str, label: str, count: int | None = None) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found [{label}] in {path}")
    if count is None:
        text = text.replace(old, new)
    else:
        text = text.replace(old, new, count)
    p.write_text(text)


Path("src/core/execution-budget.ts").write_text('''/**
 * Maximum multiplicative fan-out that WFG-owned nested orchestration should create
 * for one composed operation. This is deliberately NOT an upstream/network limit:
 * provider access policies remain authoritative and may be much stricter.
 */
export const DEFAULT_COMPOSED_EXECUTION_BUDGET = 32;

export function nestedConcurrency(
  parentConcurrency: number,
  preferredChildConcurrency: number,
  budget = DEFAULT_COMPOSED_EXECUTION_BUDGET,
): number {
  assertPositiveInteger(parentConcurrency, "parentConcurrency");
  assertPositiveInteger(preferredChildConcurrency, "preferredChildConcurrency");
  assertPositiveInteger(budget, "budget");
  if (parentConcurrency > budget) {
    throw new Error(
      `Parent concurrency ${parentConcurrency} exceeds composed execution budget ${budget}`,
    );
  }
  return Math.max(
    1,
    Math.min(preferredChildConcurrency, Math.floor(budget / parentConcurrency)),
  );
}

export function composedFanOut(...concurrencies: readonly number[]): number {
  return concurrencies.reduce((product, value) => {
    assertPositiveInteger(value, "concurrency");
    return product * value;
  }, 1);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
}
''')

# Tune standalone deterministic time fan-out to provider-capable levels. Provider access
# policies remain the actual network ceilings, so direct ECMWF/NOMADS etiquette is unchanged.
replace("src/core/time-series.ts", "export const DEFAULT_TIME_SERIES_CONCURRENCY = 4;", "export const DEFAULT_TIME_SERIES_CONCURRENCY = 8;", "GFS time")
replace("src/core/points-time-series.ts", "export const DEFAULT_POINTS_TIME_SERIES_CONCURRENCY = 4;", "export const DEFAULT_POINTS_TIME_SERIES_CONCURRENCY = 8;", "GFS points time")
replace("src/core/ifs-spatiotemporal.ts", "export const DEFAULT_IFS_TIME_CONCURRENCY = 3;", "export const DEFAULT_IFS_TIME_CONCURRENCY = 8;", "IFS time")
replace("src/core/aifs.ts", "const DEFAULT_AIFS_STEP_CONCURRENCY = 4;", "export const DEFAULT_AIFS_STEP_CONCURRENCY = 8;", "AIFS time")

# Ensemble/member defaults: use available upstream parallelism; stricter provider policies
# still queue/pace actual HTTP attempts below this layer.
replace("src/core/gefs-ensemble.ts", "export const DEFAULT_GEFS_MEMBER_CONCURRENCY = 6;", "export const DEFAULT_GEFS_MEMBER_CONCURRENCY = 8;", "GEFS members")
replace("src/core/gefs-ensemble-timeseries.ts", "export const DEFAULT_GEFS_TIME_STEP_CONCURRENCY = 2;", "export const DEFAULT_GEFS_TIME_STEP_CONCURRENCY = 4;", "GEFS time")
replace("src/core/ifs-ens-member-bundle.ts", "export const DEFAULT_IFS_ENS_MEMBER_CONCURRENCY = 4;", "export const DEFAULT_IFS_ENS_MEMBER_CONCURRENCY = 8;", "IFS ENS members")
replace("src/core/ifs-ens-timeseries.ts", "export const DEFAULT_IFS_ENS_TIME_STEP_CONCURRENCY = 2;", "export const DEFAULT_IFS_ENS_TIME_STEP_CONCURRENCY = 4;", "IFS ENS time")
replace("src/core/aifs-ens.ts", "const DEFAULT_AIFS_ENS_MEMBER_CONCURRENCY = 4;", "export const DEFAULT_AIFS_ENS_MEMBER_CONCURRENCY = 8;", "AIFS ENS members")
replace("src/core/aigefs.ts", "const DEFAULT_AIGEFS_MEMBER_CONCURRENCY = 4;", "export const DEFAULT_AIGEFS_MEMBER_CONCURRENCY = 8;", "AIGEFS members")
# DWD and Meteo-France wrappers intentionally stay at their provider-shaped 4 and 2 defaults.

# GFS points x time: preserve aggressive time fan-out but derive child point fan-out so the
# product cannot silently exceed the WFG composition budget.
replace(
    "src/core/points-time-series.ts",
    'import { BatchPointsService } from "./batch-points.js";',
    'import { BatchPointsService, DEFAULT_BATCH_POINT_CONCURRENCY } from "./batch-points.js";\nimport { nestedConcurrency } from "./execution-budget.js";',
    "GFS nested imports",
)
replace(
    "src/core/points-time-series.ts",
    '''    this.latestRunProvider = options.latestRunProvider ?? new LatestRunResolver();
    this.batchPointsGetter = options.batchPointsGetter ?? new BatchPointsService({
      latestRunProvider: this.latestRunProvider,
    });
    this.concurrency = options.concurrency ?? DEFAULT_POINTS_TIME_SERIES_CONCURRENCY;''',
    '''    this.latestRunProvider = options.latestRunProvider ?? new LatestRunResolver();
    this.concurrency = options.concurrency ?? DEFAULT_POINTS_TIME_SERIES_CONCURRENCY;
    this.batchPointsGetter = options.batchPointsGetter ?? new BatchPointsService({
      latestRunProvider: this.latestRunProvider,
      concurrency: nestedConcurrency(this.concurrency, DEFAULT_BATCH_POINT_CONCURRENCY),
    });''',
    "GFS child point budget",
)

# IFS points x time: same algebraic budget. Standalone point batches remain at their preferred
# concurrency, while composed point batches get the remaining share.
replace(
    "src/core/ifs-spatiotemporal.ts",
    'import { mapConcurrent } from "./concurrency.js";',
    'import { mapConcurrent } from "./concurrency.js";\nimport { nestedConcurrency } from "./execution-budget.js";',
    "IFS nested import",
)
replace(
    "src/core/ifs-spatiotemporal.ts",
    '''  constructor(options: IfsSpatiotemporalOptions = {}) {
    const resolver = new IfsLatestRunResolver();
    this.pointsService = new IfsPointsService(options);
    this.latestRangeRunProvider = options.latestRangeRunProvider ?? resolver;
    this.concurrency = options.timeConcurrency ?? DEFAULT_IFS_TIME_CONCURRENCY;
  }''',
    '''  constructor(options: IfsSpatiotemporalOptions = {}) {
    const resolver = new IfsLatestRunResolver();
    this.concurrency = options.timeConcurrency ?? DEFAULT_IFS_TIME_CONCURRENCY;
    this.pointsService = new IfsPointsService({
      ...options,
      pointConcurrency: nestedConcurrency(
        this.concurrency,
        options.pointConcurrency ?? DEFAULT_IFS_POINT_CONCURRENCY,
      ),
    });
    this.latestRangeRunProvider = options.latestRangeRunProvider ?? resolver;
  }''',
    "IFS child point budget",
)

# GEFS time x members: default nested service receives only the remaining fan-out share.
replace(
    "src/core/gefs-ensemble-timeseries.ts",
    'import { GefsEnsembleService } from "./gefs-ensemble.js";',
    'import { DEFAULT_GEFS_MEMBER_CONCURRENCY, GefsEnsembleService } from "./gefs-ensemble.js";\nimport { nestedConcurrency } from "./execution-budget.js";',
    "GEFS nested imports",
)
replace(
    "src/core/gefs-ensemble-timeseries.ts",
    '''  constructor(options: GefsEnsembleTimeSeriesServiceOptions = {}) {
    this.ensembleGetter = options.ensembleGetter ?? new GefsEnsembleService();
    this.latestRunRangeProvider = options.latestRunRangeProvider ?? new GefsLatestRunResolver();
    this.stepConcurrency = options.stepConcurrency ?? DEFAULT_GEFS_TIME_STEP_CONCURRENCY;
  }''',
    '''  constructor(options: GefsEnsembleTimeSeriesServiceOptions = {}) {
    this.stepConcurrency = options.stepConcurrency ?? DEFAULT_GEFS_TIME_STEP_CONCURRENCY;
    this.ensembleGetter = options.ensembleGetter ?? new GefsEnsembleService({
      concurrency: nestedConcurrency(this.stepConcurrency, DEFAULT_GEFS_MEMBER_CONCURRENCY),
    });
    this.latestRunRangeProvider = options.latestRunRangeProvider ?? new GefsLatestRunResolver();
  }''',
    "GEFS child member budget",
)

# IFS ENS time x members.
replace(
    "src/core/ifs-ens-timeseries.ts",
    'import { IfsEnsMemberBundleService } from "./ifs-ens-member-bundle.js";',
    'import { DEFAULT_IFS_ENS_MEMBER_CONCURRENCY, IfsEnsMemberBundleService } from "./ifs-ens-member-bundle.js";\nimport { nestedConcurrency } from "./execution-budget.js";',
    "IFS ENS nested imports",
)
replace(
    "src/core/ifs-ens-timeseries.ts",
    '''  constructor(options: IfsEnsTimeSeriesServiceOptions = {}) {
    this.bundleGetter = options.bundleGetter ?? new IfsEnsMemberBundleService();
    this.latestRunRangeProvider = options.latestRunRangeProvider ?? new IfsEnsLatestRunResolver();
    this.stepConcurrency = options.stepConcurrency ?? DEFAULT_IFS_ENS_TIME_STEP_CONCURRENCY;
  }''',
    '''  constructor(options: IfsEnsTimeSeriesServiceOptions = {}) {
    this.stepConcurrency = options.stepConcurrency ?? DEFAULT_IFS_ENS_TIME_STEP_CONCURRENCY;
    this.bundleGetter = options.bundleGetter ?? new IfsEnsMemberBundleService({
      concurrency: nestedConcurrency(this.stepConcurrency, DEFAULT_IFS_ENS_MEMBER_CONCURRENCY),
    });
    this.latestRunRangeProvider = options.latestRunRangeProvider ?? new IfsEnsLatestRunResolver();
  }''',
    "IFS ENS child member budget",
)

# Production ensemble wrappers pass a budgeted step concurrency into deterministic member
# services. Custom member factories remain fully injectable for tests.
replace(
    "src/core/aifs-ens.ts",
    'import { AifsForecastService } from "./aifs.js";',
    'import { AifsForecastService, DEFAULT_AIFS_STEP_CONCURRENCY } from "./aifs.js";\nimport { nestedConcurrency } from "./execution-budget.js";',
    "AIFS ENS budget imports",
)
replace(
    "src/core/aifs-ens.ts",
    '''      return new AifsForecastService({
        source,
        latestRunProvider: new AifsLatestRunResolver({ probe: source, cacheDir }),
      });''',
    '''      return new AifsForecastService({
        source,
        latestRunProvider: new AifsLatestRunResolver({ probe: source, cacheDir }),
        concurrency: nestedConcurrency(this.concurrency, DEFAULT_AIFS_STEP_CONCURRENCY),
      });''',
    "AIFS ENS child step budget",
)

replace(
    "src/core/aigefs.ts",
    'import { AigfsForecastService } from "./aigfs.js";',
    'import { AigfsForecastService, DEFAULT_AIGFS_STEP_CONCURRENCY } from "./aigfs.js";\nimport { nestedConcurrency } from "./execution-budget.js";',
    "AIGEFS budget imports",
)
replace(
    "src/core/aigefs.ts",
    '''      new AigfsForecastService({
        cache: new AigefsS3SubsetCache(
          join(cacheDir, "aigefs-s3", member),
          member,
        ),
      }));''',
    '''      new AigfsForecastService({
        cache: new AigefsS3SubsetCache(
          join(cacheDir, "aigefs-s3", member),
          member,
        ),
        concurrency: nestedConcurrency(this.concurrency, DEFAULT_AIGFS_STEP_CONCURRENCY),
      }));''',
    "AIGEFS child step budget",
)

replace(
    "src/core/icon-d2-eps.ts",
    'import { IconD2ForecastService } from "./icon-d2.js";',
    'import { DEFAULT_ICON_D2_STEP_CONCURRENCY, IconD2ForecastService } from "./icon-d2.js";\nimport { nestedConcurrency } from "./execution-budget.js";',
    "ICON EPS budget imports",
)
replace(
    "src/core/icon-d2-eps.ts",
    '''        areaDecoder: new Wgrib2StatsDecoder(undefined, undefined, "DWD"),
        areaGridDecoder: new Wgrib2GridDecoder(undefined, undefined, "DWD"),
      });''',
    '''        areaDecoder: new Wgrib2StatsDecoder(undefined, undefined, "DWD"),
        areaGridDecoder: new Wgrib2GridDecoder(undefined, undefined, "DWD"),
        concurrency: nestedConcurrency(this.concurrency, DEFAULT_ICON_D2_STEP_CONCURRENCY),
      });''',
    "ICON EPS child step budget",
)

replace(
    "src/core/pe-arome.ts",
    'import { AromeForecastService } from "./arome.js";',
    'import { AromeForecastService, DEFAULT_AROME_STEP_CONCURRENCY } from "./arome.js";\nimport { nestedConcurrency } from "./execution-budget.js";',
    "PE AROME budget imports",
)
replace(
    "src/core/pe-arome.ts",
    '''        areaDecoder: new Wgrib2StatsDecoder(),
        areaGridDecoder: new Wgrib2GridDecoder(),
      });''',
    '''        areaDecoder: new Wgrib2StatsDecoder(),
        areaGridDecoder: new Wgrib2GridDecoder(),
        concurrency: nestedConcurrency(this.concurrency, DEFAULT_AROME_STEP_CONCURRENCY),
      });''',
    "PE AROME child step budget",
)

# Tests for the algebra itself and the architecture's chosen defaults.
Path("test/execution-budget.test.ts").write_text('''import { describe, expect, it } from "vitest";
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
''')

# Documentation: define the difference between WFG composition and provider enforcement.
p = Path("docs/ARCHITECTURE.md")
t = p.read_text()
needle = '''Application-level concurrency is an optimization limit, not permission to exceed an upstream contract. Every cache miss and retry still passes through `src/access/`, whose provider policy is the authoritative hard ceiling for concurrency and pacing. Raising a core worker count may increase useful overlap for cache hits, decoding or independent provider work, but it must never bypass `UpstreamAccessPolicy`.
'''
addition = needle + '''
Nested WFG orchestration uses `DEFAULT_COMPOSED_EXECUTION_BUDGET` from `src/core/execution-budget.ts` as a multiplicative fan-out budget. A parent time/member worker pool allocates the remaining child concurrency with `nestedConcurrency(...)`; standalone services may use more parallelism than the same service receives when nested. This budget protects the process from accidental `time × member × point` explosions. It is deliberately separate from provider enforcement: `src/access/` can and often does impose a stricter limit on actual upstream requests.
'''
if needle not in t:
    raise SystemExit("architecture execution policy paragraph missing")
t = t.replace(needle, addition, 1)
p.write_text(t)
