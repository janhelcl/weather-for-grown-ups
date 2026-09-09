from pathlib import Path


def must_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"pattern not found: {label}")
    return text.replace(old, new)

Path("src/cache/immutable-range-cache.ts").write_text('''import { createHash } from "node:crypto";
import { FileArtifactCache } from "./artifact-cache.js";

/**
 * Persistent cache for immutable byte ranges inside published provider objects.
 *
 * Query-level subset caches remain useful assembled artifacts, but they are not the
 * reusable data unit: overlapping selections should reuse already-downloaded GRIB
 * messages. Provider/network behavior stays in the loader supplied by the caller.
 */
export class ImmutableRangeCache {
  private readonly artifacts: FileArtifactCache;

  constructor(rootDir: string) {
    this.artifacts = new FileArtifactCache(rootDir);
  }

  async getOrCreate(
    url: string,
    start: number,
    length: number,
    loader: () => Promise<Uint8Array>,
  ): Promise<Uint8Array> {
    if (!Number.isSafeInteger(start) || start < 0) throw new Error("range start must be a non-negative integer");
    if (!Number.isSafeInteger(length) || length <= 0) throw new Error("range length must be a positive integer");
    const identity = JSON.stringify({ url, start, length });
    const name = `${createHash("sha256").update(identity).digest("hex")}.range`;
    return (await this.artifacts.getOrCreateBytes(name, loader)).value;
  }
}
''')

# ECMWF deterministic IFS/AIFS and AIFS ENS all use the same reusable range-cache layer.
for path, class_name in [
    ("src/cache/aifs-open-data-cache.ts", "AifsOpenDataSubsetCache"),
    ("src/cache/ifs-open-data-cache.ts", "IfsOpenDataSubsetCache"),
    ("src/cache/aifs-ens-open-data-cache.ts", "AifsEnsOpenDataSubsetCache"),
]:
    p = Path(path)
    t = p.read_text()
    # local cache import insertion
    import_anchor = 'import type { UpstreamAccessPolicy } from "../access/access-policy.js";\n'
    t = must_replace(
        t,
        import_anchor,
        import_anchor + 'import { ImmutableRangeCache } from "./immutable-range-cache.js";\n',
        f"{path} immutable range import",
    )
    # property and constructor initialization
    policy_prop = '  private readonly accessPolicy: IfsHttpAccessPolicy;\n'
    t = must_replace(
        t,
        policy_prop,
        policy_prop + '  private readonly rangeCache: ImmutableRangeCache;\n',
        f"{path} range property",
    )
    ctor = '''    this.accessPolicy = new IfsOpenDataAccessPolicy(
      join(rootDir, "access-state"),
      cloudAccessPolicy,
      directAccessPolicy,
    );
'''
    replacement = ctor + '    this.rangeCache = new ImmutableRangeCache(join(rootDir, "ranges"));\n'
    t = must_replace(t, ctor, replacement, f"{path} range constructor")

    # selected entry paths now reuse immutable ranges across exact selector sets.
    old = '      return this.fetchRange(gribUrl, entry.offset, length);'
    new = '''      return this.rangeCache.getOrCreate(
        gribUrl,
        entry.offset,
        length,
        () => this.fetchRange(gribUrl, entry.offset, length),
      );'''
    t = must_replace(t, old, new, f"{path} selected range reuse")
    p.write_text(t)

# Generic cache tests.
Path("test/immutable-range-cache.test.ts").write_text('''import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ImmutableRangeCache } from "../src/cache/immutable-range-cache.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("immutable range cache", () => {
  it("reuses the provider object + byte range independently of query selection", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-range-cache-"));
    roots.push(root);
    const cache = new ImmutableRangeCache(root);
    let calls = 0;
    const load = async () => {
      calls += 1;
      return new TextEncoder().encode("GRIBdata");
    };

    const first = await cache.getOrCreate("https://example.test/file.grib2", 100, 8, load);
    const second = await cache.getOrCreate("https://example.test/file.grib2", 100, 8, load);
    expect(new TextDecoder().decode(first)).toBe("GRIBdata");
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });

  it("keeps distinct ranges distinct", async () => {
    const root = await mkdtemp(join(tmpdir(), "wfg-range-cache-"));
    roots.push(root);
    const cache = new ImmutableRangeCache(root);
    let calls = 0;
    const loader = async () => new Uint8Array([++calls]);
    expect(await cache.getOrCreate("https://example.test/file", 0, 4, loader)).toEqual(new Uint8Array([1]));
    expect(await cache.getOrCreate("https://example.test/file", 4, 4, loader)).toEqual(new Uint8Array([2]));
    expect(calls).toBe(2);
  });
});
''')

# Strengthen AIFS integration regression: progressive selection should fetch only missing range.
p = Path("test/aifs-open-data-cache.test.ts")
t = p.read_text()
needle = '''    const surfaceTemperature = await cache.fetchSelection({
      run,
      forecastHour: 6,
      selectors: [
        { key: "temperature_2m", param: "2t", levtype: "sfc" },
      ],
    });
'''
progressive = '''    const combined = await cache.fetchSelection({
      run,
      forecastHour: 6,
      selectors: [
        { key: "temperature@850", param: "t", levtype: "pl", levelist: 850 },
        { key: "temperature_2m", param: "2t", levtype: "sfc" },
      ],
    });
    expect(combined.cacheHit).toBe(false);
    expect(new TextDecoder().decode(await readFile(combined.path))).toBe("GRIBtempGRIB2met");
    // The first message came from the message/range cache; only the new 2 m field hit upstream.
    expect(rangeCalls).toBe(2);

''' + needle
if needle not in t:
    raise SystemExit("AIFS progressive selection insertion marker missing")
t = t.replace(needle, progressive, 1)
# Because surface was already fetched by combined, its exact selector assembly still misses but its range is cached.
old = '''    expect(surfaceTemperature.cacheHit).toBe(false);
    expect(new TextDecoder().decode(await readFile(surfaceTemperature.path))).toBe("GRIB2met");
'''
new = '''    expect(surfaceTemperature.cacheHit).toBe(false);
    expect(new TextDecoder().decode(await readFile(surfaceTemperature.path))).toBe("GRIB2met");
    expect(rangeCalls).toBe(2);
'''
t = must_replace(t, old, new, "AIFS range call assertion")
p.write_text(t)

# Architecture docs: exact selections are assembled caches, immutable messages are reuse units.
p = Path("docs/ARCHITECTURE.md")
t = p.read_text()
old = '- keep bounded in-process decoded-artifact reuse below orchestration so repeated point sampling does not re-read, re-parse or re-decompress identical GRIB cache artifacts;\n'
new = '''- keep bounded in-process decoded-artifact reuse below orchestration so repeated point sampling does not re-read, re-parse or re-decompress identical GRIB cache artifacts;
- for indexed immutable provider objects, cache selected byte ranges/messages beneath exact query-subset artifacts, so progressive selector sets reuse prior downloads and fetch only missing messages;
'''
t = must_replace(t, old, new, "range reuse docs")
p.write_text(t)
