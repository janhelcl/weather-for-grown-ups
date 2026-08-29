import { homedir } from "node:os";
import { join } from "node:path";
import {
  GefsReforecastS3SubsetCache,
  type GefsReforecastSelectionSource,
} from "../cache/gefs-reforecast-s3-subset-cache.js";
import { sortGefsMembers } from "../catalog/gefs.js";
import { Wgrib2Decoder } from "../grib/wgrib2.js";
import {
  gefsReforecastPointQuerySchema,
  gefsReforecastPointResultSchema,
  type GefsReforecastPointQueryInput,
  type GefsReforecastPointResult,
} from "../schema/gefs-reforecast.js";
import {
  gefsReforecastForecastHour,
  gefsReforecastHorizontalGridDegrees,
  gefsReforecastLeadBlock,
  parseGefsReforecastRun,
  type GefsReforecastMember,
} from "../sources/gefs-reforecast-s3.js";
import { mapConcurrent } from "./concurrency.js";
import {
  assertMemberBundlesShareGrid,
  decodeGefsMemberBundle,
  prepareGefsBundleSelection,
  summarizeGefsMemberBundles,
} from "./gefs-bundle-decoder.js";
import {
  DEFAULT_GEFS_MEMBER_CONCURRENCY,
  type GefsPointDecoder,
} from "./gefs-ensemble.js";

export interface GefsReforecastPointServiceOptions {
  cacheDir?: string;
  wgrib2Path?: string;
  source?: GefsReforecastSelectionSource;
  decoder?: GefsPointDecoder;
  concurrency?: number;
}

/**
 * GEFSv12 retrospective forecasts are a distinct forecast population, not an
 * archive of the operational cycles. This service deliberately reuses the
 * member-first GEFS field decoder/statistics while keeping source, member-set,
 * cadence and provenance semantics explicit.
 */
export class GefsReforecastPointService {
  private readonly source: GefsReforecastSelectionSource;
  private readonly decoder: GefsPointDecoder;
  private readonly concurrency: number;

  constructor(options: GefsReforecastPointServiceOptions = {}) {
    const cacheDir = options.cacheDir ?? process.env.WFG_CACHE_DIR ?? join(homedir(), ".cache", "wfg");
    this.source = options.source ?? new GefsReforecastS3SubsetCache(
      join(cacheDir, "gefs-v12-reforecast-s3"),
    );
    this.decoder = options.decoder ?? new Wgrib2Decoder(options.wgrib2Path);
    this.concurrency = options.concurrency ?? DEFAULT_GEFS_MEMBER_CONCURRENCY;
  }

  async getPoint(input: GefsReforecastPointQueryInput): Promise<GefsReforecastPointResult> {
    const query = gefsReforecastPointQuerySchema.parse(input);
    const run = parseGefsReforecastRun(query.run);
    const validTime = new Date(query.validTime);
    const forecastHour = gefsReforecastForecastHour(run, validTime);
    const members = sortGefsMembers(query.members) as GefsReforecastMember[];
    const quantiles = [...query.quantiles].sort((a, b) => a - b);
    const selection = prepareGefsBundleSelection({
      variables: [],
      pressureLevelsHpa: [],
      fields: query.fields,
    });

    const samples = await mapConcurrent(members, this.concurrency, async (member) => {
      const file = await this.source.fetchSelection({
        run,
        forecastHour,
        member,
        fields: [...selection.rawFields],
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
    const { fieldSummaries } = summarizeGefsMemberBundles(
      samples,
      selection,
      quantiles,
    );

    return gefsReforecastPointResultSchema.parse({
      model: "gefs_v12_reforecast",
      run: run.toISOString(),
      validTime: validTime.toISOString(),
      forecastHour,
      requestedPoint: { latitude: query.latitude, longitude: query.longitude },
      gridPoint,
      selection: {
        fields: query.fields,
        members,
        quantiles,
      },
      fieldSummaries,
      ...(query.includeMembers
        ? {
            members: samples.map(({ member, cacheHit, fields }) => ({
              member,
              cacheHit,
              fields,
            })),
          }
        : {}),
      source: {
        provider: "NOAA AWS Open Data",
        access: "s3_range",
        decoder: this.decoder.engine ?? "wgrib2",
        archiveType: "reforecast",
        dataset: "GEFSv12/reforecast",
        leadBlock: gefsReforecastLeadBlock(forecastHour),
        horizontalGridDegrees: gefsReforecastHorizontalGridDegrees(forecastHour),
        allCacheHit: samples.every((sample) => sample.cacheHit),
      },
    });
  }
}
