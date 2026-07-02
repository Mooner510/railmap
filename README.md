# railmap

한국 철도/도시철도 지도와 정적 시간표 기반 경로 탐색을 위한 모노레포입니다.

이 프로젝트는 공공/공식 원천 데이터를 보존하고, 로컬 에디터에서 사람이 수동 보정한 내용을 최종 공개 web 데이터에 합성하는 구조를 사용합니다. 샘플/더미/추정 데이터는 사용하지 않습니다.

## 현재 구현 범위

- `apps/editor`: 로컬 전용 편집기
  - 지도 기반 역 위치 보정
  - 환승 그룹 편집
  - 선형/지선/노선 결합 보정
  - 새 역 생성 및 기존 역 노선 연결
  - 순환 노선 토글
  - 검증/자동 해결 패널
  - 변경 내역/스냅샷 관리
- `apps/web`: 공개 지도
  - 한국 철도/도시철도 지도 표시
  - 노선/역/환승 그룹 선택
  - 공개 사용자용 HUD
  - 선택 정보 패널
  - 노선 미니 프리뷰와 환승 그룹 시각 카드
- `packages/collector`: 원천 데이터 수집/정규화/검증
  - KRIC canonical bundle 생성
  - manual overlay export
  - station-line identity validation
- `packages/ui`: 공통 UI와 지도 렌더링 정책
- `data/manual`: 사람이 관리하는 수기 보정 원본

## 절대 데이터 규칙

1. 샘플/더미/테스트 교통 데이터는 만들지 않습니다.
2. 실제 시간표가 없는 이동 시간은 추정하지 않습니다.
3. 하나의 `stationId`를 여러 노선의 실존 역처럼 공유하지 않습니다.
4. 같은 물리 위치의 환승역이라도 노선별 역 아이콘/역사는 별도로 둡니다.
5. 다른 노선의 역 좌표를 선형 경유점으로만 사용할 때는 `station`이 아니라 `control` point로 저장합니다.
6. 순환 노선은 그 노선 자체가 외부 노선으로 결합되는 것을 금지합니다.
7. 일반 노선이 순환 노선의 특정 역으로 결합하는 것은 허용합니다.
8. 수기 보정 원본은 `data/manual`입니다.
9. `apps/web/public/data`는 공개 web이 읽는 export 결과물입니다.
10. 원천 파일과 raw snapshot은 수정하지 않습니다.

## 디렉터리 구조

```text
apps/
  editor/                 로컬 편집기
  web/                    공개 지도
packages/
  collector/              수집/정규화/검증
  ui/                     공통 UI와 지도 렌더링 정책
data/
  manual/                 수기 보정 원본
  raw/                    원천 파일 스냅샷
  generated/              생성 산출물
docs/
  agent/                  에이전트 작업 규칙과 현재 작업
  collector/              raw snapshot 정책
  data-sources/           데이터 출처 문서
```

## 자주 쓰는 명령

프로젝트 루트에서 실행합니다.

```sh
pnpm install
pnpm dev
pnpm check-types
pnpm build
```

앱별 확인:

```sh
pnpm --filter editor check-types
pnpm --filter web check-types
pnpm --filter collector check-types
```

개발 서버:

```sh
pnpm --filter editor dev
pnpm --filter web dev
```

## 데이터 파이프라인

기본 흐름은 다음과 같습니다.

```text
raw/source files
  -> collector parse/normalize
  -> generated canonical app bundle
  -> data/manual manual overlays 합성
  -> apps/web/public/data export
  -> editor/web에서 확인
```

현재 중요한 파일:

```text
data/manual/manual-overlays.json
apps/web/public/data/manual-overlays.json
apps/web/public/data/kric-canonical-app-bundle.json
```

`data/manual/manual-overlays.json`은 사람이 관리하는 원본입니다. collector/build 과정은 이 파일을 공개 web 경로로 export해야 합니다.

## 편집기 사용 순서

1. editor 실행
2. 지도에서 노선/역 확인
3. 필요한 경우 역 위치, 환승 그룹, 선형, 지선, 순환 노선 설정을 수정
4. 검증 탭에서 오류/주의를 확인
5. 자동 해결 가능한 항목은 개별 해결 또는 가능한 것 모두 해결 사용
6. web에서 공개 화면 반영 확인
7. 변경 내역과 스냅샷을 확인한 뒤 커밋

## 새 역/기존 역 연결 기준

- 새 역 생성: 역 이름과 삽입 구간을 고른 뒤 지도에서 위치를 클릭합니다.
- 기존 역 연결: 이미 좌표가 있으므로 위치를 다시 찍지 않고 선택한 구간에 바로 연결합니다.
- 삽입 구간은 ㄹ자 노선도에서 역 사이 선을 선택합니다.
- 순환 노선은 마지막 역과 첫 역 사이 구간도 선택 대상으로 표시됩니다.

## 지선/노선 결합 기준

- 순환 노선 자체가 외부 노선으로 결합되는 것은 금지합니다.
- 일반 노선의 시작/끝 역이 순환 노선의 역으로 결합하는 것은 허용합니다.
- 순환 노선 내부에서 새 지선을 추가하는 것은 허용합니다.
- 기존 잘못된 결합은 검증 탭에서 오류로 표시하고, 자동 해결 가능한 경우 제거할 수 있습니다.

## 문서 우선순위

작업 전 우선 읽을 문서:

1. `docs/agent/AGENT_RULES.md`
2. `docs/agent/CURRENT_TASK.md`
3. `docs/agent/COLLECTOR_CONTRACT.md`
4. 관련 `docs/data-sources/*`
5. `data/manual/README.md`

문서와 코드가 다르면 현재 코드를 확인한 뒤 문서를 갱신합니다. 오래된 문서 문구를 기준으로 구현을 되돌리지 않습니다.
