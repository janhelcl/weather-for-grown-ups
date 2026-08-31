import { describe, expect, it } from "vitest";
import { spatialDomainCoversGeometry } from "../src/catalog/models.js";
import {
  AtmosphericOutOfDomainError,
  assertGeometryWithinSpatialDomain,
} from "../src/core/atmospheric-domain.js";

const domain = {
  scope: "limited_area" as const,
  name: "Central Europe test domain",
  bounds: {
    westLongitude: 5,
    eastLongitude: 20,
    southLatitude: 45,
    northLatitude: 55,
  },
};

describe("atmospheric spatial domain", () => {
  it("checks points, batches, transects, and bounded areas against declared coverage", () => {
    expect(spatialDomainCoversGeometry(domain, {
      type: "point",
      latitude: 50,
      longitude: 14,
    })).toBe(true);
    expect(spatialDomainCoversGeometry(domain, {
      type: "point",
      latitude: 60,
      longitude: 14,
    })).toBe(false);

    expect(spatialDomainCoversGeometry(domain, {
      type: "points",
      points: [
        { latitude: 49, longitude: 12 },
        { latitude: 50, longitude: 14 },
      ],
    })).toBe(true);
    expect(spatialDomainCoversGeometry(domain, {
      type: "points",
      points: [
        { latitude: 49, longitude: 12 },
        { latitude: 56, longitude: 14 },
      ],
    })).toBe(false);

    expect(spatialDomainCoversGeometry(domain, {
      type: "transect",
      start: { latitude: 49, longitude: 12 },
      end: { latitude: 51, longitude: 16 },
    })).toBe(true);
    expect(spatialDomainCoversGeometry(domain, {
      type: "area",
      westLongitude: 10,
      eastLongitude: 16,
      southLatitude: 48,
      northLatitude: 52,
    })).toBe(true);
    expect(spatialDomainCoversGeometry(domain, {
      type: "area",
      westLongitude: 4,
      eastLongitude: 16,
      southLatitude: 48,
      northLatitude: 52,
    })).toBe(false);
  });

  it("treats global domains as covering every valid public geometry", () => {
    expect(spatialDomainCoversGeometry(
      { scope: "global" },
      { type: "point", latitude: -89, longitude: 179 },
    )).toBe(true);
  });

  it("raises a stable, distinct OUT_OF_DOMAIN failure before source access", () => {
    const geometry = { type: "point" as const, latitude: 60, longitude: 14 };

    expect(() => assertGeometryWithinSpatialDomain(
      "test-regional",
      "gfs_0p25",
      domain,
      geometry,
    )).toThrow(AtmosphericOutOfDomainError);

    try {
      assertGeometryWithinSpatialDomain(
        "test-regional",
        "gfs_0p25",
        domain,
        geometry,
      );
      throw new Error("Expected domain assertion to fail");
    } catch (error) {
      expect(error).toMatchObject({
        name: "AtmosphericOutOfDomainError",
        code: "OUT_OF_DOMAIN",
        dataset: "test-regional",
        internalDatasetId: "gfs_0p25",
      });
      expect((error as Error).message).toContain("declared domain=Central Europe test domain");
    }
  });
});
