import type { DiagnoseAtmosphereRequest, QueryAtmosphereRequest } from "../schema/unified-api.js";
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
