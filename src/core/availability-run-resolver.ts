import { homedir } from "node:os";
import { join } from "node:path";
import { AigefsS3SubsetCache } from "../cache/aigefs-s3-subset-cache.js";
import { AifsEnsOpenDataSubsetCache } from "../cache/aifs-ens-open-data-cache.js";
import { IconD2EpsOpenDataCache } from "../cache/icon-d2-eps-open-data-cache.js";
import { PeAromeWcsCache } from "../cache/pe-arome-wcs-cache.js";
import { AIFS_ENS_MEMBERS, type AifsEnsMember } from "../catalog/aifs-ens.js";
import { AIGEFS_MEMBERS } from "../catalog/aigefs.js";
import { GEFS_MAX_FORECAST_HOUR, GEFS_MEMBERS, type GefsMember } from "../catalog/gefs.js";
import { ICON_D2_EPS_MEMBERS } from "../catalog/icon-d2-eps.js";
import { PE_AROME_MEMBERS } from "../catalog/pe-arome.js";
import { expandRequestedFields } from "../catalog/non-isobaric-fields.js";
import { expandRequestedVariables } from "../catalog/variables.js";
import type { QueryAtmosphereRequest } from "../schema/unified-api.js";
import {
  AIGFS_MAX_FORECAST_HOUR,
  aigfsNativeForecastHoursInRange,
  aigfsValidTime,
} from "../sources/aigfs.js";
import {
  ICON_D2_MAX_FORECAST_HOUR,
  iconD2NativeForecastHoursInRange,
  iconD2ValidTime,
} from "../sources/icon-d2.js";
import {
  PE_AROME_MAX_FORECAST_HOUR,
  peAromeNativeForecastHoursInRange,
  peAromeValidTime,
  parsePeAromeRun,
} from "../sources/pe-arome.js";
import { AifsLatestRunResolver } from "./aifs-run.js";
import {
  AIFS_MAX_FORECAST_HOUR,
  aifsForecastHoursInRange,
  aifsValidTime,
} from "./aifs-time.js";
import { AifsForecastService } from "./aifs.js";
import { AigfsRunResolver } from "./aigfs-run.js";
import { AigfsForecastService } from "./aigfs.js";
import { AromeForecastService } from "./arome.js";
import {
  GFS_MAX_FORECAST_HOUR,
  forecastHour,
  nativeForecastHoursInRange,
  parseGfsRun,
  validTimeForForecastHour,
} from "./forecast-hour.js";
import { GefsLatestRunResolver } from "./gefs-latest-run.js";
import { gefsForecastHour, parseGefsRun } from "./gefs-time.js";
import { IfsEnsLatestRunResolver } from "./ifs-ens-latest-run.js";
import { IfsLatestRunResolver } from "./ifs-latest-run.js";
import { ifsIndexSelectorsForSelection } from "./ifs-profile.js";
import {
  ifsEnsForecastHoursInRange,
  ifsEnsMaxForecastHour,
  ifsEnsValidTimeForForecastHour,
  ifsForecastHoursInRange,
  ifsMaxForecastHour,
  ifsValidTimeForForecastHour,
  parseIfsRun,
} from "./ifs-time.js";
import { IconD2RunResolver } from "./icon-d2-run.js";
import { IconD2ForecastService } from "./icon-d2.js";
import {
  LatestRunResolver,
  resolveLatestCompleteRunForGrid,
  resolveLatestRunForGrid,
} from "./latest-run.js";
import { PeAromeRunResolver } from "./pe-arome-run.js";
import type { AtmosphericAvailabilityRunResolver } from "./atmospheric-availability.js";

const HOUR_MS = 3_600_000;
const AROME_MAX_FORECAST_HOUR = 51;
const HGEFS_MAX_FORECAST_HOUR = 240;

export interface DefaultAtmosphericAvailabilityRunResolverOptions {
  cacheDir?: string;
  now?: () => Date;
}

/**
 * Resolve forecast initialization availability through the same dataset-native
 * run resolvers used by normal queries. Those resolvers probe indexes/products;
 * this layer never downloads or decodes forecast payloads.
 */
export class DefaultAtmosphericAvailabilityRunResolver implements AtmosphericAvailabilityRunResolver {
  private readonly cacheDir: string;
  private readonly now: () => Date;
  private readonly gfs = new LatestRunResolver();
  private readonly gefs: GefsLatestRunResolver;
  private readonly ifs: IfsLatestRunResolver;
  private readonly ifsEns: IfsEnsLatestRunResolver;
  private readonly aigfs = new AigfsForecastService();
  private readonly aifs: AifsForecastService;
  private readonly iconD2 = new IconD2ForecastService();
  private readonly arome = new AromeForecastService();

  constructor(options: DefaultAtmosphericAvailabilityRunResolverOptions = {}) {
    this.cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.now = options.now ?? (() => new Date());
    this.gefs = new GefsLatestRunResolver({ now: this.now });
    this.ifs = new IfsLatestRunResolver({ cacheDir: this.cacheDir, now: this.now });
    this.ifsEns = new IfsEnsLatestRunResolver({ cacheDir: this.cacheDir, now: this.now });
    this.aifs = new AifsForecastService({
      cacheDir: this.cacheDir,
      latestRunProvider: new AifsLatestRunResolver({ cacheDir: this.cacheDir, now: this.now }),
    });
  }

  async resolve(request: QueryAtmosphereRequest): Promise<Date> {
    const run = await this.resolveNativeRun(request);
    this.assertDeclaredWindow(request, run);
    return run;
  }

  nativeValidTimes(
    request: QueryAtmosphereRequest,
    run: Date,
    from: Date,
    to: Date,
  ): Date[] {
    switch (request.dataset) {
      case "gfs": {
        const grid = request.forecast?.grid ?? "0p25";
        return nativeForecastHoursInRange(run, from, to, grid)
          .map((hour) => validTimeForForecastHour(run, hour));
      }
      case "gefs":
        return fixedStepTimes(run, from, to, 3, GEFS_MAX_FORECAST_HOUR);
      case "ifs":
        return ifsForecastHoursInRange(run, from, to)
          .map((hour) => ifsValidTimeForForecastHour(run, hour));
      case "ifs-ens":
        return ifsEnsForecastHoursInRange(run, from, to)
          .map((hour) => ifsEnsValidTimeForForecastHour(run, hour));
      case "aigfs":
      case "aigefs":
        return aigfsNativeForecastHoursInRange(run, from, to)
          .map((hour) => aigfsValidTime(run, hour));
      case "hgefs":
        return fixedStepTimes(run, from, to, 6, HGEFS_MAX_FORECAST_HOUR);
      case "aifs":
      case "aifs-ens":
        return aifsForecastHoursInRange(run, from, to)
          .map((hour) => aifsValidTime(run, hour));
      case "icon-d2":
      case "icon-d2-eps":
        return iconD2NativeForecastHoursInRange(run, from, to)
          .map((hour) => iconD2ValidTime(run, hour));
      case "arome":
        return fixedStepTimes(run, from, to, 1, AROME_MAX_FORECAST_HOUR);
      case "pe-arome":
        return peAromeNativeForecastHoursInRange(run, from, to)
          .map((hour) => peAromeValidTime(run, hour));
      case "gfs-analysis":
        return [];
    }
  }

  private async resolveNativeRun(request: QueryAtmosphereRequest): Promise<Date> {
    switch (request.dataset) {
      case "gfs":
        return this.resolveGfs(request);
      case "gefs":
        return this.resolveGefs(request);
      case "ifs":
        return this.resolveIfs(request, false);
      case "ifs-ens":
        return this.resolveIfs(request, true);
      case "aigfs":
        return this.aigfs.resolveQueryRun(request);
      case "aigefs":
        return this.aigefsMemberService(request).resolveQueryRun(asDataset(request, "aigfs"));
      case "hgefs":
        return this.aigefsMemberService(request).resolveQueryRun(asDataset(request, "aigfs"));
      case "aifs":
        return this.aifs.resolveQueryRun(request);
      case "aifs-ens":
        return this.aifsEnsMemberService(request).resolveQueryRun(asDataset(request, "aifs"));
      case "icon-d2":
        return this.iconD2.resolveQueryRun(request);
      case "icon-d2-eps":
        return this.iconD2EpsMemberService().resolveQueryRun(asDataset(request, "icon-d2"));
      case "arome":
        return this.arome.resolveQueryRun(request);
      case "pe-arome": {
        const selector = request.forecast?.run;
        if (selector !== undefined && selector !== "latest" && selector !== "latest_complete") {
          parsePeAromeRun(selector);
        }
        return this.peAromeMemberService(request).resolveQueryRun(asDataset(request, "arome"));
      }
      case "gfs-analysis":
        throw new Error("Forecast initialization availability is not defined for gfs-analysis");
    }
  }

  private async resolveGfs(request: QueryAtmosphereRequest): Promise<Date> {
    const grid = request.forecast?.grid ?? "0p25";
    const selector = request.forecast?.run ?? "latest";
    if (selector !== "latest" && selector !== "latest_complete") return parseGfsRun(selector);
    if (selector === "latest_complete") return resolveLatestCompleteRunForGrid(this.gfs, grid);

    const variables = expandRequestedVariables(request.selection.variables ?? []);
    const fields = expandRequestedFields(request.selection.fields ?? []);
    const selection = {
      variableCodes: variables.map((variable) => variable.gfsCode),
      pressureLevelsHpa: request.selection.pressureLevelsHpa ?? [],
      fields,
    };
    const requirement = "at" in request.time
      ? { type: "valid_time" as const, validTime: new Date(request.time.at), selection }
      : {
          type: "time_range" as const,
          startTime: new Date(request.time.from),
          endTime: new Date(request.time.to),
          selection,
        };
    return resolveLatestRunForGrid(this.gfs, requirement, grid);
  }

  private async resolveGefs(request: QueryAtmosphereRequest): Promise<Date> {
    const selector = request.forecast?.run ?? "latest";
    if (selector !== "latest") return parseGefsRun(selector);
    const members = (request.ensemble?.members ?? GEFS_MEMBERS) as readonly GefsMember[];
    return "at" in request.time
      ? this.gefs.resolveLatestRun(new Date(request.time.at), members)
      : this.gefs.resolveLatestRunRange(
          new Date(request.time.from),
          new Date(request.time.to),
          members,
        );
  }

  private async resolveIfs(request: QueryAtmosphereRequest, ensemble: boolean): Promise<Date> {
    const selector = request.forecast?.run ?? "latest";
    if (selector !== "latest") return parseIfsRun(selector);
    const selectors = ifsIndexSelectorsForSelection(request.selection as any);
    if (ensemble) {
      return "at" in request.time
        ? this.ifsEns.resolveLatestRun(new Date(request.time.at), selectors)
        : this.ifsEns.resolveLatestRunForRange(
            new Date(request.time.from),
            new Date(request.time.to),
            selectors,
          );
    }
    return "at" in request.time
      ? this.ifs.resolveLatestRun(new Date(request.time.at), selectors)
      : this.ifs.resolveLatestRunForRange(
          new Date(request.time.from),
          new Date(request.time.to),
          selectors,
        );
  }

  private aigefsMemberService(request: QueryAtmosphereRequest): AigfsForecastService {
    const member = String(request.ensemble?.members?.[0] ?? AIGEFS_MEMBERS[0]);
    const probe = new AigefsS3SubsetCache(
      join(this.cacheDir, "availability", request.dataset, member),
      member as any,
    );
    return new AigfsForecastService({
      cacheDir: this.cacheDir,
      runProvider: new AigfsRunResolver(probe, () => this.now().getTime()),
    });
  }

  private aifsEnsMemberService(request: QueryAtmosphereRequest): AifsForecastService {
    const member = (request.ensemble?.members?.[0] ?? AIFS_ENS_MEMBERS[0]) as AifsEnsMember;
    const source = new AifsEnsOpenDataSubsetCache(
      join(this.cacheDir, "availability", "aifs-ens", String(member)),
      member,
    );
    return new AifsForecastService({
      cacheDir: this.cacheDir,
      latestRunProvider: new AifsLatestRunResolver({ probe: source, cacheDir: this.cacheDir, now: this.now }),
    });
  }

  private iconD2EpsMemberService(): IconD2ForecastService {
    const cache = new IconD2EpsOpenDataCache(join(this.cacheDir, "availability", "icon-d2-eps"));
    return new IconD2ForecastService({
      cacheDir: this.cacheDir,
      runProvider: new IconD2RunResolver(cache, () => this.now().getTime()),
    });
  }

  private peAromeMemberService(request: QueryAtmosphereRequest): AromeForecastService {
    const member = String(request.ensemble?.members?.[0] ?? PE_AROME_MEMBERS[0]);
    const cache = new PeAromeWcsCache(
      join(this.cacheDir, "availability", "pe-arome", member),
      member as any,
    );
    return new AromeForecastService({
      cacheDir: this.cacheDir,
      runProvider: new PeAromeRunResolver(cache, () => this.now().getTime()),
    });
  }

  private assertDeclaredWindow(request: QueryAtmosphereRequest, run: Date): void {
    const maxHour = maxForecastHour(request.dataset, run);
    const start = "at" in request.time ? new Date(request.time.at) : new Date(request.time.from);
    const end = "at" in request.time ? start : new Date(request.time.to);
    if (start.getTime() < run.getTime() || end.getTime() > run.getTime() + maxHour * HOUR_MS) {
      throw new Error(
        `Requested valid-time window falls outside initialization ${run.toISOString()} (f0..f${maxHour}).`,
      );
    }
    const native = this.nativeValidTimes(request, run, start, end);
    if (native.length === 0) throw new Error("Requested valid-time window contains no native forecast output.");
    if ("at" in request.time && native[0]!.getTime() !== start.getTime()) {
      throw new Error("Requested valid time is not on the dataset's native forecast cadence.");
    }
  }
}

function asDataset(
  request: QueryAtmosphereRequest,
  dataset: "aigfs" | "aifs" | "icon-d2" | "arome",
): QueryAtmosphereRequest {
  return {
    ...request,
    dataset,
    ensemble: undefined,
    source: undefined,
  } as QueryAtmosphereRequest;
}

function maxForecastHour(dataset: QueryAtmosphereRequest["dataset"], run: Date): number {
  switch (dataset) {
    case "gfs": return GFS_MAX_FORECAST_HOUR;
    case "gefs": return GEFS_MAX_FORECAST_HOUR;
    case "ifs": return ifsMaxForecastHour(run);
    case "ifs-ens": return ifsEnsMaxForecastHour(run);
    case "aigfs":
    case "aigefs": return AIGFS_MAX_FORECAST_HOUR;
    case "hgefs": return HGEFS_MAX_FORECAST_HOUR;
    case "aifs":
    case "aifs-ens": return AIFS_MAX_FORECAST_HOUR;
    case "icon-d2":
    case "icon-d2-eps": return ICON_D2_MAX_FORECAST_HOUR;
    case "arome": return AROME_MAX_FORECAST_HOUR;
    case "pe-arome": return PE_AROME_MAX_FORECAST_HOUR;
    case "gfs-analysis": return 0;
  }
}

function fixedStepTimes(
  run: Date,
  from: Date,
  to: Date,
  stepHours: number,
  maxForecastHour: number,
): Date[] {
  const result: Date[] = [];
  for (let hour = 0; hour <= maxForecastHour; hour += stepHours) {
    const valid = new Date(run.getTime() + hour * HOUR_MS);
    if (valid.getTime() >= from.getTime() && valid.getTime() <= to.getTime()) result.push(valid);
  }
  return result;
}
