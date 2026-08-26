import type { HistoricalProfileQueryInput } from "../schema/history.js";
import type { HistoricalProfileResult } from "../schema/history-result.js";
import {
  historicalAnalogQuerySchema,
  historicalIndexBuildQuerySchema,
  type HistoricalAnalogQueryInput,
  type HistoricalAnalogResult,
  type HistoricalIndexBuildQueryInput,
  type HistoricalIndexBuildResult,
  type HistoricalIndexRecord,
} from "../schema/history-index.js";
import { HistoricalTimeSeriesService, type HistoricalProfileGetter } from "./history-time-series.js";
import { HistoricalProfileIndexStore, canonicalSelection, sameGridPoint } from "./history-index-store.js";
import { HistoricalProfileService } from "./history.js";

const HOUR_MS = 60 * 60 * 1_000;
const ANALOG_CAVEAT = "Similarity is computed only from the selected GFS model-analysis variables and pressure levels; it is not a climatological or impact-specific similarity score" as const;

type HistoricalVariableId = HistoricalIndexRecord["selection"]["variables"][number];
type HistoricalLevel = HistoricalIndexRecord["levels"][number];

export interface HistoricalIndexTimeSeriesGetter {
  getHistoricalTimeSeries(input: HistoricalIndexBuildQueryInput): Promise<{
    model: "gfs_grid4_analysis_0p5";
    requestedStartTime: string;
    requestedEndTime: string;
    requestedPoint: { latitude: number; longitude: number };
    gridPoint: { latitude: number; longitude: number };
    selection: {
      variables: HistoricalIndexRecord["selection"]["variables"];
      pressureLevelsHpa: number[];
      cycleHoursUtc: number[];
    };
    source: { provider: "NOAA NCEI"; access: "ncei_thredds_ncss" };
    series: Array<{
      analysisTime: string;
      levels: HistoricalIndexRecord["levels"];
      dataset: string;
      cacheHit: boolean;
    }>;
    caveat: string;
  }>;
}

export interface HistoricalIndexServiceOptions {
  store?: HistoricalProfileIndexStore;
  timeSeriesGetter?: HistoricalIndexTimeSeriesGetter;
  profileGetter?: HistoricalProfileGetter;
}

export class HistoricalIndexService {
  private readonly store: HistoricalProfileIndexStore;
  private readonly timeSeriesGetter: HistoricalIndexTimeSeriesGetter;
  private readonly profileGetter: HistoricalProfileGetter;

  constructor(options: HistoricalIndexServiceOptions = {}) {
    this.store = options.store ?? new HistoricalProfileIndexStore();
    this.profileGetter = options.profileGetter ?? new HistoricalProfileService();
    this.timeSeriesGetter = options.timeSeriesGetter ?? new HistoricalTimeSeriesService({
      profileGetter: this.profileGetter,
    });
  }

  async materialize(input: HistoricalIndexBuildQueryInput): Promise<HistoricalIndexBuildResult> {
    const query = historicalIndexBuildQuerySchema.parse(input);
    const variables = normalizeVariables(query.variables);
    const pressureLevelsHpa = normalizeLevels(query.pressureLevelsHpa);
    const result = await this.timeSeriesGetter.getHistoricalTimeSeries({
      ...query,
      variables,
      pressureLevelsHpa,
    });

    const records = result.series.map((step): HistoricalIndexRecord => ({
      version: 1,
      model: "gfs_grid4_analysis_0p5",
      analysisTime: step.analysisTime,
      requestedPoint: result.requestedPoint,
      gridPoint: result.gridPoint,
      selection: { variables, pressureLevelsHpa },
      levels: step.levels,
      source: {
        provider: "NOAA NCEI",
        access: "ncei_thredds_ncss",
        dataset: step.dataset,
      },
    }));

    const materialized = await this.store.append(records);
    const all = await this.store.readAll();
    const selectionKey = canonicalSelection(variables, pressureLevelsHpa);
    const totalMatchingRecords = all.filter((record) =>
      sameGridPoint(record.gridPoint, result.gridPoint)
      && canonicalSelection(record.selection.variables, record.selection.pressureLevelsHpa) === selectionKey
    ).length;

    return {
      indexPath: this.store.path,
      requestedStartTime: result.requestedStartTime,
      requestedEndTime: result.requestedEndTime,
      materialized,
      totalMatchingRecords,
      analysisTimes: records.map((record) => record.analysisTime),
      note: "append-only local materialization; duplicate keys are deduplicated when read",
    };
  }

  async findAnalogs(input: HistoricalAnalogQueryInput): Promise<HistoricalAnalogResult> {
    const query = historicalAnalogQuerySchema.parse(input);
    const variables = normalizeVariables(query.variables);
    const pressureLevelsHpa = normalizeLevels(query.pressureLevelsHpa);
    const selectionKey = canonicalSelection(variables, pressureLevelsHpa);
    let records = await this.store.readAll();

    let target = findTargetRecord(records, query.targetTime, query.latitude, query.longitude, selectionKey);
    let targetFromIndex = true;
    if (!target) {
      if (!query.fetchTargetIfMissing) {
        throw new Error(
          `Target ${query.targetTime} is not materialized in ${this.store.path} for the requested point/selection`,
        );
      }
      const profile = await this.profileGetter.getHistoricalProfile({
        latitude: query.latitude,
        longitude: query.longitude,
        analysisTime: query.targetTime,
        variables,
        pressureLevelsHpa,
      } satisfies HistoricalProfileQueryInput);
      target = recordFromProfile(profile, variables, pressureLevelsHpa);
      await this.store.append([target]);
      targetFromIndex = false;
      records = await this.store.readAll();
    }

    const targetTimeMs = new Date(target.analysisTime).getTime();
    const exclusionMs = query.excludeWithinHours * HOUR_MS;
    const candidates = records.filter((record) =>
      record.analysisTime !== target!.analysisTime
      && sameGridPoint(record.gridPoint, target!.gridPoint)
      && canonicalSelection(record.selection.variables, record.selection.pressureLevelsHpa) === selectionKey
      && Math.abs(new Date(record.analysisTime).getTime() - targetTimeMs) > exclusionMs
    );

    const featureSpec = buildFeatureSpec(variables, pressureLevelsHpa);
    const targetVector = extractFeatureVector(target, featureSpec);
    const candidateVectors = candidates.map((record) => ({
      record,
      vector: extractFeatureVector(record, featureSpec),
    }));
    const scales = featureScales([targetVector, ...candidateVectors.map((candidate) => candidate.vector)]);
    const ranked = candidateVectors
      .map(({ record, vector }) => ({ record, distance: standardizedDistance(targetVector, vector, scales) }))
      .sort((a, b) => a.distance - b.distance || a.record.analysisTime.localeCompare(b.record.analysisTime))
      .slice(0, query.count);

    return {
      model: "gfs_grid4_analysis_0p5",
      targetTime: target.analysisTime,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: target.gridPoint,
      selection: { variables, pressureLevelsHpa },
      indexPath: this.store.path,
      metric: {
        name: "standardized_euclidean",
        features: featureSpec.map((feature) => feature.name),
        windRepresentation: "u_v_components",
      },
      candidateCount: candidates.length,
      target: {
        analysisTime: target.analysisTime,
        levels: target.levels,
        dataset: target.source.dataset,
        fromIndex: targetFromIndex,
      },
      analogs: ranked.map(({ record, distance }, index) => ({
        rank: index + 1,
        analysisTime: record.analysisTime,
        distance,
        levels: record.levels,
        dataset: record.source.dataset,
      })),
      caveat: ANALOG_CAVEAT,
    };
  }
}

interface FeatureSpec {
  name: string;
  pressureHpa: number;
  property: keyof HistoricalLevel;
}

const FEATURE_PROPERTIES: Record<HistoricalVariableId, readonly (keyof HistoricalLevel)[]> = {
  temperature: ["temperatureC"],
  relative_humidity: ["relativeHumidityPct"],
  u_wind: ["uWindMs"],
  v_wind: ["vWindMs"],
  geopotential_height: ["geopotentialHeightGpm"],
  vertical_velocity: ["verticalVelocityPaS"],
  absolute_vorticity: ["absoluteVorticityS1"],
  wind: ["uWindMs", "vWindMs"],
  dew_point: ["dewPointC"],
  potential_temperature: ["potentialTemperatureK"],
};

export function buildFeatureSpec(
  variables: readonly HistoricalVariableId[],
  pressureLevelsHpa: readonly number[],
): FeatureSpec[] {
  const seen = new Set<string>();
  const features: FeatureSpec[] = [];
  for (const pressureHpa of normalizeLevels(pressureLevelsHpa)) {
    for (const variable of normalizeVariables(variables)) {
      for (const property of FEATURE_PROPERTIES[variable]) {
        const name = `${pressureHpa}hPa.${String(property)}`;
        if (seen.has(name)) continue;
        seen.add(name);
        features.push({ name, pressureHpa, property });
      }
    }
  }
  return features;
}

export function standardizedDistance(
  a: readonly number[],
  b: readonly number[],
  scales: readonly number[],
): number {
  if (a.length !== b.length || a.length !== scales.length) {
    throw new Error("Historical analog feature vectors must have matching dimensions");
  }
  let squared = 0;
  for (let index = 0; index < a.length; index += 1) {
    const scale = scales[index] || 1;
    const delta = (a[index]! - b[index]!) / scale;
    squared += delta * delta;
  }
  return Math.sqrt(squared);
}

function extractFeatureVector(record: HistoricalIndexRecord, features: readonly FeatureSpec[]): number[] {
  const levels = new Map(record.levels.map((level) => [level.pressureHpa, level]));
  return features.map((feature) => {
    const level = levels.get(feature.pressureHpa);
    const value = level?.[feature.property];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(
        `Historical index record ${record.analysisTime} is missing numeric feature ${feature.name}`,
      );
    }
    return value;
  });
}

function featureScales(vectors: readonly (readonly number[])[]): number[] {
  if (vectors.length === 0) return [];
  const dimensions = vectors[0]!.length;
  return Array.from({ length: dimensions }, (_, dimension) => {
    const values = vectors.map((vector) => vector[dimension]!);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const scale = Math.sqrt(variance);
    return scale > 1e-12 ? scale : 1;
  });
}

function findTargetRecord(
  records: readonly HistoricalIndexRecord[],
  targetTime: string,
  latitude: number,
  longitude: number,
  selectionKey: string,
): HistoricalIndexRecord | undefined {
  const sameSelectionAndTime = records.filter((record) =>
    record.analysisTime === new Date(targetTime).toISOString()
    && canonicalSelection(record.selection.variables, record.selection.pressureLevelsHpa) === selectionKey
  );
  const exactRequestedPoint = sameSelectionAndTime.find((record) =>
    Math.abs(record.requestedPoint.latitude - latitude) < 1e-9
    && circularLongitudeDifference(record.requestedPoint.longitude, longitude) < 1e-9
  );
  if (exactRequestedPoint) return exactRequestedPoint;

  const expectedGridPoint = nearestGrid4Point(latitude, longitude);
  return sameSelectionAndTime.find((record) => sameGridPoint(record.gridPoint, expectedGridPoint));
}

function recordFromProfile(
  profile: HistoricalProfileResult,
  variables: HistoricalIndexRecord["selection"]["variables"],
  pressureLevelsHpa: number[],
): HistoricalIndexRecord {
  return {
    version: 1,
    model: "gfs_grid4_analysis_0p5",
    analysisTime: profile.analysisTime,
    requestedPoint: profile.requestedPoint,
    gridPoint: profile.gridPoint,
    selection: { variables, pressureLevelsHpa },
    levels: profile.levels,
    source: {
      provider: "NOAA NCEI",
      access: "ncei_thredds_ncss",
      dataset: profile.source.dataset,
    },
  };
}

function normalizeVariables<T extends string>(variables: readonly T[]): T[] {
  return [...new Set(variables)].sort() as T[];
}

function normalizeLevels(levels: readonly number[]): number[] {
  return [...new Set(levels)].sort((a, b) => b - a);
}

function nearestGrid4Point(latitude: number, longitude: number) {
  return {
    latitude: Math.max(-90, Math.min(90, Math.round(latitude * 2) / 2)),
    longitude: Math.round(normalizeLongitude(longitude) * 2) / 2,
  };
}

function circularLongitudeDifference(a: number, b: number): number {
  const delta = Math.abs(normalizeLongitude(a) - normalizeLongitude(b));
  return Math.min(delta, 360 - delta);
}

function normalizeLongitude(longitude: number): number {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}
