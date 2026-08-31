import type { QueryAtmosphereRequest } from "../../schema/unified-api.js";
import { HgefsForecastService } from "../hgefs.js";
import type { AtmosphericQueryAdapter } from "./types.js";

export interface HgefsQueryAdapterOptions {
  hgefs?: Pick<HgefsForecastService, "query">;
}

export class HgefsQueryAdapter implements AtmosphericQueryAdapter {
  private readonly service: Pick<HgefsForecastService, "query">;

  constructor(options: HgefsQueryAdapterOptions = {}) {
    this.service = options.hgefs ?? new HgefsForecastService();
  }

  query(request: QueryAtmosphereRequest): Promise<unknown> {
    return this.service.query(request);
  }
}
