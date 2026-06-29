# Manual Overlay

공공 원본 데이터는 직접 수정하지 않고, 사람이 보정한 데이터만 이 디렉터리에 둡니다.

현재 스키마는 `manual-overlays.json` 하나로 시작합니다.

- `stationOverrides`: 역 좌표/표시명 보정
- `branchOverrides`: 노선/구간 표시 보정
- `transferEdges`: 수동 환승 연결
- `geometryOverrides`: 수동 선형 보정점

`apps/web/public/data/manual-overlays.json`는 viewer 검증용 복사본입니다.
나중에는 collector 또는 local-editor가 `data/manual/manual-overlays.json`를 읽어 app bundle/public data로 병합합니다.
