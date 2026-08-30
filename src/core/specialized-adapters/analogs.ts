import { historicalAnalogQuerySchema } from "../../schema/history-index.js";
import type { FindAtmosphericAnalogsRequest } from "../../schema/unified-specialized.js";
import { HistoricalIndexService } from "../history-index.js";
import type { AtmosphericAnalogAdapter } from "./types.js";

export class GfsAnalysisAnalogAdapter implements AtmosphericAnalogAdapter {
  constructor(
    private readonly service: Pick<HistoricalIndexService, "findAnalogs"> =
      new HistoricalIndexService(),
  ) {}

  find(request: FindAtmosphericAnalogsRequest): Promise<unknown> {
    return this.service.findAnalogs(historicalAnalogQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      targetTime: request.time.at,
      variables: request.variables,
      pressureLevelsHpa: request.pressureLevelsHpa,
      count: request.count,
      excludeWithinHours: request.excludeWithinHours,
      fetchTargetIfMissing: request.fetchTargetIfMissing,
    }));
  }
}
