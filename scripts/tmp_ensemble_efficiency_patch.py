from pathlib import Path


def must_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"pattern not found: {label}")
    return text.replace(old, new)


# Shared member orchestration: production services expose cheap run resolution; injected
# test doubles without it retain a safe fallback without imposing the old production barrier.
Path("src/core/ensemble-member-execution.ts").write_text('''import type { DiagnoseAtmosphereRequest, QueryAtmosphereRequest } from "../schema/unified-api.js";
import { mapConcurrent } from "./concurrency.js";

export interface ResolvableEnsembleMemberService {
  query(request: QueryAtmosphereRequest): Promise<unknown>;
  diagnose?(request: DiagnoseAtmosphereRequest): Promise<unknown>;
  resolveQueryRun?(request: QueryAtmosphereRequest): Promise<Date>;
  resolveDiagnosticRun?(request: DiagnoseAtmosphereRequest): Promise<Date>;
}

export interface EnsembleMemberResult<M> {
  member: M;
  result: any;
}

export async function executeMemberQueries<M, S extends ResolvableEnsembleMemberService>(options: {
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
  const explicitRun = concreteRun(request.forecast?.run);

  if (explicitRun !== undefined) {
    return runAllMembers(options, firstMember, firstService, explicitRun, "query");
  }
  if (firstService.resolveQueryRun !== undefined) {
    const run = (await firstService.resolveQueryRun(request)).toISOString();
    return runAllMembers(options, firstMember, firstService, run, "query");
  }

  const firstResult = await firstService.query(request);
  const run = resultRun(firstResult, options.context);
  const rest = await mapConcurrent(
    options.members.slice(1),
    options.concurrency,
    async (member) => ({
      member,
      result: await options.serviceFactory(member).query(options.requestFactory(run)),
    }),
  );
  return [{ member: firstMember, result: firstResult }, ...rest];
}

export async function executeMemberDiagnostics<M, S extends ResolvableEnsembleMemberService>(options: {
  members: readonly M[];
  concurrency: number;
  serviceFactory: (member: M) => S;
  requestFactory: (runOverride?: string) => DiagnoseAtmosphereRequest;
  context: string;
}): Promise<EnsembleMemberResult<M>[]> {
  const firstMember = options.members[0];
  if (firstMember === undefined) throw new Error(`${options.context} selected no members`);
  const firstService = options.serviceFactory(firstMember);
  if (firstService.diagnose === undefined) throw new Error(`${options.context} member service has no diagnostic operation`);
  const request = options.requestFactory();
  const explicitRun = concreteRun(request.forecast?.run);

  if (explicitRun !== undefined) {
    return runAllMembers(options, firstMember, firstService, explicitRun, "diagnose");
  }
  if (firstService.resolveDiagnosticRun !== undefined) {
    const run = (await firstService.resolveDiagnosticRun(request)).toISOString();
    return runAllMembers(options, firstMember, firstService, run, "diagnose");
  }

  const firstResult = await firstService.diagnose(request);
  const run = resultRun(firstResult, options.context);
  const rest = await mapConcurrent(
    options.members.slice(1),
    options.concurrency,
    async (member) => {
      const service = options.serviceFactory(member);
      if (service.diagnose === undefined) throw new Error(`${options.context} member service has no diagnostic operation`);
      return { member, result: await service.diagnose(options.requestFactory(run)) };
    },
  );
  return [{ member: firstMember, result: firstResult }, ...rest];
}

async function runAllMembers<M, S extends ResolvableEnsembleMemberService>(
  options: {
    members: readonly M[];
    concurrency: number;
    serviceFactory: (member: M) => S;
    requestFactory: (runOverride?: string) => QueryAtmosphereRequest | DiagnoseAtmosphereRequest;
    context: string;
  },
  firstMember: M,
  firstService: S,
  run: string,
  operation: "query" | "diagnose",
): Promise<EnsembleMemberResult<M>[]> {
  return mapConcurrent(options.members, options.concurrency, async (member) => {
    const service = member === firstMember ? firstService : options.serviceFactory(member);
    const request = options.requestFactory(run);
    if (operation === "query") {
      return { member, result: await service.query(request as QueryAtmosphereRequest) };
    }
    if (service.diagnose === undefined) throw new Error(`${options.context} member service has no diagnostic operation`);
    return { member, result: await service.diagnose(request as DiagnoseAtmosphereRequest) };
  });
}

function concreteRun(selector: string | undefined): string | undefined {
  return selector !== undefined && selector !== "latest" && selector !== "latest_complete"
    ? selector
    : undefined;
}

function resultRun(result: unknown, context: string): string {
  if (
    typeof result !== "object"
    || result === null
    || !("run" in result)
    || typeof (result as { run?: unknown }).run !== "string"
  ) {
    throw new Error(`${context} did not return a resolved run`);
  }
  return (result as { run: string }).run;
}
''')


def insert_resolvers(path: str, methods: str) -> None:
    p = Path(path)
    t = p.read_text()
    marker = "  private async getPoint(request: QueryAtmosphereRequest)"
    if marker not in t:
        raise SystemExit(f"resolver insertion marker missing in {path}")
    t = t.replace(marker, methods + "\n\n" + marker, 1)
    p.write_text(t)


insert_resolvers("src/core/aigfs.ts", '''  async resolveQueryRun(request: QueryAtmosphereRequest): Promise<Date> {
    const selection = expandedSelection(request);
    const products = productsFor(selection);
    return "at" in request.time
      ? this.resolveRun(request.forecast?.run ?? "latest", {
          type: "valid_time",
          validTime: new Date(request.time.at),
          products,
        })
      : this.resolveRun(request.forecast?.run ?? "latest", {
          type: "time_range",
          startTime: new Date(request.time.from),
          endTime: new Date(request.time.to),
          products,
        });
  }

  async resolveDiagnosticRun(request: DiagnoseAtmosphereRequest): Promise<Date> {
    if (request.diagnostic.kind === "parcel") {
      throw new Error("AIGFS parcel diagnostics are not supported");
    }
    return "at" in request.time
      ? this.resolveRun(request.forecast?.run ?? "latest", {
          type: "valid_time",
          validTime: new Date(request.time.at),
          products: { pressure: true, surface: false },
        })
      : this.resolveRun(request.forecast?.run ?? "latest", {
          type: "time_range",
          startTime: new Date(request.time.from),
          endTime: new Date(request.time.to),
          products: { pressure: true, surface: false },
        });
  }''')

insert_resolvers("src/core/icon-d2.ts", '''  async resolveQueryRun(request: QueryAtmosphereRequest): Promise<Date> {
    const selection = expandedSelection(request);
    const products = productsFor(selection);
    return "at" in request.time
      ? this.resolveRun(request.forecast?.run ?? "latest", {
          type: "valid_time",
          validTime: new Date(request.time.at),
          products,
        })
      : this.resolveRun(request.forecast?.run ?? "latest", {
          type: "time_range",
          startTime: new Date(request.time.from),
          endTime: new Date(request.time.to),
          products,
        });
  }

  async resolveDiagnosticRun(request: DiagnoseAtmosphereRequest): Promise<Date> {
    if (request.diagnostic.kind === "parcel") {
      throw new Error("ICON-D2 parcel diagnostics are not supported");
    }
    return "at" in request.time
      ? this.resolveRun(request.forecast?.run ?? "latest", {
          type: "valid_time",
          validTime: new Date(request.time.at),
          products: { pressure: true, surface: false },
        })
      : this.resolveRun(request.forecast?.run ?? "latest", {
          type: "time_range",
          startTime: new Date(request.time.from),
          endTime: new Date(request.time.to),
          products: { pressure: true, surface: false },
        });
  }''')

insert_resolvers("src/core/arome.ts", '''  async resolveQueryRun(request: QueryAtmosphereRequest): Promise<Date> {
    const selection = expandedSelection(request);
    const products = aromePackagesForFields(selection.fields);
    return "at" in request.time
      ? this.resolveRun(request.forecast?.run ?? "latest", {
          type: "valid_time",
          validTime: new Date(request.time.at),
          products,
        })
      : this.resolveRun(request.forecast?.run ?? "latest", {
          type: "time_range",
          startTime: new Date(request.time.from),
          endTime: new Date(request.time.to),
          products,
        });
  }''')

# AIFS has a slightly different resolver signature.
p = Path("src/core/aifs.ts")
t = p.read_text()
marker = "  private async getPoint(request: QueryAtmosphereRequest)"
methods = '''  async resolveQueryRun(request: QueryAtmosphereRequest): Promise<Date> {
    const selection = prepareSelection(request);
    return "at" in request.time
      ? this.resolveRun(request.forecast?.run ?? "latest", new Date(request.time.at), selection)
      : this.resolveRangeRun(
          request.forecast?.run ?? "latest",
          new Date(request.time.from),
          new Date(request.time.to),
          selection,
        );
  }

  async resolveDiagnosticRun(request: DiagnoseAtmosphereRequest): Promise<Date> {
    if (request.diagnostic.kind === "parcel") {
      throw new Error("AIFS parcel diagnostics are not supported");
    }
    const pressureLevelsHpa = request.diagnostic.kind === "layer"
      ? [request.diagnostic.lowerPressureHpa, request.diagnostic.upperPressureHpa]
      : request.diagnostic.pressureLevelsHpa;
    const requested = request.diagnostic.kind === "layer"
      ? expandLayerDiagnosticVariables(request.diagnostic.diagnostics)
      : expandProfileDiagnosticVariables(request.diagnostic.diagnostics);
    const selection = selectionFrom(requested, pressureLevelsHpa, []);
    return "at" in request.time
      ? this.resolveRun(request.forecast?.run ?? "latest", new Date(request.time.at), selection)
      : this.resolveRangeRun(
          request.forecast?.run ?? "latest",
          new Date(request.time.from),
          new Date(request.time.to),
          selection,
        );
  }'''
if marker not in t: raise SystemExit("AIFS resolver insertion marker missing")
t = t.replace(marker, methods + "\n\n" + marker, 1)
p.write_text(t)


# Ensemble wrappers use one shared execution primitive. Production defaults resolve the run
# before executing any member payload; custom test doubles can still fall back safely.
def patch_wrapper(path: str, model: str, query_adapter: str, diagnostic_adapter: str | None) -> None:
    p = Path(path)
    t = p.read_text()
    t = t.replace('import { mapConcurrent } from "./concurrency.js";\n', '')
    anchor = 'import { InvalidRequestError } from "../failure.js";\n'
    import_block = 'import {\n  executeMemberDiagnostics,\n  executeMemberQueries,\n} from "./ensemble-member-execution.js";\n'
    if diagnostic_adapter is None:
        import_block = 'import { executeMemberQueries } from "./ensemble-member-execution.js";\n'
    t = must_replace(t, anchor, anchor + import_block, f"{model} shared execution import")

    interface_name = {
        'AIFS ENS': 'AifsEnsMemberService',
        'AIGEFS': 'AigefsMemberService',
        'ICON-D2-EPS': 'IconD2EpsMemberService',
        'PE-AROME': 'PeAromeMemberService',
    }[model]
    if diagnostic_adapter is None:
        old_iface = f'''export interface {interface_name} {{\n  query(request: QueryAtmosphereRequest): Promise<unknown>;\n}}'''
        new_iface = f'''export interface {interface_name} {{\n  query(request: QueryAtmosphereRequest): Promise<unknown>;\n  resolveQueryRun?(request: QueryAtmosphereRequest): Promise<Date>;\n}}'''
    else:
        old_iface = f'''export interface {interface_name} {{\n  query(request: QueryAtmosphereRequest): Promise<unknown>;\n  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown>;\n}}'''
        new_iface = f'''export interface {interface_name} {{\n  query(request: QueryAtmosphereRequest): Promise<unknown>;\n  diagnose(request: DiagnoseAtmosphereRequest): Promise<unknown>;\n  resolveQueryRun?(request: QueryAtmosphereRequest): Promise<Date>;\n  resolveDiagnosticRun?(request: DiagnoseAtmosphereRequest): Promise<Date>;\n}}'''
    t = must_replace(t, old_iface, new_iface, f"{model} member interface")

    # Replace queryMembers by locating the exact block boundaries.
    q_start = t.index('  private async queryMembers(')
    q_end_marker = '  private async diagnoseMembers(' if diagnostic_adapter is not None else '\n}\n\nfunction '
    if diagnostic_adapter is not None:
        q_end = t.index(q_end_marker, q_start)
    else:
        q_end = t.index(q_end_marker, q_start)
    query_block = f'''  private async queryMembers(\n    request: QueryAtmosphereRequest,\n    members: { {'AIFS ENS':'AifsEnsMember','AIGEFS':'AigefsMember','ICON-D2-EPS':'IconD2EpsMember','PE-AROME':'PeAromeMember'}[model] }[],\n  ): Promise<MemberResult[]> {{\n    return executeMemberQueries({{\n      members,\n      concurrency: this.concurrency,\n      serviceFactory: this.memberServiceFactory,\n      requestFactory: (runOverride) => {query_adapter}(request, runOverride),\n      context: "{model} member query",\n    }});\n  }}\n\n'''
    t = t[:q_start] + query_block + t[q_end:]

    if diagnostic_adapter is not None:
        d_start = t.index('  private async diagnoseMembers(')
        d_end = t.index('\n}\n\nfunction ', d_start)
        member_type = {'AIFS ENS':'AifsEnsMember','AIGEFS':'AigefsMember','ICON-D2-EPS':'IconD2EpsMember'}[model]
        diag_block = f'''  private async diagnoseMembers(\n    request: DiagnoseAtmosphereRequest,\n    members: {member_type}[],\n  ): Promise<MemberResult[]> {{\n    return executeMemberDiagnostics({{\n      members,\n      concurrency: this.concurrency,\n      serviceFactory: this.memberServiceFactory,\n      requestFactory: (runOverride) => {diagnostic_adapter}(request, runOverride),\n      context: "{model} member diagnostic",\n    }});\n  }}\n'''
        t = t[:d_start] + diag_block + t[d_end:]
    p.write_text(t)


patch_wrapper("src/core/aifs-ens.ts", "AIFS ENS", "asAifsQuery", "asAifsDiagnostic")
patch_wrapper("src/core/aigefs.ts", "AIGEFS", "asAigfsQuery", "asAigfsDiagnostic")
patch_wrapper("src/core/icon-d2-eps.ts", "ICON-D2-EPS", "asIconD2Query", "asIconD2Diagnostic")
patch_wrapper("src/core/pe-arome.ts", "PE-AROME", "asAromeQuery", None)

# Unit coverage for shared orchestration.
Path("test/ensemble-member-execution.test.ts").write_text('''import { describe, expect, it } from "vitest";
import { executeMemberQueries } from "../src/core/ensemble-member-execution.js";
import type { QueryAtmosphereRequest } from "../src/schema/unified-api.js";

const RUN = new Date("2026-09-09T12:00:00Z");

function request(run: string = "latest"): QueryAtmosphereRequest {
  return {
    dataset: "aigfs",
    geometry: { type: "point", latitude: 50, longitude: 14 },
    time: { from: "2026-09-09T12:00:00Z", to: "2026-09-09T18:00:00Z" },
    selection: { variables: ["temperature"], pressureLevelsHpa: [850] },
    forecast: { run },
  } as QueryAtmosphereRequest;
}

describe("ensemble member execution", () => {
  it("resolves the run before member payloads and starts all members without a first-member barrier", async () => {
    let resolveCalls = 0;
    let active = 0;
    let maxActive = 0;
    const receivedRuns: string[] = [];
    const services = new Map<string, any>();
    for (const member of ["a", "b", "c"]) {
      services.set(member, {
        resolveQueryRun: async () => {
          resolveCalls += 1;
          return RUN;
        },
        query: async (input: QueryAtmosphereRequest) => {
          receivedRuns.push(input.forecast?.run ?? "");
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { run: RUN.toISOString(), member };
        },
      });
    }

    const result = await executeMemberQueries({
      members: ["a", "b", "c"],
      concurrency: 2,
      serviceFactory: (member) => services.get(member)!,
      requestFactory: (runOverride) => request(runOverride),
      context: "test ensemble",
    });

    expect(resolveCalls).toBe(1);
    expect(maxActive).toBe(2);
    expect(receivedRuns).toEqual([RUN.toISOString(), RUN.toISOString(), RUN.toISOString()]);
    expect(result.map((entry) => entry.member)).toEqual(["a", "b", "c"]);
  });

  it("does not probe run availability for an explicit initialization", async () => {
    let resolveCalls = 0;
    const service = {
      resolveQueryRun: async () => {
        resolveCalls += 1;
        return RUN;
      },
      query: async () => ({ run: RUN.toISOString() }),
    };
    await executeMemberQueries({
      members: ["a", "b"],
      concurrency: 2,
      serviceFactory: () => service,
      requestFactory: (runOverride) => request(runOverride ?? RUN.toISOString()),
      context: "test explicit ensemble",
    });
    expect(resolveCalls).toBe(0);
  });
});
''')

# Architecture guard: production ensemble wrappers use shared run-first orchestration.
p = Path("test/architecture-boundaries.test.ts")
t = p.read_text()
marker = '  it("keeps independent deterministic forecast ranges bounded-concurrent", async () => {'
addition = '''  it("keeps ensemble run discovery out of full first-member execution", async () => {
    const files = [
      "src/core/aifs-ens.ts",
      "src/core/aigefs.ts",
      "src/core/icon-d2-eps.ts",
      "src/core/pe-arome.ts",
    ];
    for (const path of files) {
      const source = await readFile(path, "utf8");
      expect(source, path).toContain("ensemble-member-execution.js");
      expect(source, path).not.toContain("const firstResult = await firstService.query");
    }
  });

'''
t = must_replace(t, marker, addition + marker, "ensemble architecture test marker")
p.write_text(t)

# Extend architecture docs with the concrete ensemble rule.
p = Path("docs/ARCHITECTURE.md")
t = p.read_text()
old = '- do not put one complete member/range on the critical path merely to discover shared run state;\n'
new = '- resolve ensemble initialization through the member service run-resolution seam, then fan out all selected members; never execute a complete first member/range merely to discover shared run state;\n'
t = must_replace(t, old, new, "ensemble architecture doc rule")
p.write_text(t)
