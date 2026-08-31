import type { PublicAtmosphericDataset } from "../../schema/unified-api.js";
import { AigfsDiagnosticAdapter, type AigfsDiagnosticAdapterOptions } from "./aigfs.js";
import { AifsDiagnosticAdapter, type AifsDiagnosticAdapterOptions } from "./aifs.js";
import { AifsEnsDiagnosticAdapter, type AifsEnsDiagnosticAdapterOptions } from "./aifs-ens.js";
import { AigefsDiagnosticAdapter, type AigefsDiagnosticAdapterOptions } from "./aigefs.js";
import { GefsDiagnosticAdapter, type GefsDiagnosticAdapterOptions } from "./gefs.js";
import { HgefsDiagnosticAdapter, type HgefsDiagnosticAdapterOptions } from "./hgefs.js";
import {
  IconD2DiagnosticAdapter,
  type IconD2DiagnosticAdapterOptions,
} from "./icon-d2.js";
import {
  GfsAnalysisDiagnosticAdapter,
  type GfsAnalysisDiagnosticAdapterOptions,
} from "./gfs-analysis.js";
import { GfsDiagnosticAdapter, type GfsDiagnosticAdapterOptions } from "./gfs.js";
import {
  IfsEnsDiagnosticAdapter,
  type IfsEnsDiagnosticAdapterOptions,
} from "./ifs-ens.js";
import { IfsDiagnosticAdapter, type IfsDiagnosticAdapterOptions } from "./ifs.js";
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
  const defaults: AtmosphericDiagnosticAdapterRegistry = {
    aigfs: new AigfsDiagnosticAdapter(options),
    aifs: new AifsDiagnosticAdapter(options),
    "aifs-ens": new AifsEnsDiagnosticAdapter(options),
    aigefs: new AigefsDiagnosticAdapter(options),
    gfs: new GfsDiagnosticAdapter(options),
    gefs: new GefsDiagnosticAdapter(options),
    hgefs: new HgefsDiagnosticAdapter(options),
    "icon-d2": new IconD2DiagnosticAdapter(options),
    ifs: new IfsDiagnosticAdapter(options),
    "ifs-ens": new IfsEnsDiagnosticAdapter(options),
    "gfs-analysis": new GfsAnalysisDiagnosticAdapter(options),
  };
  return {
    ...defaults,
    ...options.adapters,
  };
}
