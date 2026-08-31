import type { PublicAtmosphericDataset } from "../../schema/unified-api.js";
import { AigfsQueryAdapter, type AigfsQueryAdapterOptions } from "./aigfs.js";
import { AifsQueryAdapter, type AifsQueryAdapterOptions } from "./aifs.js";
import { AifsEnsQueryAdapter, type AifsEnsQueryAdapterOptions } from "./aifs-ens.js";
import { AigefsQueryAdapter, type AigefsQueryAdapterOptions } from "./aigefs.js";
import { GefsQueryAdapter, type GefsQueryAdapterOptions } from "./gefs.js";
import { HgefsQueryAdapter, type HgefsQueryAdapterOptions } from "./hgefs.js";
import { IconD2QueryAdapter, type IconD2QueryAdapterOptions } from "./icon-d2.js";
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
  & AifsQueryAdapterOptions
  & AifsEnsQueryAdapterOptions
  & AigefsQueryAdapterOptions
  & GfsQueryAdapterOptions
  & GefsQueryAdapterOptions
  & HgefsQueryAdapterOptions
  & IconD2QueryAdapterOptions
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
    aifs: new AifsQueryAdapter(options),
    "aifs-ens": new AifsEnsQueryAdapter(options),
    aigefs: new AigefsQueryAdapter(options),
    gfs: new GfsQueryAdapter(options),
    gefs: new GefsQueryAdapter(options),
    hgefs: new HgefsQueryAdapter(options),
    "icon-d2": new IconD2QueryAdapter(options),
    ifs: new IfsQueryAdapter(options),
    "ifs-ens": new IfsEnsQueryAdapter(options),
    "gfs-analysis": new GfsAnalysisQueryAdapter(options),
  };
  return {
    ...defaults,
    ...options.adapters,
  };
}
