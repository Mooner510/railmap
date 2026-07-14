# Transfer recommendation component split (13.121.0-13.123.0)

- 환승 추천 목록과 거절 모달을 `TransferGroupReviewPanel`로 분리했다.
- 추천 필터링과 가장 가까운 미검토 추천 선택을 `transferRecommendation` 모듈로 분리했다.
- 추천 목록 필터 결과와 거절 key 집합을 memoization해 관련 없는 에디터 상태 변경 시 계산량을 줄였다.
- 저장 후 다음 추천 선택 기준은 거리, 추천 강도, 그룹 최대 거리 순서를 유지한다.
- 기존 미완성 환승 시간표 확인과 저장/보류 정책은 유지한다.
