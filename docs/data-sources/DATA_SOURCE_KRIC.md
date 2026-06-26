# DATA_SOURCE_KRIC

Status: source-design ready, verified sample, bulk verification deferred  
Generated: 2026-06-23  
Source IDs:

```text
kric_urban_rail_xlsx_20260228
kric_openapi_trainUseInfo_subwayRouteInfo_20260623_probe
```

Scope: Korean urban rail line, station, ordered route sequence, and static operation timetable source.

## 1. Summary

KRIC is accepted as the primary Stage 1 source family for Korean urban rail data.

This document covers two KRIC source forms:

1. KRIC standard XLSX files already acquired for all urban rail line, station, and operation data.
2. KRIC Rail Portal OpenAPI `trainUseInfo/subwayRouteInfo`, now verified with a successful sample response.

The XLSX files remain the broader raw snapshot source for:

- urban rail station metadata;
- urban rail line metadata;
- static train operation/timetable rows;
- station-level coordinates from the station table;
- Korean and English station names where present;
- initial routing data for urban rail only.

The OpenAPI `subwayRouteInfo` source is accepted as a verified supplementary source for:

- ordered station sequence by metropolitan area code and line code;
- route code/name confirmation;
- operator institution code confirmation;
- validation against the XLSX `정거장구성` field.

This source family is not sufficient for:

- railway geometry/track alignment;
- high-speed/general railway national timetable coverage;
- fare calculation;
- manual transfer time matrix;
- construction/planned lines;
- verified multilingual coverage beyond values present in the files or API;
- travel-time prediction from geometry or speed.

Routing must use actual timetable stop rows only. Do not infer travel time from speed, geometry, or route order alone.

## 2. Raw snapshot rule

The snapshot directory date must be the local acquisition date, not the source data reference date and not the date embedded in a filename.

Recommended placement for the existing acquired files:

```text
data/raw/2026-06-19/kric/전체_도시철도운행정보_20260228.xlsx
data/raw/2026-06-19/kric/전체_도시철도역사정보_20260228.xlsx
data/raw/2026-06-19/kric/전체_도시철도노선정보_20260228.xlsx
```

Recommended placement for OpenAPI probes:

```text
data/probes/2026-06-23/kric/subway-route-info/kric-subway-route-info-mreaWideCd-01-lnCd-A1.json
data/probes/2026-06-23/kric/subway-route-info/kric-subway-route-info-mreaWideCd-01-lnCd-A1.status.txt
data/probes/2026-06-23/kric/subway-route-info/kric-subway-route-info-mreaWideCd-01-lnCd-A1.request-redacted.txt
data/probes/2026-06-23/kric/subway-route-info/kric-subway-route-info-mreaWideCd-01-lnCd-A1.summary.json
```

If a full OpenAPI collection is later performed, raw API responses should be stored under:

```text
data/raw/<acquired-date>/kric/openapi/trainUseInfo/subwayRouteInfo/
```

Service keys must never be written to raw, probe, collected, generated, git, logs, or documentation files.

## 3. Existing XLSX raw files

| Raw file | Size | SHA256 | Required action |
|---|---:|---|---|
| `전체_도시철도운행정보_20260228.xlsx` | 17,451,829 bytes | `3cd6cb32f0833f384041ad79760c6e85ecea9b4aeaf9ebea4e986ee9ebe61d3c` | Preserve as raw snapshot |
| `전체_도시철도역사정보_20260228.xlsx` | 573,093 bytes | `f99bc832bd6c3caffcb217319f46a0deeae1c1e76e49bc01d00585003b8650f3` | Preserve as raw snapshot |
| `전체_도시철도노선정보_20260228.xlsx` | 28,605 bytes | `b7c0104356546b3b19b82395660d42a85cf35a4ed9d602f337e7e221eabdab6c` | Preserve as raw snapshot |

## 4. Observed XLSX workbook structure

### 4.1 `전체_도시철도운행정보_20260228.xlsx`

Observed sheet:

```text
표준데이터 운행(전체)
```

Observed worksheet range:

```text
A1:O223025
```

Observed columns:

| Column | Meaning | Collector rule |
|---|---|---|
| `열차번호` | Train number | Preserve raw string/value |
| `노선번호` | Line number | Preserve raw; use as source line identifier candidate |
| `노선명` | Line name | Preserve raw; candidate display name |
| `운행구간기점명` | Operation section origin | Preserve raw |
| `운행구간종점명` | Operation section destination | Preserve raw |
| `운행유형` | Operation type | Preserve raw |
| `요일구분` | Day type | Preserve raw; normalize only after value analysis |
| `운행구간정거장` | Stop/station in operation sequence | Preserve raw; candidate stop sequence key |
| `정거장도착시각` | Arrival time | Preserve raw; parse into structured time candidate |
| `정가장출발시각` | Departure time; source typo likely | Preserve exact header. Do not silently rename in raw model |
| `운행속도` | Operation speed | Preserve raw; do not use for travel-time prediction |
| `운영기관전화번호` | Operator phone | Preserve raw |
| `데이터기준일자` | Data reference date | Preserve raw; parse separately |

Notes:

- Some time/date values may be Excel serial values. Store both `rawValue` and `parsedValue`.
- Do not infer missing timetable rows.
- Do not calculate travel time from speed. Routing must use actual timetable stop times only.

### 4.2 `전체_도시철도역사정보_20260228.xlsx`

Observed sheet:

```text
표준데이터 역사
```

Observed worksheet range:

```text
A1:O1100
```

Observed columns:

| Column | Meaning | Collector rule |
|---|---|---|
| `역번호` | Station number | Preserve raw; candidate station-line identifier |
| `역사명` | Korean station name | Candidate `name.ko` |
| `노선번호` | Line number | Preserve raw; join candidate with line file |
| `노선명` | Line name | Preserve raw |
| `영문역사명` | English station name | Candidate `name.en` if non-empty |
| `한자역사명` | Hanja station name | Preserve as source field; do not map automatically to zh/ja |
| `환승역구분` | Transfer-station flag | Transfer hint only; not final transfer group |
| `환승노선번호` | Transfer line number(s) | Transfer hint only |
| `환승노선명` | Transfer line name(s) | Transfer hint only |
| `역위도` | Station latitude | Candidate coordinate |
| `역경도` | Station longitude | Candidate coordinate |
| `운영기관명` | Operator name | Preserve raw |
| `역사도로명주소` | Road-name address | Preserve raw |
| `역사전화번호` | Station phone | Preserve raw |
| `데이터기준일자` | Data reference date | Preserve raw; parse separately |

Notes:

- One row should be treated as one station-on-line source record, not necessarily a globally merged station.
- Same-name stations across different lines must not be automatically merged.
- Transfer groups must be created/edited in the local editor.

### 4.3 `전체_도시철도노선정보_20260228.xlsx`

Observed sheet:

```text
표준데이터 노선(전체)
```

Observed worksheet range:

```text
A1:K48
```

Observed columns:

| Column | Meaning | Collector rule |
|---|---|---|
| `노선번호` | Line number | Preserve raw; candidate line identifier |
| `노선명` | Line name | Candidate `line.name.ko` |
| `기점명` | Origin station | Preserve raw |
| `종점명` | Terminal station | Preserve raw |
| `정거장구성` | Station composition string | Preserve raw; parse into ordered candidate sequence with validation |
| `노선연장` | Line length | Preserve raw; parse numeric candidate separately |
| `개통일자` | Opening date | Preserve raw; parse candidate date separately |
| `운영기관명` | Operator name | Preserve raw |
| `운영기관전화번호` | Operator phone | Preserve raw |
| `데이터기준일자` | Data reference date | Preserve raw; parse separately |

Notes:

- `정거장구성` may use comma-separated station tokens such as `A01-서울,A02-공덕,...`.
- Some rows may use `+` or inconsistent separators. Parser must record parse diagnostics.
- Date formats may mix Excel serial values and strings such as `2024.12.18` or `22.05.28`. Store raw string/value and parse status.

## 5. Verified OpenAPI: `trainUseInfo/subwayRouteInfo`

### 5.1 Service identity

```text
Portal/service family: KRIC Rail Portal OpenAPI
Service ID: trainUseInfo
Operation ID: subwayRouteInfo
Request URL: https://openapi.kric.go.kr/openapi/trainUseInfo/subwayRouteInfo
```

Official purpose:

```text
도시철도 운영기관 및 노선에 따른 상행에서 하행까지의 노선구성역명 정보
```

### 5.2 Request parameters observed

The successful probe used:

```text
serviceKey=<REDACTED>
format=json
mreaWideCd=01
lnCd=A1
```

Redacted request:

```text
GET https://openapi.kric.go.kr/openapi/trainUseInfo/subwayRouteInfo?serviceKey=<REDACTED>&format=json&mreaWideCd=01&lnCd=A1
```

Observed metadata:

```text
acquiredDate=2026-06-23
service=trainUseInfo
operation=subwayRouteInfo
mreaWideCd=01
lnCd=A1
```

### 5.3 Probe result

Observed HTTP status:

```text
200
```

Observed response header:

```json
{
  "resultCnt": 14,
  "resultCode": "00",
  "resultMsg": "정상 처리되었습니다."
}
```

Observed top-level response shape:

```text
header: object
body: array
```

Observed first row:

```json
{
  "mreaWideCd": "01",
  "routCd": "A1",
  "routNm": "공항",
  "stinConsOrdr": 1,
  "railOprIsttCd": "AR",
  "lnCd": "A1",
  "stinCd": "A01",
  "stinNm": "서울역"
}
```

Observed last row:

```json
{
  "mreaWideCd": "01",
  "routCd": "A1",
  "routNm": "공항",
  "stinConsOrdr": 14,
  "railOprIsttCd": "AR",
  "lnCd": "A1",
  "stinCd": "A11",
  "stinNm": "인천공항2터미널"
}
```

### 5.4 Observed output fields

| Field | Observed example | Meaning | Collector rule |
|---|---|---|---|
| `mreaWideCd` | `01` | Metropolitan/wide area code | Preserve raw; candidate route-area key |
| `routCd` | `A1` | Route code | Preserve raw; compare with `lnCd` and XLSX line number |
| `routNm` | `공항` | Route name | Candidate Korean route name; do not auto-translate |
| `stinConsOrdr` | `1` | Station construction/order sequence | Parse as integer; preserve raw value too |
| `railOprIsttCd` | `AR` | Rail operator institution code | Preserve raw; candidate operator code |
| `lnCd` | `A1` | Line code | Preserve raw; input key and source line candidate |
| `stinCd` | `A01` | Station code | Preserve raw; candidate station-on-line key |
| `stinNm` | `서울역` | Station name | Candidate Korean station name |

### 5.5 Observed station sequence for `mreaWideCd=01`, `lnCd=A1`

| Order | Station code | Station name |
|---:|---|---|
| 1 | `A01` | 서울역 |
| 2 | `A02` | 공덕 |
| 3 | `A03` | 홍대입구 |
| 4 | `A04` | 디지털미디어시티 |
| 5 | `A042` | 마곡나루 |
| 6 | `A05` | 김포공항 |
| 7 | `A06` | 계양 |
| 8 | `A07` | 검암 |
| 9 | `A071` | 청라국제도시 |
| 10 | `A072` | 영종 |
| 11 | `A08` | 운서 |
| 12 | `A09` | 공항화물청사 |
| 13 | `A10` | 인천공항1터미널 |
| 14 | `A11` | 인천공항2터미널 |

### 5.6 Confirmed `mreaWideCd` value set and line mapping allowlist

The `mreaWideCd` request parameter is the KRIC subway wide-area region code.

Confirmed complete value set:

| `mreaWideCd` | Region |
|---|---|
| `01` | 수도권 |
| `02` | 부산 |
| `03` | 대구 |
| `04` | 광주 |
| `05` | 대전 |

The project uses the following manually reviewed `lnCd` to `mreaWideCd` allowlist for `subwayRouteInfo` request planning.

| `mreaWideCd` | Region | `lnCd` | Line name |
|---|---|---|---|
| `01` | 수도권 | `A` | GTX-A |
| `01` | 수도권 | `K5` | 경강선 |
| `01` | 수도권 | `K4` | 경의중앙선 |
| `01` | 수도권 | `K2` | 경춘선 |
| `01` | 수도권 | `A1` | 공항철도 |
| `01` | 수도권 | `G1` | 김포골드라인 |
| `01` | 수도권 | `1` | 1호선 |
| `01` | 수도권 | `2` | 2호선 |
| `01` | 수도권 | `3` | 3호선 |
| `01` | 수도권 | `4` | 4호선 |
| `01` | 수도권 | `5` | 5호선 |
| `01` | 수도권 | `6` | 6호선 |
| `01` | 수도권 | `7` | 7호선 |
| `01` | 수도권 | `8` | 8호선 |
| `01` | 수도권 | `9` | 9호선 |
| `01` | 수도권 | `K1` | 수인분당선 |
| `01` | 수도권 | `D1` | 신분당선 |
| `01` | 수도권 | `L1` | 신림선 |
| `01` | 수도권 | `E1` | 용인에버라인 |
| `01` | 수도권 | `UI` | 우이신설선 |
| `01` | 수도권 | `U1` | 의정부 경전철 |
| `01` | 수도권 | `I1` | 인천1호선 |
| `01` | 수도권 | `I2` | 인천2호선 |
| `01` | 수도권 | `M1` | 자기부상 |
| `01` | 수도권 | `WS` | 서해선 |
| `02` | 부산 | `1` | 부산1호선 |
| `02` | 부산 | `2` | 부산2호선 |
| `02` | 부산 | `3` | 부산3호선 |
| `02` | 부산 | `4` | 부산4호선 |
| `02` | 부산 | `B1` | 부산김해경전철 |
| `03` | 대구 | `1` | 대구1호선 |
| `03` | 대구 | `2` | 대구2호선 |
| `03` | 대구 | `3` | 대구3호선 |
| `04` | 광주 | `1` | 광주1호선 |
| `05` | 대전 | `1` | 대전1호선 |

Important key rule:

```text
lnCd is not globally unique.
Use (mreaWideCd, lnCd) as the API route key.
```

Examples of repeated `lnCd` values:

- `1` exists in 수도권, 부산, 대구, 광주, and 대전.
- `2` exists in 수도권, 부산, and 대구.
- `3` exists in 수도권, 부산, and 대구.
- `4` exists in 수도권 and 부산.

Therefore, collector code must never use `lnCd` alone as a global route identifier. Use `mreaWideCd + lnCd`, and retain line name/operator context for diagnostics.

### 5.7 API collector rule

The `subwayRouteInfo` collector may be implemented from the confirmed allowlist above.

Allowed line-code enumeration strategies:

1. Use the manually reviewed `(mreaWideCd, lnCd)` allowlist in this document or its committed CSV/JSON equivalent under `data/manual/`.
2. Cross-check allowlist entries against the KRIC operator/station code workbook.
3. Use another verified KRIC OpenAPI endpoint if later confirmed.

Disallowed strategies:

- do not guess `lnCd` values;
- do not crawl arbitrary codes blindly;
- do not infer active construction/planned lines from failed or empty responses;
- do not store or log service keys;
- do not let API route order overwrite XLSX route order without diagnostics.

### 5.8 Conflict handling with XLSX line composition

`subwayRouteInfo` and XLSX `정거장구성` should be treated as separate source observations.

If both sources provide an ordered station sequence for the same line:

1. Preserve both raw observations.
2. Emit a comparison diagnostic.
3. Mark exact match, missing station, extra station, order mismatch, station-code mismatch, or station-name mismatch.
4. Do not automatically resolve conflicts.
5. Let the local editor/admin workflow pick the final canonical order.

API freshness should not automatically win over XLSX. XLSX snapshot and API response may have different reference dates and different coverage assumptions.

## 6. Normalized candidate records

The collector may emit candidate records, but each must retain a source pointer to the raw row or raw API response item.

Recommended candidate categories:

```text
KricUrbanLineRaw
KricUrbanStationRaw
KricUrbanOperationRaw
KricUrbanLineCandidate
KricUrbanStationOnLineCandidate
KricUrbanTimetableStopCandidate
KricSubwayRouteInfoResponseRaw
KricSubwayRouteInfoItemRaw
KricSubwayRouteSequenceCandidate
```

Each XLSX raw row should include:

```json
{
  "sourceId": "kric_urban_rail_xlsx_20260228",
  "sourceFile": "...xlsx",
  "sheetName": "...",
  "rowNumber": 2,
  "raw": {},
  "parseDiagnostics": []
}
```

Each OpenAPI item should include:

```json
{
  "sourceId": "kric_openapi_trainUseInfo_subwayRouteInfo",
  "acquiredDate": "2026-06-23",
  "request": {
    "url": "https://openapi.kric.go.kr/openapi/trainUseInfo/subwayRouteInfo",
    "queryRedacted": {
      "serviceKey": "<REDACTED>",
      "format": "json",
      "mreaWideCd": "01",
      "lnCd": "A1"
    }
  },
  "responseHeader": {
    "resultCnt": 14,
    "resultCode": "00",
    "resultMsg": "정상 처리되었습니다."
  },
  "itemIndex": 0,
  "raw": {},
  "parseDiagnostics": []
}
```

## 7. Language policy

- Store Korean and English names only when present in source fields.
- Preserve Hanja as a source field.
- Do not auto-generate Japanese or Chinese names from Hanja or from Korean.
- Do not translate `routNm` or `stinNm` from OpenAPI output.
- If downstream schema requires language completeness, report missing languages in `missingLanguages`.

## 8. Conflict policy

The collector must not resolve conflicts between KRIC XLSX, KRIC OpenAPI, OSM, KORAIL, TAGO, or manual records.

It must emit all candidates with source pointers. Merge/pick/omit decisions belong to the local editor/admin layer.

Examples of conflicts that must be diagnostic-only:

- same station code with different station name;
- same station name with different code;
- different station order between XLSX `정거장구성` and OpenAPI `stinConsOrdr`;
- API route exists but XLSX route is missing;
- XLSX route exists but API route response is empty;
- route name differs between `노선명` and `routNm`.

## 9. License and publication note

KRIC Rail Portal OpenAPI is publicly listed, but public redistribution terms must be reviewed before production publication.

Until licensing is explicitly reviewed, this source is allowed for local research, collector design, and internal build experiments only.

Do not publish bundled raw KRIC files or raw API responses in the public app repository unless redistribution rights are confirmed.

## 10. Deferred verification and implementation-time checks

No additional API calls are required for source documentation.

The current source-design status is:

```text
verified-sample + documented route allowlist
```

The project has already verified:

1. `trainUseInfo/subwayRouteInfo` endpoint identity.
2. service-key access for one representative route.
3. JSON response shape.
4. response success fields: `resultCode`, `resultMsg`, `resultCnt`.
5. sample ordered route sequence for `mreaWideCd=01`, `lnCd=A1`.
6. complete `mreaWideCd` value set.
7. manually reviewed `(mreaWideCd, lnCd, lineName)` allowlist.

Full allowlist execution is intentionally deferred to collector implementation.

Collector implementation must:

1. Iterate all rows in `data/manual/kric-subway-route-info-line-map.csv`.
2. Call `subwayRouteInfo` with `mreaWideCd + lnCd`.
3. Preserve every raw response.
4. Emit per-route diagnostics for success, empty body, non-JSON response, HTTP error, source error code, station-order mismatch, missing station, extra station, and station-code/name mismatch.
5. Not remove a configured route merely because one request fails.
6. Report failures for manual review.

Do not perform one-off brute-force route validation during documentation work.
The design document defines the candidate set and the preservation/diagnostic rules; runtime success belongs to the collector execution logs.
