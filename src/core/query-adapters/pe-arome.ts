import type { QueryAtmosphereRequest } from "../../schema/unified-api.js";
import { PeAromeForecastService } from "../pe-arome.js";
import type { AtmosphericQueryAdapter } from "./types.js";

export interface PeAromeQueryAdapterOptions {
  peArome?: Pick<PeAromeForecastService, "query">;
}

export class PeAromeQueryAdapter implements AtmosphericQueryAdapter {
  private readonly service: Pick<PeAromeForecastService, "query">;

  constructor(options: PeAromeQueryAdapterOptions = {}) {
    this.service = options.peArome ?? new PeAromeForecastService();
  }

  query(request: QueryAtmosphereRequest): Promise<unknown> {
    return this.service.query(request);
  }
}
