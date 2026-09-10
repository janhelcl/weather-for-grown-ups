import { GfsAnalysisAnalogAdapter } from "./analogs.js";
import type {
  AtmosphericAnalogAdapterRegistry,
  AtmosphericVerificationAdapterRegistry,
} from "./types.js";
import {
  GfsAnalysisVerificationAdapter,
  IgraVerificationAdapter,
} from "./verification.js";

export function createAtmosphericVerificationAdapterRegistry(
  adapters: Partial<AtmosphericVerificationAdapterRegistry> = {},
): AtmosphericVerificationAdapterRegistry {
  return {
    "gfs-analysis": new GfsAnalysisVerificationAdapter(),
    igra: new IgraVerificationAdapter(),
    ...adapters,
  };
}

export function createAtmosphericAnalogAdapterRegistry(
  adapters: Partial<AtmosphericAnalogAdapterRegistry> = {},
): AtmosphericAnalogAdapterRegistry {
  return {
    "gfs-analysis": new GfsAnalysisAnalogAdapter(),
    ...adapters,
  };
}
