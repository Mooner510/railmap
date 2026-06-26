# AGENT_RULES

Status: active project rules  
Generated: 2026-06-23

## 1. Agent role

Implementation agents must implement from the provided documents and source schemas.

Agents must not independently redesign the data model, invent source priority, or perform broad new research unless explicitly instructed.

This project is currently in source-design and collector-design stage. It is not in product UI implementation stage.

## 2. Non-negotiable rules

1. Do not create fake transit data.
2. Do not synthesize timetable rows.
3. Do not infer travel time from speed, geometry, route order, or line length.
4. Do not auto-translate names.
5. Do not discard raw source fields.
6. Do not log, commit, or print API keys.
7. Do not treat construction/planned lines as active service unless manually approved.
8. Do not resolve conflicting sources silently.
9. Do not merge same-name stations automatically.
10. Do not use `lnCd` alone as a global KRIC route key.

## 3. Source-of-truth policy

Durable source-of-truth documents are under `docs/` in the repository.

Chat history and assistant memory may guide workflow, but they are not the durable private repository.

If a document and chat text disagree, prefer the repository document unless the user explicitly says a newer chat decision supersedes it.

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

## 5. Date policy

Directory acquisition date means the local project acquisition date.

It is not:

- source file date;
- source data reference date;
- API internal `데이터기준일자`;
- OSM replication timestamp;
- web page modified date.

## 6. Language and naming policy

Store names only when present in source data or manually provided.

Allowed name fields may include:

```text
ko
en
ja
zh
hanja/source-specific original fields
```

Do not automatically translate, romanize, or infer missing names.

## 7. Routing policy

Routing must use actual timetable stop rows.

For urban rail, KRIC operation rows are candidate timetable records.

For intercity/conventional rail, KORAIL station-stop-level operation rows are candidate timetable records.

Never compute timetable travel time from:

- OSM geometry;
- route distance;
- speed fields;
- station order;
- line length.

## 8. Manual editor boundary

The local editor/admin workflow is responsible for:

- transfer group confirmation;
- canonical station merge/split decisions;
- conflict resolution;
- planned/construction line activation;
- manual route corrections;
- final publication gating.

Collectors should emit candidates and diagnostics, not final editorial decisions.

## 9. API probing rule

Probe only what is necessary for source design or collector implementation.

Do not brute-force API codes when an official or manually reviewed allowlist exists.

For KRIC `subwayRouteInfo`, use:

```text
data/manual/kric-subway-route-info-line-map.csv
```

for route-call candidates.

Full execution of this allowlist is deferred to collector implementation.

## 10. Expected implementation behavior

Implementation agents should:

1. read `DATA_SOURCE_REGISTRY.md` first;
2. read the specific source document before touching a collector;
3. preserve raw data before parsing;
4. write diagnostics for every ambiguity;
5. keep changes small and source-driven;
6. avoid unnecessary dependencies;
7. stop and report when source behavior contradicts the documents.
