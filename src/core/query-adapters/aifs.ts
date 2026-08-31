import type { QueryAtmosphereRequest } from "../../schema/unified-api.js";
import { AifsForecastService } from "../aifs.js";
import type { AtmosphericQueryAdapter } from "./types.js";

export interface AifsQueryAdapterOptions {
  aifs?: Pick<AifsForecastService, "query">;
}

export class AifsQueryAdapter implements AtmosphericQueryAdapter {
  private readonly service: Pick<AifsForecastService, "query">;

  constructor(options: AifsQueryAdapterOptions = {}) {
    this.service = options.aifs ?? new AifsForecastService();
  }

  query(request: QueryAtmosphereRequest): Promise<unknown> {
    return this.service.query(request);
  }
}
