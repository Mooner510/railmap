# RAW_SNAPSHOT_POLICY

Status: locked draft
Generated: 2026-06-19
Scope: raw/probe/observed/generated data storage policy for the railway collector

## Purpose

The collector is not the authority-deciding layer. It is a raw acquisition, preservation, and candidate-normalization layer.

The local editor/admin layer decides:

- which source wins when sources conflict;
- whether to omit a candidate;
- whether to merge duplicate stations/lines;
- manual transfer groups and transfer times;
- manual fare tables;
- planned/construction lines.

## Directory layout

Use this layout from the repository root:

```text
data/
  raw/
    YYYY-MM-DD/
      kric/
      osm/
        geofabrik/
        osm-korea/
  probe/
    YYYY-MM-DD/
      osm/
        geofabrik/
        osm-korea/
  observed/
    YYYY-MM-DD/
      kric/
      osm/
  collected/
    YYYY-MM-DD/
      kric/
      osm/
  generated/
    YYYY-MM-DD/
      app-bundle/
      routing-bundle/
      map-tiles/
```

## Raw data rules

1. Raw downloaded/uploaded source files must be stored unchanged.
2. Raw files must have a sidecar metadata file.
3. Raw files must have a SHA256 checksum.
4. Raw files must not be edited to fix schema, encoding, dates, or typos.
5. Raw rows/objects must remain traceable from every candidate output.
6. If a source has a typo in a field name, preserve the typo in raw representation.

## Sidecar metadata

Each raw file must have a sidecar JSON file next to it.

Recommended naming:

```text
<raw-file-name>.metadata.json
<raw-file-name>.sha256
```

Recommended sidecar shape:

```json
{
  "sourceId": "osm_geofabrik_south_korea_20260617",
  "sourceName": "Geofabrik South Korea OSM PBF",
  "retrievedAt": "2026-06-17T00:00:00Z",
  "sourceUrl": "https://download.geofabrik.de/asia/south-korea-latest.osm.pbf",
  "localFileName": "south-korea-260617.osm.pbf",
  "byteSize": 280693281,
  "sha256": "B0CBCD65DC91B979965AFC30256CC3713E37D131DE7D5AA0AD8B947E42D1A74A",
  "license": {
    "status": "requires-release-review",
    "notes": "Do not publish generated artifacts before license/attribution review."
  },
  "observed": {
    "format": "PBF",
    "tool": "osmium fileinfo -e",
    "timestamp": "2026-06-17T20:21:14Z"
  }
}
```

## Probe data rules

Probe files are derived files created to inspect a raw source. They are not final normalized data.

Examples:

```text
data/probe/2026-06-17/osm/geofabrik/railway-geofabrik.osm.pbf
data/probe/2026-06-17/osm/geofabrik/railway-geofabrik-fileinfo.txt
data/probe/2026-06-17/osm/geofabrik/railway-geofabrik-tag-values.txt
```

Probe files must be reproducible from raw files and documented commands.

## Observed schema rules

Observed schema files should capture what was actually seen, not what documentation claims.

Recommended files:

```text
data/observed/2026-02-28/kric/kric-urban-rail-observed-schema.json
data/observed/2026-06-17/osm/geofabrik/osm-railway-observed-tags.json
```

Observed schema records must distinguish:

- documented fields;
- observed fields;
- parsed candidate fields;
- parse failures;
- raw values.

## Candidate collected data rules

Candidate collected data may be normalized, but it must retain source provenance.

Recommended JSONL shape:

```json
{
  "candidateId": "candidate:...",
  "sourceId": "kric_urban_rail_xlsx_20260228",
  "sourcePointer": {
    "file": "전체_도시철도역사정보_20260228.xlsx",
    "sheet": "표준데이터 역사",
    "rowNumber": 2
  },
  "raw": {},
  "normalized": {},
  "parseDiagnostics": []
}
```

## Date/time parsing policy

For Excel/KRIC sources:

1. Preserve original cell value.
2. Preserve original display text if available.
3. Store parsed candidate value separately.
4. Record parse status.
5. Do not silently coerce invalid dates.

Recommended shape:

```json
{
  "rawValue": 45369,
  "rawText": "45369",
  "parsedValue": "2024-03-19",
  "parseStatus": "parsed-excel-serial",
  "parseWarnings": []
}
```

For timetable times:

```json
{
  "rawValue": 0.5416666667,
  "rawText": "13:00:00",
  "parsedTime": "13:00:00",
  "serviceDayOffset": 0,
  "parseStatus": "parsed"
}
```

## No-prediction routing policy

Routing must not infer travel time from average speed or line geometry. It must use actual static timetable rows only.

Allowed:

- scheduled departure time;
- scheduled arrival time;
- static day type;
- explicit transfer time from local editor.

Not allowed:

- speed-based travel time estimation;
- geometry-length-based travel time estimation;
- AI-generated missing timetable rows;
- auto-created transfer walking times.

## Conflict policy

When two sources conflict, store both.

Do not implement global source priority inside the collector except for source availability fallback, such as Geofabrik primary vs OSM Korea fallback.

Conflict examples:

- KRIC station coordinate differs from OSM station coordinate.
- KRIC line name differs from OSM relation name.
- KRIC operator differs from OSM operator.
- OSM route relation is incomplete.

The collector should produce conflict diagnostics, not final decisions.

## Exclusion policy

For OSM, inactive/future/deprecated objects must be excluded from active normalized output but preserved in raw/probe data.

Examples:

```text
railway=construction
railway=proposed
railway=abandoned
railway=disused
railway=razed
railway=dismantled
construction:railway=*
proposed:railway=*
abandoned:railway=*
disused:railway=*
razed:railway=*
```

## Generated app data policy

Generated app bundles are disposable outputs from raw/collected data and local editor decisions.

Recommended generated outputs:

```text
data/generated/YYYY-MM-DD/app-bundle/manifest.json
data/generated/YYYY-MM-DD/app-bundle/search-index.json
data/generated/YYYY-MM-DD/routing-bundle/static-timetable.bin
data/generated/YYYY-MM-DD/map-tiles/railway.pmtiles
```

Generated app data must include:

- data version;
- source snapshot references;
- schema version;
- generation timestamp;
- checksums;
- compatibility fields such as `minAppVersion`.

## Agent implementation rule

An implementation agent must stop and report `BLOCKED` if:

- a required source file is missing;
- the observed schema differs from this document;
- a parser needs a rule not specified here;
- a source license is required for public distribution but not verified;
- it would need to generate fake/sample data to proceed.
