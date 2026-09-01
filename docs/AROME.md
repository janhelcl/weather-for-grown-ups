# Météo-France AROME

WFG exposes the current Météo-France AROME-France deterministic forecast as public `dataset: "arome"`.

The integration deliberately distinguishes the **forecast model** from the **public delivery product**. Operational AROME has a nominal horizontal mesh of about **1.3 km**. The first WFG capability uses Météo-France's separate **0.01° EURW1S100** regular-lat/lon public package. Those are related resolutions, not interchangeable grid identities.

## Public identity

| Property | WFG value |
| --- | --- |
| Public dataset | `arome` |
| Internal dataset | `arome_0p01` |
| Provider | Météo-France |
| Model class | physics |
| Kind | deterministic forecast |
| Spatial scope | limited area |
| Native model grid | Lambert-conformal, nominal ~1.3 km |
| Public product grid | regular lat/lon, 0.01° (`EURW1S100`) |
| Conservative product bounds | 12°W–16°E, 37.5–55.4°N |
| Initialization cadence | every 3 hours (00/03/06/09/12/15/18/21 UTC) |
| Native output cadence | hourly |
| Forecast horizon | f000–f051 |

The dataset catalog exposes both `nativeGrid` and `horizontalGridDegrees`; callers must not infer that a 0.01° delivery grid means the dynamical model itself is a 0.01° regular-lat/lon model.

## Upstream product

WFG uses Météo-France's openly downloadable PNT object-store packages:

```text
https://meteofrance-pnt.s3.rbx.io.cloud.ovh.net/pnt/
  {run}/arome/001/{package}/
  arome__001__{package}__{HH}H__{run}.grib2
```

The selected product is the official **Paquets Arome - Résolution 0,01°** dataset. Files are GRIB2 and use the provider's public package grouping. WFG currently needs:

- `SP1` for 2 m temperature, 2 m relative humidity, and 10 m U/V wind;
- `HP1` for U/V wind at 20 m, 50 m and 100 m.

The source layer downloads only the package families required by a selection, combines immutable GRIB records locally, and caches them by run/lead/field set. Availability probes use the same source contract. Météo-France access policy is independent of NOAA, DWD and ECMWF policy.

## Current field inventory

The public 0.01° WFG slice exposes:

- `temperature_2m`
- `relative_humidity_2m`
- `u_wind_10m`, `v_wind_10m`, derived `wind_10m`
- `u_wind_20m`, `v_wind_20m`, derived `wind_20m`
- `u_wind_50m`, `v_wind_50m`, derived `wind_50m`
- `u_wind_100m`, `v_wind_100m`, derived `wind_100m`

Point, native-cadence range, multi-point, multi-point-range, great-circle transect and bounded scalar-area operations use the same public `query_atmosphere` vocabulary as every other dataset.

Derived vector wind is available for point-like operations. Area summaries intentionally require a native scalar field so the spatial statistics are computed from one real GRIB message rather than from separately summarized vector components.

## Why pressure profiles are not mixed in

Météo-France also publishes other AROME public products, including a separate **0.025°** package family with a richer vertical inventory. WFG does **not** silently fetch that product when a caller asks `dataset: "arome"` backed by `arome_0p01`.

Consequently, the current AROME capability advertises:

- no pressure-level variables;
- no layer/profile/parcel diagnostics;
- no cross-dataset comparison strategy yet.

A pressure request fails at the dataset capability boundary with an explicit message. This is intentional: one query language means common grammar, not fabricated source symmetry.

A later expansion can add another explicit AROME product identity or a generic product-resolution selector once the semantics are designed without introducing a provider-specific public namespace.

## Run semantics

`forecast.run` accepts:

- `latest` — newest published 3-hour cycle that can satisfy the requested valid time/range and required package families;
- `latest_complete` — newest cycle with the terminal f051 package available;
- an explicit timezone-aware 3-hour UTC cycle.

For range queries, one run is resolved for the whole range and native hourly leads are sampled without interpolation. A request beyond f051 fails rather than switching to another model or product.

## Decoder and live compatibility

The official AROME files use GRIB2 CCSDS packing. WFG's bundled `@mattnucc/gribberish` decoder supports that representation, so normal AROME use does not require native `wgrib2`.

`npm run test:live:arome` verifies against a safely published real cycle:

- current object naming and transport;
- CCSDS decode through the bundled decoder;
- 2 m temperature / relative humidity;
- derived 10 m wind;
- run/lead semantics;
- native-model versus public-product grid provenance.

## Upstream references

- Météo-France / data.gouv.fr: `https://www.data.gouv.fr/datasets/paquets-arome-resolution-0-01deg/`
- Météo-France AROME model overview: `https://education.meteofrance.fr/meteo-a-z/les-modeles-de-prevision-meteo`
- Météo-France AROME API metadata: `https://www.data.gouv.fr/dataservices/api-modele-arome`

These links document upstream semantics; WFG's public contract remains [UNIFIED_API.md](UNIFIED_API.md).
