from pathlib import Path


def must_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"pattern not found: {label}")
    return text.replace(old, new)


def patch_aigfs() -> None:
    p = Path("src/core/aigfs.ts")
    t = p.read_text()
    t = must_replace(t, 'import { computeAreaDistribution } from "./area-distribution.js";\n', 'import { computeAreaDistribution } from "./area-distribution.js";\nimport { mapConcurrent } from "./concurrency.js";\n', "AIGFS concurrency import")
    t = must_replace(t, 'const MAX_NATIVE_STEPS = 65;\n', 'const MAX_NATIVE_STEPS = 65;\nexport const DEFAULT_AIGFS_STEP_CONCURRENCY = 4;\n', "AIGFS concurrency constant")
    t = must_replace(t, '  areaGridDecoder?: Wgrib2GridDecoder;\n}', '  areaGridDecoder?: Wgrib2GridDecoder;\n  concurrency?: number;\n}', "AIGFS option")
    t = must_replace(t, '  private readonly areaGridDecoder: Wgrib2GridDecoder;\n', '  private readonly areaGridDecoder: Wgrib2GridDecoder;\n  private readonly concurrency: number;\n', "AIGFS property")
    t = must_replace(t, '    this.areaGridDecoder = options.areaGridDecoder ?? new Wgrib2GridDecoder();\n', '    this.areaGridDecoder = options.areaGridDecoder ?? new Wgrib2GridDecoder();\n    this.concurrency = options.concurrency ?? DEFAULT_AIGFS_STEP_CONCURRENCY;\n', "AIGFS constructor")
    t = must_replace(t, '''    const profiles: AigfsProfileResult[] = [];
    for (const forecastHour of forecastHours) {
      profiles.push(await this.profileAt(
        run,
        aigfsValidTime(run, forecastHour),
        request.geometry,
        selection,
      ));
    }''', '''    const point = request.geometry;
    const profiles = await mapConcurrent(
      forecastHours,
      this.concurrency,
      (forecastHour) => this.profileAt(
        run,
        aigfsValidTime(run, forecastHour),
        point,
        selection,
      ),
    );''', "AIGFS point range")
    t = must_replace(t, '''    const batches: any[] = [];
    for (const forecastHour of forecastHours) {
      batches.push(await this.pointsAt(
        run,
        aigfsValidTime(run, forecastHour),
        request.geometry.points,
        selection,
      ));
    }''', '''    const points = request.geometry.points;
    const batches = await mapConcurrent(
      forecastHours,
      this.concurrency,
      (forecastHour) => this.pointsAt(
        run,
        aigfsValidTime(run, forecastHour),
        points,
        selection,
      ) as Promise<any>,
    );''', "AIGFS points range")
    t = must_replace(t, '''    const results: any[] = [];
    for (const forecastHour of forecastHours) {
      results.push(await this.getInstantDiagnostic({
        ...request,
        time: { at: aigfsValidTime(run, forecastHour).toISOString() },
        forecast: { ...request.forecast, run: run.toISOString() },
      } as DiagnoseAtmosphereRequest, run));
    }''', '''    const results = await mapConcurrent(
      forecastHours,
      this.concurrency,
      (forecastHour) => this.getInstantDiagnostic({
        ...request,
        time: { at: aigfsValidTime(run, forecastHour).toISOString() },
        forecast: { ...request.forecast, run: run.toISOString() },
      } as DiagnoseAtmosphereRequest, run) as Promise<any>,
    );''', "AIGFS diagnostic range")
    p.write_text(t)


def patch_icon() -> None:
    p = Path("src/core/icon-d2.ts")
    t = p.read_text()
    t = must_replace(t, 'import { computeAreaDistribution } from "./area-distribution.js";\n', 'import { computeAreaDistribution } from "./area-distribution.js";\nimport { mapConcurrent } from "./concurrency.js";\n', "ICON concurrency import")
    t = must_replace(t, 'const MAX_NATIVE_STEPS = 49;\n', 'const MAX_NATIVE_STEPS = 49;\nexport const DEFAULT_ICON_D2_STEP_CONCURRENCY = 4;\n', "ICON concurrency constant")
    t = must_replace(t, '  areaGridDecoder?: Wgrib2GridDecoder;\n}', '  areaGridDecoder?: Wgrib2GridDecoder;\n  concurrency?: number;\n}', "ICON option")
    t = must_replace(t, '  private readonly areaGridDecoder: Wgrib2GridDecoder;\n', '  private readonly areaGridDecoder: Wgrib2GridDecoder;\n  private readonly concurrency: number;\n', "ICON property")
    t = must_replace(t, '    this.areaGridDecoder = options.areaGridDecoder ?? new Wgrib2GridDecoder();\n', '    this.areaGridDecoder = options.areaGridDecoder ?? new Wgrib2GridDecoder();\n    this.concurrency = options.concurrency ?? DEFAULT_ICON_D2_STEP_CONCURRENCY;\n', "ICON constructor")
    t = must_replace(t, '''    const profiles: IconD2ProfileResult[] = [];
    for (const forecastHour of forecastHours) {
      profiles.push(await this.profileAt(
        run,
        iconD2ValidTime(run, forecastHour),
        request.geometry,
        selection,
      ));
    }''', '''    const point = request.geometry;
    const profiles = await mapConcurrent(
      forecastHours,
      this.concurrency,
      (forecastHour) => this.profileAt(
        run,
        iconD2ValidTime(run, forecastHour),
        point,
        selection,
      ),
    );''', "ICON point range")
    t = must_replace(t, '''    const batches: any[] = [];
    for (const forecastHour of forecastHours) {
      batches.push(await this.pointsAt(
        run,
        iconD2ValidTime(run, forecastHour),
        request.geometry.points,
        selection,
      ));
    }''', '''    const points = request.geometry.points;
    const batches = await mapConcurrent(
      forecastHours,
      this.concurrency,
      (forecastHour) => this.pointsAt(
        run,
        iconD2ValidTime(run, forecastHour),
        points,
        selection,
      ) as Promise<any>,
    );''', "ICON points range")
    t = must_replace(t, '''    const results: any[] = [];
    for (const forecastHour of forecastHours) {
      results.push(await this.getInstantDiagnostic({
        ...request,
        time: { at: iconD2ValidTime(run, forecastHour).toISOString() },
        forecast: { ...request.forecast, run: run.toISOString() },
      } as DiagnoseAtmosphereRequest, run));
    }''', '''    const results = await mapConcurrent(
      forecastHours,
      this.concurrency,
      (forecastHour) => this.getInstantDiagnostic({
        ...request,
        time: { at: iconD2ValidTime(run, forecastHour).toISOString() },
        forecast: { ...request.forecast, run: run.toISOString() },
      } as DiagnoseAtmosphereRequest, run) as Promise<any>,
    );''', "ICON diagnostic range")
    p.write_text(t)


def patch_arome() -> None:
    p = Path("src/core/arome.ts")
    t = p.read_text()
    t = must_replace(t, 'import { computeAreaDistribution } from "./area-distribution.js";\n', 'import { computeAreaDistribution } from "./area-distribution.js";\nimport { mapConcurrent } from "./concurrency.js";\n', "AROME concurrency import")
    t = must_replace(t, 'const MAX_NATIVE_STEPS = 52;\n', 'const MAX_NATIVE_STEPS = 52;\nexport const DEFAULT_AROME_STEP_CONCURRENCY = 4;\n', "AROME concurrency constant")
    t = must_replace(t, '  areaGridDecoder?: Wgrib2GridDecoder;\n}', '  areaGridDecoder?: Wgrib2GridDecoder;\n  concurrency?: number;\n}', "AROME option")
    t = must_replace(t, '  private readonly areaGridDecoder: Wgrib2GridDecoder;\n', '  private readonly areaGridDecoder: Wgrib2GridDecoder;\n  private readonly concurrency: number;\n', "AROME property")
    t = must_replace(t, '    this.areaGridDecoder = options.areaGridDecoder ?? new Wgrib2GridDecoder();\n', '    this.areaGridDecoder = options.areaGridDecoder ?? new Wgrib2GridDecoder();\n    this.concurrency = options.concurrency ?? DEFAULT_AROME_STEP_CONCURRENCY;\n', "AROME constructor")
    t = must_replace(t, '''    const points: AromePointResult[] = [];
    for (const forecastHour of forecastHours) {
      points.push(await this.pointAt(
        run,
        aromeValidTime(run, forecastHour),
        request.geometry,
        selection,
      ));
    }''', '''    const point = request.geometry;
    const points = await mapConcurrent(
      forecastHours,
      this.concurrency,
      (forecastHour) => this.pointAt(
        run,
        aromeValidTime(run, forecastHour),
        point,
        selection,
      ),
    );''', "AROME point range")
    t = must_replace(t, '''    const batches: any[] = [];
    for (const forecastHour of forecastHours) {
      batches.push(await this.pointsAt(
        run,
        aromeValidTime(run, forecastHour),
        request.geometry.points,
        selection,
      ));
    }''', '''    const requestedPoints = request.geometry.points;
    const batches = await mapConcurrent(
      forecastHours,
      this.concurrency,
      (forecastHour) => this.pointsAt(
        run,
        aromeValidTime(run, forecastHour),
        requestedPoints,
        selection,
      ) as Promise<any>,
    );''', "AROME points range")
    p.write_text(t)


def patch_architecture_test() -> None:
    p = Path("test/architecture-boundaries.test.ts")
    t = p.read_text()
    marker = '  it("keeps the public unified API module as a composition barrel", async () => {'
    addition = '''  it("keeps independent deterministic forecast ranges bounded-concurrent", async () => {
    const files = [
      "src/core/aifs.ts",
      "src/core/aigfs.ts",
      "src/core/arome.ts",
      "src/core/icon-d2.ts",
      "src/core/ifs-spatiotemporal.ts",
      "src/core/time-series.ts",
    ];
    for (const path of files) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(/for\\s*\\(const forecastHour of forecastHours\\)\\s*\\{[\\s\\S]{0,160}?await/);
    }
  });

'''
    t = must_replace(t, marker, addition + marker, "architecture test marker")
    p.write_text(t)


def patch_docs() -> None:
    p = Path("docs/ARCHITECTURE.md")
    t = p.read_text()
    old = 'Composition is allowed to be serial or bounded-concurrent according to the source contract. The public result reports what was resolved; it does not pretend every backend has identical reuse or parallelism characteristics.\n'
    new = '''Independent forecast steps are bounded-concurrent by default. Serial execution is reserved for an explicit provider/data dependency, never as an accidental implementation default. The public result reports what was resolved; it does not pretend every backend has identical reuse or parallelism characteristics.

### Execution-efficiency invariants

WFG treats computational efficiency as part of the application architecture:

- resolve shared state such as model initialization once per composed request;
- execute independent time steps concurrently with a bounded worker pool;
- do not put one complete member/range on the critical path merely to discover shared run state;
- reuse one downloaded artifact across points, members or derived operations whenever the provider product permits it;
- avoid nested concurrency policies that attempt to replace provider access control.

Application-level concurrency is an optimization limit, not permission to exceed an upstream contract. Every cache miss and retry still passes through `src/access/`, whose provider policy is the authoritative hard ceiling for concurrency and pacing. Raising a core worker count may increase useful overlap for cache hits, decoding or independent provider work, but it must never bypass `UpstreamAccessPolicy`.
'''
    t = must_replace(t, old, new, "architecture execution paragraph")
    p.write_text(t)


patch_aigfs()
patch_icon()
patch_arome()
patch_architecture_test()
patch_docs()
