import type { UpstreamAccessPolicy } from "../access/access-policy.js";
import { fetchWithRetry } from "../access/http-fetch.js";
import type { HttpRetryExecutionOptions } from "../access/http-retry.js";
import { formatHttpStatus } from "../access/http-failure.js";
import { WFG_USER_AGENT } from "../access/user-agent.js";
import type { RawNonIsobaricFieldDefinition } from "../catalog/non-isobaric-fields.js";
import type { RawVariableDefinition } from "../catalog/variables.js";
import type { GfsGrid } from "../catalog/gfs-grid.js";
import {
  DataUnavailableError,
  RateLimitedError,
  UpstreamUnavailableError,
} from "../failure.js";

export interface NomadsPointRequest {
  run: Date;
  grid?: GfsGrid;
  forecastHour: number;
  latitude: number;
  longitude: number;
  variables: RawVariableDefinition[];
  pressureLevelsHpa: number[];
  fields?: RawNonIsobaricFieldDefinition[];
}

export interface NomadsAreaRequest {
  run: Date;
  grid?: GfsGrid;
  forecastHour: number;
  westLongitude: number;
  eastLongitude: number;
  southLatitude: number;
  northLatitude: number;
  variables: RawVariableDefinition[];
  pressureLevelsHpa: number[];
  fields?: RawNonIsobaricFieldDefinition[];
}

export interface NomadsPointGribSource {
  fetchPoint(request: NomadsPointRequest): Promise<Uint8Array>;
}

export interface NomadsAreaGribSource {
  fetchArea(request: NomadsAreaRequest): Promise<Uint8Array>;
}

type NomadsRequest = NomadsAreaRequest;

export class NomadsSource implements NomadsPointGribSource, NomadsAreaGribSource {
  constructor(
    private readonly accessPolicy?: UpstreamAccessPolicy,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly retryOptions: HttpRetryExecutionOptions = {},
  ) {}

  fetchPoint(request: NomadsPointRequest): Promise<Uint8Array> {
    return this.fetchGrib(buildNomadsPointUrl(request));
  }

  fetchArea(request: NomadsAreaRequest): Promise<Uint8Array> {
    return this.fetchGrib(buildNomadsAreaUrl(request));
  }

  private async fetchGrib(url: string): Promise<Uint8Array> {
    const response = await fetchWithRetry(
      url,
      { headers: { "user-agent": WFG_USER_AGENT } },
      {
        ...this.retryOptions,
        fetchFn: this.fetchFn,
        ...(this.accessPolicy === undefined ? {} : { accessPolicy: this.accessPolicy }),
      },
    );
    if (response.status === 404) {
      throw new DataUnavailableError("NOMADS has no data for the requested GFS run and forecast hour", {
        details: { provider: "NOAA NOMADS", status: response.status },
      });
    }
    if (response.status === 429) {
      throw new RateLimitedError("NOAA NOMADS rate limit remained exhausted after retries", {
        details: { provider: "NOAA NOMADS", status: response.status },
      });
    }
    if (response.status >= 500 && response.status <= 599) {
      throw new UpstreamUnavailableError(
        `NOAA NOMADS is unavailable after retries (${formatHttpStatus(response.status, response.statusText)})`,
        { details: { provider: "NOAA NOMADS", status: response.status } },
      );
    }
    if (!response.ok) {
      throw new UpstreamUnavailableError(
        `NOAA NOMADS rejected the request (${formatHttpStatus(response.status, response.statusText)})`,
        {
          retryable: false,
          details: { provider: "NOAA NOMADS", status: response.status },
        },
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 4 || new TextDecoder().decode(bytes.slice(0, 4)) !== "GRIB") {
      throw new UpstreamUnavailableError("NOAA NOMADS returned invalid non-GRIB content", {
        retryable: true,
        details: { provider: "NOAA NOMADS" },
      });
    }
    return bytes;
  }
}

export function buildNomadsPointUrl(request: NomadsPointRequest): string {
  return buildNomadsUrl({
    run: request.run,
    ...(request.grid === undefined ? {} : { grid: request.grid }),
    forecastHour: request.forecastHour,
    westLongitude: Math.max(-180, request.longitude - 0.5),
    eastLongitude: Math.min(180, request.longitude + 0.5),
    southLatitude: Math.max(-90, request.latitude - 0.5),
    northLatitude: Math.min(90, request.latitude + 0.5),
    variables: request.variables,
    pressureLevelsHpa: request.pressureLevelsHpa,
    ...(request.fields === undefined ? {} : { fields: request.fields }),
  });
}

export function buildNomadsAreaUrl(request: NomadsAreaRequest): string {
  return buildNomadsUrl(request);
}

function buildNomadsUrl(request: NomadsRequest): string {
  const runDate = yyyymmdd(request.run);
  const runHour = request.run.getUTCHours().toString().padStart(2, "0");
  const forecastHour = request.forecastHour.toString().padStart(3, "0");

  const grid = request.grid ?? "0p25";
  const params = new URLSearchParams({
    dir: `/gfs.${runDate}/${runHour}/atmos`,
    file: grid === "0p50"
      ? `gfs.t${runHour}z.pgrb2full.0p50.f${forecastHour}`
      : `gfs.t${runHour}z.pgrb2.0p25.f${forecastHour}`,
    subregion: "",
    toplat: request.northLatitude.toString(),
    bottomlat: request.southLatitude.toString(),
    leftlon: request.westLongitude.toString(),
    rightlon: request.eastLongitude.toString(),
  });

  const fields = request.fields ?? [];
  const variableCodes = [
    ...new Set([
      ...request.variables.map((variable) => variable.gfsCode),
      ...fields.map((field) => field.gfsCode),
    ]),
  ].sort();
  const pressureLevels = [...new Set(request.pressureLevelsHpa)].sort((a, b) => b - a);
  const nonIsobaricLevels = [...new Set(fields.map((field) => field.level.nomadsLevel))].sort();

  for (const code of variableCodes) params.set(`var_${code}`, "on");
  for (const level of pressureLevels) params.set(`lev_${level}_mb`, "on");
  for (const level of nonIsobaricLevels) params.set(`lev_${level}`, "on");

  return `https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_${grid}.pl?${params.toString()}`;
}

function yyyymmdd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}
