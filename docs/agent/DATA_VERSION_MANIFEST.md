# Public data version manifest

`apps/web/public/data/data-version.json`은 public viewer가 현재 배포된 데이터 묶음을 식별하기 위한 manifest다.

- `versions.bundle`: `kric-canonical-app-bundle.json`의 생성 시각, 수집일, 파일 크기
- `versions.manualOverlay`: `manual-overlays.json`의 파일 크기와 수정 시각
- `cachePolicy.manifest`: manifest는 최신 여부 판단용이므로 CDN에서 짧게 또는 no-store로 다룬다.
- `cachePolicy.dataArtifacts`: bundle과 manual overlay는 version manifest 기준으로 변경 여부를 판단한다.

collector 실행 후 `writePublicDataVersionManifest()`가 manifest를 갱신한다.
