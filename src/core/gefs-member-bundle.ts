import { homedir } from "node:os";
import { join } from "node:path";
import {
  GefsS3SubsetCache,
  type GefsMemberSelectionSource,
} from "../cache/gefs-s3-subset-cache.js";
import { sortGefsMembers } from "../catalog/gefs.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import {
  gefsMemberBundleQuerySchema,
  gefsMemberBundleResultSchema,
  type GefsMemberBundleQueryInput,
  type GefsMemberBundleResult,
} from "../schema/gefs-member-bundle.js";
import { mapConcurrent } from "./concurrency.js";
import {
  assertMemberBundlesShareGrid,
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

export interface GefsMemberBundleServiceOptions {
  cacheDir?: string;
  wgrib2Path?: string;
  source?: GefsMemberSelectionSource;
  decoder?: GefsPointDecoder;
  latestRunProvider?: GefsLatestRunProvider;
  concurrency?: number;
}

/**
 * Fetch and decode one mixed GEFS pgrb2a selection per member. Pressure-level
 * and non-isobaric dependencies are merged before decoding, while the shared
 * bundle decoder owns all normalization, derived physics and aggregation.
 */
export class GefsMemberBundleService {
  private readonly source: GefsMemberSelectionSource;
  private readonly decoder: GefsPointDecoder;
  private readonly latestRunProvider: GefsLatestRunProvider;
  private readonly concurrency: number;

  constructor(options: GefsMemberBundleServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new GefsS3SubsetCache(join(cacheDir, "gefs-s3"));
    this.decoder = options.decoder ?? new Wgrib2Decoder(options.wgrib2Path);
    this.latestRunProvider = options.latestRunProvider ?? new GefsLatestRunResolver();
    this.concurrency = options.concurrency ?? DEFAULT_GEFS_MEMBER_CONCURRENCY;
  }

  async getBundle(
    input: GefsMemberBundleQueryInput,
    productOverride?: GefsAtmosProduct,
  ): Promise<GefsMemberBundleResult> {
    const query = gefsMemberBundleQuerySchema.parse(input);
    const validTime = new Date(query.validTime);
    const members = sortGefsMembers(query.members);
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const selection = prepareGefsBundleSelection(query.selection);
    const run = query.run === "latest"
      ? await this.latestRunProvider.resolveLatestRun(validTime, members)
      : parseGefsRun(query.run);
    const forecastHour = gefsForecastHour(run, validTime);
    const product = productOverride ?? gefsAtmosProductForSelection(
      selection.rawPressureVariables.length > 0,
      forecastHour,
    );

    const samples = await mapConcurrent(members, this.concurrency, async (member) => {
      const file = await this.source.fetchSelection({
        run,
        forecastHour,
        member,
        variableCodes: selection.rawPressureVariables.map(({ definition }) => definition.gfsCode),
        pressureLevelsHpa: [...selection.pressureLevelsHpa],
        fields: [...selection.rawFields],
        product,
      });
      const decoded = await this.decoder.extractPoint(file.path, query.longitude, query.latitude);
      return decodeGefsMemberBundle({
        member,
        cacheHit: file.cacheHit,
        decoded,
        run,
        selection,
      });
    });

    const gridPoint = assertMemberBundlesShareGrid(samples);
    const summaries = summarizeGefsMemberBundles(samples, selection, quantiles);

    return gefsMemberBundleResultSchema.parse({
      model: "gefs_0p50",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint,
      selection: {
        variables: selection.variables,
        pressureLevelsHpa: selection.pressureLevelsHpa,
        fields: selection.fields,
        members,
        quantiles,
      },
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
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: this.decoder.engine ?? "wgrib2",
        product,
        horizontalGridDegrees: gefsAtmosProductGridDegrees(product),
        allCacheHit: samples.every((sample) => sample.cacheHit),
      },
    });
  }
}
