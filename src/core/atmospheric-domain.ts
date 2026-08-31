import {
  ATMOSPHERIC_DATASET_CATALOG,
  spatialDomainCoversGeometry,
  type AtmosphericCoverageGeometry,
  type AtmosphericDatasetId,
  type AtmosphericSpatialDomain,
} from "../catalog/models.js";

export class AtmosphericOutOfDomainError extends Error {
  readonly code = "OUT_OF_DOMAIN" as const;

  constructor(
    readonly dataset: string,
    readonly internalDatasetId: AtmosphericDatasetId,
    readonly domain: AtmosphericSpatialDomain,
    readonly geometry: AtmosphericCoverageGeometry,
  ) {
    super(outOfDomainMessage(dataset, domain));
    this.name = "AtmosphericOutOfDomainError";
  }
}

export function assertAtmosphericGeometryWithinDomain(
  dataset: string,
  internalDatasetId: AtmosphericDatasetId,
  geometry: AtmosphericCoverageGeometry,
): void {
  const domain = ATMOSPHERIC_DATASET_CATALOG[internalDatasetId].spatialDomain;
  if (spatialDomainCoversGeometry(domain, geometry)) return;
  throw new AtmosphericOutOfDomainError(dataset, internalDatasetId, domain, geometry);
}

function outOfDomainMessage(
  dataset: string,
  domain: AtmosphericSpatialDomain,
): string {
  if (domain.scope === "global") {
    return `OUT_OF_DOMAIN: dataset=${dataset} does not cover the requested geometry`;
  }
  const bounds = domain.bounds;
  return [
    `OUT_OF_DOMAIN: dataset=${dataset} does not cover the requested geometry`,
    `declared domain=${domain.name}`,
    `bounds=[${bounds.westLongitude},${bounds.eastLongitude}] lon × [${bounds.southLatitude},${bounds.northLatitude}] lat`,
  ].join("; ");
}
