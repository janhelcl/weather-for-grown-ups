import type { QueryAtmosphereRequest } from "../../schema/unified-api.js";
import { IconD2ForecastService } from "../icon-d2.js";
import type { AtmosphericQueryAdapter } from "./types.js";

export interface IconD2QueryAdapterOptions {
  iconD2?: Pick<IconD2ForecastService, "query">;
}

export class IconD2QueryAdapter implements AtmosphericQueryAdapter {
  private readonly service: Pick<IconD2ForecastService, "query">;

  constructor(options: IconD2QueryAdapterOptions = {}) {
    this.service = options.iconD2 ?? new IconD2ForecastService();
  }

  query(request: QueryAtmosphereRequest): Promise<unknown> {
    return this.service.query(request);
  }
}
