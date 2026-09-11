import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAtmosphericQueryAdapterRegistry } from "../src/core/query-adapters/registry.js";
import { createAtmosphericDiagnosticAdapterRegistry } from "../src/core/diagnostic-adapters/registry.js";
import type { DiagnoseAtmosphereRequest, QueryAtmosphereRequest } from "../src/schema/unified-api.js";

const spies = vi.hoisted(() => ({
  query: vi.fn(async (request: unknown) => request),
  diagnose: vi.fn(async (request: unknown) => request),
  queryConstructor: vi.fn(),
  diagnosticConstructor: vi.fn(),
}));
vi.mock("../src/core/query-adapters/gfs.js", () => ({
  GfsQueryAdapter: class {
    constructor(options: unknown) { spies.queryConstructor(options); }
    query = spies.query;
  },
}));
vi.mock("../src/core/diagnostic-adapters/gfs.js", () => ({
  GfsDiagnosticAdapter: class {
    constructor(options: unknown) { spies.diagnosticConstructor(options); }
    diagnose = spies.diagnose;
  },
}));
// These factories must not even be evaluated when another dataset is selected.
vi.mock("../src/core/query-adapters/gefs.js", () => { throw new Error("unexpected GEFS query import"); });
vi.mock("../src/core/diagnostic-adapters/gefs.js", () => { throw new Error("unexpected GEFS diagnostic import"); });

beforeEach(() => vi.clearAllMocks());

describe("lazy dataset registries", () => {
  it("constructs only the selected query adapter once, including concurrent first calls", async () => {
    const options = { progress: vi.fn() };
    const registry = createAtmosphericQueryAdapterRegistry(options);
    expect(spies.queryConstructor).not.toHaveBeenCalled();
    const first = { dataset: "gfs" } as QueryAtmosphereRequest;
    const second = { ...first, source: "s3" } as QueryAtmosphereRequest;
    expect(await Promise.all([registry.gfs.query(first), registry.gfs.query(second)])).toEqual([first, second]);
    expect(spies.queryConstructor).toHaveBeenCalledExactlyOnceWith(options);
    expect(spies.query).toHaveBeenCalledTimes(2);
  });

  it("constructs only the selected diagnostic adapter and isolates registry lifetimes", async () => {
    const registry = createAtmosphericDiagnosticAdapterRegistry();
    const other = createAtmosphericDiagnosticAdapterRegistry();
    expect(spies.diagnosticConstructor).not.toHaveBeenCalled();
    const request = { dataset: "gfs" } as DiagnoseAtmosphereRequest;
    await Promise.all([registry.gfs.diagnose(request), registry.gfs.diagnose(request)]);
    expect(spies.diagnosticConstructor).toHaveBeenCalledTimes(1);
    await other.gfs.diagnose(request);
    expect(spies.diagnosticConstructor).toHaveBeenCalledTimes(2);
  });

  it("uses injected adapters without initializing the defaults", async () => {
    const query = { query: vi.fn(async () => "query") };
    const diagnostic = { diagnose: vi.fn(async () => "diagnostic") };
    const queries = createAtmosphericQueryAdapterRegistry({ adapters: { gfs: query } });
    const diagnostics = createAtmosphericDiagnosticAdapterRegistry({ adapters: { gfs: diagnostic } });
    expect(queries.gfs).toBe(query);
    expect(diagnostics.gfs).toBe(diagnostic);
    await queries.gfs.query({ dataset: "gfs" } as QueryAtmosphereRequest);
    await diagnostics.gfs.diagnose({ dataset: "gfs" } as DiagnoseAtmosphereRequest);
    expect(spies.queryConstructor).not.toHaveBeenCalled();
    expect(spies.diagnosticConstructor).not.toHaveBeenCalled();
  });
});
