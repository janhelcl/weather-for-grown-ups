import { homedir } from "node:os";
import { join } from "node:path";
import { ProfileEvidenceCache, profileEvidenceSelectionPolicy } from "../cache/profile-evidence-cache.js";
import { ifsEnsMemberNumber, sortIfsEnsMembers } from "../catalog/ifs-ens.js";
import {
  ifsEnsMemberBundleQuerySchema,
  ifsEnsMemberBundleResultSchema,
  type IfsEnsMemberBundleQueryInput,
  type IfsEnsMemberBundleResult,
} from "../schema/ifs-ens.js";
import { AtmosphericEvidenceAcquirer } from "./atmospheric-evidence-acquirer.js";
import { IfsEnsLatestRunResolver, type IfsEnsLatestRunProvider } from "./ifs-ens-latest-run.js";
import { IfsEnsMemberBundleService } from "./ifs-ens-member-bundle.js";
import { ifsIndexSelectorsForSelection } from "./ifs-profile.js";
import { ifsEnsForecastHour, parseIfsRun } from "./ifs-time.js";

export interface IfsEnsBundleGetter {
  getBundle(input: IfsEnsMemberBundleQueryInput): Promise<IfsEnsMemberBundleResult>;
}

export interface IfsEnsMemberBundleEvidenceServiceOptions {
  cacheDir?: string;
  bundleGetter?: IfsEnsBundleGetter;
  latestRunProvider?: IfsEnsLatestRunProvider;
  evidenceCache?: ProfileEvidenceCache<IfsEnsMemberBundleResult>;
}

/**
 * Run-resolved member-first IFS ENS evidence shared by raw views and diagnostics.
 * The persisted value always retains perturbation values even when the public
 * request is compact; nonlinear diagnostics therefore never operate on ensemble
 * means or quantiles.
 */
export class IfsEnsMemberBundleEvidenceService implements IfsEnsBundleGetter {
  private readonly bundleGetter: IfsEnsBundleGetter;
  private readonly latestRunProvider: IfsEnsLatestRunProvider;
  private readonly acquirer: AtmosphericEvidenceAcquirer<
    { pressureVariables: readonly string[]; pressureLevelsHpa: readonly number[]; fields: readonly string[] },
    IfsEnsMemberBundleResult
  >;

  constructor(options: IfsEnsMemberBundleEvidenceServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.latestRunProvider = options.latestRunProvider ?? new IfsEnsLatestRunResolver({ cacheDir });
    this.bundleGetter = options.bundleGetter ?? new IfsEnsMemberBundleService({
      cacheDir,
      latestRunProvider: this.latestRunProvider,
    });
    const store = options.evidenceCache
      ?? new ProfileEvidenceCache<IfsEnsMemberBundleResult>(join(cacheDir, "evidence", "ifs-ens-member-bundle"));
    this.acquirer = new AtmosphericEvidenceAcquirer(store, profileEvidenceSelectionPolicy);
  }

  async getBundle(input: IfsEnsMemberBundleQueryInput): Promise<IfsEnsMemberBundleResult> {
    const query = ifsEnsMemberBundleQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortIfsEnsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const pressureLevelsHpa = [...query.selection.pressureLevelsHpa].sort((a, b) => b - a);
    const baseSelectors = ifsIndexSelectorsForSelection(query.selection);
    const availabilitySelectors = members.flatMap((member) => {
      const number = ifsEnsMemberNumber(member);
      return baseSelectors.map((selector) => ({ ...selector, number }));
    });
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, availabilitySelectors)
      : parseIfsRun(query.run);
    ifsEnsForecastHour(run, validTime);

    const resolved = {
      ...query,
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      members,
      quantiles,
      selection: { ...query.selection, pressureLevelsHpa },
    };
    const identity = {
      dataset: "ifs-ens",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      latitude: query.latitude,
      longitude: query.longitude,
      variant: "ifs_0p25_enfo_ef",
      source: "ecmwf-open-data",
      population: `${members.join(",")}|q=${quantiles.join(",")}`,
    };
    const selection = {
      pressureVariables: query.selection.variables,
      pressureLevelsHpa,
      fields: query.selection.fields,
    };

    const acquired = await this.acquirer.acquire(identity, selection, async () => {
      const evidence = await this.bundleGetter.getBundle({ ...resolved, includeMembers: true });
      if (evidence.members === undefined) throw new Error("IFS ENS evidence acquisition must retain member values");
      return evidence;
    });
    return projectIfsEnsBundle(acquired.evidence, resolved, acquired.cacheHit);
  }
}

function projectIfsEnsBundle(
  evidence: IfsEnsMemberBundleResult,
  query: ReturnType<typeof ifsEnsMemberBundleQuerySchema.parse>,
  evidenceHit: boolean,
): IfsEnsMemberBundleResult {
  if (evidence.members === undefined) throw new Error("Stored IFS ENS evidence is missing member values");
  const variables = new Set(query.selection.variables);
  const levels = new Set(query.selection.pressureLevelsHpa);
  const fields = new Set(query.selection.fields);
  const pressureSummaries = evidence.pressureSummaries.filter((summary) =>
    variables.has(summary.variable) && levels.has(summary.pressureLevelHpa));
  const fieldSummaries = evidence.fieldSummaries.filter((summary) => fields.has(summary.field));
  const members = evidence.members.map((member) => ({
    member: member.member,
    cacheHit: evidenceHit ? true : member.cacheHit,
    pressureValues: member.pressureValues.filter((value) =>
      variables.has(value.variable) && levels.has(value.pressureLevelHpa)),
    fields: member.fields.filter((field) => fields.has(field.field)),
  }));

  return ifsEnsMemberBundleResultSchema.parse({
    ...evidence,
    selection: {
      variables: query.selection.variables,
      pressureLevelsHpa: query.selection.pressureLevelsHpa,
      fields: query.selection.fields,
      members: query.members,
      quantiles: query.quantiles,
    },
    pressureSummaries,
    fieldSummaries,
    ...(query.includeMembers ? { members } : { members: undefined }),
    source: {
      ...evidence.source,
      allCacheHit: evidenceHit ? true : members.every((member) => member.cacheHit),
    },
  });
}
