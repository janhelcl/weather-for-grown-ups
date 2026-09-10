import type {
  AtmosphericEvidenceIdentity,
  AtmosphericEvidenceSelectionPolicy,
  AtmosphericEvidenceStore,
} from "../cache/atmospheric-evidence-store.js";
import { stableEvidenceKey } from "../cache/atmospheric-evidence-store.js";

export interface AtmosphericEvidenceAcquisition<TEvidence> {
  evidence: TEvidence;
  cacheHit: boolean;
}

/**
 * Coordinates acquisition around a reusable evidence store.
 *
 * Run resolution, cadence validation, evidence widening and projection remain
 * model responsibilities. This class only prevents duplicate compatible work:
 * persisted supersets are reused first and identical in-flight misses share one
 * acquisition. Failed in-flight work is always evicted.
 */
export class AtmosphericEvidenceAcquirer<TSelection, TEvidence> {
  private readonly inFlight = new Map<string, Promise<TEvidence>>();

  constructor(
    private readonly store: AtmosphericEvidenceStore<TSelection, TEvidence>,
    private readonly policy: AtmosphericEvidenceSelectionPolicy<TSelection>,
  ) {}

  async acquire(
    identity: AtmosphericEvidenceIdentity,
    selection: TSelection,
    fetchEvidence: () => Promise<TEvidence>,
  ): Promise<AtmosphericEvidenceAcquisition<TEvidence>> {
    const normalized = this.policy.normalize(selection);
    const cached = await this.store.find(identity, normalized);
    if (cached !== undefined) return { evidence: cached, cacheHit: true };

    const key = stableEvidenceKey({ identity, selection: normalized });
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return { evidence: await existing, cacheHit: true };

    const operation = (async () => {
      const evidence = await fetchEvidence();
      await this.store.put(identity, normalized, evidence);
      return evidence;
    })().finally(() => {
      if (this.inFlight.get(key) === operation) this.inFlight.delete(key);
    });
    this.inFlight.set(key, operation);
    return { evidence: await operation, cacheHit: false };
  }
}
