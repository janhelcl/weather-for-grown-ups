import { homedir } from "node:os";
import { join } from "node:path";
import {
  IfsOpenDataSubsetCache,
  type IfsSelectionSource,
} from "../cache/ifs-open-data-cache.js";
import { ProfileEvidenceCache, profileEvidenceSelectionPolicy } from "../cache/profile-evidence-cache.js";
import { ifsEnsMemberNumber, type IfsEnsMember } from "../catalog/ifs-ens.js";
import { ifsPointQuerySchema, type IfsPointQueryInput } from "../schema/ifs.js";
import { AtmosphericEvidenceAcquirer } from "./atmospheric-evidence-acquirer.js";
import { IfsEnsMemberSelectionSource } from "./ifs-ens-member-source.js";
import { IfsProfileService, type IfsProfileSample } from "./ifs-profile.js";
import { ifsEnsForecastHour, parseIfsRun } from "./ifs-time.js";

export interface IfsEnsMemberProfileGetter {
  getProfile(member: IfsEnsMember, input: IfsPointQueryInput): Promise<IfsProfileSample>;
}

export interface IfsEnsMemberProfileEvidenceServiceOptions {
  cacheDir?: string;
  source?: IfsSelectionSource;
  profileGetter?: IfsEnsMemberProfileGetter;
  evidenceCache?: ProfileEvidenceCache<IfsProfileSample>;
}

/** Reusable decoded IFS ENS member column; callers must supply a resolved run. */
export class IfsEnsMemberProfileEvidenceService implements IfsEnsMemberProfileGetter {
  private readonly profileGetter: IfsEnsMemberProfileGetter;
  private readonly acquirer: AtmosphericEvidenceAcquirer<
    { pressureVariables: readonly string[]; pressureLevelsHpa: readonly number[]; fields: readonly string[] },
    IfsProfileSample
  >;

  constructor(options: IfsEnsMemberProfileEvidenceServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    const source = options.source ?? new IfsOpenDataSubsetCache(join(cacheDir, "ifs-open-data"));
    this.profileGetter = options.profileGetter ?? new DirectIfsEnsMemberProfileGetter(source);
    const store = options.evidenceCache
      ?? new ProfileEvidenceCache<IfsProfileSample>(join(cacheDir, "evidence", "ifs-ens-member-profile"));
    this.acquirer = new AtmosphericEvidenceAcquirer(store, profileEvidenceSelectionPolicy);
  }

  async getProfile(member: IfsEnsMember, input: IfsPointQueryInput): Promise<IfsProfileSample> {
    const query = ifsPointQuerySchema.parse(input);
    if (query.run === "latest") throw new Error("IFS ENS member evidence requires a resolved run");
    const run = parseIfsRun(query.run);
    const validTime = new Date(query.validTime);
    ifsEnsForecastHour(run, validTime);
    const resolved = { ...query, run: run.toISOString(), validTime: validTime.toISOString() };
    const identity = {
      dataset: "ifs-ens",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      latitude: query.latitude,
      longitude: query.longitude,
      variant: "ifs_0p25_enfo_ef",
      source: "ecmwf-open-data",
      population: member,
    };
    const selection = {
      pressureVariables: query.variables ?? [],
      pressureLevelsHpa: query.pressureLevelsHpa ?? [],
      fields: query.fields ?? [],
    };
    const acquired = await this.acquirer.acquire(
      identity,
      selection,
      () => this.profileGetter.getProfile(member, resolved),
    );
    return projectMemberProfile(acquired.evidence, resolved, acquired.cacheHit);
  }
}

class DirectIfsEnsMemberProfileGetter implements IfsEnsMemberProfileGetter {
  constructor(private readonly source: IfsSelectionSource) {}

  getProfile(member: IfsEnsMember, input: IfsPointQueryInput): Promise<IfsProfileSample> {
    return new IfsProfileService({
      source: new IfsEnsMemberSelectionSource(this.source, ifsEnsMemberNumber(member)),
    }).getProfileSample(input, {
      forecastHourResolver: ifsEnsForecastHour,
      sourceProduct: "ifs_0p25_enfo_ef",
    });
  }
}

function projectMemberProfile(
  profile: IfsProfileSample,
  query: ReturnType<typeof ifsPointQuerySchema.parse>,
  evidenceHit: boolean,
): IfsProfileSample {
  const pressureLevels = new Set<number>(query.pressureLevelsHpa ?? []);
  const requestedFields = new Set(query.fields ?? []);
  const fields = profile.fields?.filter((field) => requestedFields.has(field.id));
  const { fields: _cachedFields, ...base } = profile;
  return {
    ...base,
    levels: profile.levels.filter((level) => pressureLevels.has(level.pressureHpa)),
    ...(fields === undefined || fields.length === 0 ? {} : { fields }),
    source: { ...profile.source, cacheHit: evidenceHit ? true : profile.source.cacheHit },
  };
}
