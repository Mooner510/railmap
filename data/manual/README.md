# Manual overlays

공공 데이터 원본을 직접 수정하지 않고, 사람이 보정한 데이터를 별도로 저장하는 영역입니다.

`data/manual`은 수기 보정의 원본입니다. `apps/web/public/data`는 공개 web이 읽는 export 결과물입니다.

## 핵심 파일

```text
data/manual/manual-overlays.json
```

이 파일은 editor가 저장하는 주요 수기 보정 원본입니다.

public web export:

```text
apps/web/public/data/manual-overlays.json
```

collector/build/export 단계는 수기 보정 원본을 공개 web 경로로 복사하거나 동등한 결과물로 내보내야 합니다.

## manualTransferGroups

수동 환승은 개별 A-B edge가 아니라 `환승 그룹`으로 관리합니다.

- `stationIds`: 같은 환승 그룹에 포함된 노선별 역 ID 목록입니다.
- 같은 그룹 안의 역들은 항상 서로 양방향 환승 가능합니다.
- `transferMinutesByPair`: 역 쌍별 환승 시간입니다.
- key는 station id를 정렬한 뒤 `<->`로 연결합니다.
- editor/viewer는 이 그룹을 경로 탐색용 transfer edge로 변환해서 사용합니다.

환승 그룹은 물리적/운영상의 환승 관계입니다. 노선별 역 아이콘을 합치는 기능이 아닙니다.

## stationOverrides / manual stations

역 위치 보정과 수동 생성 역은 manual overlay로 저장합니다.

규칙:

1. 같은 물리 위치라도 노선이 다르면 별도 stationId를 사용합니다.
2. 하나의 stationId를 여러 노선의 실존 역처럼 공유하지 않습니다.
3. 새 역은 소속 노선/branch가 명확해야 합니다.
4. 기존 역을 다른 노선에 연결할 때는 station identity 규칙을 검증해야 합니다.

## geometryOverrides

선형 보정은 station point와 control point를 구분합니다.

- `kind: "station"`: 해당 branch/line에 실제로 속한 역입니다.
- `kind: "control"`: 선형을 잡기 위한 경유점입니다.

다른 노선 역 좌표를 모양 참고용으로 쓰는 경우에는 반드시 `control` point로 저장합니다. foreign `stationId`를 `station` point로 넣으면 검증 오류입니다.

## lineBranchOverrides

지선/노선 결합과 정차 순서 보정 정보를 저장합니다.

순환 노선 규칙:

1. 순환 노선은 마지막 역과 첫 역이 연결됩니다.
2. 순환 노선 자체가 외부 노선으로 결합되는 것은 금지합니다.
3. 일반 노선이 순환 노선의 특정 역으로 결합하는 것은 허용합니다.
4. 순환 노선 내부의 새 지선 추가는 허용합니다.

## nonTransferStationIds

`nonTransferStationIds`는 환승 그룹 후보에서 제외할 역 ID 목록입니다.

- 일반 역 검색 결과에는 표시되지 않습니다.
- editor의 미환승역 보기에서 별도로 확인할 수 있습니다.
- 환승역으로 전환하면 목록에서 제거되어 다시 환승 그룹에 추가할 수 있습니다.

## 금지 사항

- 샘플/더미 역 추가 금지
- 공공 원천 파일 직접 수정 금지
- 같은 이름이라는 이유만으로 역 병합 금지
- foreign stationId를 geometry station point로 저장 금지
- 추정 이동 시간 저장 금지

## Line metadata override

`manual-overlays.json`의 `lineMetadataOverrides`는 일반철도/고속철 확장용 노선 메타데이터를 수기 보정한다.

```json
{
  "lineId": "01:1",
  "category": "urban_rail",
  "serviceTypes": ["subway"],
  "enabled": true,
  "source": "editor",
  "note": null
}
```

고속열차 브랜드명은 Line 이름으로 쓰지 않는다. 예를 들어 `KTX선`이 아니라 `경부고속선`을 Line으로 만들고 `serviceTypes`에 `ktx`를 둔다.

## Manual rail line definitions

`manualLineDefinitions`와 `manualBranchDefinitions`는 공식 데이터로 생성되지 않는 일반철도/고속철/계획 노선의 뼈대를 수동으로 만들기 위한 구조다.

- `manualLineDefinitions`: 노선 이름, 색상, 철도 유형, 서비스 타입, 운영 상태를 정의한다.
- `manualBranchDefinitions`: 해당 노선의 정차역 순서와 순환 여부를 정의한다.
- 정차역은 `stationOverrides`에 별도 stationId로 먼저 만들어야 한다.
- 같은 물리 역이라도 노선/선로 체계가 다르면 stationId를 공유하지 않고 환승 그룹으로 묶는다.
- KTX/SRT는 Line 이름이 아니라 `serviceTypes`로 표현한다.

허용 철도 유형:

- `high_speed_rail`: 고속선
- `semi_high_speed_rail`: 준고속선
- `trunk_rail`: 간선철도
- `branch_rail`: 지선철도
- `urban_rail`: 도시철도

### 수기 노선 구축 상태와 역 목록 빌더

`manualLineDefinitions.coverageStatus`는 수기 노선의 구축 범위를 나타낸다.

- `draft`: 노선 메타데이터만 있거나 검토 전 상태.
- `partial`: 경부선처럼 큰 물리 노선을 주요역부터 부분 구축한 상태.
- `complete`: 현재 기준으로 물리 노선의 역 목록을 모두 구축한 상태.

수기 노선의 역 목록은 물리 선로/철도 노선 기준으로 만든다. 예를 들어 `경부선`에는 원칙적으로 해당 물리 구간의 역을 포함하고, KTX/SRT/무궁화/수도권 전철 같은 운행계통의 실제 정차역은 후속 service pattern/timetable 모델에서 분리한다.
