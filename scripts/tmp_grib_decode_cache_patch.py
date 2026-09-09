from pathlib import Path


def must_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"pattern not found: {label}")
    return text.replace(old, new)

p = Path("src/grib/gribberish-runtime.ts")
t = p.read_text()
t = must_replace(
    t,
    'import { readFile } from "node:fs/promises";',
    'import { readFile, stat } from "node:fs/promises";',
    "fs imports",
)
anchor = 'type GribCoordinateLayout = "axes" | "points";\n'
addition = '''type GribCoordinateLayout = "axes" | "points";

interface ParsedGribCacheEntry {
  signature: string;
  messages: GribMessage[];
}

interface PreparedGrid {
  latitude: readonly number[];
  longitude: readonly number[];
  data: readonly number[];
  layout: GribCoordinateLayout;
}

// GRIB subset files are immutable cache artifacts in normal WFG operation. Keep a small
// in-process LRU so point/ensemble composition does not repeatedly read and parse the same
// artifact. File metadata invalidates the entry for tests or non-cache callers that replace
// a path in place.
const PARSED_GRIB_CACHE_LIMIT = 8;
const parsedGribCache = new Map<string, ParsedGribCacheEntry>();
const parsedGribInFlight = new Map<string, Promise<GribMessage[]>>();
const preparedGridCache = new WeakMap<GribMessage, PreparedGrid>();
'''
t = must_replace(t, anchor, addition, "GRIB cache declarations")
old = '''export async function readGribMessages(path: string): Promise<GribMessage[]> {
  const bytes = await readFile(path);
  const messages = parseMessagesWithKnownLocalAliases(bytes);
  if (messages.length === 0) throw new Error(`Bundled GRIB2 decoder found no readable messages in ${path}`);
  return messages;
}
'''
new = '''export async function readGribMessages(path: string): Promise<GribMessage[]> {
  const info = await stat(path);
  const signature = `${info.size}:${info.mtimeMs}`;
  const cached = parsedGribCache.get(path);
  if (cached?.signature === signature) {
    // Refresh LRU position without copying the parsed messages.
    parsedGribCache.delete(path);
    parsedGribCache.set(path, cached);
    return cached.messages;
  }

  const inFlightKey = `${path}:${signature}`;
  const pending = parsedGribInFlight.get(inFlightKey);
  if (pending !== undefined) return pending;

  const operation = (async () => {
    const bytes = await readFile(path);
    const messages = parseMessagesWithKnownLocalAliases(bytes);
    if (messages.length === 0) {
      throw new Error(`Bundled GRIB2 decoder found no readable messages in ${path}`);
    }
    parsedGribCache.delete(path);
    parsedGribCache.set(path, { signature, messages });
    while (parsedGribCache.size > PARSED_GRIB_CACHE_LIMIT) {
      const oldest = parsedGribCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      parsedGribCache.delete(oldest);
    }
    return messages;
  })().finally(() => parsedGribInFlight.delete(inFlightKey));

  parsedGribInFlight.set(inFlightKey, operation);
  return operation;
}
'''
t = must_replace(t, old, new, "readGribMessages")

# Route all grid preparation through one WeakMap-backed operation. This makes repeated point
# sampling on the same parsed messages cheap, without changing public sampling semantics.
old = '''function nearestPoint(message: GribMessage, longitude: number, latitude: number): GribGridPoint {
  const coordinates = message.latlngAdjusted(true, false);
  const data = message.dataAdjusted(true, false);
  const layout = coordinateLayout(message, coordinates.latitude, coordinates.longitude, data);
  const targetLongitude = toSignedLongitude(longitude);
'''
new = '''function nearestPoint(message: GribMessage, longitude: number, latitude: number): GribGridPoint {
  const prepared = preparedGrid(message);
  const coordinates = { latitude: prepared.latitude, longitude: prepared.longitude };
  const data = prepared.data;
  const layout = prepared.layout;
  const targetLongitude = toSignedLongitude(longitude);
'''
t = must_replace(t, old, new, "nearestPoint preparation")

# Area paths benefit from the same preparation reuse when a parsed message is sampled both
# spatially and by point in one composed request.
old = '''export function gridPointsInBox(message: GribMessage, box: GribBox): GribGridPoint[] {
  const coordinates = message.latlngAdjusted(true, false);
  const data = message.dataAdjusted(true, false);
  const layout = coordinateLayout(message, coordinates.latitude, coordinates.longitude, data);
  const points: GribGridPoint[] = [];
'''
new = '''export function gridPointsInBox(message: GribMessage, box: GribBox): GribGridPoint[] {
  const prepared = preparedGrid(message);
  const coordinates = { latitude: prepared.latitude, longitude: prepared.longitude };
  const data = prepared.data;
  const layout = prepared.layout;
  const points: GribGridPoint[] = [];
'''
t = must_replace(t, old, new, "gridPointsInBox preparation")

marker = '''function coordinateLayout(
  message: GribMessage,
'''
helper = '''function preparedGrid(message: GribMessage): PreparedGrid {
  const cached = preparedGridCache.get(message);
  if (cached !== undefined) return cached;
  const coordinates = message.latlngAdjusted(true, false);
  const data = message.dataAdjusted(true, false);
  const prepared: PreparedGrid = {
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    data,
    layout: coordinateLayout(message, coordinates.latitude, coordinates.longitude, data),
  };
  preparedGridCache.set(message, prepared);
  return prepared;
}

'''
if marker not in t:
    raise SystemExit("coordinateLayout marker missing")
t = t.replace(marker, helper + marker, 1)
p.write_text(t)

# Add a regression proving repeated point/area sampling prepares a message grid only once.
p = Path("test/gribberish-runtime.test.ts")
t = p.read_text()
marker = 'describe("bundled GRIB2 exact message selection", () => {'
addition = '''describe("bundled GRIB2 prepared-grid reuse", () => {
  it("prepares one parsed message grid once across repeated point and area sampling", () => {
    let coordinateReads = 0;
    let dataReads = 0;
    const message = fakeMessage({
      key: "TMP:202608240600:850 in mb:Forecast",
      values: [280, 281, 282, 283],
    });
    (message as any).latlngAdjusted = () => {
      coordinateReads += 1;
      return { latitude: [50, 50, 49, 49], longitude: [14, 15, 14, 15] };
    };
    (message as any).dataAdjusted = () => {
      dataReads += 1;
      return [280, 281, 282, 283];
    };

    decodePointMessages([message], 14, 50);
    decodePointMessages([message], 15, 49);
    gridPointsInBox(message, {
      westLongitude: 14,
      eastLongitude: 15,
      southLatitude: 49,
      northLatitude: 50,
    });

    expect(coordinateReads).toBe(1);
    expect(dataReads).toBe(1);
  });
});

'''
if marker not in t:
    raise SystemExit("GRIB test marker missing")
t = t.replace(marker, addition + marker, 1)
p.write_text(t)

# Architecture docs: make parsed artifact reuse a stable rule.
p = Path("docs/ARCHITECTURE.md")
t = p.read_text()
old = '- reuse one downloaded artifact across points, members or derived operations whenever the provider product permits it;\n'
new = '''- reuse one downloaded artifact across points, members or derived operations whenever the provider product permits it;
- keep bounded in-process decoded-artifact reuse below orchestration so repeated point sampling does not re-read, re-parse or re-decompress identical GRIB cache artifacts;
'''
t = must_replace(t, old, new, "decode reuse architecture doc")
p.write_text(t)
