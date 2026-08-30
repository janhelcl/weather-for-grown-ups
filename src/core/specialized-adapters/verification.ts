import { historicalForecastVerificationQuerySchema } from "../../schema/history-verification.js";
import type { VerifyAtmosphericForecastRequest } from "../../schema/unified-specialized.js";
import { HistoricalForecastSkillService } from "../history-skill.js";
import { HistoricalForecastVerificationService } from "../history-verification.js";
import { IgraForecastSkillService } from "../igra-skill.js";
import { IgraForecastVerificationService } from "../igra-verification.js";
import type { AtmosphericVerificationAdapter } from "./types.js";

export class GfsAnalysisVerificationAdapter implements AtmosphericVerificationAdapter {
  constructor(
    private readonly instant: Pick<HistoricalForecastVerificationService, "verify"> =
      new HistoricalForecastVerificationService(),
    private readonly skill: Pick<HistoricalForecastSkillService, "summarize"> =
      new HistoricalForecastSkillService(),
  ) {}

  verify(request: VerifyAtmosphericForecastRequest): Promise<unknown> {
    if (request.referenceDataset !== "gfs-analysis") {
      throw new Error("GFS-analysis verification adapter requires referenceDataset=gfs-analysis");
    }
    if (Array.isArray(request.leadHours)) {
      const time = request.time as {
        from: string;
        to: string;
        hoursUtc: Array<0 | 6 | 12 | 18>;
        maxValidTimes: number;
      };
      return this.skill.summarize({
        latitude: request.geometry.latitude,
        longitude: request.geometry.longitude,
        startTime: time.from,
        endTime: time.to,
        cycleHoursUtc: time.hoursUtc,
        maxValidTimes: time.maxValidTimes,
        leadHours: request.leadHours,
        variables: request.variables as any,
        pressureLevelsHpa: request.pressureLevelsHpa,
      });
    }

    const time = request.time as { at: string };
    return this.instant.verify(historicalForecastVerificationQuerySchema.parse({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      validTime: time.at,
      leadHours: request.leadHours,
      variables: request.variables,
      pressureLevelsHpa: request.pressureLevelsHpa,
    }));
  }
}

export class IgraVerificationAdapter implements AtmosphericVerificationAdapter {
  constructor(
    private readonly instant: Pick<IgraForecastVerificationService, "verify"> =
      new IgraForecastVerificationService(),
    private readonly skill: Pick<IgraForecastSkillService, "summarize"> =
      new IgraForecastSkillService(),
  ) {}

  verify(request: VerifyAtmosphericForecastRequest): Promise<unknown> {
    if (request.referenceDataset !== "igra") {
      throw new Error("IGRA verification adapter requires referenceDataset=igra");
    }
    if (Array.isArray(request.leadHours)) {
      const time = request.time as {
        from: string;
        to: string;
        hoursUtc: Array<0 | 6 | 12 | 18>;
        maxValidTimes: number;
      };
      return this.skill.summarize({
        latitude: request.geometry.latitude,
        longitude: request.geometry.longitude,
        startTime: time.from,
        endTime: time.to,
        cycleHoursUtc: time.hoursUtc,
        maxValidTimes: time.maxValidTimes,
        leadHours: request.leadHours,
        variables: request.variables as any,
        pressureLevelsHpa: request.pressureLevelsHpa,
        ...(request.gfsGrid === undefined ? {} : { gfsGrid: request.gfsGrid }),
        ...(request.stationId === undefined ? {} : { stationId: request.stationId }),
        ...(request.maxStationDistanceKm === undefined
          ? {}
          : { maxStationDistanceKm: request.maxStationDistanceKm }),
      });
    }

    const time = request.time as { at: string };
    return this.instant.verify({
      latitude: request.geometry.latitude,
      longitude: request.geometry.longitude,
      validTime: time.at,
      leadHours: request.leadHours,
      variables: request.variables as any,
      pressureLevelsHpa: request.pressureLevelsHpa,
      ...(request.gfsGrid === undefined ? {} : { gfsGrid: request.gfsGrid }),
      ...(request.stationId === undefined ? {} : { stationId: request.stationId }),
      ...(request.maxStationDistanceKm === undefined
        ? {}
        : { maxStationDistanceKm: request.maxStationDistanceKm }),
    });
  }
}
