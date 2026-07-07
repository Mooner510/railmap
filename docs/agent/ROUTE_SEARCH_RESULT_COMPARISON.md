# Route search result comparison

경로 후보가 2개 이상 남는 경우 결과 카드 안에서 후보 비교 표를 노출한다.

비교 기준:

- 예상 시간
- 환승 수
- 품질 진단 레벨
- 최단 시간 후보 표식
- 최소 환승 후보 표식

동일하거나 압도적인 후보 제거 정책은 기존 route result dedupe/dominance 로직을 유지한다.
