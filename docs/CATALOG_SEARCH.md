# Catalog search

WFG exposes one canonical catalog search across its atmospheric datasets. Catalog search is **local and deterministic**: it performs no NOAA request and does not use the courtesy limiter.

## CLI

```bash
wfg catalog --dataset all --json
wfg catalog --dataset gfs --search wind --json
wfg catalog --dataset gefs --search "low cloud cover" --sections fields --temporal average --limit 10 --json
wfg catalog --dataset gfs-analysis --search parcel --json
```

Available filters include:

- `--dataset gfs|gefs|gfs-analysis|all`;
- `--search <text>`;
- `--sections <list>`;
- `--classification <raw|derived>`;
- `--temporal <instantaneous|accumulation|average>`;
- `--limit <number>`.

There is no public `--model` selector.

## MCP

MCP exposes one discovery tool: `search_catalog`.

Example:

```json
{
  "search": "wet bulb",
  "datasets": ["gfs", "gefs", "gfs-analysis"],
  "sections": ["variables"],
  "classification": "derived",
  "limit": 10
}
```

Each match reports which datasets support the canonical entry, so dataset differences remain explicit without multiplying discovery tools.

## What the catalog describes

Entries can describe raw pressure variables, derived thermodynamics, non-isobaric fields, layer/profile diagnostics, parcel definitions, dependencies, normalized outputs/units, vertical availability, and temporal semantics.

Dataset support comes from the source-specific inventories; WFG does not assume that GFS, GEFS, and the historical analysis archive contain identical fields.

## Ranking and matching

Search normalizes case, whitespace, underscores, hyphens and diacritics. Every search token must occur in the searchable representation of an entry. Ranking is deterministic: exact IDs rank highest, followed by ID prefix/substring matches and then structured metadata matches.
