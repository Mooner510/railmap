# CURRENT_TASK

Status: active implementation
Updated: 2026-07-10
Current applied baseline: `13.70.0-route-search-diagnostics-import-comparison`
Next patch target: `13.71.0-editor-maintenance-workflow`

## Current phase

The editor, public web viewer, collector/export pipeline, manual rail builder, transfer review, timetable input, route search, data version manifest, and audit foundation are implemented.

Current focus is no longer foundation work. The next phase is operational hardening:

1. make destructive maintenance actions previewable and reversible through normal overlay history;
2. turn audit summaries into direct entry points for correction;
3. keep implementation documents synchronized with current code;
4. add repeatable route-quality regression cases before expanding fare/search policies.

## Completed through 13.70.0

- Transfer recommendation approval flow and nearest-next recommendation selection.
- Manual route/station building and transfer-group review.
- Service-pattern and train-run timetable authoring/import review.
- Public route search with multiple candidate comparison.
- Route quality diagnostics and comparison readiness.
- Station-line identity detection and stationId split execution.
- Manual data audit summary.
- Public data version manifest generation and web loading.

## 13.71.0 scope

- Replace stationId split `window.confirm` with a central preview dialog.
- Let the operator choose which line keeps the existing stationId.
- Show affected service-pattern and train-run counts before execution.
- Keep generated stations in a transfer group and mark transfer times pending.
- Make audit risk rows navigate to the relevant correction tab.
- Correct stale documents that no longer match the current code.

## Recommended next work after 13.71.0

### 13.72.0 route-search regression cases

- Save origin/destination verification cases.
- Define expected via stations or expected route characteristics.
- Run all cases and filter failures.
- Classify failures by timetable, performance, geometry, transfer time, and detour.

### 13.73.0 timetable import operations

- Bulk-resolve unmatched stations.
- Remember mapping choices and connect them to station aliases.
- Improve midnight rollover and duplicate-run conflict handling.
- Provide before/after review and per-row exclusion.

### 13.74.0 cache and release hardening

- Replace mtime/size versioning with content hashes.
- Add release ID and schema compatibility checks.
- Detect stale web data and define Cloudflare cache headers.

### 13.75.0 fare model foundation

- Add operator/line/service fare policies.
- Add editor input and validation.
- Prepare route result estimated fare and cost-first search.

## Non-negotiable rules

- No dummy or sample production transit data.
- A stationId must not represent real stations on multiple lines.
- Same physical station connections use transfer groups.
- KTX/SRT are service types, not physical Line names.
- `data/manual` remains the manual source of truth.
- Do not perform risky geometry or identity repair silently.
