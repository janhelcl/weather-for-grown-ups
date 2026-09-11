import { describe, expect, it } from "vitest";
import { searchAtmosphereCatalog } from "../src/catalog/unified-search.js";
import { CATALOG_ENTRY_FACTORIES } from "../src/catalog/unified-entries.js";
import { PUBLIC_ATMOSPHERIC_DATASET_IDS } from "../src/schema/unified-api.js";

describe("indexed catalog discovery", () => {
  it("registers every public dataset", () => {
    expect(Object.keys(CATALOG_ENTRY_FACTORIES).sort()).toEqual([...PUBLIC_ATMOSPHERIC_DATASET_IDS].sort());
  });

  it("keeps cached metadata isolated from caller mutations", () => {
    const query = { search: "temperature", limit: 100 };
    const expected = searchAtmosphereCatalog(query);
    const result = searchAtmosphereCatalog(query);
    result.matches[0]!.description = "changed";
    result.matches[0]!.outputs[0]!.unit = "changed";
    result.matches[0]!.support.length = 0;
    result.datasetCapabilities[0]!.operations.length = 0;
    result.query.datasets.length = 0;
    expect(searchAtmosphereCatalog(query)).toEqual(expected);
  });

  it("preserves ranking while honoring caller order only in support rows", () => {
    const forward = searchAtmosphereCatalog({ datasets: ["gfs", "gefs"], search: "wind" });
    const reverse = searchAtmosphereCatalog({ datasets: ["gefs", "gfs"], search: "wind" });
    expect(reverse.matches.map(({ support, ...match }) => match))
      .toEqual(forward.matches.map(({ support, ...match }) => match));
    expect(reverse.matches.find(match => match.support.length === 2)!.support.map(row => row.dataset))
      .toEqual(["gefs", "gfs"]);
  });

  it("does not mix operational and reforecast inventories across repeated calls", () => {
    const operational = searchAtmosphereCatalog({ datasets: ["gefs"], sections: ["parcel_definitions"] });
    const retrospective = searchAtmosphereCatalog({ datasets: ["gefs"], forecastKind: "reforecast", sections: ["parcel_definitions"] });
    expect(operational.totalMatches).toBeGreaterThan(0);
    expect(retrospective.totalMatches).toBe(0);
    expect(searchAtmosphereCatalog({ datasets: ["gefs"], sections: ["parcel_definitions"] })).toEqual(operational);
  });

  it("normalizes case, separators and diacritics without changing exact-ID priority", () => {
    const plain = searchAtmosphereCatalog({ search: "wet bulb" });
    const normalized = searchAtmosphereCatalog({ search: "WÉT_bulb" });
    expect(normalized.matches).toEqual(plain.matches);
    const exact = searchAtmosphereCatalog({ search: "temperature" });
    expect(exact.matches[0]!.id).toBe("temperature");
  });
});

describe("catalog pagination", () => {
  it("enumerates the complete catalog without gaps or duplicate IDs", () => {
    const ids: string[] = [];
    let offset: number | undefined;
    let total = 0;
    do {
      const page = searchAtmosphereCatalog({ limit: 7, ...(offset === undefined ? {} : { offset }) });
      total = page.totalMatches;
      expect(page.matches.length).toBeLessThanOrEqual(7);
      expect(page.truncated).toBe(page.nextOffset !== undefined);
      ids.push(...page.matches.map(match => `${match.section}:${match.id}`));
      if (page.nextOffset !== undefined) expect(page.nextOffset).toBe((offset ?? 0) + page.matches.length);
      offset = page.nextOffset;
    } while (offset !== undefined);
    expect(ids.length).toBe(total);
    expect(new Set(ids).size).toBe(total);
  });

  it("pages a filtered search without changing scores or support", () => {
    const query = { datasets: ["gfs", "gefs"] as const, search: "wind" };
    const full = searchAtmosphereCatalog({ ...query, datasets: [...query.datasets], limit: 100 });
    const page = searchAtmosphereCatalog({ ...query, datasets: [...query.datasets], offset: 2, limit: 3 });
    expect(page.matches).toEqual(full.matches.slice(2, 5));
    expect(page.totalMatches).toBe(full.totalMatches);
    const end = searchAtmosphereCatalog({ offset: 100_000 });
    expect(end.matches).toEqual([]);
    expect(end.truncated).toBe(false);
    expect(end.nextOffset).toBeUndefined();
  });

  it.each([-1, 0.5, Number.POSITIVE_INFINITY])("rejects invalid offset %s", offset => {
    expect(() => searchAtmosphereCatalog({ offset })).toThrow();
  });
});
