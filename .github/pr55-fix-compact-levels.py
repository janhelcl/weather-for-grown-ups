from pathlib import Path

runtime = Path("src/grib/gribberish-runtime.ts")
text = runtime.read_text()
alias_anchor = '  ["entire atmosphere as a single layer", "entire atmosphere (considered as a single layer)"],\n'
alias_variant = '  ["entire atmosphere as single layer", "entire atmosphere (considered as a single layer)"],\n'
if alias_variant not in text:
    if alias_anchor not in text:
        raise RuntimeError("entire-atmosphere alias anchor not found")
    text = text.replace(alias_anchor, alias_anchor + alias_variant, 1)

old = '''  const lowerKey = key.toLowerCase();
  for (const [decoderName, publicName] of NAMED_VERTICAL_ALIASES) {
    if (lowerKey.includes(`in ${decoderName}`)) return { namedVertical: publicName };
  }
  return null;
}'''
new = '''  const normalizedKey = normalizeNamedVerticalText(key);
  for (const [decoderName, publicName] of NAMED_VERTICAL_ALIASES) {
    if (normalizedKey.includes(`in${normalizeNamedVerticalText(decoderName)}`)) {
      return { namedVertical: publicName };
    }
  }
  return null;
}'''
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise RuntimeError("named vertical matching block not found")

anchor = '''function matchesGribLevel(key: string, gribLevel: string): boolean {'''
helper = '''function normalizeNamedVerticalText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

'''
if helper not in text:
    if anchor not in text:
        raise RuntimeError("matchesGribLevel anchor not found")
    text = text.replace(anchor, helper + anchor, 1)
runtime.write_text(text)

test = Path("test/gribberish-runtime.test.ts")
text = test.read_text()
marker = '  it("accepts compact named verticals emitted by gribberish", () => {'
if marker not in text:
    insertion = r'''

  it("accepts compact named verticals emitted by gribberish", () => {
    const cases = [
      ["LCDC:202608240600:0 in lowcloudlayer:average forecast", "LCDC", "low cloud layer"],
      ["PWAT:202608240600:0 in entireatmosphereassinglelayer:forecast", "PWAT", "entire atmosphere (considered as a single layer)"],
      ["HGT:202608240600:0 in cloudceiling:forecast", "HGT", "cloud ceiling"],
    ] as const;
    for (const [key, code, namedVertical] of cases) {
      const [decoded] = decodePointMessages([fakeMessage({ key, code })], 14, 50);
      expect(decoded).toMatchObject({ namedVertical });
    }
  });
'''
    closing = '\n});\n'
    index = text.rfind(closing)
    if index < 0:
        raise RuntimeError("test describe closing marker not found")
    text = text[:index] + insertion + text[index:]
test.write_text(text)
