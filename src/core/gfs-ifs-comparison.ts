import { VARIABLE_CATALOG } from "../catalog/variables.js";
import {
  gfsIfsComparisonQuerySchema,
  gfsIfsComparisonResultSchema,
  type GfsIfsComparisonQueryInput,
  type GfsIfsComparisonResult,
} from "../schema/gfs-ifs-comparison.js";
import type { IfsPointQueryInput, IfsProfileResult } from "../schema/ifs.js";
import type { ProfileQueryInput } from "../schema/query.js";
import type { ProfileLevel, ProfileResult } from "./types.js";
import {
  GfsIfsAlignedRunResolver,
  type GfsIfsAlignedRunProvider,
} from "./gfs-ifs-aligned-run.js";
import { IfsProfileService } from "./ifs-profile.js";
import { ifsForecastHour, parseIfsRun } from "./ifs-time.js";
import { forecastHour, parseGfsRun } from "./forecast-hour.js";
import { ProfileService } from "./profile.js";

export interface GfsComparisonProfileGetter {
  getProfile(query: ProfileQueryInput): Promise<ProfileResult>;
}

export interface IfsComparisonProfileGetter {
  getProfile(query: IfsPointQueryInput): Promise<IfsProfileResult>;
}

export interface GfsIfsComparisonServiceOptions {
  gfsProfileGetter?: GfsComparisonProfileGetter;
  ifsProfileGetter?: IfsComparisonProfileGetter;
  alignedRunProvider?: GfsIfsAlignedRunProvider;
}

export class GfsIfsComparisonService {
  private readonly gfsProfileGetter: GfsComparisonProfileGetter;
  private readonly ifsProfileGetter: IfsComparisonProfileGetter;
  private readonly alignedRunProvider: GfsIfsAlignedRunProvider;

  constructor(options: GfsIfsComparisonServiceOptions = {}) {
    this.gfsProfileGetter = options.gfsProfileGetter ?? new ProfileService();
    this.ifsProfileGetter = options.ifsProfileGetter ?? new IfsProfileService();
    this.alignedRunProvider = options.alignedRunProvider ?? new GfsIfsAlignedRunResolver();
  }

  async compare(input: GfsIfsComparisonQueryInput): Promise<GfsIfsComparisonResult> {
    const query = gfsIfsComparisonQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const run = query.run === "latest"
      ? await this.alignedRunProvider.resolveLatestAlignedRun(
          validTime,
          query.variable,
          query.pressureLevelHpa,
          query.gfsGrid,
        )
      : parseSharedRun(query.run);

    const runIso = run.toISOString();
    const gfsForecastHour = forecastHour(run, validTime, query.gfsGrid);
    const ifsForecastHourValue = ifsForecastHour(run, validTime);
    if (gfsForecastHour !== ifsForecastHourValue) {
      throw new Error("GFS/IFS comparison received inconsistent forecast-hour semantics");
    }

    const [gfs, ifs] = await Promise.all([
      this.gfsProfileGetter.getProfile({
        latitude: query.latitude,
        longitude: query.longitude,
        run: runIso,
        ...(query.gfsGrid === undefined ? {} : { grid: query.gfsGrid }),
        validTime: query.validTime,
        variables: [query.variable],
        pressureLevelsHpa: [query.pressureLevelHpa],
        source: "s3",
      }),
      this.ifsProfileGetter.getProfile({
        latitude: query.latitude,
        longitude: query.longitude,
        run: runIso,
        validTime: query.validTime,
        variables: [query.variable],
        pressureLevelsHpa: [query.pressureLevelHpa],
      }),
    ]);

    if (gfs.run !== runIso || ifs.run !== runIso) {
      throw new Error("GFS/IFS comparison received data from inconsistent initialization cycles");
    }
    if (gfs.validTime !== ifs.validTime || gfs.forecastHour !== ifs.forecastHour) {
      throw new Error("GFS/IFS comparison received inconsistent valid-time semantics");
    }

    const gfsLevel = findLevel(gfs.levels, query.pressureLevelHpa, "GFS");
    const ifsLevel = findLevel(ifs.levels, query.pressureLevelHpa, "IFS");
    const definition = VARIABLE_CATALOG[query.variable];
    const outputs = definition.outputs.map((output) => {
      const gfsValue = levelValue(gfsLevel, output.field, "GFS");
      const ifsValue = levelValue(ifsLevel, output.field, "IFS");
      const deltaKind = output.field === "windDirectionDeg"
        ? "circular_degrees" as const
        : "linear" as const;
      return {
        field: output.field,
        unit: output.unit,
        gfsValue,
        ifsValue,
        ifsMinusGfs: deltaKind === "circular_degrees"
          ? shortestCircularDifferenceDegrees(ifsValue, gfsValue)
          : ifsValue - gfsValue,
        deltaKind,
      };
    });

    return gfsIfsComparisonResultSchema.parse({
      run: runIso,
      validTime: query.validTime,
      forecastHour: gfsForecastHour,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      selection: {
        variable: query.variable,
        pressureLevelHpa: query.pressureLevelHpa,
        outputs: definition.outputs.map((output) => ({ field: output.field, unit: output.unit })),
      },
      gfs: {
        model: gfs.model,
        gridPoint: gfs.gridPoint,
        values: outputs.map((output) => ({
          field: output.field,
          unit: output.unit,
          value: output.gfsValue,
        })),
        source: gfs.source,
      },
      ifs: {
        model: ifs.model,
        gridPoint: ifs.gridPoint,
        values: outputs.map((output) => ({
          field: output.field,
          unit: output.unit,
          value: output.ifsValue,
        })),
        source: ifs.source,
      },
      comparison: {
        outputs,
        interpretation: "raw_deterministic_model_difference_not_error_or_uncertainty",
      },
    });
  }
}

function parseSharedRun(value: string): Date {
  const gfs = parseGfsRun(value);
  const ifs = parseIfsRun(value);
  if (gfs.getTime() !== ifs.getTime()) {
    throw new Error("GFS/IFS comparison requires one shared 00/06/12/18 UTC initialization cycle");
  }
  return gfs;
}

function findLevel(levels: readonly ProfileLevel[], pressureHpa: number, model: string): ProfileLevel {
  const level = levels.find((candidate) => candidate.pressureHpa === pressureHpa);
  if (!level) throw new Error(`${model} comparison profile is missing ${pressureHpa} hPa`);
  return level;
}

function levelValue(level: ProfileLevel, field: string, model: string): number {
  const value = (level as unknown as Record<string, unknown>)[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${model} comparison profile is missing output field ${field}@${level.pressureHpa}hPa`);
  }
  return value;
}

function shortestCircularDifferenceDegrees(left: number, right: number): number {
  const delta = ((left - right + 540) % 360) - 180;
  return delta === -180 ? 180 : delta;
}
