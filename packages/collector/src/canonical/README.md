# Canonical app bundle builder

KRIC 기반 도시철도 데이터를 공개 app bundle로 정규화하는 collector/build 영역입니다.

## 입력

```text
data/manual/kric-canonical-source-line-map.csv
data/manual/kric-canonical-line-colors.csv
data/manual/kric-subway-route-info-line-map.csv
data/manual/manual-overlays.json
```

현재 프로젝트 스냅샷에 따라 generated/review 파일이 추가로 필요할 수 있습니다.

## 출력

```text
data/generated/<date>/app-bundle/kric-canonical-app-bundle.json
apps/web/public/data/kric-canonical-app-bundle.json
apps/web/public/data/manual-overlays.json
```

## 생성 규칙

1. `(mreaWideCd, lnCd)`를 KRIC route API key로 사용합니다.
2. `lnCd`만 전역 key로 사용하지 않습니다.
3. canonical line과 branch를 유지합니다.
4. routeStop은 canonical line/branch context를 보존합니다.
5. source line number와 raw provenance를 보존합니다.
6. manual overlay는 마지막에 합성/복사/export합니다.
7. export 후 public data와 manual source 간 parity를 검증합니다.

## 검증 규칙

Build/export는 다음 오류를 잡아야 합니다.

- 존재하지 않는 station/line/branch 참조
- 하나의 stationId가 여러 노선 실존 역처럼 쓰이는 경우
- foreign stationId가 geometry `station` point로 들어간 경우
- 순환 노선이 외부 노선으로 branch-connect 되는 경우
- geometry가 없는 branch가 조용히 누락되는 경우
- public export에서 manual overlay가 누락되는 경우

## 금지 사항

- timetable travel time 추정 금지
- same-name station 자동 병합 금지
- source conflict 자동 승자 결정 금지
- manual overlay를 generated 값으로 덮어쓰기 금지

## 13.21 validation hardening

`validate-manual-overlay-pipeline.ts`는 collector build 직후 다음 항목을 한 번 더 확인합니다.

- `data/manual/manual-overlays.json`과 `apps/web/public/data/manual-overlays.json` parity
- generated canonical bundle과 web public bundle parity
- manual transfer/branch/geometry override의 station/branch 참조 유효성
- 순환 노선이 parent/source가 되어 외부 노선으로 결합되는 오류
- route stop은 있으나 지도에 그릴 좌표가 2개 미만인 branch
- 각 오류의 위치, 원인, 해결 방법

검증 실패 시 collector는 실패해야 하며, public web data를 조용히 배포하면 안 됩니다.
