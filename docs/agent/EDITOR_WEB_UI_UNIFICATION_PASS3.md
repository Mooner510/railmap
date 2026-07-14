# Editor / Web UI Unification Pass 3

버전: `13.88.0-13.90.0`

## 적용 내용

- Web 검색/필터 블록을 `RailFilterControls.tsx`로 분리했다.
- 공통 chip, toggle, action button을 `packages/ui`로 이동했다.
- Web 권역/철도 유형/지도 표시/기본 액션이 공통 컴포넌트를 사용한다.
- 검색 결과 역 색상은 존재하지 않는 `RailMapStation.colorHex`가 아니라 실제 정차 branch 색상으로 계산한다.
- 역이 여러 노선에 속하면 첫 번째 실제 정차 branch 색상을 사용하고, 연결 정보가 없으면 중립색을 사용한다.

## 다음 분리 대상

- 선택 역 상세 패널
- 선택 노선 상세 패널
- 경로검색 입력 및 결과 패널
- 지도 source/layer factory
