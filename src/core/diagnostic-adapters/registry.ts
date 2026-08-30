import type { PublicAtmosphericDataset } from "../../schema/unified-api.js";
import { GefsDiagnosticAdapter, type GefsDiagnosticAdapterOptions } from "./gefs.js";
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
  GfsDiagnosticAdapterOptions
  & GefsDiagnosticAdapterOptions
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
    gfs: new GfsDiagnosticAdapter(options),
    gefs: new GefsDiagnosticAdapter(options),
    ifs: new IfsDiagnosticAdapter(options),
    "ifs-ens": new IfsEnsDiagnosticAdapter(options),
    "gfs-analysis": new GfsAnalysisDiagnosticAdapter(options),
  };
  return {
    ...defaults,
    ...options.adapters,
  };
}
