TODO

canonical bundle 생성기

입력
- kric-canonical-source-line-map.csv
- kric-route-stop-station-review.candidate.csv

출력
- kric-canonical-app-bundle.json

생성 규칙

1. canonicalKey 기준 그룹핑
2. main/branch 유지
3. station dedupe
4. routeStop은 canonicalLineId 저장
5. sourceLineNumber 저장
