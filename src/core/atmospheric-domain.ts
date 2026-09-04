import {
  ATMOSPHERIC_DATASET_CATALOG,
  spatialDomainCoversGeometry,
  type AtmosphericCoverageGeometry,
  type AtmosphericDatasetId,
  type AtmosphericSpatialDomain,
} from "../catalog/models.js";
import { WfgError } from "../failure.js";

export class AtmosphericOutOfDomainError extends WfgError {
  constructor(
    readonly dataset: string,
    readonly internalDatasetId: AtmosphericDatasetId,
    readonly domain: AtmosphericSpatialDomain,
    readonly geometry: AtmosphericCoverageGeometry,
  ) {
    super("OUT_OF_DOMAIN", outOfDomainMessage(dataset, domain), {
      retryable: false,
      details: {
        dataset,
        domain: domain.name,
      },
    });
    this.name = "AtmosphericOutOfDomainError";
  }
}

export function assertAtmosphericGeometryWithinDomain(
  dataset: string,
  internalDatasetId: AtmosphericDatasetId,
  geometry: AtmosphericCoverageGeometry,
): void {
  const domain = ATMOSPHERIC_DATASET_CATALOG[internalDatasetId].spatialDomain;
  assertGeometryWithinSpatialDomain(dataset, internalDatasetId, domain, geometry);
}

export function assertGeometryWithinSpatialDomain(
  dataset: string,
  internalDatasetId: AtmosphericDatasetId,
  domain: AtmosphericSpatialDomain,
  geometry: AtmosphericCoverageGeometry,
): void {
  if (spatialDomainCoversGeometry(domain, geometry)) return;
  throw new AtmosphericOutOfDomainError(dataset, internalDatasetId, domain, geometry);
}

function outOfDomainMessage(
  dataset: string,
  domain: AtmosphericSpatialDomain,
): string {
  if (domain.scope === "global") {
    return `Dataset ${dataset} does not cover the requested geometry`;
  }
  const bounds = domain.bounds;
  return [
    `Dataset ${dataset} does not cover the requested geometry`,
    `declared domain=${domain.name}`,
    `bounds=[${bounds.westLongitude},${bounds.eastLongitude}] lon × [${bounds.southLatitude},${bounds.northLatitude}] lat`,
  ].join("; ");
}
