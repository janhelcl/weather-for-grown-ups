import type { DiagnoseAtmosphereRequest, QueryAtmosphereRequest } from "../schema/unified-api.js";
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
