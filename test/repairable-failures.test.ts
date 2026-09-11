import { describe, expect, it } from "vitest";
import { DataUnavailableError, toPublicFailure } from "../src/failure.js";
import { queryAtmosphereSchema } from "../src/schema/unified-api.js";

const POINT = { type: "point", latitude: 50.08, longitude: 14.43 } as const;
const TIME = { at: "2026-09-11T12:00:00Z" } as const;

function publicValidationFailure(input: unknown) {
  const parsed = queryAtmosphereSchema.safeParse(input);
  expect(parsed.success).toBe(false);
  if (parsed.success) throw new Error("Expected validation to fail");
  return toPublicFailure(parsed.error);
}

function issueAt(failure: ReturnType<typeof toPublicFailure>, path: string) {
  const issues = failure.details?.issues as Array<Record<string, any>>;
  return issues.find((entry) => entry.path === path);
}

describe("repairable capability failures", () => {
  it("returns unsupported pressure levels and dataset-specific alternatives", () => {
    const failure = publicValidationFailure({
      dataset: "icon-d2",
      geometry: POINT,
      time: TIME,
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [777],
      },
    });

    expect(failure.code).toBe("INVALID_REQUEST");
    const issue = issueAt(failure, "selection.pressureLevelsHpa");
    expect(issue?.repair).toMatchObject({
      kind: "unsupported_inventory",
      action: "choose_supported_values",
      dataset: "icon-d2",
      path: "selection.pressureLevelsHpa",
      unsupported: [777],
      constraints: {
        maxForecastHour: 48,
        nativeTimeCadenceHours: [1],
      },
    });
    expect(issue?.repair.supported).toContain(850);
    expect(issue?.repair.supported).not.toContain(777);
  });

  it("returns valid ensemble members for an unsupported member selection", () => {
    const failure = publicValidationFailure({
      dataset: "aigefs",
      geometry: POINT,
      time: TIME,
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      ensemble: {
        members: ["p01", "not-a-member"],
      },
    });

    const issue = issueAt(failure, "ensemble.members");
    expect(issue?.repair).toMatchObject({
      kind: "unsupported_inventory",
      action: "choose_supported_values",
      dataset: "aigefs",
      path: "ensemble.members",
      unsupported: ["not-a-member"],
    });
    expect(issue?.repair.supported).toContain("p01");
    expect(issue?.repair.supported).not.toContain("not-a-member");
  });

  it("uses reforecast run selectors rather than operational GEFS selectors", () => {
    const failure = publicValidationFailure({
      dataset: "gefs",
      geometry: POINT,
      time: TIME,
      selection: {
        variables: ["temperature"],
        pressureLevelsHpa: [850],
      },
      forecast: {
        kind: "reforecast",
        run: "latest",
      },
    });

    const issue = issueAt(failure, "forecast.run");
    expect(issue?.repair).toMatchObject({
      kind: "unsupported_inventory",
      action: "choose_supported_values",
      dataset: "gefs",
      path: "forecast.run",
      unsupported: ["latest"],
      supported: ["explicit ISO cycle"],
      inspect: {
        dataset: "gefs",
        forecastKind: "reforecast",
        geometryType: "point",
      },
    });
  });

  it("returns reforecast-specific field and variable inventories", () => {
    const failure = publicValidationFailure({
      dataset: "gefs",
      geometry: POINT,
      time: TIME,
      selection: {
        fields: ["visibility"],
        variables: ["relative_humidity"],
        pressureLevelsHpa: [850],
      },
      forecast: {
        kind: "reforecast",
        run: "2020-01-01T00:00:00Z",
      },
    });

    expect(issueAt(failure, "selection.fields")?.repair).toMatchObject({
      kind: "unsupported_inventory",
      action: "choose_supported_values",
      unsupported: ["visibility"],
    });
    expect(issueAt(failure, "selection.variables")?.repair).toMatchObject({
      kind: "unsupported_inventory",
      action: "choose_supported_values",
      unsupported: ["relative_humidity"],
    });
  });

  it("returns the reforecast member population for an unsupported member", () => {
    const failure = publicValidationFailure({
      dataset: "gefs",
      geometry: POINT,
      time: TIME,
      selection: { fields: ["temperature_2m"] },
      forecast: {
        kind: "reforecast",
        run: "2020-01-01T00:00:00Z",
      },
      ensemble: { members: ["p11"] },
    });

    const repair = issueAt(failure, "ensemble.members")?.repair;
    expect(repair).toMatchObject({
      kind: "unsupported_inventory",
      action: "choose_supported_values",
      dataset: "gefs",
      unsupported: ["p11"],
    });
    expect(repair.supported).toContain("p10");
    expect(repair.supported).not.toContain("p11");
  });

  it("does not offer a misleading flat inventory for variable-dependent pressure intersections", () => {
    const failure = publicValidationFailure({
      dataset: "gefs",
      geometry: POINT,
      time: TIME,
      selection: {
        variables: ["specific_humidity"],
        pressureLevelsHpa: [50],
      },
      forecast: {
        kind: "reforecast",
        run: "2020-01-01T00:00:00Z",
      },
    });

    expect(issueAt(failure, "selection.pressureLevelsHpa")?.repair).toMatchObject({
      kind: "unsupported_capability",
      action: "inspect_capabilities",
      dataset: "gefs",
      path: "selection.pressureLevelsHpa",
    });
  });

  it("rejects reforecast on non-GEFS datasets with an operational repair", () => {
    const failure = publicValidationFailure({
      dataset: "icon-d2",
      geometry: POINT,
      time: TIME,
      selection: { fields: ["temperature_2m"] },
      forecast: {
        kind: "reforecast",
        run: "2020-01-01T00:00:00Z",
      },
    });

    expect(issueAt(failure, "forecast.kind")?.repair).toMatchObject({
      kind: "unsupported_inventory",
      action: "choose_supported_values",
      dataset: "icon-d2",
      path: "forecast.kind",
      unsupported: ["reforecast"],
      supported: ["operational"],
    });
  });

  it("suggests removing model-specific modifiers when no alternative value applies", () => {
    const failure = publicValidationFailure({
      dataset: "icon-d2",
      geometry: POINT,
      time: TIME,
      selection: { fields: ["temperature_2m"] },
      forecast: { grid: "0p50" },
    });

    expect(issueAt(failure, "forecast.grid")?.repair).toMatchObject({
      kind: "unsupported_capability",
      action: "remove_modifier",
      dataset: "icon-d2",
      path: "forecast.grid",
    });
  });

  it("suggests removing a source override from datasets that do not expose one", () => {
    const failure = publicValidationFailure({
      dataset: "icon-d2",
      geometry: POINT,
      time: TIME,
      selection: { fields: ["temperature_2m"] },
      source: "s3",
    });

    expect(issueAt(failure, "source")?.repair).toMatchObject({
      kind: "unsupported_capability",
      action: "remove_modifier",
      dataset: "icon-d2",
      path: "source",
    });
  });

  it("returns supported field inventory when a requested field is unknown", () => {
    const failure = publicValidationFailure({
      dataset: "arome",
      geometry: POINT,
      time: TIME,
      selection: { fields: ["not_a_real_field"] },
    });

    const repair = issueAt(failure, "selection.fields")?.repair;
    expect(repair).toMatchObject({
      kind: "unsupported_inventory",
      action: "choose_supported_values",
      dataset: "arome",
      path: "selection.fields",
      unsupported: ["not_a_real_field"],
    });
    expect(repair.supported.length).toBeGreaterThan(0);
  });

  it("returns the source required by a GFS multi-point geometry instead of silently rerouting", () => {
    const failure = publicValidationFailure({
      dataset: "gfs",
      geometry: {
        type: "points",
        points: [POINT, { type: "point", latitude: 50.1, longitude: 14.5 }],
      },
      time: TIME,
      selection: { fields: ["temperature_2m"] },
      source: "nomads",
    });

    expect(issueAt(failure, "source")?.repair).toMatchObject({
      kind: "unsupported_inventory",
      action: "choose_supported_values",
      dataset: "gfs",
      path: "source",
      unsupported: ["nomads"],
      supported: ["s3"],
    });
  });

  it("returns NOMADS as the repair for a GFS area source override", () => {
    const failure = publicValidationFailure({
      dataset: "gfs",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 15,
        southLatitude: 49,
        northLatitude: 50,
      },
      time: TIME,
      selection: { fields: ["temperature_2m"] },
      source: "s3",
    });

    expect(issueAt(failure, "source")?.repair).toMatchObject({
      kind: "unsupported_inventory",
      action: "choose_supported_values",
      dataset: "gfs",
      path: "source",
      unsupported: ["s3"],
      supported: ["nomads"],
    });
  });

  it("returns S3 as the repair for a GFS transect source override", () => {
    const failure = publicValidationFailure({
      dataset: "gfs",
      geometry: {
        type: "transect",
        start: POINT,
        end: { latitude: 50.1, longitude: 14.5 },
      },
      time: TIME,
      selection: { fields: ["temperature_2m"] },
      source: "nomads",
    });

    expect(issueAt(failure, "source")?.repair).toMatchObject({
      kind: "unsupported_inventory",
      action: "choose_supported_values",
      dataset: "gfs",
      path: "source",
      unsupported: ["nomads"],
      supported: ["s3"],
    });
  });

  it("returns reforecast geometry alternatives", () => {
    const failure = publicValidationFailure({
      dataset: "gefs",
      geometry: {
        type: "area",
        westLongitude: 14,
        eastLongitude: 15,
        southLatitude: 49,
        northLatitude: 50,
      },
      time: TIME,
      selection: { fields: ["temperature_2m"] },
      forecast: {
        kind: "reforecast",
        run: "2020-01-01T00:00:00Z",
      },
    });

    expect(issueAt(failure, "geometry")?.repair).toMatchObject({
      kind: "unsupported_inventory",
      action: "choose_supported_values",
      dataset: "gefs",
      path: "geometry",
      supported: ["point", "points"],
    });
  });

  it("uses capability inspection for non-inventory capability failures", () => {
    const failure = publicValidationFailure({
      dataset: "icon-d2",
      geometry: POINT,
      time: TIME,
      selection: { fields: ["temperature_2m"] },
      ensemble: { includeMembers: true },
    });

    expect(issueAt(failure, "ensemble")?.repair).toMatchObject({
      kind: "unsupported_capability",
      action: "inspect_capabilities",
      dataset: "icon-d2",
      path: "ensemble",
    });
  });

  it("keeps temporary data availability failures distinct from unsupported inventory", () => {
    const failure = toPublicFailure(new DataUnavailableError(
      "Requested field is temporarily unavailable upstream",
      { details: { dataset: "icon-d2", field: "temperature_2m" } },
    ));

    expect(failure).toEqual({
      code: "DATA_UNAVAILABLE",
      message: "Requested field is temporarily unavailable upstream",
      retryable: false,
      details: { dataset: "icon-d2", field: "temperature_2m" },
    });
  });
});
