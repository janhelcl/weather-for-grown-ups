# Météo-France PE-AROME

`dataset: "pe-arome"` is WFG's second regional ensemble family. It uses the same public atmospheric query language as the other datasets while keeping Météo-France's ensemble access mechanics inside the source layer.

## Forecast population

The current metropolitan PE-AROME capability is represented as:

- 25 members: control `c00` plus perturbations `p01..p24`;
- 6-hourly production cycles at 03/09/15/21 UTC;
- hourly forecast output through f51;
- regular 0.025° public WCS delivery grid over the declared metropolitan domain;
- member-first ensemble aggregation.

Member IDs are deliberately not rewritten to resemble ICON-D2-EPS, GEFS or IFS ENS. A selected PE-AROME member stays a PE-AROME member throughout provenance and optional raw-member output.

## Current WFG field slice

Météo-France's targeted ensemble API is dynamic and exposes one model/member/run/lead/level/meteorological field per request. WFG therefore advertises only the near-surface coverage identities that the integration currently maps explicitly:

- `temperature_2m`;
- `relative_humidity_2m`.

Wind, pressure-level variables and pressure-derived diagnostics are intentionally not advertised yet. Temperature and relative-humidity coverage nomenclature is corroborated by Météo-France's published WCS/WMS service vocabulary; the PE-specific subscribed service itself is credential-gated. Expanding the field set should therefore start from that service's live `GetCapabilities`/`DescribeCoverage` inventory rather than assuming that deterministic AROME coverage names can be copied blindly.

For area summaries, WFG currently accepts the two native scalar fields above.

## Member-first semantics

PE-AROME follows WFG's standing ensemble rule:

1. resolve one forecast initialization;
2. fetch the selected member fields;
3. normalize each member independently;
4. aggregate member distributions only after those per-member calculations.

The same boundary is retained for future derived/nonlinear capabilities: they must be evaluated inside each member before ensemble aggregation rather than derived from an ensemble-mean state.

The first selected member resolves `latest` / `latest_complete`. That resolved initialization is then pinned for the remaining members, preventing mixed-cycle ensemble results while publication is in progress.

## Météo-France WCS access

Unlike deterministic AROME's anonymous object-store packages, PE-AROME is accessed through Météo-France's authenticated targeted ensemble WCS API. The provider's public documentation describes:

- five-day data retention;
- synchronous WCS access;
- one member/run/lead/level/field per request;
- binary GRIB/GeoTIFF responses;
- bearer-token authorization.

WFG requests bounded latitude/longitude subsets instead of downloading the whole metropolitan field for a point query. Multiple requested raw fields are fetched separately, cached immutably, and concatenated into one local GRIB bundle before the shared decoder/field-normalization path runs.

The public query contains none of those WCS concepts.

## Credentials and endpoint configuration

PE-AROME is the one current WFG dataset that needs Météo-France API credentials.

Set:

```bash
export WFG_METEO_FRANCE_TOKEN='...'
```

Météo-France's portal subscription determines the member-specific WCS endpoint. WFG deliberately does not guess a subscription URL. Configure either a template:

```bash
export WFG_PEAROME_WCS_URL_TEMPLATE='https://.../{member_number_2}/.../wcs'
```

or an explicit JSON mapping:

```bash
export WFG_PEAROME_WCS_ENDPOINTS='{"c00":"https://...","p01":"https://...", "...":"..."}'
```

Template placeholders are:

- `{member}` — `c00` / `p01` … `p24`;
- `{member_number}` — `0` … `24`;
- `{member_number_2}` — `00` … `24`.

The token and endpoint configuration are source-layer concerns. They are never part of `query_atmosphere` input.

## Example

```json
{
  "dataset": "pe-arome",
  "geometry": {
    "type": "point",
    "latitude": 50.08,
    "longitude": 14.43
  },
  "time": {
    "at": "2026-09-01T12:00:00Z"
  },
  "selection": {
    "fields": ["temperature_2m", "relative_humidity_2m"]
  },
  "ensemble": {
    "members": ["c00", "p01", "p02", "p03"],
    "quantiles": [0.1, 0.5, 0.9]
  }
}
```

The result reports field distributions over the selected members. `ensemble.includeMembers: true` additionally returns member payloads; it should be used only when those raw values are actually needed.

## Scope boundary

PE-AROME is atmospheric evidence, not a calibrated probability product. Member fractions, quantiles and spread describe the raw forecast population. WFG does not reinterpret them as calibrated event probabilities.
