import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ProfileEvidenceCache,
  type ProfileEvidenceIdentity,
  type ProfileEvidenceSelection,
} from "../src/cache/profile-evidence-cache.js";

const identity: ProfileEvidenceIdentity = {
  dataset: "gfs",
  run: "2026-09-10T00:00:00.000Z",
  validTime: "2026-09-10T06:00:00.000Z",
  latitude: 45.77,
  longitude: 11.73,
  variant: "0p25",
  source: "s3",
};

const temperature850: ProfileEvidenceSelection = {
  pressureVariables: ["TMP"],
  pressureLevelsHpa: [850],
  fields: [],
};

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "wfg-profile-evidence-cache-"));
}

describe("ProfileEvidenceCache", () => {
  it("rejects invalid variant bounds through the generic evidence store", () => {
    expect(() => new ProfileEvidenceCache("unused", { maxVariants: 0 })).toThrow(
      "atmospheric evidence maxVariants must be a positive integer",
    );
    expect(() => new ProfileEvidenceCache("unused", { maxVariants: 1.5 })).toThrow(
      "atmospheric evidence maxVariants must be a positive integer",
    );
  });

  it("replaces narrower evidence with a wider superset and ignores redundant puts", async () => {
    const root = await tempRoot();
    try {
      const cache = new ProfileEvidenceCache<string>(root);
      await cache.put(identity, temperature850, "narrow");
      await cache.put(identity, {
        pressureVariables: ["RH", "TMP", "TMP"],
        pressureLevelsHpa: [700, 850, 850],
        fields: [],
      }, "wide");
      await cache.put(identity, temperature850, "redundant");

      expect(await cache.find(identity, temperature850)).toBe("wide");
      expect(await cache.find(identity, {
        pressureVariables: ["RH"],
        pressureLevelsHpa: [700],
        fields: [],
      })).toBe("wide");
      expect(await cache.find(identity, {
        pressureVariables: ["VGRD"],
        pressureLevelsHpa: [850],
        fields: [],
      })).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serializes concurrent incomparable writes to the same identity", async () => {
    const root = await tempRoot();
    try {
      const cache = new ProfileEvidenceCache<string>(root);
      await Promise.all([
        cache.put(identity, temperature850, "temperature"),
        cache.put(identity, {
          pressureVariables: ["RH"],
          pressureLevelsHpa: [850],
          fields: [],
        }, "humidity"),
      ]);

      expect(await cache.find(identity, temperature850)).toBe("temperature");
      expect(await cache.find(identity, {
        pressureVariables: ["RH"],
        pressureLevelsHpa: [850],
        fields: [],
      })).toBe("humidity");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("bounds incomparable selection variants", async () => {
    const root = await tempRoot();
    try {
      const cache = new ProfileEvidenceCache<string>(root, { maxVariants: 2 });
      await cache.put(identity, {
        pressureVariables: ["TMP"],
        pressureLevelsHpa: [850, 700],
        fields: [],
      }, "largest");
      await cache.put(identity, {
        pressureVariables: ["RH"],
        pressureLevelsHpa: [850],
        fields: [],
      }, "middle");
      await cache.put(identity, {
        pressureVariables: [],
        pressureLevelsHpa: [],
        fields: ["temperature_2m"],
      }, "field");

      expect(await cache.find(identity, {
        pressureVariables: ["TMP"],
        pressureLevelsHpa: [850],
        fields: [],
      })).toBe("largest");
      const retained = await Promise.all([
        cache.find(identity, {
          pressureVariables: ["RH"],
          pressureLevelsHpa: [850],
          fields: [],
        }),
        cache.find(identity, {
          pressureVariables: [],
          pressureLevelsHpa: [],
          fields: ["temperature_2m"],
        }),
      ]);
      expect(retained.filter((value) => value !== undefined)).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats malformed, version-mismatched and invalid-entry files as misses", async () => {
    const root = await tempRoot();
    try {
      await mkdir(root, { recursive: true });
      const path = join(root, `${identityHash(identity)}.json`);
      const cache = new ProfileEvidenceCache<string>(root);

      await writeFile(path, "not-json", "utf8");
      expect(await cache.find(identity, temperature850)).toBeUndefined();

      await writeFile(path, JSON.stringify({ version: 999, identity, entries: [] }), "utf8");
      expect(await cache.find(identity, temperature850)).toBeUndefined();

      await writeFile(path, JSON.stringify({
        version: 1,
        identity,
        entries: [
          { selection: null, value: "bad" },
          { selection: { pressureVariables: [1], pressureLevelsHpa: [850], fields: [] }, value: "bad" },
          { selection: { pressureVariables: ["TMP"], pressureLevelsHpa: [Number.NaN], fields: [] }, value: "bad" },
          { selection: { pressureVariables: ["TMP"], pressureLevelsHpa: [850], fields: [2] }, value: "bad" },
          { selection: temperature850, value: "good" },
        ],
      }), "utf8");
      expect(await cache.find(identity, temperature850)).toBe("good");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function identityHash(value: ProfileEvidenceIdentity): string {
  const ordered = Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}
