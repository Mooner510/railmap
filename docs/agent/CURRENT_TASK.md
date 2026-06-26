# CURRENT_TASK

Status: current handoff note  
Generated: 2026-06-23

## 1. Current phase

The project is in source-design and collector-contract phase.

Do not start UI/app implementation.

Do not create fake data.

Do not perform broad new API probing unless necessary for collector implementation.

## 2. Completed source-design work

### KRIC urban rail

- KRIC XLSX files inspected.
- KRIC `trainUseInfo/subwayRouteInfo` sample call verified.
- KRIC `mreaWideCd` value set confirmed: `01` 수도권, `02` 부산, `03` 대구, `04` 광주, `05` 대전.
- Manual `(mreaWideCd, lnCd, lineName)` allowlist provided.
- KRIC operator/station code workbook accepted as code reference.
- Full route API execution deferred to collector implementation.

### KORAIL run API

- `travelerTrainRunInfo2` returned usable station-stop-level records.
- `travelerTrainRunPlan2` returned usable train-level records.
- `codes2` returned empty items in observed probes.
- Pagination works.
- Date filtering behavior is not verified; local filtering rule retained.

### OSM

- Geofabrik Korea and OSM Korea extracts inspected.
- Railway extraction and tag counts observed.
- OSM accepted as geometry/context source, not timetable source.

### TAGO Train

- Service metadata identified.
- Access currently blocked with `Forbidden`.
- TAGO deferred as secondary/cross-check only.

## 3. Current files to place in repo

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

## 4. Next recommended task

Prepare the first collector implementation handoff without doing additional documentation-phase API probing. Start with KRIC raw XLSX parsing, KRIC route allowlist handling, and KORAIL grouping rules.

Minimum next collector behavior:

1. Read KRIC raw XLSX files without modifying them.
2. Parse sheets into raw row records while preserving original headers and values.
3. Read `data/manual/kric-subway-route-info-line-map.csv`.
4. Validate that duplicate `lnCd` values are allowed across different `mreaWideCd` values.
5. Prepare, but do not necessarily execute, route API call plans from `(mreaWideCd, lnCd)`.
6. Emit diagnostics instead of final canonical data.
7. Group KORAIL `travelerTrainRunInfo2` rows by `run_ymd + trn_no` and sort by numeric `trn_run_sn`.
8. Preserve null arrival/departure times without inference.

## 5. Do not do next

- Do not brute-force all possible KRIC `lnCd` values.
- Do not test every KRIC route during documentation work.
- Do not use TAGO as a blocker.
- Do not infer transfers from same station name alone.
- Do not infer route geometry from timetable rows.
- Do not infer travel time from OSM geometry or KRIC speed fields.
