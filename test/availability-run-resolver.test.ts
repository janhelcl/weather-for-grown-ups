import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DefaultAtmosphericAvailabilityRunResolver } from "../src/core/availability-run-resolver.js";
import type { QueryAtmosphereRequest } from "../src/schema/unified-api.js";

const HOUR_MS = 3_600_000;
const RUN = new Date("2026-09-10T00:00:00Z");
const PE_AROME_RUN = new Date("2026-09-10T03:00:00Z");
const cacheDir = mkdtempSync(join(tmpdir(), "wfg-availability-resolver-"));
const resolver = new DefaultAtmosphericAvailabilityRunResolver({
  cacheDir,
  now: () => new Date("2026-09-10T12:00:00Z"),
});

afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

function atHour(hour: number, run = RUN): Date {
  return new Date(run.getTime() + hour * HOUR_MS);
}

function request(
  dataset: QueryAtmosphereRequest["dataset"],
  time: QueryAtmosphereRequest["time"],
  options: {
    run?: string;
    forecastKind?: "operational" | "reforecast";
    grid?: "0p25" | "0p50";
    members?: string[];
  } = {},
): QueryAtmosphereRequest {
  return {
    dataset,
    geometry: { type: "point", latitude: 50.08, longitude: 14.43 },
    time,
    selection: {},
    forecast: {
      ...(options.run === undefined ? {} : { run: options.run }),
      ...(options.forecastKind === undefined ? {} : { kind: options.forecastKind }),
      ...(options.grid === undefined ? {} : { grid: options.grid }),
    },
    ...(options.members === undefined ? {} : { ensemble: { members: options.members } }),
  } as QueryAtmosphereRequest;
}

function hours(times: readonly Date[], run = RUN): number[] {
  return times.map((time) => (time.getTime() - run.getTime()) / HOUR_MS);
}

describe("DefaultAtmosphericAvailabilityRunResolver native windows", () => {
  it("preserves native cadence across every operational forecast family", () => {
    expect(hours(resolver.nativeValidTimes(request("gfs", { at: RUN.toISOString() }), RUN, RUN, atHour(6))))
      .toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(hours(resolver.nativeValidTimes(request("gefs", { at: RUN.toISOString() }), RUN, RUN, atHour(12))))
      .toEqual([0, 3, 6, 9, 12]);
    expect(hours(resolver.nativeValidTimes(request("ifs", { at: RUN.toISOString() }), RUN, RUN, atHour(12))))
      .toEqual([0, 3, 6, 9, 12]);
    expect(hours(resolver.nativeValidTimes(request("ifs-ens", { at: RUN.toISOString() }), RUN, RUN, atHour(12))))
      .toEqual([0, 3, 6, 9, 12]);
    expect(hours(resolver.nativeValidTimes(request("aigfs", { at: RUN.toISOString() }), RUN, RUN, atHour(12))))
      .toEqual([0, 6, 12]);
    expect(hours(resolver.nativeValidTimes(request("aigefs", { at: RUN.toISOString() }), RUN, RUN, atHour(12))))
      .toEqual([0, 6, 12]);
    expect(hours(resolver.nativeValidTimes(request("hgefs", { at: RUN.toISOString() }), RUN, RUN, atHour(12))))
      .toEqual([0, 6, 12]);
    expect(hours(resolver.nativeValidTimes(request("aifs", { at: RUN.toISOString() }), RUN, RUN, atHour(12))))
      .toEqual([0, 6, 12]);
    expect(hours(resolver.nativeValidTimes(request("aifs-ens", { at: RUN.toISOString() }), RUN, RUN, atHour(12))))
      .toEqual([0, 6, 12]);
    expect(hours(resolver.nativeValidTimes(request("icon-d2", { at: RUN.toISOString() }), RUN, RUN, atHour(2))))
      .toEqual([0, 1, 2]);
    expect(hours(resolver.nativeValidTimes(request("icon-d2-eps", { at: RUN.toISOString() }), RUN, RUN, atHour(2))))
      .toEqual([0, 1, 2]);
    expect(hours(resolver.nativeValidTimes(request("arome", { at: RUN.toISOString() }), RUN, RUN, atHour(2))))
      .toEqual([0, 1, 2]);
    expect(hours(
      resolver.nativeValidTimes(
        request("pe-arome", { at: PE_AROME_RUN.toISOString() }),
        PE_AROME_RUN,
        PE_AROME_RUN,
        atHour(2, PE_AROME_RUN),
      ),
      PE_AROME_RUN,
    )).toEqual([0, 1, 2]);
    expect(resolver.nativeValidTimes(request("gfs-analysis", { at: RUN.toISOString() }), RUN, RUN, atHour(2)))
      .toEqual([]);
  });

  it("preserves the mixed GEFSv12 reforecast cadence", () => {
    const historicalRun = new Date("2019-01-15T00:00:00Z");
    const reforecast = request(
      "gefs",
      { at: historicalRun.toISOString() },
      { run: historicalRun.toISOString(), forecastKind: "reforecast" },
    );

    expect(hours(
      resolver.nativeValidTimes(
        reforecast,
        historicalRun,
        atHour(237, historicalRun),
        atHour(252, historicalRun),
      ),
      historicalRun,
    )).toEqual([237, 240, 246, 252]);
  });

  it("preserves cycle-dependent IFS and IFS ENS horizons", () => {
    const shortRun = new Date("2026-09-10T06:00:00Z");
    expect(hours(
      resolver.nativeValidTimes(
        request("ifs", { at: shortRun.toISOString() }),
        shortRun,
        atHour(84, shortRun),
        atHour(120, shortRun),
      ),
      shortRun,
    )).toEqual([84, 87, 90]);
    expect(hours(
      resolver.nativeValidTimes(
        request("ifs-ens", { at: shortRun.toISOString() }),
        shortRun,
        atHour(138, shortRun),
        atHour(180, shortRun),
      ),
      shortRun,
    )).toEqual([138, 141, 144]);

    expect(hours(
      resolver.nativeValidTimes(
        request("ifs", { at: RUN.toISOString() }),
        RUN,
        atHour(138),
        atHour(156),
      ),
    )).toEqual([138, 141, 144, 150, 156]);
  });
});

describe("DefaultAtmosphericAvailabilityRunResolver explicit runs", () => {
  it("routes explicit initializations through every forecast family without live probing", async () => {
    const cases: Array<{
      dataset: QueryAtmosphereRequest["dataset"];
      lead: number;
      members?: string[];
      run?: Date;
    }> = [
      { dataset: "gfs", lead: 1 },
      { dataset: "gefs", lead: 3, members: ["c00"] },
      { dataset: "ifs", lead: 3 },
      { dataset: "ifs-ens", lead: 3, members: ["p01"] },
      { dataset: "aigfs", lead: 6 },
      { dataset: "aigefs", lead: 6, members: ["c00"] },
      { dataset: "hgefs", lead: 6 },
      { dataset: "aifs", lead: 6 },
      { dataset: "aifs-ens", lead: 6, members: ["c00"] },
      { dataset: "icon-d2", lead: 1 },
      { dataset: "icon-d2-eps", lead: 1, members: ["c00"] },
      { dataset: "arome", lead: 1 },
      { dataset: "pe-arome", lead: 1, members: ["c00"], run: PE_AROME_RUN },
    ];

    for (const testCase of cases) {
      const run = testCase.run ?? RUN;
      const resolved = await resolver.resolve(request(
        testCase.dataset,
        { at: atHour(testCase.lead, run).toISOString() },
        { run: run.toISOString(), members: testCase.members },
      ));
      expect(resolved.toISOString(), testCase.dataset).toBe(run.toISOString());
    }
  });

  it("validates archived GEFS reforecast runs and rejects a synthetic latest reforecast", async () => {
    const historicalRun = new Date("2019-01-15T00:00:00Z");
    await expect(resolver.resolve(request(
      "gefs",
      { at: atHour(246, historicalRun).toISOString() },
      { run: historicalRun.toISOString(), forecastKind: "reforecast", members: ["c00"] },
    ))).resolves.toEqual(historicalRun);

    await expect(resolver.resolve(request(
      "gefs",
      { at: atHour(6, historicalRun).toISOString() },
      { run: "latest", forecastKind: "reforecast", members: ["c00"] },
    ))).rejects.toThrow(/requires an explicit/i);
  });

  it("rejects requests beyond a run's native horizon or off its native cadence", async () => {
    const shortIfsRun = new Date("2026-09-10T06:00:00Z");
    await expect(resolver.resolve(request(
      "ifs",
      { at: atHour(93, shortIfsRun).toISOString() },
      { run: shortIfsRun.toISOString() },
    ))).rejects.toThrow(/outside initialization|f90/i);

    await expect(resolver.resolve(request(
      "aigfs",
      { at: atHour(5).toISOString() },
      { run: RUN.toISOString() },
    ))).rejects.toThrow(/native forecast cadence|native/i);
  });

  it("does not define a forecast initialization for analysis archives", async () => {
    await expect(resolver.resolve(request(
      "gfs-analysis",
      { at: RUN.toISOString() },
    ))).rejects.toThrow(/not defined for gfs-analysis/i);
  });
});
