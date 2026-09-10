import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  PersistentAtmosphericEvidenceStore,
  type AtmosphericEvidenceSelectionPolicy,
} from "../src/cache/atmospheric-evidence-store.js";
import { AtmosphericEvidenceAcquirer } from "../src/core/atmospheric-evidence-acquirer.js";

interface Selection { tokens: readonly string[] }

const policy: AtmosphericEvidenceSelectionPolicy<Selection> = {
  normalize: (selection) => ({ tokens: [...new Set(selection.tokens)].sort() }),
  covers: (available, requested) => requested.tokens.every((token) => available.tokens.includes(token)),
  cost: (selection) => selection.tokens.length,
  isSelection(value): value is Selection {
    if (typeof value !== "object" || value === null) return false;
    const tokens = (value as Record<string, unknown>).tokens;
    return Array.isArray(tokens) && tokens.every((token) => typeof token === "string");
  },
};

const identity = {
  dataset: "test-model",
  run: "2026-09-10T00:00:00.000Z",
  validTime: "2026-09-10T06:00:00.000Z",
  latitude: 45.77,
  longitude: 11.73,
};

describe("AtmosphericEvidenceAcquirer", () => {
  it("deduplicates identical in-flight acquisition and then serves the persisted result", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-evidence-generic-"));
    try {
      const store = new PersistentAtmosphericEvidenceStore<Selection, { value: number }>(root, policy);
      const acquirer = new AtmosphericEvidenceAcquirer(store, policy);
      const fetchEvidence = vi.fn(async () => ({ value: 42 }));

      const [first, second] = await Promise.all([
        acquirer.acquire(identity, { tokens: ["temperature", "wind"] }, fetchEvidence),
        acquirer.acquire(identity, { tokens: ["wind", "temperature"] }, fetchEvidence),
      ]);
      const third = await new AtmosphericEvidenceAcquirer(store, policy).acquire(
        identity,
        { tokens: ["temperature"] },
        async () => ({ value: -1 }),
      );

      expect(fetchEvidence).toHaveBeenCalledTimes(1);
      expect(first.evidence.value).toBe(42);
      expect(second.evidence.value).toBe(42);
      expect(first.cacheHit || second.cacheHit).toBe(true);
      expect(third).toEqual({ evidence: { value: 42 }, cacheHit: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("evicts failed in-flight work so a retry can acquire normally", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-evidence-retry-"));
    try {
      const store = new PersistentAtmosphericEvidenceStore<Selection, number>(root, policy);
      const acquirer = new AtmosphericEvidenceAcquirer(store, policy);
      await expect(acquirer.acquire(identity, { tokens: ["temperature"] }, async () => {
        throw new Error("upstream failed");
      })).rejects.toThrow("upstream failed");

      const retry = await acquirer.acquire(identity, { tokens: ["temperature"] }, async () => 7);
      expect(retry).toEqual({ evidence: 7, cacheHit: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
