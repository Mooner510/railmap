# Station-line split review

노선별 stationId 분할은 실행 전에 미리보기 메시지를 표시한다.

미리보기 항목:

- 기존 stationId를 유지할 대표 노선
- 새 stationId를 만들 노선 목록
- 정차 패턴 영향 개수
- 열차 시간표 영향 개수
- 생성 후 환승 그룹 처리 방식

분할 정책은 유지된다. 같은 물리 역이라도 노선/선로 체계가 다르면 stationId를 분리하고, 연결은 환승 그룹으로 처리한다.
