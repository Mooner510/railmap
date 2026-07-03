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

## 13.24.0 manual rail line builder UI

이번 단계는 `13.23.0`에서 추가한 수기 노선 모델을 editor에서 직접 생성할 수 있게 하는 안전한 1차 UI다.

- 지도 상단 액션에 `새 노선` 버튼을 추가한다.
- 좌측 사이드바에 `수기 노선` 탭을 추가한다.
- 새 노선 dialog에서 다음 값을 입력/선택한다.
  - 노선 이름
  - 노선 색상
  - 철도 유형: 고속선, 준고속선, 간선철도, 지선철도, 도시철도
  - 서비스 타입: 지하철, GTX, KTX, SRT, ITX, 새마을, 무궁화, 누리로, 공항철도, 미정
  - 운영 상태: 개통, 공사중, 계획, 폐지/미사용
  - 메모
- 저장 결과는 `manualLineDefinitions`에 추가한다.
- 저장 후 editor data를 reload해서 수기 노선 목록에 반영한다.
- 이번 단계에서는 아직 지도에서 역을 연속으로 찍어 정차 순서를 만드는 기능은 넣지 않는다.
- 다음 단계는 `13.25.0-manual-route-station-builder`로, 수기 노선에 역을 순서대로 추가하고 `manualBranchDefinitions`를 생성하는 기능이다.

## 13.25.0-manual-route-station-builder

- 수기 노선을 물리 선로/철도 노선 기준으로 만드는 정책을 editor UX에 반영한다.
- `coverageStatus`를 추가해 큰 일반철도 노선을 `draft`/`partial`/`complete`로 관리한다.
- 수기 노선 탭에서 노선별 `역 목록 만들기/수정`을 제공한다.
- 지도 클릭으로 시작역부터 종점역까지 수기 역을 순서대로 추가한다.
- 저장 시 다음 항목을 한 번에 생성/갱신한다.
  - `stationOverrides`: 수기 노선 전용 stationId와 좌표
  - `manualBranchDefinitions`: 해당 노선의 정차역 순서
  - `geometryOverrides`: 역 좌표를 직선 연결한 1차 선형
  - `manualLineDefinitions.coverageStatus`: 구축 상태
- KTX/SRT/무궁화/수도권 전철은 Line이 아니라 serviceTypes/후속 정차 패턴으로 분리한다.

## 13.26.0-manual-route-builder-ux-cleanup

- 지도 하단 안내/위경도 표시를 제거해 지도 공간을 확보한다.
- 수기 노선 빌더를 물리 노선 역 목록 작성에 집중하도록 단순화한다.
- 역 이름이 비어 있는 상태에서 지도 좌클릭 시 역 이름 입력 dialog를 띄우고 Enter로 즉시 추가한다.
- 수기 노선 빌더 중 지도 우클릭 시 가장 가까운 기존 역 이름을 빠른 추가 이름으로 복사한다. 이때 기존 데이터의 실제 역명은 바꾸지 않고, 복사값에서 괄호 보조 표기만 제거한다.
- 빌더 중 작성 중인 노선 preview line/station을 지도에 즉시 표시하고, 기존 노선/역/환승 아이콘은 반투명 처리한다.
- 역 목록 카드에서 위도/경도 노출을 제거하고 조밀한 목록, 순서 조정, 위치 수정 버튼을 제공한다.
- 왼쪽 사이드바 하단에 현재 모드 단축키 dock과 더보기 modal을 추가한다.

## 13.26.1-manual-route-station-move-cancel

- 수기 노선 빌더에서 `위치 수정`을 시작한 뒤 취소할 수 없던 문제를 수정한다.
- 위치 수정 중에는 상단 상태 배너에 수정 대상 역명과 `취소` 버튼을 표시한다.
- 위치 수정 중 동일 역의 위치 수정 버튼은 취소 버튼처럼 동작한다.
- `Esc` 키로 위치 수정 모드와 역 이름 입력 dialog를 취소할 수 있다.
- 단축키 dock에 `수정 취소: Esc`를 추가한다.

## 13.27.0-manual-line-review-and-validation

- 검증 탭에 `수기 노선 점검` 카테고리를 추가한다.
- 수기 노선에 역 목록이 없거나, 역이 2개 미만이거나, 저장된 역 ID/좌표가 누락된 경우를 명확히 표시한다.
- 수기 노선 안에서 같은 역 ID 또는 같은 역명이 반복되는 경우 주의로 표시한다.
- 같은 이름의 다른 역이 있는 경우 환승 그룹 후보로 안내한다. 단, 같은 물리 역인지 여부는 사용자가 판단한다.
- 수기 노선 역 목록 빌더 안에 저장 전 점검 요약 카드를 추가해 역 수, 이름 누락, 좌표 누락, 중복명, 완성도를 바로 확인할 수 있게 한다.

## 13.28.0-manual-route-builder-mode-hardening

- route builder를 전용 작업 모드처럼 보이도록 정리했다.
- 역 목록 완성도를 버튼 3개에서 드롭다운으로 바꿨다.
- `빠른 추가 이름`을 `다음 역 이름` 입력으로 바꿨다.
- 역 목록에서 위/아래/삭제 버튼을 제거하고 드래그 재정렬 + 드래그 제거 영역으로 바꿨다.
- 역 이름은 목록에서 바로 클릭해 수정하고, 위치 수정은 단일 수정 아이콘으로 유지했다.
- 역명 입력 modal에 주변 역 이름 추천 3개를 표시한다. 추천 이름은 괄호 보조 표기를 제거하고 중복 제거한다.
- 단축키 더보기 modal을 사이드바 내부가 아닌 넓은 전체화면형 modal로 바꿨다.
- 환승 시간표 편집 modal을 전체화면형으로 바꾸고 선택 셀의 행/열 header를 하이라이트한다.

## 13.30.0-existing-station-position-clone-and-drag-move

- 수기 노선 빌더에서 기존 역을 클릭하면 기존 `stationId`를 재사용하지 않고 이름/좌표만 복사해 새 노선용 역 draft를 추가한다.
- 복사된 역 이름은 괄호 보조 표기를 제거한 값으로 제안하되, 기존 역 데이터 자체는 수정하지 않는다.
- 지도 우클릭은 가장 가까운 기존 역의 이름/좌표를 새 노선용 역으로 복사한다.
- `Shift+우클릭`은 기존처럼 이름만 `다음 역 이름` 입력에 복사한다.
- 빌더에서 추가한 역 preview point를 직접 드래그해 실제 승강장 위치로 미세 조정할 수 있다.
- 저장 시 복사 원본 역 ID는 새 수기 역의 stationId로 사용하지 않는다. 새 노선 전용 stationId는 기존 정책대로 저장 단계에서 생성한다.
