import type { QueryAtmosphereRequest } from "../../schema/unified-api.js";
import { IconD2EpsForecastService } from "../icon-d2-eps.js";
import type { AtmosphericQueryAdapter } from "./types.js";

export interface IconD2EpsQueryAdapterOptions {
  iconD2Eps?: Pick<IconD2EpsForecastService, "query">;
}

export class IconD2EpsQueryAdapter implements AtmosphericQueryAdapter {
  private readonly service: Pick<IconD2EpsForecastService, "query">;

  constructor(options: IconD2EpsQueryAdapterOptions = {}) {
    this.service = options.iconD2Eps ?? new IconD2EpsForecastService();
  }

  query(request: QueryAtmosphereRequest): Promise<unknown> {
    return this.service.query(request);
  }
}
