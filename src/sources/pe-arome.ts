import type { RawNonIsobaricFieldDefinition } from "../catalog/non-isobaric-fields.js";
import {
  peAromeMemberNumber,
  type PeAromeMember,
} from "../catalog/pe-arome.js";

export const PE_AROME_MAX_FORECAST_HOUR = 51;
export const PE_AROME_FORECAST_INTERVAL_HOURS = 1;
const HOUR_MS = 3_600_000;
const CYCLE_MS = 6 * HOUR_MS;
const CYCLE_OFFSET_MS = 3 * HOUR_MS;

export interface PeAromeSpatialSubset {
  westLongitude: number;
  eastLongitude: number;
  southLatitude: number;
  northLatitude: number;
}

export interface PeAromeCoverageRequest {
  run: Date;
  forecastHour: number;
  field: RawNonIsobaricFieldDefinition;
  subset: PeAromeSpatialSubset;
}

interface WcsFieldMapping {
  coverageName: string;
  heightM: number;
}

const WCS_FIELD_MAPPINGS: Partial<Record<RawNonIsobaricFieldDefinition["id"], WcsFieldMapping>> = {
  temperature_2m: {
    coverageName: "TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND",
    heightM: 2,
  },
  relative_humidity_2m: {
    coverageName: "RELATIVE_HUMIDITY__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND",
    heightM: 2,
  },
};

export function parsePeAromeRun(value: string): Date {
  const run = new Date(value);
  if (!Number.isFinite(run.getTime()) || run.toISOString() !== value) {
    throw new Error("PE-AROME run must be a canonical timezone-aware ISO instant");
  }
  assertPeAromeCycle(run);
  return run;
}

export function assertPeAromeCycle(run: Date): void {
  const hour = run.getUTCHours();
  if (
    run.getUTCMinutes() !== 0
    || run.getUTCSeconds() !== 0
    || run.getUTCMilliseconds() !== 0
    || ![3, 9, 15, 21].includes(hour)
  ) {
    throw new Error("PE-AROME runs initialize at 03, 09, 15, or 21 UTC");
  }
}

export function floorToPeAromeCycle(value: Date): Date {
  const shifted = value.getTime() - CYCLE_OFFSET_MS;
  return new Date(Math.floor(shifted / CYCLE_MS) * CYCLE_MS + CYCLE_OFFSET_MS);
}

export function peAromeForecastHour(run: Date, validTime: Date): number {
  assertPeAromeCycle(run);
  const deltaHours = (validTime.getTime() - run.getTime()) / HOUR_MS;
  if (!Number.isInteger(deltaHours)) {
    throw new Error("PE-AROME valid times must align to the native hourly forecast cadence");
  }
  if (deltaHours < 0 || deltaHours > PE_AROME_MAX_FORECAST_HOUR) {
    throw new Error(
      `PE-AROME forecast hour must be between 0 and ${PE_AROME_MAX_FORECAST_HOUR}`,
    );
  }
  return deltaHours;
}

export function peAromeValidTime(run: Date, forecastHour: number): Date {
  assertPeAromeCycle(run);
  if (
    !Number.isInteger(forecastHour)
    || forecastHour < 0
    || forecastHour > PE_AROME_MAX_FORECAST_HOUR
  ) {
    throw new Error(
      `PE-AROME forecast hour must be an integer from 0 to ${PE_AROME_MAX_FORECAST_HOUR}`,
    );
  }
  return new Date(run.getTime() + forecastHour * HOUR_MS);
}

export function peAromeNativeForecastHoursInRange(
  run: Date,
  startTime: Date,
  endTime: Date,
): number[] {
  if (endTime.getTime() < startTime.getTime()) {
    throw new Error("endTime must be at or after startTime");
  }
  const first = Math.max(0, Math.ceil((startTime.getTime() - run.getTime()) / HOUR_MS));
  const last = Math.min(
    PE_AROME_MAX_FORECAST_HOUR,
    Math.floor((endTime.getTime() - run.getTime()) / HOUR_MS),
  );
  if (first > last) {
    throw new Error("No native PE-AROME forecast outputs fall inside the requested time range");
  }
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

export function formatPeAromeWcsRun(run: Date): string {
  assertPeAromeCycle(run);
  return run.toISOString().replace(/:(\d{2}):(\d{2})\.000Z$/, ".$1.$2Z");
}

export function buildPeAromeGetCoverageUrl(
  endpoint: string,
  request: PeAromeCoverageRequest,
): string {
  const mapping = WCS_FIELD_MAPPINGS[request.field.id];
  if (mapping === undefined) {
    throw new Error(
      `PE-AROME WCS coverage mapping is not defined for field=${request.field.id}`,
    );
  }
  const forecastHour = peAromeForecastHour(
    request.run,
    peAromeValidTime(request.run, request.forecastHour),
  );
  const validTime = peAromeValidTime(request.run, forecastHour);
  const coverageId = `${mapping.coverageName}___${formatPeAromeWcsRun(request.run)}`;
  const base = endpoint.endsWith("/GetCoverage")
    ? endpoint
    : `${endpoint.replace(/\/$/, "")}/GetCoverage`;
  const url = new URL(base);
  url.searchParams.set("service", "WCS");
  url.searchParams.set("version", "2.0.1");
  url.searchParams.set("coverageid", coverageId);
  url.searchParams.append(
    "subset",
    `long(${request.subset.westLongitude},${request.subset.eastLongitude})`,
  );
  url.searchParams.append(
    "subset",
    `lat(${request.subset.southLatitude},${request.subset.northLatitude})`,
  );
  url.searchParams.append("subset", `time(${validTime.toISOString()})`);
  url.searchParams.append("subset", `height(${mapping.heightM})`);
  url.searchParams.set("format", "application/wmo-grib");
  return url.toString();
}

export function resolvePeAromeWcsEndpoint(
  member: PeAromeMember,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const encoded = env.WFG_PEAROME_WCS_ENDPOINTS;
  if (encoded !== undefined && encoded.trim() !== "") {
    let endpoints: Record<string, unknown>;
    try {
      endpoints = JSON.parse(encoded) as Record<string, unknown>;
    } catch {
      throw new Error("WFG_PEAROME_WCS_ENDPOINTS must be a JSON object keyed by c00,p01..p24");
    }
    const endpoint = endpoints[member];
    if (typeof endpoint !== "string" || endpoint.trim() === "") {
      throw new Error(`WFG_PEAROME_WCS_ENDPOINTS has no endpoint for member=${member}`);
    }
    return endpoint;
  }

  const template = env.WFG_PEAROME_WCS_URL_TEMPLATE;
  if (template !== undefined && template.trim() !== "") {
    const memberNumber = peAromeMemberNumber(member);
    return template
      .replaceAll("{member}", member)
      .replaceAll("{member_number}", String(memberNumber))
      .replaceAll("{member_number_2}", String(memberNumber).padStart(2, "0"));
  }

  throw new Error(
    "PE-AROME requires WFG_PEAROME_WCS_URL_TEMPLATE or WFG_PEAROME_WCS_ENDPOINTS from the subscribed Météo-France PEAROME API",
  );
}

export function resolveMeteoFranceBearerToken(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const token = env.WFG_METEO_FRANCE_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "PE-AROME requires WFG_METEO_FRANCE_TOKEN containing a current Météo-France API bearer token",
    );
  }
  return token;
}
