import type { QueryAtmosphereRequest } from "../../schema/unified-api.js";
import { AigfsForecastService } from "../aigfs.js";
import type { AtmosphericQueryAdapter } from "./types.js";

export interface AigfsQueryAdapterOptions {
  aigfs?: Pick<AigfsForecastService, "query">;
}

export class AigfsQueryAdapter implements AtmosphericQueryAdapter {
  private readonly service: Pick<AigfsForecastService, "query">;

  constructor(options: AigfsQueryAdapterOptions = {}) {
    this.service = options.aigfs ?? new AigfsForecastService();
  }

  query(request: QueryAtmosphereRequest): Promise<unknown> {
    return this.service.query(request);
  }
}
