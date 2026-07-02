# CURRENT_TASK

Status: active implementation handoff  
Updated: 2026-07-02  
Current version target: `13.20.1-docs-and-operation-cleanup`

## 1. Current phase

The project is now in implementation and hardening phase.

The old source-design-only phase is complete. UI/editor/web implementation already exists and must be maintained.

Current focus:

1. keep data identity rules enforced;
2. keep manual overlays durable through collector/export runs;
3. reduce editor maintenance risk after module splitting;
4. productize the public web map;
5. keep documents synchronized with the current code.

## 2. Recently completed work

### Editor

- Unified map editor is implemented.
- Station position override flow exists.
- Transfer group editor exists.
- Geometry/line branch editing exists.
- New station creation flow exists.
- Existing station insertion into a line exists.
- Circular line toggle exists.
- Validation panel is readable and grouped by problem type.
- Some repair actions are available per issue and in bulk.
- Station insertion uses a compact ㄹ-shaped visual line diagram.
- Editor module splitting has started:
  - `branchRules.ts`
  - `stationInsertion.tsx`
  - `branchInspector.tsx`
  - `validationPanel.tsx`
  - `stationInspector.tsx`

### Web

- Public map is implemented.
- Rail explorer UI exists.
- User-facing HUD exists.
- Selected station/line/transfer group panels exist.
- Transfer group and line preview visuals exist.
- Web metadata is updated for the Korean public rail map.

### Collector/data

- KRIC canonical app bundle generation exists.
- Manual overlay export into web public data exists.
- Station-line identity validation exists.
- Manual overlay source-of-truth is `data/manual`.
- Public export path is `apps/web/public/data`.

## 3. Non-negotiable current data rules

1. Do not create fake transit data.
2. Do not infer timetable travel times.
3. Do not merge same-name stations automatically.
4. Do not use one `stationId` as a real station for multiple lines.
5. A physical transfer location may contain multiple line-specific station icons.
6. Cross-line geometry references must use `control` points, not foreign `stationId` station points.
7. Circular lines cannot themselves branch-connect outward into another line.
8. Non-circular lines may connect into a station on a circular line.
9. Circular lines may still have internal branch additions.
10. `data/manual` is the manual source of truth.

## 4. Recommended next work

### 13.21.0 collector/data validation hardening

Recommended scope:

- Add stricter collector-side validation for manual overlays.
- Validate every geometry override point.
- Validate every line branch override against circular-line branch rules.
- Validate generated/public data parity.
- Fail build/export when manual overlay cannot be safely applied.
- Emit clear diagnostics that match editor validation categories.

### 13.22.0 deployment/cache/version policy

Recommended scope:

- Define public data version metadata.
- Define cache-busting behavior for app bundle and manual overlays.
- Add release checklist.
- Add deployment verification checklist.

## 5. Do not do next

- Do not redesign the project architecture from scratch.
- Do not remove existing editor/web functionality while refactoring.
- Do not reintroduce sample or dummy data.
- Do not treat `apps/web/public/data` as the canonical manual source.
- Do not use old documentation that says UI implementation is not allowed.
- Do not silently auto-fix risky geometry problems without user-visible diagnostics.
