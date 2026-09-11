import { lazyAsync } from "../../util/lazy-async.js";
import type { PublicAtmosphericDataset } from "../../schema/unified-api.js";
import type { AigfsDiagnosticAdapterOptions } from "./aigfs.js";
import type { AifsDiagnosticAdapterOptions } from "./aifs.js";
import type { AifsEnsDiagnosticAdapterOptions } from "./aifs-ens.js";
import type { AigefsDiagnosticAdapterOptions } from "./aigefs.js";
import type { GefsDiagnosticAdapterOptions } from "./gefs.js";
import type { HgefsDiagnosticAdapterOptions } from "./hgefs.js";
import type { IconD2DiagnosticAdapterOptions } from "./icon-d2.js";
import type { IconD2EpsDiagnosticAdapterOptions } from "./icon-d2-eps.js";
import type { GfsAnalysisDiagnosticAdapterOptions } from "./gfs-analysis.js";
import type { GfsDiagnosticAdapterOptions } from "./gfs.js";
import type { IfsEnsDiagnosticAdapterOptions } from "./ifs-ens.js";
import type { IfsDiagnosticAdapterOptions } from "./ifs.js";
import type {
  AtmosphericDiagnosticAdapter,
  AtmosphericDiagnosticAdapterRegistry,
} from "./types.js";

export type DefaultAtmosphericDiagnosticAdapterOptions =
  AigfsDiagnosticAdapterOptions
  & AifsDiagnosticAdapterOptions
  & AifsEnsDiagnosticAdapterOptions
  & AigefsDiagnosticAdapterOptions
  & GfsDiagnosticAdapterOptions
  & GefsDiagnosticAdapterOptions
  & HgefsDiagnosticAdapterOptions
  & IconD2DiagnosticAdapterOptions
  & IconD2EpsDiagnosticAdapterOptions
  & IfsDiagnosticAdapterOptions
  & IfsEnsDiagnosticAdapterOptions
  & GfsAnalysisDiagnosticAdapterOptions;

export interface AtmosphericDiagnosticRegistryOptions
  extends DefaultAtmosphericDiagnosticAdapterOptions {
  adapters?: Partial<Record<PublicAtmosphericDataset, AtmosphericDiagnosticAdapter>>;
}

export function createAtmosphericDiagnosticAdapterRegistry(
  options: AtmosphericDiagnosticRegistryOptions = {},
): AtmosphericDiagnosticAdapterRegistry {
  return {
    aigfs: options.adapters?.aigfs ?? lazyAdapter(async () => {
      const { AigfsDiagnosticAdapter } = await import("./aigfs.js");
      return new AigfsDiagnosticAdapter(options);
    }),
    aifs: options.adapters?.aifs ?? lazyAdapter(async () => {
      const { AifsDiagnosticAdapter } = await import("./aifs.js");
      return new AifsDiagnosticAdapter(options);
    }),
    "aifs-ens": options.adapters?.["aifs-ens"] ?? lazyAdapter(async () => {
      const { AifsEnsDiagnosticAdapter } = await import("./aifs-ens.js");
      return new AifsEnsDiagnosticAdapter(options);
    }),
    aigefs: options.adapters?.aigefs ?? lazyAdapter(async () => {
      const { AigefsDiagnosticAdapter } = await import("./aigefs.js");
      return new AigefsDiagnosticAdapter(options);
    }),
    arome: options.adapters?.arome ?? lazyAdapter(async () => {
      const { AromeDiagnosticAdapter } = await import("./arome.js");
      return new AromeDiagnosticAdapter();
    }),
    "pe-arome": options.adapters?.["pe-arome"] ?? lazyAdapter(async () => {
      const { PeAromeDiagnosticAdapter } = await import("./pe-arome.js");
      return new PeAromeDiagnosticAdapter();
    }),
    gfs: options.adapters?.gfs ?? lazyAdapter(async () => {
      const { GfsDiagnosticAdapter } = await import("./gfs.js");
      return new GfsDiagnosticAdapter(options);
    }),
    gefs: options.adapters?.gefs ?? lazyAdapter(async () => {
      const { GefsDiagnosticAdapter } = await import("./gefs.js");
      return new GefsDiagnosticAdapter(options);
    }),
    hgefs: options.adapters?.hgefs ?? lazyAdapter(async () => {
      const { HgefsDiagnosticAdapter } = await import("./hgefs.js");
      return new HgefsDiagnosticAdapter(options);
    }),
    "icon-d2": options.adapters?.["icon-d2"] ?? lazyAdapter(async () => {
      const { IconD2DiagnosticAdapter } = await import("./icon-d2.js");
      return new IconD2DiagnosticAdapter(options);
    }),
    "icon-d2-eps": options.adapters?.["icon-d2-eps"] ?? lazyAdapter(async () => {
      const { IconD2EpsDiagnosticAdapter } = await import("./icon-d2-eps.js");
      return new IconD2EpsDiagnosticAdapter(options);
    }),
    ifs: options.adapters?.ifs ?? lazyAdapter(async () => {
      const { IfsDiagnosticAdapter } = await import("./ifs.js");
      return new IfsDiagnosticAdapter(options);
    }),
    "ifs-ens": options.adapters?.["ifs-ens"] ?? lazyAdapter(async () => {
      const { IfsEnsDiagnosticAdapter } = await import("./ifs-ens.js");
      return new IfsEnsDiagnosticAdapter(options);
    }),
    "gfs-analysis": options.adapters?.["gfs-analysis"] ?? lazyAdapter(async () => {
      const { GfsAnalysisDiagnosticAdapter } = await import("./gfs-analysis.js");
      return new GfsAnalysisDiagnosticAdapter(options);
    }),
  };
}

function lazyAdapter(load: () => Promise<AtmosphericDiagnosticAdapter>): AtmosphericDiagnosticAdapter {
  const getAdapter = lazyAsync(load);
  return { diagnose: async (request) => (await getAdapter()).diagnose(request) };
}
