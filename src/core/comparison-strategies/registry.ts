import {
  AigfsAifsComparisonStrategy,
  GefsAigefsComparisonStrategy,
  GefsIfsEnsComparisonStrategy,
  GfsAigfsComparisonStrategy,
  GfsGefsComparisonStrategy,
  GfsIfsComparisonStrategy,
  HgefsAigefsComparisonStrategy,
  HgefsGefsComparisonStrategy,
  IfsAifsComparisonStrategy,
  IfsEnsAifsEnsComparisonStrategy,
  IfsIfsEnsComparisonStrategy,
} from "./strategies.js";
import type {
  AtmosphericDatasetComparisonKey,
  AtmosphericDatasetComparisonStrategyRegistry,
} from "./types.js";

export function createAtmosphericDatasetComparisonStrategyRegistry(
  strategies: Partial<AtmosphericDatasetComparisonStrategyRegistry> = {},
): AtmosphericDatasetComparisonStrategyRegistry {
  const registry: AtmosphericDatasetComparisonStrategyRegistry = {
    "gfs:gefs": new GfsGefsComparisonStrategy(),
    "gfs:ifs": new GfsIfsComparisonStrategy(),
    "gefs:ifs-ens": new GefsIfsEnsComparisonStrategy(),
    "ifs:ifs-ens": new IfsIfsEnsComparisonStrategy(),
    "gfs:aigfs": new GfsAigfsComparisonStrategy(),
    "ifs:aifs": new IfsAifsComparisonStrategy(),
    "aigfs:aifs": new AigfsAifsComparisonStrategy(),
    "gefs:aigefs": new GefsAigefsComparisonStrategy(),
    "ifs-ens:aifs-ens": new IfsEnsAifsEnsComparisonStrategy(),
    "hgefs:gefs": new HgefsGefsComparisonStrategy(),
    "hgefs:aigefs": new HgefsAigefsComparisonStrategy(),
    ...strategies,
  };
  validateComparisonStrategyRegistry(registry);
  return registry;
}

function validateComparisonStrategyRegistry(
  registry: AtmosphericDatasetComparisonStrategyRegistry,
): void {
  for (const [rawKey, strategy] of Object.entries(registry)) {
    const key = rawKey as AtmosphericDatasetComparisonKey;
    const declaredKey = `${strategy.metadata.datasets[0]}:${strategy.metadata.datasets[1]}`;
    if (strategy.metadata.key !== key || declaredKey !== key) {
      throw new Error(
        `Comparison strategy registry key ${key} does not match strategy declaration ${strategy.metadata.key}/${declaredKey}`,
      );
    }
  }
}
