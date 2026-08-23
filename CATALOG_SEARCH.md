# GFS catalog search

WFG keeps the complete atmospheric catalog available through CLI `wfg catalog` and MCP `get_gfs_catalog`, but agents often need only a small subset of that surface. Catalog search provides a bounded, deterministic discovery path without changing the underlying catalog definitions.

## CLI

With no search/filter options, `wfg catalog` keeps the existing full-catalog behavior.

```bash
wfg catalog
wfg catalog --json
```

Supplying any search/filter option switches the command to compact search/browse mode:

```bash
wfg catalog \
  --search "low cloud cover" \
  --sections fields \
  --temporal average \
  --limit 10 \
  --json
```

Available filters:

- `--search <text>` — tokenized case-insensitive search across IDs, descriptions, dependencies, output names/descriptions/units, GFS codes, source units, and vertical/temporal semantics.
- `--sections <list>` — comma-separated subset of `variables`, `fields`, `layer_diagnostics`, `profile_diagnostics`, `parcel_definitions`.
- `--classification <raw|derived>` — raw NOAA-backed definitions versus deterministic derived definitions/diagnostics.
- `--temporal <instantaneous|accumulation|average>` — exact non-isobaric temporal semantics.
- `--limit <number>` — returned matches, 1-100. Compact search defaults to 30.

## MCP

MCP exposes the same shared search core as `search_gfs_catalog`. `get_gfs_catalog` remains unchanged for clients that want the full catalog.

Example structured input:

```json
{
  "search": "wet bulb",
  "sections": ["variables"],
  "classification": "derived",
  "limit": 10
}
```

## Ranking and matching

Search normalizes case, whitespace, underscores, hyphens, and diacritics. Every search token must occur somewhere in the searchable representation of an entry; WFG does not broaden a zero-result query.

Ranking is deterministic. Exact IDs receive the strongest score, followed by ID prefixes/substrings and then token matches across IDs, descriptions, and structured metadata. Ties are resolved by stable section order and then ID.

The result includes:

- the resolved query and filters;
- `totalMatches` before limiting;
- `truncated` when more matches exist;
- flat matches with section, ID, raw/derived classification, concrete kind, description, vertical semantics, optional temporal semantics/GFS metadata/dependencies, normalized outputs, and score.

Search is local and deterministic. It performs no NOAA request and does not touch the NOMADS courtesy limiter.
