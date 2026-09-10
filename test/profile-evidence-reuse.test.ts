import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ProfileEvidenceCache } from "../src/cache/profile-evidence-cache.js";
import {
  GefsMemberBundleEvidenceService,
  GefsParcelDiagnosticsEvidenceService,
} from "../src/core/gefs-evidence-service.js";
import {
  GfsProfileEvidenceService,
  IfsProfileEvidenceService,
} from "../src/core/profile-evidence-service.js";

const run = "2026-09-10T00:00:00Z";
const validTime = "2026-09-10T06:00:00Z";
const point = { latitude: 45.77, longitude: 11.73 };
const gridPoint = { latitude: 45.75, longitude: 11.75 };

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "wfg-evidence-"));
}

describe("persistent profile evidence reuse", () => {
  it("reuses a wider GFS pressure column across cache instances and derives a later requested view", async () => {
    const root = await tempRoot();
    try {
      const firstUpstream = vi.fn(async () => ({
        model: "gfs_0p25" as const,
        run: new Date(run).toISOString(),
        validTime: new Date(validTime).toISOString(),
        forecastHour: 6,
        requestedPoint: point,
        gridPoint,
        levels: [
          { pressureHpa: 1000, temperatureC: 19, relativeHumidityPct: 60 },
          { pressureHpa: 850, temperatureC: 9, relativeHumidityPct: 50 },
        ],
        source: {
          provider: "NOAA AWS Open Data" as const,
          access: "s3_range" as const,
          decoder: "gribberish" as const,
          cacheHit: false,
        },
      }));
      const first = new GfsProfileEvidenceService({
        profileGetter: { getProfile: firstUpstream },
        evidenceCache: new ProfileEvidenceCache(join(root, "gfs")),
      });
      await first.getProfile({
        ...point,
        run,
        validTime,
        grid: "0p25",
        source: "s3",
        variables: ["temperature", "relative_humidity"],
        pressureLevelsHpa: [1000, 850],
      });

      const secondUpstream = vi.fn(async () => {
        throw new Error("cached GFS evidence should have satisfied this request");
      });
      const second = new GfsProfileEvidenceService({
        profileGetter: { getProfile: secondUpstream },
        evidenceCache: new ProfileEvidenceCache(join(root, "gfs")),
      });
      const derived = await second.getProfile({
        ...point,
        run,
        validTime,
        grid: "0p25",
        source: "s3",
        variables: ["dew_point"],
        pressureLevelsHpa: [850],
      });

      expect(firstUpstream).toHaveBeenCalledTimes(1);
      expect(secondUpstream).not.toHaveBeenCalled();
      expect(derived.source.cacheHit).toBe(true);
      expect(derived.levels).toHaveLength(1);
      expect(derived.levels[0]).toMatchObject({
        pressureHpa: 850,
        temperatureC: 9,
        relativeHumidityPct: 50,
      });
      expect(derived.levels[0]?.dewPointC).toBeTypeOf("number");
      expect(derived.levels[0]).not.toHaveProperty("geopotentialHeightGpm");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses IFS raw pressure dependencies for a later derived diagnostic selection", async () => {
    const root = await tempRoot();
    try {
      const firstUpstream = vi.fn(async () => ({
        model: "ifs_0p25" as const,
        run: new Date(run).toISOString(),
        validTime: new Date(validTime).toISOString(),
        forecastHour: 6,
        requestedPoint: point,
        gridPoint,
        levels: [
          { pressureHpa: 1000, temperatureC: 18, relativeHumidityPct: 65 },
          { pressureHpa: 850, temperatureC: 8, relativeHumidityPct: 55 },
        ],
        source: {
          provider: "ECMWF Open Data" as const,
          access: "indexed_http_range" as const,
          decoder: "gribberish" as const,
          product: "ifs_0p25_oper_fc" as const,
          horizontalGridDegrees: 0.25 as const,
          cacheHit: false,
        },
      }));
      const first = new IfsProfileEvidenceService({
        profileGetter: { getProfile: firstUpstream },
        evidenceCache: new ProfileEvidenceCache(join(root, "ifs")),
      });
      await first.getProfile({
        ...point,
        run,
        validTime,
        variables: ["temperature", "relative_humidity"],
        pressureLevelsHpa: [1000, 850],
      });

      const secondUpstream = vi.fn(async () => {
        throw new Error("cached IFS evidence should have satisfied this request");
      });
      const second = new IfsProfileEvidenceService({
        profileGetter: { getProfile: secondUpstream },
        evidenceCache: new ProfileEvidenceCache(join(root, "ifs")),
      });
      const derived = await second.getProfile({
        ...point,
        run,
        validTime,
        variables: ["dew_point"],
        pressureLevelsHpa: [850],
      });

      expect(firstUpstream).toHaveBeenCalledTimes(1);
      expect(secondUpstream).not.toHaveBeenCalled();
      expect(derived.source.cacheHit).toBe(true);
      expect(derived.levels[0]?.dewPointC).toBeTypeOf("number");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("GEFS member evidence reuse", () => {
  it("retains member evidence behind compact raw output and reuses it for a later derived pressure view", async () => {
    const root = await tempRoot();
    try {
      const firstUpstream = vi.fn(async (input: any) => fakeGefsBundle(input));
      const first = new GefsMemberBundleEvidenceService({
        bundleGetter: { getBundle: firstUpstream },
        evidenceCache: new ProfileEvidenceCache(join(root, "gefs")),
      });
      const compact = await first.getBundle({
        ...point,
        run,
        validTime,
        selection: {
          variables: ["temperature", "relative_humidity"],
          pressureLevelsHpa: [1000, 850],
          fields: [],
        },
        members: ["c00", "p01"],
        quantiles: [0.5],
        includeMembers: false,
      });
      expect(compact.members).toBeUndefined();

      const secondUpstream = vi.fn(async () => {
        throw new Error("cached GEFS member evidence should have satisfied this request");
      });
      const second = new GefsMemberBundleEvidenceService({
        bundleGetter: { getBundle: secondUpstream },
        evidenceCache: new ProfileEvidenceCache(join(root, "gefs")),
      });
      const dewPoint = await second.getBundle({
        ...point,
        run,
        validTime,
        selection: {
          variables: ["dew_point"],
          pressureLevelsHpa: [850],
          fields: [],
        },
        members: ["c00", "p01"],
        quantiles: [0.5],
        includeMembers: true,
      });

      expect(firstUpstream).toHaveBeenCalledTimes(1);
      expect(secondUpstream).not.toHaveBeenCalled();
      expect(dewPoint.source.allCacheHit).toBe(true);
      expect(dewPoint.members?.every((member) => member.cacheHit)).toBe(true);
      expect(dewPoint.members?.[0]?.pressureValues[0]?.variable).toBe("dew_point");
      expect(dewPoint.members?.[0]?.pressureValues[0]?.value).toBeTypeOf("number");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("feeds parcel physics from a previously queried member bundle without reacquiring forecast evidence", async () => {
    const root = await tempRoot();
    try {
      const firstUpstream = vi.fn(async (input: any) => fakeGefsBundle(input));
      const first = new GefsMemberBundleEvidenceService({
        bundleGetter: { getBundle: firstUpstream },
        evidenceCache: new ProfileEvidenceCache(join(root, "gefs-parcel")),
      });
      await first.getBundle({
        ...point,
        run,
        validTime,
        selection: {
          variables: ["temperature", "relative_humidity", "geopotential_height"],
          pressureLevelsHpa: [1000, 850],
          fields: ["surface_pressure", "temperature_2m", "relative_humidity_2m"],
        },
        members: ["c00", "p01"],
        quantiles: [0.5],
        includeMembers: false,
      });

      const secondUpstream = vi.fn(async () => {
        throw new Error("parcel diagnostics should reuse the prior GEFS bundle");
      });
      const bundle = new GefsMemberBundleEvidenceService({
        bundleGetter: { getBundle: secondUpstream },
        evidenceCache: new ProfileEvidenceCache(join(root, "gefs-parcel")),
      });
      const orography = vi.fn(async ({ member }: { member: string }) => ({
        heightGpm: member === "c00" ? 100 : 105,
        gridPoint,
        cacheHit: true,
      }));
      const parcelService = new GefsParcelDiagnosticsEvidenceService({
        bundleGetter: bundle,
        orographyGetter: { getOrography: orography },
      });
      const result = await parcelService.getParcelDiagnostics({
        ...point,
        run,
        validTime,
        pressureLevelsHpa: [1000, 850],
        parcel: "surface_2m",
        members: ["c00", "p01"],
        quantiles: [0.5],
        includeMembers: false,
      });

      expect(firstUpstream).toHaveBeenCalledTimes(1);
      expect(secondUpstream).not.toHaveBeenCalled();
      expect(orography).toHaveBeenCalledTimes(2);
      expect(result.source.allCacheHit).toBe(true);
      expect(result.summary.capeJkg.memberCount).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function fakeGefsBundle(input: any) {
  const members = input.members as string[];
  const levels = input.selection.pressureLevelsHpa as number[];
  const variables = input.selection.variables as string[];
  const fields = input.selection.fields as string[];
  return {
    model: "gefs_0p50",
    run: new Date(input.run).toISOString(),
    validTime: new Date(input.validTime).toISOString(),
    forecastHour: 6,
    requestedPoint: point,
    gridPoint,
    selection: {
      variables,
      pressureLevelsHpa: levels,
      fields,
      members,
      quantiles: input.quantiles,
    },
    pressureSummaries: [],
    fieldSummaries: [],
    members: members.map((member, memberIndex) => ({
      member,
      cacheHit: false,
      pressureValues: levels.flatMap((pressureHpa) =>
        variables.map((variable) => ({
          variable,
          pressureLevelHpa: pressureHpa,
          value: gefsPressureValue(variable, pressureHpa, memberIndex),
        })),
      ),
      fields: fields.map((field) => ({
        field,
        temporal: { type: "instantaneous" },
        values: gefsFieldValues(field, memberIndex),
      })),
    })),
    source: {
      provider: "NOAA AWS Open Data",
      access: "s3_range",
      decoder: "gribberish",
      product: "pgrb2a_0p50",
      horizontalGridDegrees: 0.5,
      allCacheHit: false,
    },
  } as any;
}

function gefsPressureValue(variable: string, pressureHpa: number, memberIndex: number): number {
  if (variable === "temperature") return (pressureHpa === 1000 ? 18 : 8) + memberIndex;
  if (variable === "relative_humidity") return (pressureHpa === 1000 ? 65 : 55) + memberIndex;
  if (variable === "geopotential_height") return (pressureHpa === 1000 ? 110 : 1_500) + 5 * memberIndex;
  if (variable === "u_wind") return 3 + memberIndex;
  if (variable === "v_wind") return 4 + memberIndex;
  if (variable === "vertical_velocity") return -0.1;
  throw new Error(`Unexpected fake GEFS variable ${variable}`);
}

function gefsFieldValues(field: string, memberIndex: number): Record<string, number> {
  if (field === "surface_pressure") return { pressurePa: 99_500 + 100 * memberIndex };
  if (field === "temperature_2m") return { temperatureC: 20 + memberIndex };
  if (field === "relative_humidity_2m") return { relativeHumidityPct: 65 + memberIndex };
  throw new Error(`Unexpected fake GEFS field ${field}`);
}
