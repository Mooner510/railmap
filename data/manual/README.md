# Manual Overlays

수동 보정 데이터는 공공 원본 데이터를 직접 수정하지 않고 `data/manual/manual-overlays.json`에서 관리한다.

현재 구조:

- `manualTransferEdges`: 역과 역 사이의 수동 환승 연결
- `stationOverrides`: 역 이름/좌표/표시 여부 수동 보정
- `branchOverrides`: 노선 구간 표시 정보 수동 보정
- `geometryOverrides`: 노선 선형 수동 보정

운영 규칙:

- `apps/web`은 읽기 전용 viewer다.
- 수동 데이터 수정은 `apps/editor`에서 한다.
- `apps/editor`는 저장 시 `data/manual/manual-overlays.json`과 `apps/web/public/data/manual-overlays.json`을 함께 갱신한다.
- `apps/web/public/data/manual-overlays.json`은 viewer 개발 서버에서 즉시 확인하기 위한 배포용 복사본이다.

수동 환승 편집:

1. `pnpm --filter editor dev`
2. `http://localhost:3001/transfers` 접속
3. 출발 환승 역과 도착 환승 역 선택
4. 환승 시간, 표시 이름, 메모 입력
5. `환승 edge 추가`
6. `manual-overlays.json 저장`
7. viewer 새로고침 후 경로 검색 확인
