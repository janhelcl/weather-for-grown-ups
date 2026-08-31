import { ModelClassComparisonService } from "../model-class-comparison.js";
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
  const modelClassComparison = new ModelClassComparisonService();
  const registry: AtmosphericDatasetComparisonStrategyRegistry = {
    "gfs:gefs": new GfsGefsComparisonStrategy(),
    "gfs:ifs": new GfsIfsComparisonStrategy(),
    "gefs:ifs-ens": new GefsIfsEnsComparisonStrategy(),
    "ifs:ifs-ens": new IfsIfsEnsComparisonStrategy(),
    "gfs:aigfs": new GfsAigfsComparisonStrategy(modelClassComparison),
    "ifs:aifs": new IfsAifsComparisonStrategy(modelClassComparison),
    "aigfs:aifs": new AigfsAifsComparisonStrategy(modelClassComparison),
    "gefs:aigefs": new GefsAigefsComparisonStrategy(modelClassComparison),
    "ifs-ens:aifs-ens": new IfsEnsAifsEnsComparisonStrategy(modelClassComparison),
    "hgefs:gefs": new HgefsGefsComparisonStrategy(modelClassComparison),
    "hgefs:aigefs": new HgefsAigefsComparisonStrategy(modelClassComparison),
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
