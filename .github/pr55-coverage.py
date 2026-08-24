from pathlib import Path

path = Path("test/gribberish-runtime.test.ts")
text = path.read_text()

anchor = 'import { describe, expect, it } from "vitest";\n'
imports = '''import { Wgrib2GridDecoder } from "../src/grib/wgrib2-grid.js";
import { Wgrib2StatsDecoder } from "../src/grib/wgrib2-stats.js";
import { Wgrib2Decoder } from "../src/grib/wgrib2.js";
'''
if imports not in text:
    if anchor not in text:
        raise RuntimeError("vitest import anchor missing")
    text = text.replace(anchor, anchor + imports, 1)

marker = '  it("reports bundled and native decoder engine identity", () => {'
if marker not in text:
    insertion = r'''

  it("reports bundled and native decoder engine identity", () => {
    const previousPath = process.env.WGRIB2_PATH;
    const previousDecoder = process.env.WFG_DECODER;
    try {
      delete process.env.WGRIB2_PATH;
      delete process.env.WFG_DECODER;
      expect(new Wgrib2Decoder().engine).toBe("gribberish");
      expect(new Wgrib2GridDecoder().engine).toBe("gribberish");
      expect(new Wgrib2StatsDecoder().engine).toBe("gribberish");

      process.env.WFG_DECODER = "wgrib2";
      expect(new Wgrib2Decoder().engine).toBe("wgrib2");
      expect(new Wgrib2GridDecoder().engine).toBe("wgrib2");
      expect(new Wgrib2StatsDecoder().engine).toBe("wgrib2");

      process.env.WGRIB2_PATH = "/custom/wgrib2";
      expect(new Wgrib2Decoder().engine).toBe("wgrib2");
      expect(new Wgrib2GridDecoder().engine).toBe("wgrib2");
      expect(new Wgrib2StatsDecoder().engine).toBe("wgrib2");
    } finally {
      if (previousPath === undefined) delete process.env.WGRIB2_PATH;
      else process.env.WGRIB2_PATH = previousPath;
      if (previousDecoder === undefined) delete process.env.WFG_DECODER;
      else process.env.WFG_DECODER = previousDecoder;
    }
  });
'''
    closing = '\n});\n'
    index = text.rfind(closing)
    if index < 0:
        raise RuntimeError("edge describe closing marker missing")
    text = text[:index] + insertion + text[index:]

path.write_text(text)
