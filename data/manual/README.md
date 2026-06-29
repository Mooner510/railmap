# Manual overlays

공공 데이터 원본을 직접 수정하지 않고, 사람이 보정한 데이터를 별도로 저장하는 영역입니다.

## manual-overlays.json

### manualTransferGroups

수동 환승은 개별 A-B edge가 아니라 `환승 그룹`으로 관리합니다.

- `stationIds`: 같은 환승 그룹에 포함된 역 목록입니다.
- 같은 그룹 안의 역들은 항상 서로 양방향 환승 가능합니다.
- `transferMinutesByPair`: 역 쌍별 환승 시간입니다. key는 station id를 정렬한 뒤 `<->`로 연결합니다.
- editor에서 저장하면 viewer는 이 그룹을 경로 탐색용 transfer edge로 변환해서 사용합니다.

샘플 데이터는 넣지 않습니다. 실제 보정은 `apps/editor`의 `/transfers`에서 추가합니다.

## 미환승역(nonTransferStationIds)

`nonTransferStationIds`는 환승 그룹 후보에서 제외할 역 ID 목록입니다.

- 일반 역 검색 결과에는 표시되지 않습니다.
- editor의 `미환승역만 보기`를 켜면 별도로 확인할 수 있습니다.
- `환승역으로 전환`을 누르면 목록에서 제거되어 다시 환승 그룹에 추가할 수 있습니다.

