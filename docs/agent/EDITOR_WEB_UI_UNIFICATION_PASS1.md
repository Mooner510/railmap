# Editor/Web UI 통일 1차

## 범위

- Editor의 조밀한 패널·검색·타이포그래피 방향을 Web에 적용한다.
- 두 앱의 기본 글자 크기와 공통 색상·테두리·radius·shadow token을 `packages/ui`에서 공유한다.
- 검색 입력과 검색 결과 카드의 공통 컴포넌트를 `packages/ui`로 이동한다.
- 기본 노선선의 흰색 casing을 제거하고 노선 폭·역명 zoom·역명 크기·halo 정책을 공통화한다.

## 공통 모듈

- `@repo/ui/rail-product`
  - `RailSearchField`
  - `RailSearchResultCard`
  - `RailSectionHeader`
- `@repo/ui/rail-product-theme.css`
- `RAIL_MAP_VISUAL_POLICY`

## 지도 표시 정책

- 기본 노선선에는 흰색 외곽선을 표시하지 않는다.
- 기본 노선 폭은 3px, 선택 노선은 6px을 기준으로 한다.
- 일반 역명은 zoom 11.5부터 표시한다.
- 일반 역명은 11px, 선택 역명은 12px을 기준으로 한다.
- Editor와 Web에서 같은 공통 정책을 참조한다.

## 후속

1차에서는 기존 기능과 화면 구조를 유지하면서 시각 기반과 공통 검색 컴포넌트를 통일한다. 다음 피드백 이후 패널 구조, 결과 카드, 선택 상세, 모바일 레이아웃을 단계적으로 공통 컴포넌트로 옮긴다.
