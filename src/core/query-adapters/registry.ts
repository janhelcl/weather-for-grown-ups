import { lazyAsync } from "../../util/lazy-async.js";
import {
  publicDatasetMetadata,
  type PublicAtmosphericDataset,
  type QueryAtmosphereRequest,
} from "../../schema/unified-api.js";
import {
  normalizeEnsembleWindResult,
  queryRequestsEnsembleWindSummary,
  requestWithEnsembleWindMembers,
} from "../ensemble-wind-normalization.js";
import type { AigfsQueryAdapterOptions } from "./aigfs.js";
import type { AifsQueryAdapterOptions } from "./aifs.js";
import type { AifsEnsQueryAdapterOptions } from "./aifs-ens.js";
import type { AigefsQueryAdapterOptions } from "./aigefs.js";
import type { AromeQueryAdapterOptions } from "./arome.js";
import type { PeAromeQueryAdapterOptions } from "./pe-arome.js";
import type { GefsQueryAdapterOptions } from "./gefs.js";
import type { HgefsQueryAdapterOptions } from "./hgefs.js";
import type { IconD2QueryAdapterOptions } from "./icon-d2.js";
import type { IconD2EpsQueryAdapterOptions } from "./icon-d2-eps.js";
import type { GfsAnalysisQueryAdapterOptions } from "./gfs-analysis.js";
import type { GfsQueryAdapterOptions } from "./gfs.js";
import type { IfsEnsQueryAdapterOptions } from "./ifs-ens.js";
import type { IfsQueryAdapterOptions } from "./ifs.js";
import type {
  AtmosphericQueryAdapter,
  AtmosphericQueryAdapterRegistry,
} from "./types.js";

export type DefaultAtmosphericQueryAdapterOptions =
  AigfsQueryAdapterOptions
  & AromeQueryAdapterOptions
  & PeAromeQueryAdapterOptions
  & AifsQueryAdapterOptions
  & AifsEnsQueryAdapterOptions
  & AigefsQueryAdapterOptions
  & GfsQueryAdapterOptions
  & GefsQueryAdapterOptions
  & HgefsQueryAdapterOptions
  & IconD2QueryAdapterOptions
  & IconD2EpsQueryAdapterOptions
  & IfsQueryAdapterOptions
  & IfsEnsQueryAdapterOptions
  & GfsAnalysisQueryAdapterOptions;

export interface AtmosphericQueryRegistryOptions extends DefaultAtmosphericQueryAdapterOptions {
  adapters?: Partial<Record<PublicAtmosphericDataset, AtmosphericQueryAdapter>>;
}

export function createAtmosphericQueryAdapterRegistry(
  options: AtmosphericQueryRegistryOptions = {},
): AtmosphericQueryAdapterRegistry {
  const configured: AtmosphericQueryAdapterRegistry = {
    aigfs: options.adapters?.aigfs ?? lazyAdapter(async () => {
      const { AigfsQueryAdapter } = await import("./aigfs.js");
      return new AigfsQueryAdapter(options);
    }),
    aifs: options.adapters?.aifs ?? lazyAdapter(async () => {
      const { AifsQueryAdapter } = await import("./aifs.js");
      return new AifsQueryAdapter(options);
    }),
    "aifs-ens": options.adapters?.["aifs-ens"] ?? lazyAdapter(async () => {
      const { AifsEnsQueryAdapter } = await import("./aifs-ens.js");
      return new AifsEnsQueryAdapter(options);
    }),
    aigefs: options.adapters?.aigefs ?? lazyAdapter(async () => {
      const { AigefsQueryAdapter } = await import("./aigefs.js");
      return new AigefsQueryAdapter(options);
    }),
    arome: options.adapters?.arome ?? lazyAdapter(async () => {
      const { AromeQueryAdapter } = await import("./arome.js");
      return new AromeQueryAdapter(options);
    }),
    "pe-arome": options.adapters?.["pe-arome"] ?? lazyAdapter(async () => {
      const { PeAromeQueryAdapter } = await import("./pe-arome.js");
      return new PeAromeQueryAdapter(options);
    }),
    gfs: options.adapters?.gfs ?? lazyAdapter(async () => {
      const { GfsQueryAdapter } = await import("./gfs.js");
      return new GfsQueryAdapter(options);
    }),
    gefs: options.adapters?.gefs ?? lazyAdapter(async () => {
      const [{ GefsQueryAdapter }, { GefsMemberBundleEvidenceService }, { GefsBundleTimeSeriesService }] = await Promise.all([
        import("./gefs.js"),
        import("../gefs-evidence-service.js"),
        import("../gefs-bundle-timeseries.js"),
      ]);
      const gefsBundle = options.gefsBundle ?? new GefsMemberBundleEvidenceService();
      return new GefsQueryAdapter({
        ...options,
        gefsBundle,
        gefsTimeSeries: options.gefsTimeSeries ?? new GefsBundleTimeSeriesService({
          bundleGetter: gefsBundle,
        }),
      });
    }),
    hgefs: options.adapters?.hgefs ?? lazyAdapter(async () => {
      const { HgefsQueryAdapter } = await import("./hgefs.js");
      return new HgefsQueryAdapter(options);
    }),
    "icon-d2": options.adapters?.["icon-d2"] ?? lazyAdapter(async () => {
      const { IconD2QueryAdapter } = await import("./icon-d2.js");
      return new IconD2QueryAdapter(options);
    }),
    "icon-d2-eps": options.adapters?.["icon-d2-eps"] ?? lazyAdapter(async () => {
      const { IconD2EpsQueryAdapter } = await import("./icon-d2-eps.js");
      return new IconD2EpsQueryAdapter(options);
    }),
    ifs: options.adapters?.ifs ?? lazyAdapter(async () => {
      const { IfsQueryAdapter } = await import("./ifs.js");
      return new IfsQueryAdapter(options);
    }),
    "ifs-ens": options.adapters?.["ifs-ens"] ?? lazyAdapter(async () => {
      const { IfsEnsQueryAdapter } = await import("./ifs-ens.js");
      return new IfsEnsQueryAdapter(options);
    }),
    "gfs-analysis": options.adapters?.["gfs-analysis"] ?? lazyAdapter(async () => {
      const { GfsAnalysisQueryAdapter } = await import("./gfs-analysis.js");
      return new GfsAnalysisQueryAdapter(options);
    }),
  };

  return Object.fromEntries(
    Object.entries(configured).map(([dataset, adapter]) => [
      dataset,
      publicDatasetMetadata(dataset as PublicAtmosphericDataset).kind === "ensemble"
        ? withEnsembleWindNormalization(adapter)
        : adapter,
    ]),
  ) as AtmosphericQueryAdapterRegistry;
}

function withEnsembleWindNormalization(
  adapter: AtmosphericQueryAdapter,
): AtmosphericQueryAdapter {
  return {
    async query(request: QueryAtmosphereRequest): Promise<unknown> {
      const operationalGefsHasNativeWindVectors = request.dataset === "gefs"
        && request.forecast?.kind !== "reforecast";
      if (operationalGefsHasNativeWindVectors || !queryRequestsEnsembleWindSummary(request)) {
        return adapter.query(request);
      }
      const rawResult = await adapter.query(requestWithEnsembleWindMembers(request));
      return normalizeEnsembleWindResult(request, rawResult);
    },
  };
}

function lazyAdapter(load: () => Promise<AtmosphericQueryAdapter>): AtmosphericQueryAdapter {
  const getAdapter = lazyAsync(load);
  return { query: async (request) => (await getAdapter()).query(request) };
}
