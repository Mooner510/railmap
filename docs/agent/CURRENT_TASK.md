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

## 13.31.0-transfer-group-review-workflow

- 환승 그룹 추천 검토 화면을 추가했다.
- 같은/비슷하게 정규화된 역명이 가까운 반경에 모인 경우 환승 그룹 후보로 추천한다.
- 추천은 검토 필요/전체/거절됨/승인됨 상태로 볼 수 있다.
- 추천 후보는 거절하거나, 수정 후 승인 흐름으로 넘길 수 있다.
- 승인 시 환승 그룹 편집 화면에서 그룹 이름/포함 역/환승 시간표를 조정한다.
- 환승 시간표는 보류 저장 가능하며, 보류된 그룹은 검증에서 가벼운 경고로 표시한다.

## 13.32.0-transfer-group-review-polish

- 환승 추천 탭 진입/후보 선택 시 후보 역 묶음 위치로 지도를 자동 fitBounds 이동.
- 환승 추천 UI의 굵은 글꼴과 불필요한 장문 설명을 줄이고, 줄바꿈이 깨지는 문구를 짧은 문구로 정리.
- Dialog를 portal 기반으로 렌더링해 사이드바/패널 내부 clipping 영향을 받지 않도록 수정.
- 환승 시간표 편집 dialog를 실제 viewport 전체 폭/높이 modal로 표시하도록 강화.
- 환승 시간표 테이블의 행/열 header 하이라이트를 유지하고, 라벨을 짧게 정리.


## 13.33.0-transfer-group-review-modal-and-map-highlight

- 환승 시간표 편집을 브라우저 전체를 덮는 화면이 아니라 넓은 중앙 모달로 정리.
- 환승 시간표 테이블을 더 flat하게 정리하고 선택 셀의 행/열 하이라이트를 유지.
- 환승 추천 후보 선택 시 후보 역을 지도에서 링/라벨로 강조.
- 환승 추천 이전/다음은 편집 화면을 열지 않고 후보 선택만 변경.
- 환승 그룹 수정 화면에 주변 후보 역을 추가할 수 있는 보조 UX 추가.


## 13.34.0-transfer-group-review-selection-polish

- 환승 그룹 편집 화면에서 포함 역 선택, 지도 이동, 제거 확인을 더 명확하게 정리했다.
- 주변 후보 역은 이름 일치/거리 정보를 함께 보여주고 바로 지도에서 확인한 뒤 추가할 수 있게 했다.
- 환승 추천 거절 시 사유를 함께 저장하고, 거절됨/승인됨 상태를 추천 카드에 표시한다.

## 13.35.0-manual-route-bulk-entry-and-transfer-review-flow

- 수기 노선 빌더에 역 이름 여러 줄 붙여넣기 modal을 추가했다.
- 붙여넣은 역 이름은 괄호 보조 표기를 제거하고 중복을 제거한 뒤, 같은 이름의 기존 역 위치/이름을 복사해 새 노선용 역 draft로 추가한다.
- 매칭되지 않는 역은 결과 메시지로 알려 주고, 기존 stationId는 재사용하지 않는다.
- 환승 그룹 편집의 `시간표는 나중에 입력하고 저장` 버튼에 저장 아이콘을 추가했다.
- 환승 추천 거절 사유 드롭다운을 기본 노출하지 않고, `거절` 클릭 시 별도 modal에서 사유 선택 후 반영하도록 변경했다.
- 거절 modal에는 `취소` 버튼을 제공해 실수로 거절 상태가 저장되지 않도록 했다.

## 13.36.0-manual-route-bulk-entry-polish-and-map-style

- 수기 노선 대량 입력에서 매칭되지 않은 역을 별도 보정 영역으로 표시한다.
- 미매칭 역은 지도에서 직접 찍거나, 기존 역 검색 결과의 위치를 복사해 새 노선용 역 draft로 추가할 수 있다.
- 레이어 탭에 지도 스타일 선택을 추가했다: 기본, 라이트, 위성.
- Dialog 공통 컴포넌트에 배경 클릭 닫기 옵션을 추가하고 주요 modal에 적용했다.
- 환승 시간표 편집 버튼명을 `편집`으로 변경했다.
- 환승 시간표 테이블의 행/열 header에 노선 색상 점을 표시해 역 소속을 더 쉽게 구분하도록 했다.

## 13.37.0 - route builder bulk correction map flow

- 대량 입력 결과를 추가/보정/제외로 나눠 표시한다.
- 이미 노선 역 목록에 있는 이름은 제외 항목으로 분리한다.
- 미매칭 역 보정 중 다음 후보로 바로 이동할 수 있게 한다.
- 기존 역 위치 복사로 보정하면 보정 수가 줄고 추가 수가 갱신된다.
- 지도에서 찍기 보정은 보정 목록에서 제거하고 지도 클릭 흐름으로 이동한다.


## 13.38.0-route-builder-bulk-import-review

- 수기 노선 대량 입력 결과를 바로 반영하지 않고 `추가 / 보정 / 제외` 리뷰 후 반영하도록 변경.
- 매칭 성공 역은 `반영 대기` 목록으로 표시하고, 사용자가 확인 후 `반영`해야 역 목록에 추가된다.
- 미매칭/중복 제외 항목은 기존처럼 별도 영역에서 확인하고 보정할 수 있다.

## 13.39.0-route-builder-bulk-import-finalize

- 수기 노선 대량 입력 modal을 두 단계로 정리했다: 왼쪽 입력/분석, 오른쪽 반영 대기/위치 보정.
- 분석 결과는 바로 역 목록에 반영하지 않고, 반영 대기 목록에서 이름 수정/삭제/순서 조정 후 반영한다.
- 미매칭 역을 기존 역 검색으로 보정하면 즉시 실제 역 목록에 넣지 않고 반영 대기 목록으로 이동한다.
- 반영 대기 목록의 역은 개별 제외, 이름 수정, 위/아래 이동이 가능하다.
- 중복/이미 추가된 역은 제외 목록에 분리하고, 보정 완료/반영 대기/제외 개수를 일관되게 표시한다.
- 반영 버튼을 누르면 반영 대기 목록만 실제 역 목록에 추가한다. 미매칭 역이 남아 있으면 modal을 유지해 이어서 보정할 수 있다.

## 13.40.0-transfer-history-and-service-timetable-foundation

- 환승 그룹 추천/승인/거절/시간표 보류 작업을 `manualTransferReviewEvents`로 기록하는 기반을 추가했다.
- 기록 탭에서 최근 환승 그룹 검토 이력을 확인할 수 있게 했다.
- 보류 저장, 추천 승인, 추천 거절, 그룹 생성/수정/삭제를 작업 이력으로 남긴다.
- `manualServicePatterns`를 추가해 물리 노선과 열차/운행계통의 정차 패턴을 분리하는 기반을 만들었다.
- `manualTrainRuns`를 추가해 열차번호별 실제 도착/출발 시각을 정차 패턴과 별도로 저장할 수 있는 기반을 만들었다.
- collector validation에서 service pattern과 train run의 line/branch/station/pattern 참조를 검증한다.
- 아직 시간표 입력 UI는 만들지 않았으며, 다음 단계에서 service pattern 생성/편집 UX를 추가한다.

## 13.41.0-service-pattern-builder-ui

- `정차 패턴` 탭을 추가했다.
- 노선/지선을 선택한 뒤 KTX, SRT, 무궁화, ITX 같은 서비스 타입별 정차 패턴을 만들 수 있게 했다.
- 물리 노선의 전체 역 목록에서 실제 정차역만 선택해 저장한다.
- 저장된 정차 패턴은 목록에서 확인하고 삭제할 수 있다.
- 정차 패턴은 아직 열차번호별 시간표가 아니며, 다음 단계의 train run / timetable 입력 UI에서 사용한다.

## 13.42.0 - train run timetable builder UI

- 정차 패턴 기반 열차 시간표 입력 UI 추가.
- 열차번호/표시 이름/운행일/역별 도착·출발 시각 저장 지원.
- 저장된 열차 시간표 목록과 삭제 기능 추가.
- 실제 경로검색 그래프 변환은 후속 단계로 분리.


## 13.43.0-timetable-validation-and-review

- 열차 시간표 저장 전 점검 카드를 추가했다.
- 저장 전 점검에서 시각 형식, 누락 시각, 역 참조, 정차 패턴 순서 불일치, 운행일/열차번호 누락을 확인한다.
- 오류가 있으면 열차 시간표 저장 버튼을 비활성화한다.
- 검증 탭에서도 저장된 정차 패턴/열차 시간표의 참조 오류, 2개 미만 정차역, 시각 형식 오류, 누락 시각, 시간 순서 이상을 확인한다.
- 시각은 `HH:mm` 형식을 기준으로 검증하며, 자정 이후 운행을 위해 24:00~47:59도 허용한다.

## 13.44.0-service-pattern-editing-ui

- 저장된 정차 패턴을 삭제만 하는 대신 다시 열어 수정할 수 있게 했다.
- 정차 패턴 목록에 수정 버튼을 추가하고, 수정 진입 시 이름/노선/지선/서비스 타입/방향/정차역/메모를 기존 값으로 채운다.
- 수정 중에는 저장 버튼 문구를 `정차 패턴 수정`으로 바꾸고, `수정 취소` 버튼으로 새 패턴 작성 상태로 되돌릴 수 있다.
- 수정 저장 시 기존 pattern id를 유지하므로 연결된 열차 시간표가 같은 정차 패턴을 계속 참조한다.
- 정차역 구성을 바꾼 경우 기존 열차 시간표는 삭제하지 않고, 검증 탭에서 시간표/정차 패턴 불일치 여부를 확인하도록 유지한다.

## 13.45.0-public-service-pattern-display

- public web 노선 상세 패널에 정차 패턴/대표 열차 시간표 요약을 읽기 전용으로 표시한다.
- 노선별 정차 패턴 수, 연결된 열차 시간표 수, 서비스 타입, 방향, 정차역 수를 확인할 수 있게 했다.
- 대표 열차는 각 정차 패턴 카드 안에 최대 3개까지 표시한다.
- 13.44.0에서 발생한 정차 패턴 수정 타입 오류를 함께 수정했다.
- 정차 패턴 수정 시 lineId/branchId/direction이 비어 있어도 안전한 기본값으로 처리한다.

## 13.46.0 - timetable graph foundation

- web에서 `manualServicePatterns`, `manualTrainRuns`가 누락되어도 빈 배열로 안전하게 처리한다.
- public 노선 상세의 정차 패턴 카드에 경로검색용 timetable graph 준비 지표를 추가한다.
- graph 지표는 역 노드 수, 정차 패턴 기반 구간 수, 시간표 기반 시간 간선 수를 계산한다.
- 실제 경로검색 알고리즘 연결은 후속 단계로 분리한다.


## 13.47.0

- 정차 패턴/열차 시간표를 경로검색용 timetable graph 구조로 변환하는 기반을 추가했다.
- 패턴 구간 edge와 실제 시간표 기반 timed edge를 분리했다.
- 아직 실제 경로검색 UI 연결은 후속 단계로 남긴다.
