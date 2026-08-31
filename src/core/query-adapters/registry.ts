import type { PublicAtmosphericDataset } from "../../schema/unified-api.js";
import { AigfsQueryAdapter, type AigfsQueryAdapterOptions } from "./aigfs.js";
import { AigefsQueryAdapter, type AigefsQueryAdapterOptions } from "./aigefs.js";
import { GefsQueryAdapter, type GefsQueryAdapterOptions } from "./gefs.js";
import {
  GfsAnalysisQueryAdapter,
  type GfsAnalysisQueryAdapterOptions,
} from "./gfs-analysis.js";
import { GfsQueryAdapter, type GfsQueryAdapterOptions } from "./gfs.js";
import { IfsEnsQueryAdapter, type IfsEnsQueryAdapterOptions } from "./ifs-ens.js";
import { IfsQueryAdapter, type IfsQueryAdapterOptions } from "./ifs.js";
import type {
  AtmosphericQueryAdapter,
  AtmosphericQueryAdapterRegistry,
} from "./types.js";

export type DefaultAtmosphericQueryAdapterOptions =
  AigfsQueryAdapterOptions
  & AigefsQueryAdapterOptions
  & GfsQueryAdapterOptions
  & GefsQueryAdapterOptions
  & IfsQueryAdapterOptions
  & IfsEnsQueryAdapterOptions
  & GfsAnalysisQueryAdapterOptions;

export interface AtmosphericQueryRegistryOptions extends DefaultAtmosphericQueryAdapterOptions {
  adapters?: Partial<Record<PublicAtmosphericDataset, AtmosphericQueryAdapter>>;
}

export function createAtmosphericQueryAdapterRegistry(
  options: AtmosphericQueryRegistryOptions = {},
): AtmosphericQueryAdapterRegistry {
  const defaults: AtmosphericQueryAdapterRegistry = {
    aigfs: new AigfsQueryAdapter(options),
    aigefs: new AigefsQueryAdapter(options),
    gfs: new GfsQueryAdapter(options),
    gefs: new GefsQueryAdapter(options),
    ifs: new IfsQueryAdapter(options),
    "ifs-ens": new IfsEnsQueryAdapter(options),
    "gfs-analysis": new GfsAnalysisQueryAdapter(options),
  };
  return {
    ...defaults,
    ...options.adapters,
  };
}
