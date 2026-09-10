from pathlib import Path
import re


def must_replace(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found [{label}] in {path}")
    p.write_text(text.replace(old, new, 1))


def insert_composition_resolvers(path: str, describe_name: str, run: str) -> None:
    p = Path(path)
    text = p.read_text()
    pattern = re.compile(
        rf'(describe\("{re.escape(describe_name)}"[\s\S]*?function factory\([\s\S]*?return \{{\n)(\s+query:)',
    )
    replacement = (
        r'\1'
        f'      resolveQueryRun: vi.fn(async () => new Date("{run}")),\n'
        f'      resolveDiagnosticRun: vi.fn(async () => new Date("{run}")),\n'
        r'\2'
    )
    updated, count = pattern.subn(replacement, text, count=1)
    if count != 1:
        raise SystemExit(f"composition factory not found in {path}")
    p.write_text(updated)


# Make the shared execution seam strict: an ensemble member service must be able to
# resolve shared initialization without executing a member payload.
p = Path("src/core/ensemble-member-execution.ts")
p.write_text('''import type { DiagnoseAtmosphereRequest, QueryAtmosphereRequest } from "../schema/unified-api.js";
import { mapConcurrent } from "./concurrency.js";

export interface ResolvableEnsembleQueryService {
  query(request: QueryAtmosphereRequest): Promise<unknown>;
  resolveQueryRun(request: QueryAtmosphereRequest): Promise<Date>;
}

export interface ResolvableEnsembleDiagnosticService extends ResolvableEnsembleQueryService {
  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown>;
  resolveDiagnosticRun(request: DiagnoseAtmosphereRequest): Promise<Date>;
}

export interface EnsembleMemberResult<M> {
  member: M;
  result: any;
}

export async function executeMemberQueries<M, S extends ResolvableEnsembleQueryService>(options: {
  members: readonly M[];
  concurrency: number;
  serviceFactory: (member: M) => S;
  requestFactory: (runOverride?: string) => QueryAtmosphereRequest;
  context: string;
}): Promise<EnsembleMemberResult<M>[]> {
  const firstMember = options.members[0];
  if (firstMember === undefined) throw new Error(`${options.context} selected no members`);
  const firstService = options.serviceFactory(firstMember);
  const request = options.requestFactory();
  const run = concreteRun(request.forecast?.run)
    ?? resolvedRun(await firstService.resolveQueryRun(request), options.context);

  return mapConcurrent(options.members, options.concurrency, async (member) => {
    const service = member === firstMember ? firstService : options.serviceFactory(member);
    return {
      member,
      result: await service.query(options.requestFactory(run)),
    };
  });
}

export async function executeMemberDiagnostics<M, S extends ResolvableEnsembleDiagnosticService>(options: {
  members: readonly M[];
  concurrency: number;
  serviceFactory: (member: M) => S;
  requestFactory: (runOverride?: string) => DiagnoseAtmosphereRequest;
  context: string;
}): Promise<EnsembleMemberResult<M>[]> {
  const firstMember = options.members[0];
  if (firstMember === undefined) throw new Error(`${options.context} selected no members`);
  const firstService = options.serviceFactory(firstMember);
  const request = options.requestFactory();
  const run = concreteRun(request.forecast?.run)
    ?? resolvedRun(await firstService.resolveDiagnosticRun(request), options.context);

  return mapConcurrent(options.members, options.concurrency, async (member) => {
    const service = member === firstMember ? firstService : options.serviceFactory(member);
    return {
      member,
      result: await service.diagnose(options.requestFactory(run)),
    };
  });
}

function concreteRun(selector: string | undefined): string | undefined {
  return selector !== undefined && selector !== "latest" && selector !== "latest_complete"
    ? selector
    : undefined;
}

function resolvedRun(run: Date, context: string): string {
  if (!(run instanceof Date) || !Number.isFinite(run.getTime())) {
    throw new Error(`${context} did not return a resolved run`);
  }
  return run.toISOString();
}
''')

# Wrapper contracts make the invariant explicit to future implementations.
for path in ["src/core/aifs-ens.ts", "src/core/aigefs.ts", "src/core/icon-d2-eps.ts"]:
    p = Path(path)
    t = p.read_text()
    t = t.replace("  resolveQueryRun?(request: QueryAtmosphereRequest): Promise<Date>;", "  resolveQueryRun(request: QueryAtmosphereRequest): Promise<Date>;")
    t = t.replace("  resolveDiagnosticRun?(request: DiagnoseAtmosphereRequest): Promise<Date>;", "  resolveDiagnosticRun(request: DiagnoseAtmosphereRequest): Promise<Date>;")
    p.write_text(t)

p = Path("src/core/pe-arome.ts")
t = p.read_text().replace(
    "  resolveQueryRun?(request: QueryAtmosphereRequest): Promise<Date>;",
    "  resolveQueryRun(request: QueryAtmosphereRequest): Promise<Date>;",
)
p.write_text(t)

# Inline test doubles must model the production contract too; otherwise tests would hide the
# same architectural regression we are preventing.
fixtures = {
    "test/aifs-ens.test.ts": ("2026-08-31T00:00:00.000Z", True),
    "test/aigefs.test.ts": ("2026-08-30T00:00:00.000Z", True),
    "test/icon-d2-eps.test.ts": ("2026-08-31T00:00:00.000Z", True),
    "test/pe-arome.test.ts": ("2026-09-01T09:00:00.000Z", False),
}
factory_pattern = re.compile(r'(memberServiceFactory:\s*(?:\([^\n]*\)|\(\))\s*=>\s*\(\{\n)')
for path, (run, has_diagnostics) in fixtures.items():
    p = Path(path)
    text = p.read_text()
    insertion = f'\\1        resolveQueryRun: vi.fn(async () => new Date("{run}")),\n'
    if has_diagnostics:
        insertion += f'        resolveDiagnosticRun: vi.fn(async () => new Date("{run}")),\n'
    updated, count = factory_pattern.subn(insertion, text)
    if count == 0:
        raise SystemExit(f"no memberServiceFactory test doubles found in {path}")
    updated = updated.replace('forecast: { run: "latest" },', f'forecast: {{ run: "{run}" }},')
    p.write_text(updated)

# Composition suites use named factory functions instead of inline memberServiceFactory doubles.
insert_composition_resolvers(
    "test/aifs-ens.test.ts",
    "AIFS ENS composition coverage",
    "2026-08-30T00:00:00.000Z",
)
insert_composition_resolvers(
    "test/aigefs.test.ts",
    "AIGEFS composition coverage",
    "2026-08-30T00:00:00.000Z",
)

# Preserve the defensive contract test: injected runtime services may still violate their
# static type, and the shared helper should fail with a domain error rather than a JS TypeError.
for path, suite in [
    ("test/aifs-ens.test.ts", "AIFS ENS defensive aggregation coverage"),
    ("test/aigefs.test.ts", "AIGEFS defensive aggregation coverage"),
]:
    p = Path(path)
    text = p.read_text()
    pattern = re.compile(
        rf'(describe\("{re.escape(suite)}"[\s\S]*?it\("fails clearly when the run-resolving member returns no run"[\s\S]*?resolveQueryRun: vi\.fn\(async \(\) => )new Date\("[^"]+"\)(\),)',
    )
    updated, count = pattern.subn(r'\1undefined as any\2', text, count=1)
    if count != 1:
        raise SystemExit(f"negative run-resolution fixture not found in {path}")
    p.write_text(updated)

# Enforce that the shared helper itself cannot regain the fallback.
p = Path("test/architecture-boundaries.test.ts")
t = p.read_text()
needle = '''      expect(source, path).not.toContain("const firstResult = await firstService.query");
'''
if needle not in t:
    raise SystemExit("ensemble architecture assertion missing")
marker = '''  it("keeps independent deterministic forecast ranges bounded-concurrent", async () => {'''
addition = '''  it("requires ensemble run resolution before member payload execution", async () => {
    const source = await readFile("src/core/ensemble-member-execution.ts", "utf8");
    expect(source).toContain("resolveQueryRun(request: QueryAtmosphereRequest): Promise<Date>");
    expect(source).toContain("resolveDiagnosticRun(request: DiagnoseAtmosphereRequest): Promise<Date>");
    expect(source).not.toContain("resultRun(");
    expect(source).not.toContain("firstResult");
  });

'''
if marker not in t:
    raise SystemExit("architecture insertion marker missing")
t = t.replace(marker, addition + marker, 1)
p.write_text(t)

# State the no-fallback property in docs, not just the implementation.
p = Path("docs/ARCHITECTURE.md")
t = p.read_text()
old = "- resolve ensemble initialization through the member service run-resolution seam, then fan out all selected members; never execute a complete first member/range merely to discover shared run state;\n"
new = "- resolve ensemble initialization through a required member-service run-resolution seam, then fan out all selected members; there is no payload-execution fallback for run discovery, and a complete first member/range must never sit on that critical path;\n"
if old not in t:
    raise SystemExit("ensemble architecture documentation line missing")
p.write_text(t.replace(old, new, 1))
