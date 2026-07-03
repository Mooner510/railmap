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

## 13.22.0 rail line category and intercity policy

- `Line`은 기존 `Line -> Branch -> RouteStop -> Station` 구조를 유지하되 `category`와 `serviceTypes` 메타데이터를 가진다.
- 허용 category: `urban_rail`, `gtx`, `conventional_rail`, `high_speed_rail`.
- 허용 serviceTypes: `subway`, `gtx`, `ktx`, `srt`, `itx`, `saemaeul`, `mugunghwa`, `nuriro`, `airport_rail`, `unknown`.
- 일반철도/고속철도는 별도 거대 모델로 갈아엎지 않는다. `경부선`, `호남선`, `장항선`, `경부고속선`, `호남고속선`, `수서평택고속선` 같은 선로/노선명을 `Line`으로 사용한다.
- `KTX선`, `SRT선`은 만들지 않는다. KTX/SRT/ITX/무궁화 등은 `serviceTypes` 또는 후속 timetable metadata로 표현한다.
- 같은 물리 역이어도 노선/선로 체계가 다르면 별도 `stationId`를 만들고, 같은 물리 역 연결은 환승 그룹으로 처리한다.

## 13.23.0 manual rail line model

일반철도/고속철 공식 데이터가 도시철도 수준으로 제공되지 않는 상황을 기준으로, 다음 단계는 자동 수집기보다 수기 노선 빌더 기반으로 전환한다.

이번 단계는 UI 빌더를 한 번에 넣지 않고 안전하게 데이터 모델 기반만 추가한다.

- `manualLineDefinitions`: canonical bundle에 없는 수기 Line 생성용 source-of-truth.
- `manualBranchDefinitions`: 수기 Line의 정차역 순서/순환 여부 정의.
- `railType`: `high_speed_rail`, `semi_high_speed_rail`, `trunk_rail`, `branch_rail`, `urban_rail`.
- `serviceTypes`: KTX/SRT/ITX/새마을/무궁화/누리로/도시철도 등 서비스 메타데이터.
- 수기 노선의 정차역은 기존 stationId 재사용이 아니라, 원칙적으로 해당 노선용 별도 stationId를 `stationOverrides`로 생성한 뒤 참조한다.
- 같은 물리 역 연결은 stationId 공유가 아니라 환승 그룹으로 처리한다.

후속 단계는 editor에서 노선 이름, 색상, 철도 유형, 서비스 타입을 입력하고 지도에서 역을 연속 선택하는 builder UI다.
