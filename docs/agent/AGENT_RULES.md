# AGENT_RULES

Status: active project rules  
Updated: 2026-07-02

## 1. Agent role

Implementation agents must preserve the current editor/web/collector behavior while improving it in small, testable steps.

Agents must not independently redesign the data model, invent source priority, or perform broad new research unless explicitly instructed.

The project is no longer source-design-only. The local editor and public web are active implementation surfaces.

## 2. Non-negotiable rules

1. Do not create fake transit data.
2. Do not synthesize timetable rows.
3. Do not infer travel time from speed, geometry, route order, station count, or line length.
4. Do not auto-translate names.
5. Do not discard raw source fields.
6. Do not log, commit, or print API keys.
7. Do not treat construction/planned lines as active service unless manually approved.
8. Do not resolve conflicting sources silently.
9. Do not merge same-name stations automatically.
10. Do not use `lnCd` alone as a global KRIC route key.
11. Do not use one `stationId` as a real station for multiple lines.
12. Do not store a foreign line's station as a `station` geometry point; use a `control` point instead.

## 3. Source-of-truth policy

Durable source-of-truth documents are under `docs/` and durable manual data is under `data/manual`.

`apps/web/public/data` is an export target for the public web. Do not treat it as the canonical manual source.

Chat history may explain why a decision was made, but repository files and current code define the working state.

If a document and current implementation disagree, inspect the implementation and update the document. Do not revert implementation solely because an old document says otherwise.

## 4. Raw preservation

Collectors must preserve:

- raw files;
- raw API responses;
- original field names;
- original raw values;
- acquisition metadata;
- request metadata with service keys redacted;
- parse diagnostics;
- validation diagnostics.

Normalization may produce candidate records, but each candidate must retain a pointer to raw source evidence.

## 5. Manual overlay policy

Manual overlays are intentional human decisions.

The canonical manual source is:

```text
data/manual/manual-overlays.json
```

Related manual files under `data/manual` may provide split views or support data, but the build/export flow must not overwrite human edits with generated guesses.

The public export is:

```text
apps/web/public/data/manual-overlays.json
```

When collector/build/export runs, it must preserve and export manual overlays, then validate that web data reflects them.

## 6. Station and line identity policy

A station icon represents a specific line-specific station entity.

Rules:

1. Same physical place does not imply same `stationId`.
2. Transfer groups represent physical/operational transfer relationships.
3. Transfer groups do not replace line-specific station icons.
4. A station point in a geometry override must belong to the same branch/line context.
5. Foreign station coordinates used only for shape guidance must be saved as `control` points.

Violations must appear in editor validation and collector validation.

## 7. Circular line and branch policy

Circular line behavior:

1. A circular line's visual line connects last station back to first station.
2. Station insertion previews must include the last-to-first segment.
3. A circular line cannot be the source/parent of an external branch connection.
4. A non-circular line may connect into a station on a circular line.
5. Internal branch additions from a station on the circular line are allowed.

Do not implement this as “circular lines cannot be connection targets.” They can be targets.

## 8. Routing policy

Routing must use actual timetable stop rows.

For urban rail, KRIC operation rows are candidate timetable records.

For intercity/conventional rail, KORAIL station-stop-level operation rows are candidate timetable records.

Never compute timetable travel time from:

- OSM geometry;
- route distance;
- speed fields;
- station order;
- line length.

## 9. Editor implementation policy

The editor is a local/admin tool.

Maintain these expectations:

- show clear validation diagnostics;
- explain cause and fix for each problem;
- provide safe auto-repair buttons when deterministic;
- keep risky auto-fixes explicit and user-visible;
- prefer visual route/branch previews over long textual descriptions;
- do not hide data-risk warnings behind purely decorative UI.

## 10. API probing rule

Probe only what is necessary for source design or collector implementation.

Do not brute-force API codes when an official or manually reviewed allowlist exists.

For KRIC `subwayRouteInfo`, use:

```text
data/manual/kric-subway-route-info-line-map.csv
```

as the route-call allowlist.

## 11. Expected implementation behavior

Implementation agents should:

1. read `README.md` first;
2. read `docs/agent/CURRENT_TASK.md`;
3. inspect current code before patching;
4. keep patches small and reversible;
5. run app-specific type checks where possible;
6. preserve manual data;
7. report any validation risk instead of guessing.

## 일반철도/고속철 line metadata 정책

- 기존 도시철도 데이터는 기본 `urban_rail` + `subway`로 읽어야 하며, GTX는 `gtx` + `gtx`로 분류한다.
- 일반철도와 고속철도 확장은 기존 `Line -> Branch -> RouteStop -> Station` 구조에 `category`와 `serviceTypes`를 추가하는 방식으로 진행한다.
- `KTX선`, `SRT선`이라는 Line 이름은 금지한다. `경부고속선`, `호남고속선`, `수서평택고속선`처럼 선로/노선명을 Line으로 사용한다.
- 같은 물리 역을 여러 선로 체계에서 공유해야 할 때는 stationId를 공유하지 말고 별도 stationId + 환승 그룹으로 표현한다.
