import { describe, expect, it } from "vitest";
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
