import { homedir } from "node:os";
import { join } from "node:path";
import {
  GefsS3SubsetCache,
  type GefsMemberSelectionSource,
} from "../cache/gefs-s3-subset-cache.js";
import {
  GEFS_PGRB2A_FIELD_CATALOG,
  type RawGefsFieldDefinition,
} from "../catalog/gefs-fields.js";
import {
  sortGefsMembers,
  type GefsMember,
} from "../catalog/gefs.js";
import { VARIABLE_CATALOG, type RawVariableDefinition } from "../catalog/variables.js";
import { deriveSpecificHumidityFromRelativeHumidityKgKg } from "../derived/humidity.js";
import {
  deriveParcelComputation,
  type ParcelEnvironmentLevel,
} from "../derived/parcel-diagnostics.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import type { NonIsobaricGribSelector } from "../grib/index.js";
import {
  gefsParcelDiagnosticsQuerySchema,
  gefsParcelDiagnosticsResultSchema,
  type GefsParcelDiagnosticsQueryInput,
  type GefsParcelDiagnosticsResult,
} from "../schema/gefs-parcel-diagnostics.js";
import type { DecodedValue, ProfileLevel } from "./types.js";
import { mapConcurrent } from "./concurrency.js";
import { summarizeNumericDistribution } from "./ensemble-statistics.js";
import { DEFAULT_GEFS_MEMBER_CONCURRENCY, type GefsPointDecoder } from "./gefs-ensemble.js";
import { GefsLatestRunResolver, type GefsLatestRunProvider } from "./gefs-latest-run.js";
import { gefsForecastHour, parseGefsRun } from "./gefs-time.js";

const PRESSURE_VARIABLE_IDS = ["temperature", "relative_humidity", "geopotential_height"] as const;
const PRESSURE_VARIABLES = PRESSURE_VARIABLE_IDS.map((id) => ({
  id,
  definition: VARIABLE_CATALOG[id] as RawVariableDefinition,
}));
const FORECAST_FIELDS = [
  GEFS_PGRB2A_FIELD_CATALOG.surface_pressure,
  GEFS_PGRB2A_FIELD_CATALOG.temperature_2m,
  GEFS_PGRB2A_FIELD_CATALOG.relative_humidity_2m,
] as RawGefsFieldDefinition[];
const SURFACE_GEOPOTENTIAL_SELECTOR: NonIsobaricGribSelector = {
  id: "surface_geopotential_height",
  gfsCode: "HGT",
  level: { gribLevel: "surface" },
  temporalSemantics: "instantaneous",
};

export interface GefsParcelDiagnosticsServiceOptions {
  cacheDir?: string;
  wgrib2Path?: string;
  source?: GefsMemberSelectionSource;
  decoder?: GefsPointDecoder;
  latestRunProvider?: GefsLatestRunProvider;
  concurrency?: number;
}

interface DerivedMemberParcel {
  member: GefsMember;
  forecastCacheHit: boolean;
  surfaceOrographyCacheHit: boolean;
  gridPoint: { latitude: number; longitude: number };
  levels: ProfileLevel[];
  parcel: ReturnType<typeof deriveParcelComputation>;
}

export class GefsParcelDiagnosticsService {
  private readonly source: GefsMemberSelectionSource;
  private readonly decoder: GefsPointDecoder;
  private readonly latestRunProvider: GefsLatestRunProvider;
  private readonly concurrency: number;

  constructor(options: GefsParcelDiagnosticsServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new GefsS3SubsetCache(join(cacheDir, "gefs-s3"));
    this.decoder = options.decoder ?? new Wgrib2Decoder(options.wgrib2Path);
    this.latestRunProvider = options.latestRunProvider ?? new GefsLatestRunResolver();
    this.concurrency = options.concurrency ?? DEFAULT_GEFS_MEMBER_CONCURRENCY;
  }

  async getParcelDiagnostics(input: GefsParcelDiagnosticsQueryInput): Promise<GefsParcelDiagnosticsResult> {
    const query = gefsParcelDiagnosticsQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortGefsMembers(query.members);
    const pressureLevelsHpa = [...query.pressureLevelsHpa].sort((a, b) => b - a);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, members)
      : parseGefsRun(query.run);
    const forecastHour = gefsForecastHour(run, validTime);

    const derivedMembers = await mapConcurrent(members, this.concurrency, async (member) =>
      this.deriveMember(
        member,
        run,
        forecastHour,
        query.latitude,
        query.longitude,
        pressureLevelsHpa,
        query.parcel,
      ),
    );
    const first = derivedMembers[0];
    if (!first) throw new Error("GEFS parcel diagnostics produced no member samples");
    for (const member of derivedMembers) {
      if (
        member.gridPoint.latitude !== first.gridPoint.latitude
        || member.gridPoint.longitude !== first.gridPoint.longitude
      ) {
        throw new Error("GEFS parcel members resolved to inconsistent grid points");
      }
    }

    return gefsParcelDiagnosticsResultSchema.parse({
      model: "gefs_0p50",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint: first.gridPoint,
      sampledPressureLevelsHpa: pressureLevelsHpa,
      selection: { parcel: query.parcel, members, quantiles },
      methodology: {
        pressureMoisture: "temperature_relative_humidity_pressure_to_specific_humidity_per_member",
        surfaceMoisture: "2m_temperature_relative_humidity_surface_pressure_to_specific_humidity_per_member",
        surfaceOrography: "same_cycle_f000_surface_geopotential_height",
      },
      summary: summarizeParcels(derivedMembers, quantiles),
      ...(query.includeMembers
        ? {
            members: derivedMembers.map(({ member, forecastCacheHit, surfaceOrographyCacheHit, levels, parcel }) => ({
              member,
              forecastCacheHit,
              surfaceOrographyCacheHit,
              levels,
              parcel,
            })),
          }
        : {}),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: this.decoder.engine ?? "wgrib2",
        product: "pgrb2a_0p50",
        allCacheHit: derivedMembers.every((member) => member.forecastCacheHit && member.surfaceOrographyCacheHit),
      },
    });
  }

  private async deriveMember(
    member: GefsMember,
    run: Date,
    forecastHour: number,
    latitude: number,
    longitude: number,
    pressureLevelsHpa: number[],
    parcelDefinition: "surface_2m" | "mixed_layer_100hpa" | "most_unstable_300hpa",
  ): Promise<DerivedMemberParcel> {
    const forecastFile = await this.source.fetchSelection({
      run,
      forecastHour,
      member,
      variableCodes: PRESSURE_VARIABLES.map(({ definition }) => definition.gfsCode),
      pressureLevelsHpa,
      fields: FORECAST_FIELDS,
    });
    const forecastValues = await this.decoder.extractPoint(forecastFile.path, longitude, latitude);

    // GEFS pgrb2a publishes surface HGT in f000 but not regular forecast files.
    // It is model orography, so fetch the same cycle/member's f000 field and let
    // the immutable S3 subset cache collapse repeated time-series use.
    const orographyFile = await this.source.fetchSelection({
      run,
      forecastHour: 0,
      member,
      variableCodes: [],
      pressureLevelsHpa: [],
      fields: [SURFACE_GEOPOTENTIAL_SELECTOR],
    });
    const orographyValues = await this.decoder.extractPoint(orographyFile.path, longitude, latitude);

    const surfacePressurePa = requiredFieldValue(forecastValues, "PRES", "surface");
    const surfaceTemperatureC = requiredFieldValue(forecastValues, "TMP", "2m") - 273.15;
    const surfaceRelativeHumidityPct = requiredFieldValue(forecastValues, "RH", "2m");
    const surfaceHeight = requiredFieldValue(orographyValues, "HGT", "surface");
    const gridPoint = requiredGridPoint(forecastValues, orographyValues);
    const surface: ParcelEnvironmentLevel = {
      pressureHpa: surfacePressurePa / 100,
      geopotentialHeightGpm: surfaceHeight,
      temperatureC: surfaceTemperatureC,
      specificHumidityKgKg: deriveSpecificHumidityFromRelativeHumidityKgKg(
        surfaceTemperatureC,
        surfaceRelativeHumidityPct,
        surfacePressurePa / 100,
      ),
    };

    const levels = pressureLevelsHpa.map((pressureHpa): ProfileLevel => {
      const temperatureC = requiredPressureValue(forecastValues, "TMP", pressureHpa) - 273.15;
      const relativeHumidityPct = requiredPressureValue(forecastValues, "RH", pressureHpa);
      const geopotentialHeightGpm = requiredPressureValue(forecastValues, "HGT", pressureHpa);
      return {
        pressureHpa,
        temperatureC,
        relativeHumidityPct,
        geopotentialHeightGpm,
        specificHumidityKgKg: deriveSpecificHumidityFromRelativeHumidityKgKg(
          temperatureC,
          relativeHumidityPct,
          pressureHpa,
        ),
      };
    });
    const environment: ParcelEnvironmentLevel[] = levels.map((level) => ({
      pressureHpa: level.pressureHpa,
      geopotentialHeightGpm: level.geopotentialHeightGpm!,
      temperatureC: level.temperatureC!,
      specificHumidityKgKg: level.specificHumidityKgKg!,
    }));

    return {
      member,
      forecastCacheHit: forecastFile.cacheHit,
      surfaceOrographyCacheHit: orographyFile.cacheHit,
      gridPoint,
      levels,
      parcel: deriveParcelComputation(parcelDefinition, surface, environment),
    };
  }
}

function requiredPressureValue(values: readonly DecodedValue[], code: string, pressureHpa: number): number {
  const candidate = values.find((value) => value.code === code && value.pressureHpa === pressureHpa);
  if (!candidate) throw new Error(`Decoded GEFS parcel environment is missing ${code}@${pressureHpa}mb`);
  return candidate.value;
}

function requiredFieldValue(values: readonly DecodedValue[], code: string, level: "surface" | "2m"): number {
  const candidate = values.find((value) =>
    value.code === code
    && (level === "surface" ? value.surface === true : value.heightAboveGroundM === 2),
  );
  if (!candidate) throw new Error(`Decoded GEFS parcel environment is missing ${code}@${level}`);
  return candidate.value;
}

function requiredGridPoint(
  forecastValues: readonly DecodedValue[],
  orographyValues: readonly DecodedValue[],
): { latitude: number; longitude: number } {
  const all = [...forecastValues, ...orographyValues];
  const first = all[0];
  if (!first) throw new Error("Decoded GEFS parcel environment produced no values");
  for (const value of all) {
    if (
      value.gridPoint.latitude !== first.gridPoint.latitude
      || value.gridPoint.longitude !== first.gridPoint.longitude
    ) {
      throw new Error("Decoded GEFS parcel fields resolved to inconsistent grid points");
    }
  }
  return first.gridPoint;
}

function summarizeParcels(members: readonly DerivedMemberParcel[], quantiles: readonly number[]) {
  const parcels = members.map((member) => member.parcel);
  return {
    startingPressureHpa: summarizeNumericDistribution(parcels.map((parcel) => parcel.startingState.pressureHpa), quantiles),
    startingTemperatureC: summarizeNumericDistribution(parcels.map((parcel) => parcel.startingState.temperatureC), quantiles),
    startingSpecificHumidityKgKg: summarizeNumericDistribution(parcels.map((parcel) => parcel.startingState.specificHumidityKgKg), quantiles),
    lclPressureHpa: summarizeNumericDistribution(parcels.map((parcel) => parcel.lcl.pressureHpa), quantiles),
    lclTemperatureC: summarizeNumericDistribution(parcels.map((parcel) => parcel.lcl.temperatureC), quantiles),
    capeJkg: summarizeNumericDistribution(parcels.map((parcel) => parcel.capeJkg), quantiles),
    cinJkg: summarizeNumericDistribution(parcels.map((parcel) => parcel.cinJkg), quantiles),
    membersWithPositiveCape: eventFraction(parcels.filter((parcel) => parcel.capeJkg > 0).length, parcels.length),
    lfc: summarizeBoundary(parcels.map((parcel) => parcel.lfc), parcels.length, quantiles),
    el: summarizeBoundary(parcels.map((parcel) => parcel.el), parcels.length, quantiles),
  };
}

function summarizeBoundary(
  boundaries: readonly ({ pressureHpa: number; geopotentialHeightGpm?: number } | undefined)[],
  memberCount: number,
  quantiles: readonly number[],
) {
  const present = boundaries.filter((boundary): boundary is { pressureHpa: number; geopotentialHeightGpm?: number } => boundary !== undefined);
  const heights = present
    .map((boundary) => boundary.geopotentialHeightGpm)
    .filter((value): value is number => value !== undefined);
  return {
    membersWithBoundary: eventFraction(present.length, memberCount),
    ...(present.length === 0 ? {} : {
      pressureHpa: summarizeNumericDistribution(present.map((boundary) => boundary.pressureHpa), quantiles),
    }),
    ...(heights.length === present.length && heights.length > 0 ? {
      geopotentialHeightGpm: summarizeNumericDistribution(heights, quantiles),
    } : {}),
  };
}

function eventFraction(count: number, memberCount: number) {
  return {
    count,
    memberCount,
    fraction: count / memberCount,
    interpretation: "raw_member_fraction_not_calibrated_probability" as const,
  };
}
