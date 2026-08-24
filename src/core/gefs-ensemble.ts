import { homedir } from "node:os";
import { join } from "node:path";
import { GEFS_PGRB2A_FIELD_CATALOG, type RawGefsFieldDefinition } from "../catalog/gefs-fields.js";
import {
  type GefsMember,
  sortGefsMembers,
} from "../catalog/gefs.js";
import { VARIABLE_CATALOG, type RawVariableDefinition } from "../catalog/variables.js";
import {
  GefsS3SubsetCache,
  type GefsMemberSelectionSource,
  type GefsMemberSource,
} from "../cache/gefs-s3-subset-cache.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import {
  gefsEnsembleQuerySchema,
  gefsEnsembleResultSchema,
  type GefsEnsembleQueryInput,
  type GefsEnsembleResult,
} from "../schema/gefs-ensemble.js";
import type { DecodedValue, FieldTemporalResult } from "./types.js";
import { mapConcurrent } from "./concurrency.js";
import { summarizeNumericDistribution, thresholdGteSummary } from "./ensemble-statistics.js";
import { GefsLatestRunResolver, type GefsLatestRunProvider } from "./gefs-latest-run.js";
import { gefsForecastHour, parseGefsRun } from "./gefs-time.js";

export const DEFAULT_GEFS_MEMBER_CONCURRENCY = 6;

export interface GefsPointDecoder {
  extractPoint(path: string, longitude: number, latitude: number): Promise<DecodedValue[]>;
}

export interface GefsEnsembleServiceOptions {
  cacheDir?: string;
  wgrib2Path?: string;
  source?: GefsMemberSource;
  fieldSource?: GefsMemberSelectionSource;
  decoder?: GefsPointDecoder;
  latestRunProvider?: GefsLatestRunProvider;
  concurrency?: number;
}

interface EnsembleSample {
  member: GefsMember;
  value: number;
  gridPoint: { latitude: number; longitude: number };
  cacheHit: boolean;
  temporal?: FieldTemporalResult;
}

export class GefsEnsembleService {
  private readonly source: GefsMemberSource;
  private readonly fieldSource: GefsMemberSelectionSource;
  private readonly decoder: GefsPointDecoder;
  private readonly latestRunProvider: GefsLatestRunProvider;
  private readonly concurrency: number;

  constructor(options: GefsEnsembleServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const defaultSource = new GefsS3SubsetCache(join(cacheDir, "gefs-s3"));
    this.source = options.source ?? defaultSource;
    this.fieldSource = options.fieldSource
      ?? (options.source && "fetchSelection" in options.source
        ? options.source as GefsMemberSource & GefsMemberSelectionSource
        : defaultSource);
    this.decoder = options.decoder ?? new Wgrib2Decoder(options.wgrib2Path);
    this.latestRunProvider = options.latestRunProvider ?? new GefsLatestRunResolver();
    this.concurrency = options.concurrency ?? DEFAULT_GEFS_MEMBER_CONCURRENCY;
  }

  async getEnsemble(input: GefsEnsembleQueryInput): Promise<GefsEnsembleResult> {
    const query = gefsEnsembleQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortGefsMembers(query.members);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, members)
      : parseGefsRun(query.run);
    const forecastHour = gefsForecastHour(run, validTime);

    const field = query.field === undefined
      ? undefined
      : GEFS_PGRB2A_FIELD_CATALOG[query.field] as RawGefsFieldDefinition;
    const variable = query.variable === undefined
      ? undefined
      : VARIABLE_CATALOG[query.variable] as RawVariableDefinition;

    const samples = await mapConcurrent(members, this.concurrency, async (member) =>
      field
        ? this.sampleFieldMember(member, run, forecastHour, query.latitude, query.longitude, field)
        : this.samplePressureMember(
            member,
            run,
            forecastHour,
            query.latitude,
            query.longitude,
            variable!,
            query.pressureLevelHpa!,
          ),
    );
    const first = samples[0];
    if (!first) throw new Error("GEFS ensemble produced no member samples");
    for (const sample of samples) {
      if (
        sample.gridPoint.latitude !== first.gridPoint.latitude ||
        sample.gridPoint.longitude !== first.gridPoint.longitude
      ) {
        throw new Error("GEFS members resolved to inconsistent grid points for one ensemble query");
      }
      if (field && JSON.stringify(sample.temporal) !== JSON.stringify(first.temporal)) {
        throw new Error("GEFS members resolved to inconsistent temporal semantics for one field ensemble query");
      }
    }

    const values = samples.map((sample) => sample.value);
    const output = (field ?? variable!).outputs[0];
    const summary = summarizeNumericDistribution(values, query.quantiles);
    const threshold = query.thresholdGte === undefined
      ? undefined
      : thresholdGteSummary(values, query.thresholdGte);

    return gefsEnsembleResultSchema.parse({
      model: "gefs_0p50",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      selection: field
        ? {
            field: field.id,
            gfsCode: field.gfsCode,
            outputField: output.field,
            unit: output.unit,
            vertical: { ...field.level },
            temporal: first.temporal,
          }
        : {
            variable: query.variable,
            gfsCode: variable!.gfsCode,
            pressureLevelHpa: query.pressureLevelHpa,
            outputField: output.field,
            unit: output.unit,
          },
      members: samples.map(({ member, value, cacheHit }) => ({ member, value, cacheHit })),
      summary: {
        ...summary,
        ...(threshold === undefined ? {} : { threshold }),
      },
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: "wgrib2",
        product: "pgrb2a_0p50",
        allCacheHit: samples.every((sample) => sample.cacheHit),
      },
    });
  }

  private async samplePressureMember(
    member: GefsMember,
    run: Date,
    forecastHour: number,
    latitude: number,
    longitude: number,
    variable: RawVariableDefinition,
    pressureLevelHpa: number,
  ): Promise<EnsembleSample> {
    const file = await this.source.fetch({
      run,
      forecastHour,
      member,
      variableCode: variable.gfsCode,
      pressureLevelHpa,
    });
    const decoded = await this.decoder.extractPoint(file.path, longitude, latitude);
    const value = decoded.find((candidate) =>
      candidate.code === variable.gfsCode && candidate.pressureHpa === pressureLevelHpa,
    );
    if (!value) {
      throw new Error(`Decoded GEFS ${member} subset is missing ${variable.gfsCode}@${pressureLevelHpa}mb`);
    }
    return {
      member,
      value: normalizeValue(variable.sourceUnit, variable.outputs[0].unit, value.value),
      gridPoint: value.gridPoint,
      cacheHit: file.cacheHit,
    };
  }

  private async sampleFieldMember(
    member: GefsMember,
    run: Date,
    forecastHour: number,
    latitude: number,
    longitude: number,
    field: RawGefsFieldDefinition,
  ): Promise<EnsembleSample> {
    const file = await this.fieldSource.fetchSelection({
      run,
      forecastHour,
      member,
      variableCodes: [],
      pressureLevelsHpa: [],
      fields: [field],
    });
    const decoded = await this.decoder.extractPoint(file.path, longitude, latitude);
    const value = decoded.find((candidate) =>
      candidate.code === field.gfsCode
      && matchesFieldLevel(candidate, field.level.gribLevel)
      && matchesFieldTemporal(candidate, field.temporalSemantics),
    );
    if (!value) {
      throw new Error(`Decoded GEFS ${member} subset is missing ${field.gfsCode}@${field.level.gribLevel} (${field.temporalSemantics})`);
    }
    return {
      member,
      value: normalizeValue(field.sourceUnit, field.outputs[0].unit, value.value),
      gridPoint: value.gridPoint,
      cacheHit: file.cacheHit,
      temporal: temporalResult(field, value, run),
    };
  }
}

function matchesFieldLevel(value: DecodedValue, gribLevel: string): boolean {
  if (gribLevel === "surface") return value.surface === true;
  const height = gribLevel.match(/^(\d+(?:\.\d+)?) m above ground$/)?.[1];
  if (height !== undefined) return value.heightAboveGroundM === Number(height);
  return value.namedVertical === gribLevel;
}

function matchesFieldTemporal(
  value: DecodedValue,
  semantics: RawGefsFieldDefinition["temporalSemantics"],
): boolean {
  if (semantics === "accumulation") return value.accumulation !== undefined;
  if (semantics === "average") return value.average !== undefined;
  return value.accumulation === undefined && value.average === undefined;
}

function temporalResult(
  field: RawGefsFieldDefinition,
  value: DecodedValue,
  run: Date,
): FieldTemporalResult {
  if (field.temporalSemantics === "instantaneous") return { type: "instantaneous" };
  const interval = field.temporalSemantics === "accumulation" ? value.accumulation : value.average;
  if (!interval) throw new Error(`Decoded ${field.id} is missing ${field.temporalSemantics} interval metadata`);
  return {
    type: field.temporalSemantics,
    ...interval,
    startTime: forecastTime(run, interval.startForecastHour),
    endTime: forecastTime(run, interval.endForecastHour),
  };
}

function forecastTime(run: Date, forecastHour: number): string {
  return new Date(run.getTime() + forecastHour * 60 * 60 * 1000).toISOString();
}

function normalizeValue(sourceUnit: string, outputUnit: string, value: number): number {
  if (sourceUnit === "K" && outputUnit === "degC") return value - 273.15;
  return value;
}
