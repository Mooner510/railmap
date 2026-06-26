# DATA_SOURCE_REGISTRY

Status: current working registry  
Generated: 2026-06-23  
Project: railmap

## 1. Purpose

This registry lists the data sources currently accepted, blocked, or deferred for the railway/metro source-design phase.

This project does not use fake or synthesized transit data. Every candidate record must point back to raw source data, a manual source file, or a documented probe result.

## 2. Source status summary

| Source | File | Role | Status | Implementation priority |
|---|---|---|---|---|
| KRIC urban rail XLSX | `DATA_SOURCE_KRIC.md` | Primary urban rail line/station/timetable source | accepted | high |
| KRIC `trainUseInfo/subwayRouteInfo` OpenAPI | `DATA_SOURCE_KRIC.md` | Supplementary ordered route sequence source | verified sample + allowlist documented | high |
| KRIC operator/station code workbook | `DATA_SOURCE_KRIC.md` | Official code reference for operator/line/station codes | accepted | high |
| KRIC route API allowlist | `data/manual/kric-subway-route-info-line-map.csv` | Manual `(mreaWideCd, lnCd)` route-call candidate list | accepted | high |
| KORAIL train operation API | `DATA_SOURCE_KORAIL_RUN.md` | Primary intercity/conventional train timetable source | observed usable; collector rules documented | high |
| OSM / Geofabrik Korea extract | `DATA_SOURCE_OSM.md` | Geometry and map-context source | observed, usable | medium |
| OSM Korea non-military extract | `DATA_SOURCE_OSM.md` | Fallback geometry source | observed, fallback only | low |
| TAGO Train API | `DATA_SOURCE_TAGO_TRAIN.md` | Secondary OD timetable cross-check | blocked by access | low/deferred |

## 3. Current design decisions

### 3.1 KRIC is primary for Korean urban rail source design

KRIC XLSX files are accepted as the initial primary source for Korean urban rail:

- line metadata;
- station metadata;
- static urban rail operation/timetable rows;
- station coordinates from the station workbook;
- Korean and English station names where present.

KRIC `subwayRouteInfo` is accepted as a supplementary route-sequence source. It is not a replacement for the raw XLSX files.

### 3.2 KRIC route API call candidates are not discovered by brute force

The project uses a manually reviewed route allowlist:

```text
data/manual/kric-subway-route-info-line-map.csv
```

The API key for `subwayRouteInfo` is `(mreaWideCd, lnCd)`.

`lnCd` alone is not globally unique. Values such as `1`, `2`, `3`, and `4` repeat across regions. Collector implementations must use `(mreaWideCd, lnCd)` and preserve line/operator context for diagnostics.

### 3.3 KRIC bulk route verification is deferred to implementation

The documentation phase only verifies representative endpoint behavior and defines source rules.

Full allowlist execution must happen during collector implementation, with raw responses and diagnostics preserved.

Do not spend documentation time calling every route once merely to decide whether to include it in the plan.

### 3.4 KORAIL is primary for intercity/conventional train timetable rows

The KORAIL train operation API has returned usable station-stop-level and train-level records with working pagination.

Its `codes2` endpoint returned empty lists during probing, so code tables should initially be derived from observed operation rows unless later verified.

### 3.5 TAGO Train is deferred

TAGO Train service metadata exists, but calls returned `Forbidden` for the current key/access state.

TAGO must not block KORAIL collector design.

### 3.6 OSM is geometry/context, not timetable

OSM sources may help with geometry, station/route geometry context, and map rendering, but must not be used to infer timetable travel time.

Inactive or future railway values such as construction/proposed/abandoned/disused/razed/dismantled must be excluded from active normalized outputs unless manually reviewed.

## 4. Required repository placement

```text
docs/data-sources/DATA_SOURCE_REGISTRY.md
docs/data-sources/DATA_SOURCE_KRIC.md
docs/data-sources/DATA_SOURCE_KORAIL_RUN.md
docs/data-sources/DATA_SOURCE_OSM.md
docs/data-sources/DATA_SOURCE_TAGO_TRAIN.md
docs/collector/RAW_SNAPSHOT_POLICY.md
docs/agent/AGENT_RULES.md
docs/agent/COLLECTOR_CONTRACT.md
docs/agent/CURRENT_TASK.md
data/manual/kric-subway-route-info-line-map.csv
```

## 5. Global collector rules

Collectors must:

1. preserve raw responses and raw rows;
2. record acquisition date separately from source reference date;
3. avoid storing or printing API keys;
4. keep source-specific raw fields before normalization;
5. emit diagnostics instead of silently resolving conflicts;
6. avoid fake data, synthetic timetable rows, and geometry-derived travel times;
7. keep manual editorial decisions separate from automatic collection.

## 6. Current next task

Proceed to first collector implementation handoff for KRIC and KORAIL.

Do not perform additional broad API probing during documentation work. Broad verification belongs to collector implementation and must preserve raw responses plus diagnostics.
