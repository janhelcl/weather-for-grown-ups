from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found in {path}")
    p.write_text(text.replace(old, new, 1))

replace(
    "test/time-series.test.ts",
    '''  it("defaults to bounded concurrency of four", () => {
    expect(DEFAULT_TIME_SERIES_CONCURRENCY).toBe(4);
  });''',
    '''  it("defaults to bounded concurrency of eight", () => {
    expect(DEFAULT_TIME_SERIES_CONCURRENCY).toBe(8);
  });''',
)
replace(
    "test/points-time-series.test.ts",
    '''  it("defaults to four concurrent forecast-file batches", () => {
    expect(DEFAULT_POINTS_TIME_SERIES_CONCURRENCY).toBe(4);
  });''',
    '''  it("defaults to eight concurrent forecast-file batches", () => {
    expect(DEFAULT_POINTS_TIME_SERIES_CONCURRENCY).toBe(8);
  });''',
)
