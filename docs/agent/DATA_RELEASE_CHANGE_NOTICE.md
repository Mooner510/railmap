# Data release change notice

- web은 마지막으로 확인한 `releaseId`를 브라우저 localStorage에 기록한다.
- 이후 다른 `releaseId`가 로드되면 데이터 버전 배지를 `데이터 업데이트` 상태로 표시한다.
- Cloudflare Pages `_headers`는 manifest를 no-store로, JSON 데이터 artifact를 must-revalidate로 제공한다.
