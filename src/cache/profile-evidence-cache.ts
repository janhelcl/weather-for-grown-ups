import {
  PersistentAtmosphericEvidenceStore,
  type AtmosphericEvidenceIdentity,
  type AtmosphericEvidenceSelectionPolicy,
} from "./atmospheric-evidence-store.js";

export type ProfileEvidenceIdentity = AtmosphericEvidenceIdentity & {
  dataset: string;
  run: string;
  validTime: string;
  latitude: number;
  longitude: number;
  variant?: string;
  source?: string;
  population?: string;
};

export interface ProfileEvidenceSelection {
  pressureVariables: readonly string[];
  pressureLevelsHpa: readonly number[];
  fields: readonly string[];
}

export const profileEvidenceSelectionPolicy: AtmosphericEvidenceSelectionPolicy<ProfileEvidenceSelection> = {
  normalize(selection) {
    return {
      pressureVariables: [...new Set(selection.pressureVariables)].sort(),
      pressureLevelsHpa: [...new Set(selection.pressureLevelsHpa)].sort((a, b) => b - a),
      fields: [...new Set(selection.fields)].sort(),
    };
  },
  covers(available, requested) {
    return isSuperset(available.pressureVariables, requested.pressureVariables)
      && isSuperset(available.pressureLevelsHpa, requested.pressureLevelsHpa)
      && isSuperset(available.fields, requested.fields);
  },
  cost(selection) {
    return selection.pressureVariables.length * selection.pressureLevelsHpa.length
      + selection.fields.length;
  },
  isSelection(value): value is ProfileEvidenceSelection {
    if (typeof value !== "object" || value === null) return false;
    const selection = value as Record<string, unknown>;
    return Array.isArray(selection.pressureVariables)
      && selection.pressureVariables.every((item) => typeof item === "string")
      && Array.isArray(selection.pressureLevelsHpa)
      && selection.pressureLevelsHpa.every((item) => typeof item === "number" && Number.isFinite(item))
      && Array.isArray(selection.fields)
      && selection.fields.every((item) => typeof item === "string");
  },
};

/** Pressure-column specialization of the model-agnostic atmospheric evidence store. */
export class ProfileEvidenceCache<T>
  extends PersistentAtmosphericEvidenceStore<ProfileEvidenceSelection, T> {
  constructor(rootDir: string, options: { maxVariants?: number } = {}) {
    super(rootDir, profileEvidenceSelectionPolicy, options);
  }
}

function isSuperset<T>(available: readonly T[], requested: readonly T[]): boolean {
  const values = new Set(available);
  return requested.every((value) => values.has(value));
}
