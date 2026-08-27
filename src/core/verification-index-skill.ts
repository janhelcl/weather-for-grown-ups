import {
  verificationIndexSkillQuerySchema,
  verificationIndexSkillResultSchema,
  type VerificationIndexRecord,
  type VerificationIndexSkillQueryInput,
  type VerificationIndexSkillResult,
} from "../schema/verification-index.js";
import { canonicalSelection } from "./history-index-store.js";
import {
  accumulateSkillPressureLevels,
  enumerateNominalTimes,
  finalizeSkillStatistics,
  type ForecastSkillAccumulator,
} from "./forecast-skill.js";
import { VerificationIndexStore, verificationCaseIdentity } from "./verification-index-store.js";

const ANALYSIS_CAVEAT = "Local corpus statistics compare archived GFS forecasts with later GFS model analyses, not direct observations; coverage reflects only materialized cases, historical GFS versions changed over time, and this summary performs no upstream requests";
const IGRA_CAVEAT = "Local corpus statistics compare archived GFS forecasts with radiosonde observations; coverage reflects only materialized cases, station/model representativeness limitations still apply, and this summary performs no upstream requests";

export interface VerificationIndexSkillServiceOptions {
  store?: VerificationIndexStore;
}

export class VerificationIndexSkillService {
  private readonly store: VerificationIndexStore;

  constructor(options: VerificationIndexSkillServiceOptions = {}) {
    this.store = options.store ?? new VerificationIndexStore();
  }

  async summarize(input: VerificationIndexSkillQueryInput): Promise<VerificationIndexSkillResult> {
    const query = verificationIndexSkillQuerySchema.parse(input);
    const start = new Date(query.startTime);
    const end = new Date(query.endTime);
    const cycleHoursUtc = [...query.cycleHoursUtc].sort((a, b) => a - b);
    const leadHours = [...query.leadHours].sort((a, b) => a - b);
    const variables = [...new Set(query.variables)].sort();
    const pressureLevelsHpa = [...new Set(query.pressureLevelsHpa)].sort((a, b) => b - a);
    const monthsUtc = query.monthsUtc === undefined
      ? undefined
      : [...query.monthsUtc].sort((a, b) => a - b);

    let eligibleTimes = enumerateNominalTimes(start, end, cycleHoursUtc);
    if (monthsUtc !== undefined) {
      const months = new Set(monthsUtc);
      eligibleTimes = eligibleTimes.filter((time) => months.has(time.getUTCMonth() + 1));
    }

    const selectionKey = canonicalSelection(variables, pressureLevelsHpa);
    const all = await this.store.readAll();
    const matched = all.filter((record) => {
      if (record.referenceDataset !== query.referenceDataset) return false;
      if (!samePoint(record.request.requestedPoint, { latitude: query.latitude, longitude: query.longitude })) return false;
      const validTime = new Date(record.request.validTime);
      if (validTime < start || validTime > end) return false;
      if (!cycleHoursUtc.includes(validTime.getUTCHours() as 0 | 6 | 12 | 18)) return false;
      if (monthsUtc !== undefined && !monthsUtc.includes(validTime.getUTCMonth() + 1)) return false;
      if (!leadHours.includes(record.request.leadHours)) return false;
      if (canonicalSelection(record.request.variables, record.request.pressureLevelsHpa) !== selectionKey) return false;
      if (record.referenceDataset === "igra") {
        if (query.stationId !== undefined && record.result.station.id !== query.stationId) return false;
        if (query.gfsGrid !== undefined && record.result.gfsGrid !== query.gfsGrid) return false;
        if (query.maxStationDistanceKm !== undefined && record.result.station.distanceKm > query.maxStationDistanceKm) return false;
      }
      return true;
    });

    const unique = new Map<string, VerificationIndexRecord>();
    for (const record of matched) unique.set(verificationCaseIdentity(record), record);
    const records = [...unique.values()].sort((left, right) =>
      left.request.validTime.localeCompare(right.request.validTime)
      || left.request.leadHours - right.request.leadHours
    );

    const accumulators = new Map<string, ForecastSkillAccumulator>();
    const stations = new Map<string, {
      id: string;
      name: string;
      latitude: number;
      longitude: number;
      elevationM?: number;
    }>();
    for (const record of records) {
      accumulateSkillPressureLevels(accumulators, record.result.leadHours, record.result.pressureLevels);
      if (record.referenceDataset === "igra") {
        stations.set(record.result.station.id, {
          id: record.result.station.id,
          name: record.result.station.name,
          latitude: record.result.station.latitude,
          longitude: record.result.station.longitude,
          ...(record.result.station.elevationM === undefined ? {} : { elevationM: record.result.station.elevationM }),
        });
      }
    }

    const expectedEvaluations = eligibleTimes.length * leadHours.length;
    const materializedEvaluations = records.length;
    const missingEvaluations = Math.max(0, expectedEvaluations - materializedEvaluations);

    return verificationIndexSkillResultSchema.parse({
      model: "verification_index_skill_summary",
      indexPath: this.store.path,
      referenceDataset: query.referenceDataset,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      period: {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        cycleHoursUtc,
        ...(monthsUtc === undefined ? {} : { monthsUtc }),
        eligibleValidTimes: eligibleTimes.length,
        expectedEvaluations,
      },
      leadHours,
      selection: { variables, pressureLevelsHpa },
      coverage: {
        materializedEvaluations,
        missingEvaluations,
        coverageRate: expectedEvaluations === 0 ? 0 : Math.min(1, materializedEvaluations / expectedEvaluations),
      },
      statistics: finalizeSkillStatistics(accumulators),
      ...(query.referenceDataset === "igra"
        ? { stations: [...stations.values()].sort((a, b) => a.id.localeCompare(b.id)) }
        : {}),
      source: { access: "local_jsonl", upstreamRequests: 0 },
      caveat: query.referenceDataset === "igra" ? IGRA_CAVEAT : ANALYSIS_CAVEAT,
    });
  }
}

function samePoint(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
): boolean {
  return Math.abs(left.latitude - right.latitude) < 1e-9
    && circularLongitudeDifference(left.longitude, right.longitude) < 1e-9;
}

function circularLongitudeDifference(left: number, right: number): number {
  const a = normalizeLongitude(left);
  const b = normalizeLongitude(right);
  const delta = Math.abs(a - b);
  return Math.min(delta, 360 - delta);
}

function normalizeLongitude(longitude: number): number {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}
