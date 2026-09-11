# Catalog search

WFG discovery is local and deterministic. It performs no upstream weather-data requests. Start with the smallest discovery call that answers the planning question:

| Question | CLI | MCP |
| --- | --- | --- |
| Which canonical field or diagnostic expresses this quantity? | `catalog` | `search_catalog` |
| Does a known dataset support this selection and geometry? | `capabilities` | `inspect_capabilities` |
| Can a suitable run serve this place and valid-time window? | `availability` | `inspect_availability` |
| Retrieve the selected atmospheric evidence | `query` / `diagnose` | `query_atmosphere` / `diagnose_atmosphere` |

Availability can probe published provider metadata; it does not download forecast payloads. Catalog support alone is not a claim that a particular run is currently available.

## Discover canonical IDs

```bash
wfg catalog --dataset gfs --search wind --limit 5 --json
wfg catalog --dataset gefs --search "low cloud cover" --sections fields --temporal average --json
wfg catalog --dataset ifs --search "wind 10m" --sections fields --json
wfg catalog --spatial-scope limited-area --covers-point 50.08,14.43 --search temperature --json
wfg catalog --dataset gefs --forecast-kind reforecast --sections variables --json
```

`--dataset` accepts any public dataset ID shown in `wfg catalog --help`, or `all` (the default). Each match includes canonical outputs/units and explicit dataset support. Pressure variables go in `query --vars` / `selection.variables` with pressure levels; non-isobaric fields go in `--fields` / `selection.fields`. Diagnostic IDs belong in the corresponding layer, profile or parcel selection.

Filters:

- `--search <text>` searches IDs, descriptions, vertical/temporal metadata, dataset IDs and output units. Every word must match. If nothing matches, try fewer words or broader filters.
- `--sections <list>` accepts `variables,fields,layer_diagnostics,profile_diagnostics,parcel_definitions`. Dataset capabilities are always included.
- `--classification raw|derived` and `--temporal instantaneous|accumulation|average|maximum` restrict entries.
- `--spatial-scope global|limited-area`, `--covers-point lat,lon`, or `--covers-area west,east,south,north` restrict dataset coverage.
- `--forecast-kind operational|reforecast` distinguishes GEFS populations and requires `--dataset gefs`.
- `--limit <1-100>` bounds each page (default 30); `--offset <number>` continues a search.

Unknown sections and invalid filters produce structured `INVALID_REQUEST` failures. There is no public `--model` selector.

## Continue a truncated result

Results contain `totalMatches`, `truncated`, and, when another page exists, `nextOffset`. Repeat the same filters and pass `nextOffset` as `offset`. The final page omits `nextOffset`; an offset beyond the end returns an empty page. Ranking and support are stable across pages.

```bash
wfg catalog --search wind --limit 5 --json
# If the response reports nextOffset: 5:
wfg catalog --search wind --limit 5 --offset 5 --json
```

MCP uses the same contract:

```json
{
  "search": "wind",
  "datasets": ["gfs", "gefs"],
  "sections": ["fields"],
  "limit": 5,
  "offset": 5
}
```

## Move from discovery to a query

Once `temperature_2m` is known, a focused capability check avoids repeating broad catalog searches:

```bash
wfg capabilities --dataset gfs --point 50.08,14.43 --fields temperature_2m --json
wfg availability --dataset gfs --lat 50.08 --lon 14.43 --at 2026-09-12T00:00:00Z --fields temperature_2m --json
wfg query --dataset gfs --lat 50.08 --lon 14.43 --at 2026-09-12T00:00:00Z --fields temperature_2m --json
```

Replace the example timestamp with the desired valid time. To keep later queries on the initialization reported by availability, pass its `initialization` as `--run` / `forecast.run`.

## Ranking and semantics

Search normalizes case, whitespace, underscores, hyphens and diacritics. Exact IDs rank highest, followed by ID prefix/substring matches and structured metadata matches. Every search token must occur in an entry's searchable representation; search does not guess synonyms or reinterpret meteorology.

Dataset support comes from source-specific inventories and shared diagnostic kernels. Deterministic, ensemble, regional, AI and historical products retain their own capabilities and temporal semantics. GEFS operational and reforecast discovery have separate inventories. Returned results are independent copies; changing a result in a consuming application cannot affect subsequent searches.
