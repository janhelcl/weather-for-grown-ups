import {
  GefsIfsEnsDatasetComparisonAdapter,
  GfsGefsDatasetComparisonAdapter,
  GfsIfsDatasetComparisonAdapter,
  IfsIfsEnsDatasetComparisonAdapter,
} from "./dataset-comparison.js";
import { GfsAnalysisAnalogAdapter } from "./analogs.js";
import {
  GefsRunComparisonAdapter,
  GfsRunComparisonAdapter,
  IfsEnsRunComparisonAdapter,
  IfsRunComparisonAdapter,
} from "./run-comparison.js";
import type {
  AtmosphericAnalogAdapterRegistry,
  AtmosphericDatasetComparisonAdapterRegistry,
  AtmosphericRunComparisonAdapterRegistry,
  AtmosphericVerificationAdapterRegistry,
} from "./types.js";
import {
  GfsAnalysisVerificationAdapter,
  IgraVerificationAdapter,
} from "./verification.js";

export function createAtmosphericRunComparisonAdapterRegistry(
  adapters: Partial<AtmosphericRunComparisonAdapterRegistry> = {},
): AtmosphericRunComparisonAdapterRegistry {
  return {
    gfs: new GfsRunComparisonAdapter(),
    gefs: new GefsRunComparisonAdapter(),
    ifs: new IfsRunComparisonAdapter(),
    "ifs-ens": new IfsEnsRunComparisonAdapter(),
    ...adapters,
  };
}

export function createAtmosphericDatasetComparisonAdapterRegistry(
  adapters: Partial<AtmosphericDatasetComparisonAdapterRegistry> = {},
): AtmosphericDatasetComparisonAdapterRegistry {
  return {
    "gfs:gefs": new GfsGefsDatasetComparisonAdapter(),
    "gfs:ifs": new GfsIfsDatasetComparisonAdapter(),
    "gefs:ifs-ens": new GefsIfsEnsDatasetComparisonAdapter(),
    "ifs:ifs-ens": new IfsIfsEnsDatasetComparisonAdapter(),
    ...adapters,
  };
}

export function createAtmosphericVerificationAdapterRegistry(
  adapters: Partial<AtmosphericVerificationAdapterRegistry> = {},
): AtmosphericVerificationAdapterRegistry {
  return {
    "gfs-analysis": new GfsAnalysisVerificationAdapter(),
    igra: new IgraVerificationAdapter(),
    ...adapters,
  };
}

export function createAtmosphericAnalogAdapterRegistry(
  adapters: Partial<AtmosphericAnalogAdapterRegistry> = {},
): AtmosphericAnalogAdapterRegistry {
  return {
    "gfs-analysis": new GfsAnalysisAnalogAdapter(),
    ...adapters,
  };
}
