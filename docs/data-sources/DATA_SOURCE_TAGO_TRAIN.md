# DATA_SOURCE_TAGO_TRAIN

Status: blocked-by-access  
Generated: 2026-06-19  
Source category: secondary/cross-check train timetable source  
Dataset: 국토교통부_(TAGO)_열차정보  
Dataset ID: 15098552

## 1. Source role

TAGO Train API is not the primary timetable source for this project.

Use this source only as a secondary or cross-check source for origin-destination train timetable lookup after access is verified.

Primary intercity/conventional rail timetable collection should continue to use `DATA_SOURCE_KORAIL_RUN.md`, because the KORAIL train operation API has already returned usable train-level and station-stop-level records with working pagination.

## 2. Officially observed service metadata

The data.go.kr page for `국토교통부_(TAGO)_열차정보` lists the following base URL and operations:

```text
Base URL:
https://apis.data.go.kr/1613000/TrainInfo

Operations:
GET /GetCtyCodeList
GET /GetStrtpntAlocFndTrainInfo
GET /GetCtyAcctoTrainSttnList
GET /GetVhcleKndList
```

Operation descriptions:

```text
/GetCtyCodeList
- 도시코드 목록 조회

/GetStrtpntAlocFndTrainInfo
- 출/도착지기반열차정보 조회
- 열차(KTX)의 출발역, 도착역 정보를 조회하는 기능 제공

/GetCtyAcctoTrainSttnList
- 시/도별 기차역 목록조회

/GetVhcleKndList
- 차량종류 목록 조회
```

## 3. Probe attempts

Observed on `2026-06-19`.

### 3.1 Incorrect/legacy path attempt

The following guessed path was attempted:

```text
https://apis.data.go.kr/1613000/TrainInfoService/getCtyCodeList
```

Observed result:

```text
API not found
```

Decision:

```text
TrainInfoService/get... must not be used unless a later official guide or successful probe confirms it.
```

### 3.2 Current official path attempt

The following official-looking path was attempted:

```text
https://apis.data.go.kr/1613000/TrainInfo/GetCtyCodeList
```

Observed result:

```text
Forbidden
```

The same access issue persisted after rechecking the official operation list.

## 4. Current status

```text
blocked-by-access
```

The endpoint path is likely correct according to the data.go.kr service metadata provided by the user, but the API call is currently blocked.

Do not keep guessing endpoint paths.

Do not implement a TAGO Train collector until a successful probe confirms the exact callable request.

## 5. Required confirmation before implementation

Before implementing any collector or probe automation for TAGO Train, obtain one of the following:

1. A successful JSON or XML response from `GetCtyCodeList`.
2. A successful JSON or XML response from `GetVhcleKndList`.
3. A copied Request URL from data.go.kr Swagger UI / 상세기능 / 데이터조회하기 that works with the issued service key.
4. Provider confirmation that the service key has access to dataset `15098552`.

## 6. Collector rule

Until access is verified:

- do not treat TAGO Train as a required source
- do not block KORAIL collector work on TAGO
- do not generate fallback data from TAGO assumptions
- do not infer TAGO station codes from KORAIL data
- do not synthesize TAGO OD timetable results
- preserve failed probe outputs under `data/probes/<acquired-date>/tago-train/`

## 7. Intended future usage after access is verified

If the API becomes callable, use it only for secondary validation:

- compare selected OD timetable results against KORAIL train operation data
- verify station naming differences
- verify vehicle type naming
- verify city and station code lists
- detect missing KORAIL-derived station mappings

TAGO must not override KORAIL records automatically.

Any conflict must be preserved as diagnostics and resolved later through local editor/admin workflow.

## 8. Probe storage

Failed and successful probe files should be stored under:

```text
data/probes/<acquired-date>/tago-train/
```

Example:

```text
data/probes/2026-06-19/tago-train/access-check/
data/probes/2026-06-19/tago-train/traininfo-path-check/
```

Probe files are not committed.

Probe scripts, if created later, may be committed only if they do not contain service keys.

## 9. Next project action

Proceed with KORAIL collector design.

TAGO Train remains documented as a blocked secondary source.
