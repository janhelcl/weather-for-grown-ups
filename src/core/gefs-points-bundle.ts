import { homedir } from "node:os";
import { join } from "node:path";
import {
  GefsS3SubsetCache,
  type GefsMemberSelectionSource,
} from "../cache/gefs-s3-subset-cache.js";
import { sortGefsMembers, type GefsMember } from "../catalog/gefs.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import {
  gefsPointsBundleQuerySchema,
  gefsPointsBundleResultSchema,
  type GefsPointsBundleQueryInput,
  type GefsPointsBundleResult,
} from "../schema/gefs-points-bundle.js";
import { mapConcurrent } from "./concurrency.js";
import {
  assertMemberBundlesShareGrid,
  bundleScalarOutputCount,
  decodeGefsMemberBundle,
  prepareGefsBundleSelection,
  summarizeGefsMemberBundles,
} from "./gefs-bundle-decoder.js";
import { DEFAULT_GEFS_MEMBER_CONCURRENCY, type GefsPointDecoder } from "./gefs-ensemble.js";
import { GefsLatestRunResolver, type GefsLatestRunProvider } from "./gefs-latest-run.js";
import { gefsForecastHour, parseGefsRun } from "./gefs-time.js";
import {
  gefsAtmosProductForSelection,
  gefsAtmosProductGridDegrees,
  type GefsAtmosProduct,
} from "../sources/gefs-s3.js";

export const DEFAULT_GEFS_POINT_DECODE_CONCURRENCY = 4;

interface FetchedMemberFile {
  member: GefsMember;
  path: string;
  cacheHit: boolean;
}

export interface GefsPointsBundleServiceOptions {
  cacheDir?: string;
  wgrib2Path?: string;
  source?: GefsMemberSelectionSource;
  decoder?: GefsPointDecoder;
  latestRunProvider?: GefsLatestRunProvider;
  memberConcurrency?: number;
  decodeConcurrency?: number;
}

/**
 * Fetch one mixed selected-message file per member, then sample every requested
 * coordinate locally from those immutable files. Upstream selected-file work
 * scales with members; local wgrib2 point extraction scales with members × points.
 */
export class GefsPointsBundleService {
  private readonly source: GefsMemberSelectionSource;
  private readonly decoder: GefsPointDecoder;
  private readonly latestRunProvider: GefsLatestRunProvider;
  private readonly memberConcurrency: number;
  private readonly decodeConcurrency: number;

  constructor(options: GefsPointsBundleServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new GefsS3SubsetCache(join(cacheDir, "gefs-s3"));
    this.decoder = options.decoder ?? new Wgrib2Decoder(options.wgrib2Path);
    this.latestRunProvider = options.latestRunProvider ?? new GefsLatestRunResolver();
    this.memberConcurrency = options.memberConcurrency ?? DEFAULT_GEFS_MEMBER_CONCURRENCY;
    this.decodeConcurrency = options.decodeConcurrency ?? DEFAULT_GEFS_POINT_DECODE_CONCURRENCY;
  }

  async getPoints(
    input: GefsPointsBundleQueryInput,
    productOverride?: GefsAtmosProduct,
  ): Promise<GefsPointsBundleResult> {
    const query = gefsPointsBundleQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortGefsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const selection = prepareGefsBundleSelection(query.selection);

    if (query.includeMembers) {
      const memberSamples = query.points.length * members.length * bundleScalarOutputCount(selection);
      if (memberSamples > query.maxMemberSamples) {
        throw new Error(
          `GEFS multi-point bundle would return ${memberSamples} member scalar samples, exceeding maxMemberSamples=${query.maxMemberSamples}`,
        );
      }
    }

    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, members)
      : parseGefsRun(query.run);
    const forecastHour = gefsForecastHour(run, validTime);
    const product = productOverride ?? gefsAtmosProductForSelection(
      selection.rawPressureVariables.length > 0,
      forecastHour,
    );

    const memberFiles = await mapConcurrent(members, this.memberConcurrency, async (member): Promise<FetchedMemberFile> => {
      const file = await this.source.fetchSelection({
        run,
        forecastHour,
        member,
        variableCodes: selection.rawPressureVariables.map(({ definition }) => definition.gfsCode),
        pressureLevelsHpa: [...selection.pressureLevelsHpa],
        fields: [...selection.rawFields],
        product,
      });
      return { member, path: file.path, cacheHit: file.cacheHit };
    });

    const points = [];
    for (const point of query.points) {
      const samples = await mapConcurrent(memberFiles, this.decodeConcurrency, async (file) => {
        const decoded = await this.decoder.extractPoint(file.path, point.longitude, point.latitude);
        return decodeGefsMemberBundle({
          member: file.member,
          cacheHit: file.cacheHit,
          decoded,
          run,
          selection,
        });
      });
      const gridPoint = assertMemberBundlesShareGrid(samples, "GEFS multi-point bundle");
      const summaries = summarizeGefsMemberBundles(samples, selection, quantiles);
      points.push({
        requestedPoint: { ...point },
        gridPoint,
        ...summaries,
        ...(query.includeMembers
          ? {
              members: samples.map(({ member, cacheHit, pressureValues, fields }) => ({
                member,
                cacheHit,
                pressureValues,
                fields,
              })),
            }
          : {}),
      });
    }

    return gefsPointsBundleResultSchema.parse({
      model: "gefs_0p50",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      selection: {
        variables: selection.variables,
        pressureLevelsHpa: selection.pressureLevelsHpa,
        fields: selection.fields,
        members,
        quantiles,
      },
      includeMembers: query.includeMembers,
      points,
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: this.decoder.engine ?? "wgrib2",
        product,
        horizontalGridDegrees: gefsAtmosProductGridDegrees(product),
        memberFiles: memberFiles.map(({ member, cacheHit }) => ({ member, cacheHit })),
        allCacheHit: memberFiles.every((file) => file.cacheHit),
      },
    });
  }
}
