# Station-line split review

노선별 stationId 분할은 중앙 미리보기 모달에서 실행한다.

## 미리보기

- 현재 stationId를 유지할 대표 노선을 사용자가 직접 선택한다.
- 나머지 노선은 새 stationId 생성 대상으로 표시한다.
- 영향을 받는 정차 패턴 수와 열차 시간표 수를 표시한다.
- 실행 후 같은 물리 역 환승 그룹에 포함되고 환승 시간표가 보류된다는 점을 경고한다.

## 실행 정책

- 선택한 대표 노선만 기존 stationId를 유지한다.
- 다른 노선의 branch route, geometry, branch connection, service pattern, train run 참조를 새 stationId로 교체한다.
- 생성된 역은 기존 환승 그룹에 추가하거나 새 환승 그룹을 만든다.
- 생성/추가된 환승 조합은 시간표 보류 상태로 둔다.
- 실행은 overlay command history에 기록한다.

같은 물리 역이어도 노선/선로 체계가 다르면 stationId를 분리하고, 연결은 환승 그룹으로 처리한다.
