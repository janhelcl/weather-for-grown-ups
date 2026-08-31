import type { QueryAtmosphereRequest } from "../../schema/unified-api.js";
import { AifsEnsForecastService } from "../aifs-ens.js";
import type { AtmosphericQueryAdapter } from "./types.js";

export interface AifsEnsQueryAdapterOptions {
  aifsEns?: Pick<AifsEnsForecastService, "query">;
}

export class AifsEnsQueryAdapter implements AtmosphericQueryAdapter {
  private readonly service: Pick<AifsEnsForecastService, "query">;

  constructor(options: AifsEnsQueryAdapterOptions = {}) {
    this.service = options.aifsEns ?? new AifsEnsForecastService();
  }

  query(request: QueryAtmosphereRequest): Promise<unknown> {
    return this.service.query(request);
  }
}
