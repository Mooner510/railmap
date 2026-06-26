# DATA_SOURCE_KORAIL_RUN

Status: source-design ready, observed usable, implementation verification pending  
Generated: 2026-06-23  
Source category: public railway timetable / operation data  
Primary use: static intercity rail timetable source for KTX, SRT-adjacent, and conventional passenger rail routing

## 1. Source summary

This document records the observed behavior of the `한국철도공사_열차운행정보` API during project source investigation.

The API is a candidate source for:

- train-level operation plans
- station-stop-level train operation records
- static timetable-based routing
- station code discovery from actual operation rows
- main route line code/name discovery from actual operation rows
- stop type discovery from actual operation rows
- up/down direction discovery from actual operation rows

The collector must treat this API as a raw source. It must not infer missing timetable rows, estimate travel time, or synthesize train services.

## 2. Source endpoints

Base URL:

```text
https://apis.data.go.kr/B551457/run/v2
```

Observed endpoints:

```text
/codes2
/travelerTrainRunPlan2
/travelerTrainRunInfo2
```

## 3. Authentication

The API requires a public data portal service key.

Collectors and probe scripts must read the key from an environment variable.

Recommended environment variable:

```text
DATA_GO_KR_SERVICE_KEY
```

Rules:

- The key must not be committed.
- The key must not be printed.
- The key must not be written into output files.
- If an API response or request log contains the key, redact it before preserving or sharing it.

## 4. Acquisition date policy

All raw and probe responses must be stored under the local acquisition date.

Example:

```text
data/probes/2026-06-19/korail-run/
```

The directory date means the date this project acquired the sample response.

It does not necessarily mean the operation date inside the response.

The response field `run_ymd` is source data and must be stored separately from acquisition date.

## 5. Observed endpoint: codes2

### 5.1 Tested code types

The following code types were tested:

```text
stn_cd
mrnt_cd
stop_se_cd
uppln_dn_se_cd
```

### 5.2 Observed result

Observed on `2026-06-19`:

```text
codes2?type=stn_cd              -> resultCode=0, resultMsg=정상, totalCount=0
codes2?type=mrnt_cd             -> resultCode=0, resultMsg=정상, totalCount=0
codes2?type=stop_se_cd          -> resultCode=0, resultMsg=정상, totalCount=0
codes2?type=uppln_dn_se_cd      -> resultCode=0, resultMsg=정상, totalCount=0
```

### 5.3 Collector rule

The collector must not rely on `codes2` as the only source of code tables.

Until further provider documentation, Swagger UI confirmation, or successful non-empty responses are obtained:

- station codes must be derived from `travelerTrainRunInfo2.stn_cd` and `stn_nm`
- main route line codes must be derived from `travelerTrainRunInfo2.mrnt_cd` and `mrnt_nm`
- stop type codes must be derived from `travelerTrainRunInfo2.stop_se_cd` and `stop_se_nm`
- up/down direction codes must be derived from `travelerTrainRunInfo2.uppln_dn_se_cd`

The observed empty `codes2` responses must be preserved as probe evidence.

## 6. Observed endpoint: travelerTrainRunInfo2

### 6.1 Purpose

`travelerTrainRunInfo2` returns station-stop-level train operation records.

This is the most important observed endpoint for static timetable routing because it provides ordered stops and scheduled arrival/departure timestamps per train.

### 6.2 Observed response summary

Observed sample response:

```json
{
  "mrnt_cd": "01",
  "mrnt_nm": "경부선",
  "run_ymd": "20260617",
  "stn_cd": "3900023",
  "stn_nm": "서울",
  "stop_se_cd": "01",
  "stop_se_nm": "시발",
  "trn_arvl_dt": null,
  "trn_dptre_dt": "2026-06-17 05:13:00.0",
  "trn_no": "00001",
  "trn_run_sn": "1",
  "uppln_dn_se_cd": "D"
}
```

Observed total count:

```text
798165
```

### 6.3 Observed fields

```text
mrnt_cd
mrnt_nm
run_ymd
stn_cd
stn_nm
stop_se_cd
stop_se_nm
trn_arvl_dt
trn_dptre_dt
trn_no
trn_run_sn
uppln_dn_se_cd
```

### 6.4 Field handling

| Field | Meaning | Collector handling |
|---|---|---|
| `mrnt_cd` | main route line code | preserve raw; derive route code candidate |
| `mrnt_nm` | main route line name | preserve raw; derive route name candidate |
| `run_ymd` | operation date | preserve raw string; parse separately |
| `stn_cd` | station code | preserve raw; derive station code candidate |
| `stn_nm` | station name | preserve raw; derive Korean station name candidate |
| `stop_se_cd` | stop type code | preserve raw; derive observed code table |
| `stop_se_nm` | stop type name | preserve raw |
| `trn_arvl_dt` | train arrival datetime | preserve raw; parse separately; nullable |
| `trn_dptre_dt` | train departure datetime | preserve raw; parse separately; nullable |
| `trn_no` | train number | preserve as string; leading zeroes are significant |
| `trn_run_sn` | train stop sequence number | preserve raw; parse numeric candidate separately |
| `uppln_dn_se_cd` | up/down direction code | preserve raw; derive observed code table |

### 6.5 Routing relevance

This endpoint can support static timetable routing because it provides:

- train number
- operation date
- station code
- station name
- stop sequence
- arrival datetime
- departure datetime
- route line code/name
- direction code
- stop type code/name

Collector must group station-stop records by at least:

```text
run_ymd
trn_no
```

Within a train group, records should be ordered by:

```text
trn_run_sn
```

The collector must not use geometry, average speed, or AI inference to create missing stop times.

### 6.6 Train run identity and grouping rule

For collector implementation, the minimum train-run identity is:

```text
run_ymd + trn_no
```

Rationale:

- `trn_no` repeats across operation dates;
- `run_ymd` identifies the operation date;
- `trn_run_sn` is a stop sequence inside a train run, not a train-run identifier.

The collector must group rows by `run_ymd + trn_no`, then sort rows by numeric `trn_run_sn` ascending.

If future probes reveal duplicate `run_ymd + trn_no + trn_run_sn` rows, the collector must not silently overwrite either row. It must preserve both raw rows and emit a duplicate-source-key diagnostic.

### 6.7 Nullable arrival/departure rule

Observed start-stop rows may have:

```text
trn_arvl_dt = null
```

Observed terminal-stop rows may have:

```text
trn_dptre_dt = null
```

The collector must preserve null values as null. It must not copy departure time into arrival time, copy arrival time into departure time, or synthesize missing terminal/start times.

### 6.8 Stop type rule

Observed stop type fields:

```text
stop_se_cd
stop_se_nm
```

The collector should derive the observed code table from actual `travelerTrainRunInfo2` rows because the `codes2` endpoint returned empty responses during probing.

Stop type names such as `시발` should be treated as source labels, not hard-coded control logic. If control logic is needed, it must use observed fields plus null-time behavior and emit diagnostics when they conflict.


## 7. Observed endpoint: travelerTrainRunPlan2

### 7.1 Purpose

`travelerTrainRunPlan2` returns train-level operation plan records.

This endpoint is useful as a high-level train run summary, but it is not sufficient alone for station-stop-level routing.

### 7.2 Observed response summary

Observed sample response:

```json
{
  "arvl_stn_cd": "3900114",
  "arvl_stn_nm": "부산",
  "dptre_stn_cd": "3900023",
  "dptre_stn_nm": "서울",
  "run_ymd": "20260718",
  "trn_no": "00001",
  "trn_plan_arvl_dt": "2026-07-18 07:50:00.0",
  "trn_plan_dptre_dt": "2026-07-18 05:13:00.0"
}
```

Observed total count:

```text
81914
```

### 7.3 Observed fields

```text
arvl_stn_cd
arvl_stn_nm
dptre_stn_cd
dptre_stn_nm
run_ymd
trn_no
trn_plan_arvl_dt
trn_plan_dptre_dt
```

### 7.4 Field handling

| Field | Meaning | Collector handling |
|---|---|---|
| `arvl_stn_cd` | final arrival station code | preserve raw; derive terminal station candidate |
| `arvl_stn_nm` | final arrival station name | preserve raw |
| `dptre_stn_cd` | initial departure station code | preserve raw; derive origin station candidate |
| `dptre_stn_nm` | initial departure station name | preserve raw |
| `run_ymd` | operation date | preserve raw string; parse separately |
| `trn_no` | train number | preserve as string; leading zeroes are significant |
| `trn_plan_arvl_dt` | planned final arrival datetime | preserve raw; parse separately |
| `trn_plan_dptre_dt` | planned initial departure datetime | preserve raw; parse separately |

### 7.5 Routing relevance

This endpoint is useful for:

- train-level inventory
- validating that a train run exists
- origin/destination summary
- high-level timetable search metadata

It must not replace `travelerTrainRunInfo2` for station-stop routing.

## 8. Date parameter verification

### 8.1 Tested variants

The following request variants were tested against both `travelerTrainRunInfo2` and `travelerTrainRunPlan2`:

```text
no date parameter
runYmd=20260618
run_ymd=20260618
```

### 8.2 Observed result

All three variants returned the same first item and same total count for each endpoint.

For `travelerTrainRunInfo2`:

```text
firstRunYmd = 20260617
totalCount = 798165
```

For `travelerTrainRunPlan2`:

```text
firstRunYmd = 20260718
totalCount = 81914
```

### 8.3 Collector rule

API-side date filtering is not verified.

The collector must not rely on date filtering until one of the following is available:

- Swagger UI confirms the correct parameter name and behavior
- provider documentation confirms the parameter name and behavior
- a probe demonstrates that a date parameter changes `run_ymd` and/or total count correctly

Until then, the collector may page through the endpoint and filter locally by response field:

```text
run_ymd
```

## 9. Pagination verification

### 9.1 travelerTrainRunInfo2

Observed with `numOfRows=5`:

```text
pageNo=1 -> first trn_no=00001, trn_run_sn=1
pageNo=2 -> first trn_no=00001, trn_run_sn=6
```

The first item changed between page 1 and page 2. Pagination is considered working for this endpoint.

### 9.2 travelerTrainRunPlan2

Observed with `numOfRows=5`:

```text
pageNo=1 -> first trn_no=00001
pageNo=2 -> first trn_no=00006
```

The first item changed between page 1 and page 2. Pagination is considered working for this endpoint.

### 9.3 Collector rule

The collector may use `pageNo` and `numOfRows` for pagination.

The collector must preserve:

- requested `pageNo`
- requested `numOfRows`
- response `pageNo`
- response `numOfRows`
- response `totalCount`
- acquisition timestamp
- endpoint name

## 10. Recommended raw/probe storage

Recommended probe layout:

```text
data/probes/<acquired-date>/korail-run/
  codes/
  date-param-check/
  pagination-check/
  samples/
```

Recommended future raw acquisition layout:

```text
data/raw/<acquired-date>/korail-run/
  travelerTrainRunInfo2/
  travelerTrainRunPlan2/
```

Large full-page collection outputs should remain ignored by Git.

## 11. Recommended collector strategy

Initial collector strategy:

1. Read `DATA_GO_KR_SERVICE_KEY` from environment.
2. Request `travelerTrainRunInfo2` using `pageNo` and `numOfRows`.
3. Request `travelerTrainRunPlan2` using `pageNo` and `numOfRows`.
4. Preserve raw page responses.
5. Preserve response metadata.
6. Derive observed code tables from actual response rows.
7. Filter locally by `run_ymd` when needed.
8. Write JSONL candidates with source provenance.
9. Do not infer missing rows or times.
10. Stop with `BLOCKED` if pagination behavior changes or response schema changes.

## 12. Candidate record shapes

### 12.1 Station-stop operation candidate

```json
{
  "candidateType": "korail-run-info-stop",
  "sourceId": "korail_run_info_api",
  "sourceSnapshotDate": "2026-06-19",
  "sourcePointer": {
    "endpoint": "travelerTrainRunInfo2",
    "pageNo": 1,
    "itemIndex": 0
  },
  "raw": {},
  "normalizedCandidate": {
    "operationDate": "20260617",
    "trainNo": "00001",
    "sequence": 1,
    "stationCode": "3900023",
    "stationNameKo": "서울",
    "arrivalDateTime": null,
    "departureDateTime": "2026-06-17T05:13:00+09:00",
    "mainRouteCode": "01",
    "mainRouteNameKo": "경부선",
    "stopTypeCode": "01",
    "stopTypeNameKo": "시발",
    "directionCode": "D"
  },
  "parseDiagnostics": []
}
```

### 12.2 Train-level plan candidate

```json
{
  "candidateType": "korail-run-plan",
  "sourceId": "korail_run_plan_api",
  "sourceSnapshotDate": "2026-06-19",
  "sourcePointer": {
    "endpoint": "travelerTrainRunPlan2",
    "pageNo": 1,
    "itemIndex": 0
  },
  "raw": {},
  "normalizedCandidate": {
    "operationDate": "20260718",
    "trainNo": "00001",
    "departureStationCode": "3900023",
    "departureStationNameKo": "서울",
    "arrivalStationCode": "3900114",
    "arrivalStationNameKo": "부산",
    "plannedDepartureDateTime": "2026-07-18T05:13:00+09:00",
    "plannedArrivalDateTime": "2026-07-18T07:50:00+09:00"
  },
  "parseDiagnostics": []
}
```

Candidate shape is provisional. It must be refined after full schema observation and integration with shared schema documents.

## 13. Date/time parsing policy

Observed datetime strings use this shape:

```text
YYYY-MM-DD HH:mm:ss.0
```

Example:

```text
2026-06-17 05:13:00.0
```

Collector must:

- preserve the raw string
- parse candidate datetime separately
- assume Korea local railway time only after documenting the assumption
- preserve nullable arrival/departure fields
- not coerce null into a fake datetime

For start stops:

```text
trn_arvl_dt may be null
```

For terminal stops:

```text
trn_dptre_dt may be null
```

## 14. Known limitations and open questions

Known limitations:

- `codes2` returned empty responses for all tested code types.
- API-side date filtering is not verified.
- Exact Swagger request parameter table has not been captured into this repository yet.
- Train type/category is not present in the observed sample fields.
- Fare information is not present.
- Transfer information is not present.

Open questions:

- Is there a documented and working operation-date filter parameter?
- Are there additional filters for line, station, or train number?
- Is train type available from another endpoint or field not present in the first pages?
- Are SRT-operated services fully represented or only partially represented?
- Is full pagination stable across large `numOfRows` values?
- Are there rate limits lower than the public data portal traffic quota in practice?

## 15. Implementation constraints

Implementation agents must follow these constraints:

- Do not rely on `codes2` until non-empty code responses are observed.
- Do not rely on API-side date filtering until verified.
- Do not infer missing timetable rows.
- Do not infer travel time from geometry or average speed.
- Do not synthesize station codes.
- Do not drop leading zeroes from `trn_no`.
- Do not merge station names or station codes without documented rules.
- Preserve raw page responses before candidate normalization.
- Preserve observed schema separately from documented schema.
- Stop and report `BLOCKED` if response fields differ from the observed fields in this document.

## 16. Probe evidence to preserve

Preserve the following probe evidence under `data/probes/<acquired-date>/korail-run/`:

```text
korail-codes-stn_cd.json
korail-codes-mrnt_cd.json
korail-codes-stop_se_cd.json
korail-codes-uppln_dn_se_cd.json
korail-run-info-20260618.json
korail-run-plan-20260618.json
param-check/info-no-date.json
param-check/info-runYmd.json
param-check/info-run_ymd.json
param-check/plan-no-date.json
param-check/plan-runYmd.json
param-check/plan-run_ymd.json
pagination-check/info-page-1.json
pagination-check/info-page-2.json
pagination-check/plan-page-1.json
pagination-check/plan-page-2.json
```

If these exact files are reorganized, preserve equivalent evidence and update this list.


## 16. Documentation-phase decision

The documentation phase should not run broad KORAIL bulk collection merely to prove every possible response shape.

Current status is sufficient for source design:

- `travelerTrainRunInfo2` returned station-stop-level rows;
- `travelerTrainRunPlan2` returned train-level rows;
- pagination behavior was observed as working;
- `codes2` returned empty lists and must not be relied on yet;
- API-side date filtering was not verified and must not be trusted yet.

Full-volume collection, duplicate analysis, and additional endpoint parameter verification are implementation-stage tasks.
