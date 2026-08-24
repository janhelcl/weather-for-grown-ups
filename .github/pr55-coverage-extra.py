from pathlib import Path

path = Path("test/gribberish-runtime.test.ts")
text = path.read_text()
marker = '  it("rejects a point decode with no usable coordinates", () => {'
if marker not in text:
    insertion = r'''

  it("rejects a point decode with no usable coordinates", () => {
    const message = fakeMessage({
      key: "TMP:202608240600:850 in mb:Forecast",
      latitudes: [Number.NaN, Number.NaN, Number.NaN, Number.NaN],
      longitudes: [Number.NaN, Number.NaN, Number.NaN, Number.NaN],
    });
    expect(() => decodePointMessages([message], 14, 50)).toThrow(/no grid coordinates/);
  });

  it("rejects an undefined nearest point value", () => {
    const message = fakeMessage({
      key: "TMP:202608240600:850 in mb:Forecast",
      values: [Number.NaN, 281, 282, 283],
    });
    expect(() => decodePointMessages([message], 14, 50)).toThrow(/nearest GRIB2 grid point is undefined/i);
  });

  it("rejects an exact selector with no matching message", () => {
    const message = fakeMessage({ key: "TMP:202608240600:850 in mb:Forecast" });
    expect(() => selectMessage([message], {
      code: "RH",
      gribLevel: "850 mb",
      temporalSemantics: "instantaneous",
    })).toThrow(/did not contain RH/);
  });
'''
    closing = '\n});\n'
    index = text.rfind(closing)
    if index < 0:
        raise RuntimeError("edge describe closing marker missing")
    text = text[:index] + insertion + text[index:]
path.write_text(text)
