import { BatchPointsService } from "./batch-points.js";
import type { BatchPointsResult } from "./types.js";
import type { OperationalGfsModelId } from "../schema/gfs-grid.js";
import type { BatchPointsQueryInput, NonIsobaricFieldId, PointCoordinate, VariableId } from "../schema/query.js";
import { transectQuerySchema, type TransectQueryInput } from "../schema/transect.js";

const EARTH_RADIUS_KM = 6371.0088;
const ANTIPODAL_EPSILON_RAD = 1e-8;

export interface TransectBatchGetter {
  getPoints(query: BatchPointsQueryInput): Promise<BatchPointsResult>;
}

export interface TransectSampleResult {
  index: number;
  fraction: number;
  distanceKm: number;
  requestedPoint: PointCoordinate;
  gridPoint: PointCoordinate;
  levels: BatchPointsResult["points"][number]["levels"];
  fields?: BatchPointsResult["points"][number]["fields"];
}

export interface TransectResult {
  model: OperationalGfsModelId;
  run: string;
  validTime: string;
  forecastHour: number;
  startPoint: PointCoordinate;
  endPoint: PointCoordinate;
  totalDistanceKm: number;
  variables: VariableId[];
  pressureLevelsHpa: number[];
  fields?: NonIsobaricFieldId[];
  samples: TransectSampleResult[];
  source: BatchPointsResult["source"];
}

export interface TransectServiceOptions {
  batchPointsGetter?: TransectBatchGetter;
}

export class TransectService {
  private readonly batchPointsGetter: TransectBatchGetter;

  constructor(options: TransectServiceOptions = {}) {
    this.batchPointsGetter = options.batchPointsGetter ?? new BatchPointsService();
  }

  async getTransect(input: TransectQueryInput): Promise<TransectResult> {
    const query = transectQuerySchema.parse(input);
    const points = interpolateGreatCircle(query.start, query.end, query.samples);
    const totalDistanceKm = greatCircleDistanceKm(query.start, query.end);

    const batch = await this.batchPointsGetter.getPoints({
      points,
      run: query.run,
      ...(query.grid === undefined ? {} : { grid: query.grid }),
      validTime: query.validTime,
      ...(query.variables === undefined ? {} : { variables: query.variables }),
      ...(query.pressureLevelsHpa === undefined ? {} : { pressureLevelsHpa: query.pressureLevelsHpa }),
      ...(query.fields === undefined ? {} : { fields: query.fields }),
    });

    if (batch.points.length !== points.length) {
      throw new Error(`Batched transect sampling returned ${batch.points.length} points for ${points.length} requested samples`);
    }

    return {
      model: batch.model,
      run: batch.run,
      validTime: batch.validTime,
      forecastHour: batch.forecastHour,
      startPoint: { ...query.start },
      endPoint: { ...query.end },
      totalDistanceKm,
      variables: [...(query.variables ?? [])],
      pressureLevelsHpa: [...(query.pressureLevelsHpa ?? [])],
      ...(query.fields === undefined ? {} : { fields: [...query.fields] }),
      samples: batch.points.map((point, index) => {
        const fraction = index / (points.length - 1);
        return {
          index,
          fraction,
          distanceKm: totalDistanceKm * fraction,
          requestedPoint: point.requestedPoint,
          gridPoint: point.gridPoint,
          levels: point.levels,
          ...(point.fields === undefined ? {} : { fields: point.fields }),
        };
      }),
      source: { ...batch.source },
    };
  }
}

export function greatCircleDistanceKm(start: PointCoordinate, end: PointCoordinate): number {
  const startLat = degreesToRadians(start.latitude);
  const endLat = degreesToRadians(end.latitude);
  const deltaLat = endLat - startLat;
  const deltaLon = degreesToRadians(shortestLongitudeDelta(start.longitude, end.longitude));
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const a = sinLat * sinLat + Math.cos(startLat) * Math.cos(endLat) * sinLon * sinLon;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function interpolateGreatCircle(start: PointCoordinate, end: PointCoordinate, samples: number): PointCoordinate[] {
  if (!Number.isInteger(samples) || samples < 2) throw new Error("Transect samples must be an integer >= 2");
  if (start.latitude === end.latitude && start.longitude === end.longitude) {
    throw new Error("Transect start and end coordinates must differ");
  }

  const a = toUnitVector(start);
  const b = toUnitVector(end);
  const dot = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  const omega = Math.acos(dot);
  if (Math.abs(Math.PI - omega) < ANTIPODAL_EPSILON_RAD) {
    throw new Error("Great-circle interpolation is ambiguous for antipodal transect endpoints");
  }

  if (omega < Number.EPSILON) return Array.from({ length: samples }, (_, index) => index === 0 ? { ...start } : { ...end });

  const sinOmega = Math.sin(omega);
  return Array.from({ length: samples }, (_, index) => {
    if (index === 0) return { ...start };
    if (index === samples - 1) return { ...end };
    const fraction = index / (samples - 1);
    const left = Math.sin((1 - fraction) * omega) / sinOmega;
    const right = Math.sin(fraction * omega) / sinOmega;
    return fromUnitVector({
      x: left * a.x + right * b.x,
      y: left * a.y + right * b.y,
      z: left * a.z + right * b.z,
    });
  });
}

function toUnitVector(point: PointCoordinate): { x: number; y: number; z: number } {
  const lat = degreesToRadians(point.latitude);
  const lon = degreesToRadians(point.longitude);
  const cosLat = Math.cos(lat);
  return { x: cosLat * Math.cos(lon), y: cosLat * Math.sin(lon), z: Math.sin(lat) };
}

function fromUnitVector(vector: { x: number; y: number; z: number }): PointCoordinate {
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);
  const x = vector.x / magnitude;
  const y = vector.y / magnitude;
  const z = vector.z / magnitude;
  const latitude = radiansToDegrees(Math.atan2(z, Math.hypot(x, y)));
  const longitude = normalizeLongitude(radiansToDegrees(Math.atan2(y, x)));
  return { latitude, longitude };
}

function shortestLongitudeDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function normalizeLongitude(longitude: number): number {
  const normalized = ((longitude + 540) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function degreesToRadians(value: number): number { return value * Math.PI / 180; }
function radiansToDegrees(value: number): number { return value * 180 / Math.PI; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
