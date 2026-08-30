import {
  compareAtmosphericDatasetsSchema,
  compareAtmosphericRunsSchema,
  findAtmosphericAnalogsSchema,
  unifiedSpecializedResultSchema,
  verifyAtmosphericForecastSchema,
  type CompareAtmosphericDatasetsInput,
  type CompareAtmosphericRunsInput,
  type FindAtmosphericAnalogsInput,
  type UnifiedSpecializedResult,
  type VerifyAtmosphericForecastInput,
} from "../schema/unified-specialized.js";
import {
  createAtmosphericAnalogAdapterRegistry,
  createAtmosphericDatasetComparisonAdapterRegistry,
  createAtmosphericRunComparisonAdapterRegistry,
  createAtmosphericVerificationAdapterRegistry,
} from "./specialized-adapters/registry.js";
import {
  atmosphericDatasetComparisonKey,
  type AtmosphericAnalogAdapterRegistry,
  type AtmosphericDatasetComparisonAdapterRegistry,
  type AtmosphericRunComparisonAdapterRegistry,
  type AtmosphericVerificationAdapterRegistry,
} from "./specialized-adapters/types.js";

export interface UnifiedRunComparisonServiceOptions {
  adapters?: Partial<AtmosphericRunComparisonAdapterRegistry>;
}

export class UnifiedRunComparisonService {
  private readonly adapters: AtmosphericRunComparisonAdapterRegistry;

  constructor(options: UnifiedRunComparisonServiceOptions = {}) {
    this.adapters = createAtmosphericRunComparisonAdapterRegistry(options.adapters);
  }

  async compare(input: CompareAtmosphericRunsInput): Promise<UnifiedSpecializedResult> {
    const request = compareAtmosphericRunsSchema.parse(input);
    const result = await this.adapters[request.dataset].compare(request);
    return wrap("compare_runs", [request.dataset], result);
  }
}

export interface UnifiedDatasetComparisonServiceOptions {
  adapters?: Partial<AtmosphericDatasetComparisonAdapterRegistry>;
}

export class UnifiedDatasetComparisonService {
  private readonly adapters: AtmosphericDatasetComparisonAdapterRegistry;

  constructor(options: UnifiedDatasetComparisonServiceOptions = {}) {
    this.adapters = createAtmosphericDatasetComparisonAdapterRegistry(options.adapters);
  }

  async compare(input: CompareAtmosphericDatasetsInput): Promise<UnifiedSpecializedResult> {
    const request = compareAtmosphericDatasetsSchema.parse(input);
    const result = await this.adapters[atmosphericDatasetComparisonKey(request)].compare(request);
    return wrap("compare_datasets", [...request.datasets], result);
  }
}

export interface UnifiedForecastVerificationServiceOptions {
  adapters?: Partial<AtmosphericVerificationAdapterRegistry>;
}

export class UnifiedForecastVerificationService {
  private readonly adapters: AtmosphericVerificationAdapterRegistry;

  constructor(options: UnifiedForecastVerificationServiceOptions = {}) {
    this.adapters = createAtmosphericVerificationAdapterRegistry(options.adapters);
  }

  async verify(input: VerifyAtmosphericForecastInput): Promise<UnifiedSpecializedResult> {
    const request = verifyAtmosphericForecastSchema.parse(input);
    const result = await this.adapters[request.referenceDataset].verify(request);
    return wrap("verify_forecast", ["gfs", request.referenceDataset], result);
  }
}

export interface UnifiedAnalogServiceOptions {
  adapters?: Partial<AtmosphericAnalogAdapterRegistry>;
}

export class UnifiedAnalogService {
  private readonly adapters: AtmosphericAnalogAdapterRegistry;

  constructor(options: UnifiedAnalogServiceOptions = {}) {
    this.adapters = createAtmosphericAnalogAdapterRegistry(options.adapters);
  }

  async find(input: FindAtmosphericAnalogsInput): Promise<UnifiedSpecializedResult> {
    const request = findAtmosphericAnalogsSchema.parse(input);
    const result = await this.adapters[request.dataset].find(request);
    return wrap("find_analogs", [request.dataset], result);
  }
}

function wrap(
  operation: UnifiedSpecializedResult["operation"],
  datasets: UnifiedSpecializedResult["datasets"],
  result: unknown,
): UnifiedSpecializedResult {
  return unifiedSpecializedResultSchema.parse({ operation, datasets, result });
}
