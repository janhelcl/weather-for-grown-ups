import type { QueryAtmosphereRequest } from "../../schema/unified-api.js";
import { AromeForecastService } from "../arome.js";
import type { AtmosphericQueryAdapter } from "./types.js";

export interface AromeQueryAdapterOptions {
  arome?: Pick<AromeForecastService, "query">;
}

export class AromeQueryAdapter implements AtmosphericQueryAdapter {
  private readonly service: Pick<AromeForecastService, "query">;

  constructor(options: AromeQueryAdapterOptions = {}) {
    this.service = options.arome ?? new AromeForecastService();
  }

  query(request: QueryAtmosphereRequest): Promise<unknown> {
    return this.service.query(request);
  }
}
