# Public Data Version Manifest

## 현재 스키마

`apps/web/public/data/data-version.json`의 `schemaVersion`은 2다.

## 버전 판정

파일 크기와 수정 시각만으로 변경 여부를 판단하지 않는다.

- canonical bundle SHA-256
- manual overlay SHA-256
- 두 해시로 만든 16자리 `releaseId`

웹 데이터 배지는 release ID와 각 파일 해시 앞 12자리를 tooltip으로 제공한다.

## 캐시 정책

- manifest: `no-store`
- 데이터 artifact: 콘텐츠 해시 기준 버전 판정
- bundle과 manual overlay 중 하나라도 바뀌면 release ID가 바뀐다.
