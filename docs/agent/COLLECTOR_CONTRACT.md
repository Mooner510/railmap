# COLLECTOR_CONTRACT

Status: active collector contract draft  
Generated: 2026-06-23

## 1. Purpose

This contract defines how project collectors must behave across KRIC, KORAIL, OSM, TAGO, and future sources.

Collectors produce raw snapshots, parsed source records, candidate normalized records, and diagnostics.

Collectors do not produce final editorial truth.

## 2. Required outputs

Each collector should be capable of writing:

```text
data/raw/<acquired-date>/<source>/...
data/probes/<acquired-date>/<source>/...
data/collected/<acquired-date>/<source>/...
```

`data/generated/` is reserved for later build outputs derived from collected/manual data.

## 3. Required metadata

Every collection run must record:

- source identifier;
- acquisition date;
- collection timestamp if available;
- request URL with secrets redacted;
- request parameters with secrets redacted;
- HTTP status when applicable;
- response format;
- parser version or script version if available;
- diagnostics summary;
- raw file path.

## 4. Secret handling

API keys must be read from environment variables.

Do not write service keys to:

- raw files;
- probe files;
- request logs;
- diagnostics;
- markdown documents;
- git commits;
- terminal output.

If a source response includes the key, redact before sharing or committing.

## 5. KRIC collector contract

### 5.1 XLSX files

KRIC XLSX files are raw snapshot inputs. Preserve them unchanged.

Current accepted raw XLSX files:

```text
전체_도시철도운행정보_20260228.xlsx
전체_도시철도역사정보_20260228.xlsx
전체_도시철도노선정보_20260228.xlsx
운영기관_역사_코드정보_2026.05.11_일반.xlsx
```

### 5.2 `subwayRouteInfo`

Use the manual route allowlist:

```text
data/manual/kric-subway-route-info-line-map.csv
```

For each row, call:

```text
https://openapi.kric.go.kr/openapi/trainUseInfo/subwayRouteInfo?format=json&mreaWideCd=<mreaWideCd>&lnCd=<lnCd>
```

with the service key supplied from environment.

For each route call, preserve the raw response and emit diagnostics.

Do not remove a configured route merely because one request fails.

### 5.3 KRIC route key rule

Use `(mreaWideCd, lnCd)` as the API route key.

Do not use `lnCd` alone because numeric line codes repeat across regions.

## 6. KORAIL collector contract

Use `travelerTrainRunInfo2` as the main station-stop-level timetable candidate source.

Use `travelerTrainRunPlan2` as a train-level summary/cross-check source.

Do not rely on `codes2` until a non-empty code table response is verified.

Do not rely on API-side date filtering until parameter behavior is confirmed. Page responses and filter locally by response fields where necessary.

Preserve train numbers as strings because leading zeroes are meaningful.

Group station-stop rows by:

```text
run_ymd + trn_no
```

Within each group, sort by numeric `trn_run_sn` ascending.

Preserve nullable arrival/departure fields exactly:

- do not fabricate `trn_arvl_dt` for start stops;
- do not fabricate `trn_dptre_dt` for terminal stops;
- do not infer missing times from adjacent rows;
- do not use speed, route length, or geometry to fill timetable gaps.

If duplicate `run_ymd + trn_no + trn_run_sn` rows are observed, preserve all raw rows and emit diagnostics instead of overwriting.

## 7. OSM collector contract

Use Geofabrik Korea extract as primary OSM geometry source.

Use OSM Korea non-military extract only as fallback/source-availability comparison unless explicitly promoted.

Preserve raw PBF metadata and extraction diagnostics.

Exclude inactive/future railway objects from active normalized outputs unless manually reviewed.

## 8. TAGO collector contract

TAGO Train is currently blocked by access.

Do not implement or depend on TAGO Train until a successful probe confirms access.

TAGO may later be used only as a secondary/cross-check source, not as a primary source.

## 9. Diagnostics requirements

Collectors must emit diagnostics for:

- HTTP failure;
- source result code failure;
- empty body;
- non-JSON/non-XML response;
- parser failure;
- missing required field;
- duplicate source key;
- station-code/name mismatch;
- line-name mismatch;
- station-order mismatch;
- unsupported date/time format;
- source conflict;
- skipped inactive/future object.

## 10. Final publication boundary

Collected data is not automatically publishable.

Final app/publication data must come from a later build step that combines raw/collected/manual decisions and passes validation.
