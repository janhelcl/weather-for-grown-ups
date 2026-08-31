import type { QueryAtmosphereRequest } from "../../schema/unified-api.js";
import { AigefsForecastService } from "../aigefs.js";
import type { AtmosphericQueryAdapter } from "./types.js";

export interface AigefsQueryAdapterOptions {
  aigefs?: Pick<AigefsForecastService, "query">;
}

export class AigefsQueryAdapter implements AtmosphericQueryAdapter {
  private readonly service: Pick<AigefsForecastService, "query">;

  constructor(options: AigefsQueryAdapterOptions = {}) {
    this.service = options.aigefs ?? new AigefsForecastService();
  }

  query(request: QueryAtmosphereRequest): Promise<unknown> {
    return this.service.query(request);
  }
}
