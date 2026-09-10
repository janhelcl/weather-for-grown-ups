import {
  findAtmosphericAnalogsSchema,
  unifiedSpecializedResultSchema,
  verifyAtmosphericForecastSchema,
  type FindAtmosphericAnalogsInput,
  type UnifiedSpecializedResult,
  type VerifyAtmosphericForecastInput,
} from "../schema/unified-specialized.js";
import {
  createAtmosphericAnalogAdapterRegistry,
  createAtmosphericVerificationAdapterRegistry,
} from "./specialized-adapters/registry.js";
import {
  type AtmosphericAnalogAdapterRegistry,
  type AtmosphericVerificationAdapterRegistry,
} from "./specialized-adapters/types.js";

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
