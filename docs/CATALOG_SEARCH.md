# Catalog search

WFG keeps complete model-specific atmospheric catalogs available while giving agents a bounded search surface for discovery.

Catalog search is **local and deterministic**. It performs no NOAA request and does not touch the NOMADS courtesy limiter.

## CLI

The catalog command is model-selectable:

```bash
wfg catalog --model gfs --json
wfg catalog --model gefs --json
```

Supplying search/filter options switches to compact browse mode:

```bash
wfg catalog \
  --model gefs \
  --search "low cloud cover" \
  --sections fields \
  --temporal average \
  --limit 10 \
  --json
```

GFS remains the default model where the CLI needs backward-compatible behavior.

Available filters include:

- `--search <text>` — tokenized case-insensitive search across IDs, descriptions, dependencies, outputs/units, source codes and vertical/temporal semantics;
- `--sections <list>` — restrict to supported catalog sections;
- `--classification <raw|derived>` — raw NOAA-backed definitions versus locally derived definitions/diagnostics;
- `--temporal <instantaneous|accumulation|average>` — exact non-isobaric temporal semantics;
- `--limit <number>` — returned matches, bounded to the command schema.

## MCP

MCP keeps model-explicit catalog tools:

- `get_gfs_catalog`
- `search_gfs_catalog`
- `get_gefs_catalog`
- `search_gefs_catalog`

That separation is intentional: GFS and GEFS do not have identical source inventories, and smaller model-specific schemas are clearer for agents.

Example structured GEFS search input:

```json
{
  "search": "wet bulb",
  "sections": ["variables"],
  "classification": "derived",
  "limit": 10
}
```

## What the catalogs describe

Both model catalogs expose canonical normalized semantics rather than requiring callers to understand raw GRIB naming.

Depending on model and section, entries describe:

- raw pressure variables;
- member-first or deterministic derived thermodynamics;
- non-isobaric fields;
- layer diagnostics;
- whole-profile diagnostics;
- parcel definitions;
- dependencies;
- normalized outputs and units;
- pressure/vertical availability;
- instantaneous, accumulation or average temporal meaning;
- model-specific source codes and source units.

GEFS search reflects the v0.1.0 expanded `pgrb2a` contract, including derived profile thermodynamics and parcel capabilities rather than inheriting the deterministic GFS catalog by assumption.

## Ranking and matching

Search normalizes case, whitespace, underscores, hyphens and diacritics. Every search token must occur somewhere in the searchable representation of an entry; WFG does not broaden a zero-result query into a fuzzy meteorological guess.

Ranking is deterministic. Exact IDs receive the strongest score, followed by ID prefixes/substrings and then token matches across IDs, descriptions and structured metadata. Ties use stable catalog ordering.

The result includes the resolved query and filters, match count before limiting, truncation status, and compact structured matches suitable for agent tool selection.
