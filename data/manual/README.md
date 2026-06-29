# Manual overlays

공공 원본 데이터는 수정하지 않고, 사람이 보정한 데이터만 여기에 둔다.

## manual-overlays.json

- `manualTransferEdges`: 실제 환승 가능하지만 원본 데이터에 없는 역-역 환승 연결
- `stationOverrides`: 역 이름/좌표 등 수동 보정 예정
- `branchOverrides`: 노선/구간 표시명 등 수동 보정 예정
- `geometryOverrides`: 노선 선형 수동 보정 예정

현재 viewer는 `apps/web/public/data/manual-overlays.json`을 읽어 `manualTransferEdges`를 경로 graph에 병합한다.
local-editor는 이후 `data/manual/manual-overlays.json`을 편집하고 public 데이터로 동기화하는 방식으로 연결한다.
