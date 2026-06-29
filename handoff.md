# Railmap 세션 핸드오프 문서

작성일: 2026-06-29  
대상: 다음 세션의 ChatGPT / AI 에이전트  
프로젝트: 한국 철도/도시철도 지도 + 내부 에디터 프로젝트  
현재 이슈: KRIC route stop ↔ station 매칭 오류, 특히 `죽전` 역 오매칭

---

## 1. 사용자 응답/작업 선호

- 응답 언어: 한국어.
- 설명은 길게 늘이지 말고, 결론과 실행 명령 위주.
- 현재 프로젝트 작업 환경은 **Mac / zsh** 기준.
- 진단/패치 명령은 프로젝트 루트에서 실행하도록 제공.
- 결과 공유는 `pbcopy` 사용 선호.
- 임시 파일 생성 최소화. `/tmp/result` 사용하지 말 것 unless 명시 요청.
- ChatGPT가 사용자의 프로젝트에서 `pnpm`, build, test를 직접 실행했다고 말하면 안 됨. 명령만 제공.
- 패치 zip이 필요할 때 기존 규칙:
  - `railmap<version>-<content>.zip`
  - 사용자는 zip을 프로젝트 루트의 `patches/`에 저장.
  - apply 명령은 프로젝트 루트 기준 `patches/<zipname>.zip` 참조.

---

## 2. 프로젝트/Collector 정보

확인된 주요 파일:

```text
packages/collector/package.json
packages/collector/src/canonical/build-canonical-app-bundle.ts
data/manual/kric-canonical-source-line-map.csv
data/manual/kric-subway-route-info-line-map.csv
data/manual/kric-canonical-line-colors.csv
data/manual/kric-station-line-aliases.csv
apps/web/public/data/kric-canonical-app-bundle.json
```

`packages/collector/package.json`:

```json
{
  "name": "@repo/collector",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "check-types": "tsc --noEmit"
  },
  "dependencies": {
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^22.15.3",
    "tsx": "^4.20.6",
    "typescript": "5.9.2"
  }
}
```

Collector 재실행 명령:

```zsh
pnpm --filter @repo/collector dev
```

또는 `packages/collector` 내부에서:

```zsh
pnpm dev
```

---

## 3. 직전 큰 작업 흐름

- `railmap12.2-inspector-current.zip` 기반으로 작업.
- `12.2 inspector command foundation` 패치가 만들어짐.
- 기능 요약:
  - command-based flow
  - undo/redo 버튼 및 history
  - station inspector
  - transfer inspector
  - geometry inspector
  - multi-selection transfer creation
- 이후 사용자가 데이터 이슈를 발견함.

---

## 4. 현재 핵심 이슈

사용자 보고:

> 죽전 역이 `대구 도시철도 2호선` + `수인분당선`이 합쳐진 역이 되어버렸다.

처음에는 물리/논리 역 grouping 문제처럼 보였지만, 조사 결과 실제 원인은 다음과 같음.

> KRIC route stop과 station candidate의 노선번호 체계가 서로 달라서, station matcher가 같은 노선 매칭에 실패하고 마지막 global name fallback으로 내려가 잘못된 동명이역을 선택했다.

특히 분당선에서:

```text
route stop lineNumber = I28K1
station lineNumber    = I4105
```

즉 같은 분당선인데 KRIC 원본 내부에서 서로 다른 노선번호를 사용한다.

---

## 5. 조사 증거

### 5.1 Stations: 죽전

대구 죽전 station candidate:

```json
{
  "candidateId": "candidate:kric:urban-rail-station:S2702:0224:row-942",
  "normalized": {
    "stationNumber": "0224",
    "stationNameKo": "죽전",
    "lineNumber": "S2702",
    "lineNameKo": "대구 도시철도 2호선",
    "latitude": 35.8503505,
    "longitude": 128.537089
  }
}
```

분당선 죽전 station candidate:

```json
{
  "candidateId": "candidate:kric:urban-rail-station:I4105:1862:row-943",
  "normalized": {
    "stationNumber": "1862",
    "stationNameKo": "죽전역",
    "lineNumber": "I4105",
    "lineNameKo": "분당선",
    "latitude": 37.324575,
    "longitude": 127.107385
  }
}
```

결론: station candidate 자체는 두 역이 정상적으로 분리되어 있음.

### 5.2 RouteStops: 죽전

대구 죽전 route stop:

```json
{
  "candidateId": "candidate:kric:urban-rail-route-stop:S2702:9",
  "normalized": {
    "lineNumber": "S2702",
    "lineNameKo": "대구 도시철도 2호선",
    "sequence": 9,
    "sourceStationCode": "0224",
    "stationNameKo": "죽전"
  }
}
```

분당선 죽전 route stop:

```json
{
  "candidateId": "candidate:kric:urban-rail-route-stop:I28K1:23",
  "normalized": {
    "lineNumber": "I28K1",
    "lineNameKo": "분당선",
    "sequence": 23,
    "sourceStationCode": "1862",
    "stationNameKo": "죽전역"
  }
}
```

결론: route stop 쪽 분당선은 `I28K1`, station 쪽 분당선은 `I4105`.

### 5.3 기존 canonical source line map

사용자 확인 결과:

```text
data/manual/kric-canonical-source-line-map.csv:24:01:K1,K1,수인분당선,01,I28K1,수인선,branch
data/manual/kric-canonical-source-line-map.csv:25:01:K1,K1,수인분당선,01,I28K1,분당선,branch
data/manual/kric-canonical-source-line-map.csv:26:01:D1,D1,신분당선,01,I11D1,신분당선,main
```

여기에는 `I4105`가 없다.

---

## 6. 잘못된 접근과 원복 필요성

초기에 `globalNameMatches` fallback을 제거하는 방향을 제안했으나, 사용자가 실행 후 다음 문제를 보고함.

> 분당선이 통째로 사라져버림

결론:

- `globalNameMatches`를 단순 제거하는 것은 너무 공격적.
- route stop과 station의 lineNumber 불일치가 해결되지 않은 상태에서 fallback을 제거하면, 분당선 stop들이 station에 붙지 못함.
- 따라서 fallback 제거가 아니라 **명시적 alias 매핑**이 필요함.

기존 fallback 코드 형태:

```ts
const globalNameMatches = byGlobalName.get(stopName) ?? [];
if (globalNameMatches.length > 0) {
  const resolved = resolveCandidates(globalNameMatches, stop, relatedLineNumbers);
  return {
    ...resolved,
    status: "name-based",
    confidence: resolved.confidence === "none" ? "none" : "low",
    diagnostics: ["matched-by-global-normalized-name", ...resolved.diagnostics],
  };
}
```

이 fallback은 당장 제거하지 말 것. 장기적으로는 alias coverage를 늘린 뒤 validator 기반으로 제거/제한하는 것이 안전.

---

## 7. 최종 채택한 해결 방향

채택한 방향:

> `routeStop lineNumber → station lineNumber` alias를 명시적으로 관리한다.

새 수동 파일:

```text
data/manual/kric-station-line-aliases.csv
```

현재 필요한 내용:

```csv
routeStopLineNumber,routeStopLineName,stationLineNumber,stationLineName,note
I28K1,분당선,I4105,분당선,KRIC line code mismatch
```

비판적 검토 결론:

```text
❌ 같은 canonical line에 속한 모든 sourceLineNumber를 같은 노선으로 취급
✅ routeStop lineNumber → station lineNumber alias를 명시적으로 관리
```

이유:

- KRIC 원본을 수정하지 않음.
- 새 station을 만들지 않음.
- 전국 동명이역 fallback 의존을 줄임.
- 어떤 보정이 들어갔는지 CSV로 추적 가능.
- 향후 같은 문제가 나오면 CSV에 한 줄씩 추가 가능.

---

## 8. 현재 alias CSV 상태

사용자가 먼저 만든 상태:

```csv
routeStopLineNumber,routeStopLineName,stationLineNumber,stationLineName,note
I28K1,분당선,I4105,분당선,KRIC line code mismatch
```

이후 ChatGPT가 제공한 첫 패치 스크립트가 note가 다른 동일 alias를 중복 추가함.

사용자가 보여준 diff:

```diff
diff --git a/data/manual/kric-station-line-aliases.csv b/data/manual/kric-station-line-aliases.csv
index 2a17a3a..4ea1e0a 100644
--- a/data/manual/kric-station-line-aliases.csv
+++ b/data/manual/kric-station-line-aliases.csv
@@ -1,2 +1,3 @@
 routeStopLineNumber,routeStopLineName,stationLineNumber,stationLineName,note
 I28K1,분당선,I4105,분당선,KRIC line code mismatch
+I28K1,분당선,I4105,분당선,KRIC route stop line code differs from station line code
```

따라서 필요한 조치:

1. 중복 alias 제거.
2. collector 코드 패치가 실제 적용되었는지 확인.
3. collector 재실행.
4. `죽전` 결과 확인.

---

## 9. 마지막으로 제공한 패치 스크립트의 의도

마지막에 제공한 zsh/python 스크립트는 다음을 하도록 설계됨.

- `data/manual/kric-station-line-aliases.csv` 중복 정리.
- `packages/collector/src/canonical/build-canonical-app-bundle.ts` 수정.
- alias CSV loader 추가.
- `StationLineAliasRow` 타입 추가.
- `parseStationLineAliases()` 추가.
- `getMatchesForLineNumbers()` 추가.
- `addStationLineAliases()` 추가.
- matcher 내부 조회를 lineNumber 단일 조회에서 alias-aware 다중 lineNumber 조회로 변경.
- `matchStation(stop, relatedLineNumbers)` 호출부를 `effectiveRelatedLineNumbers` 기반으로 변경.
- diff를 `pbcopy`로 복사.

주의:

- 마지막 스크립트가 실제 사용자 프로젝트에서 성공했는지는 아직 확인되지 않음.
- 마지막 사용자 메시지는 첫 diff, 즉 CSV만 중복 추가된 상태를 보여준 것.
- 다음 세션에서는 먼저 `git diff`를 받아서 실제 코드 패치 적용 여부를 확인해야 함.

---

## 10. 다음 세션에서 바로 해야 할 일

### 10.1 현재 diff 확인

사용자에게 실행 요청:

```zsh
git diff -- data/manual/kric-station-line-aliases.csv packages/collector/src/canonical/build-canonical-app-bundle.ts | pbcopy
echo "복사 완료"
```

기대:

- diff에 `data/manual/kric-station-line-aliases.csv` 포함.
- diff에 `packages/collector/src/canonical/build-canonical-app-bundle.ts` 포함.
- alias CSV에는 중복 없이 아래 한 줄만 있어야 함.

```csv
routeStopLineNumber,routeStopLineName,stationLineNumber,stationLineName,note
I28K1,분당선,I4105,분당선,KRIC line code mismatch
```

### 10.2 Collector 실행

```zsh
pnpm --filter @repo/collector dev
```

### 10.3 죽전 결과 확인

```zsh
grep -n '"죽전' apps/web/public/data/kric-canonical-app-bundle.json | pbcopy
echo "복사 완료"
```

정상 기대:

- 대구 `죽전`:
  - `S2702`
  - `0224`
  - 대구 도시철도 2호선
  - 좌표 대구
- 분당선 `죽전역`:
  - station candidate `I4105`
  - stationNumber `1862`
  - source route stop `I28K1:23`
  - 좌표 용인/수지
- 수인분당선 route stop `I28K1:23`이 대구 `S2702:0224`로 붙으면 안 됨.

### 10.4 타입 체크 명령

필요하면 사용자에게 이 명령을 제공:

```zsh
pnpm --filter @repo/collector check-types
```

단, ChatGPT가 직접 실행했다고 말하지 말 것.

---

## 11. 더 안전한 최종 구현 방향

현재 패치 방식은 최소 수정이다. 장기적으로는 matcher 우선순위를 더 명확히 분리하는 것이 좋다.

권장 우선순위:

```text
1. routeStop lineNumber + stationCode
2. alias stationLineNumber + stationCode
3. routeStop lineNumber + normalized stationCode
4. alias stationLineNumber + normalized stationCode
5. routeStop lineNumber + stationName
6. alias stationLineNumber + stationName
7. global name fallback은 일단 유지하되 confidence=low, diagnostics 남김
8. alias coverage가 충분해지면 global fallback 제거 또는 validator-only 처리
```

개선 포인트:

- `primaryLineNumbers`, `aliasLineNumbers`, `relatedLineNumbers`를 분리.
- alias로 매칭된 경우 diagnostics에 `matched-by-station-line-alias` 남기기.
- global fallback으로 매칭된 경우 validator에서 강하게 경고.

---

## 12. 주의점

- `globalNameMatches`를 바로 제거하지 말 것.
  - 분당선이 통째로 사라지는 문제가 이미 발생함.
- 하지만 global fallback은 장기적으로 위험함.
  - 죽전 같은 동명이역을 잘못 붙일 수 있음.
- 현재 안전한 순서:

```text
alias 추가
→ global fallback 유지
→ low-confidence diagnostics 추적
→ validator에서 alias 누락 감지
→ alias coverage 확장
→ global fallback 축소/제거 검토
```

---

## 13. 다음 AI에게 주는 핵심 결론

핵심 원인:

```text
죽전 오매칭의 원인은 역 데이터가 합쳐진 것이 아니라,
KRIC route stop의 분당선 lineNumber(I28K1)와
station candidate의 분당선 lineNumber(I4105)가 달라
same-line matching이 실패한 뒤 global name fallback으로 대구 죽전을 선택한 것이다.
```

해결 방향:

```text
data/manual/kric-station-line-aliases.csv에
I28K1,분당선,I4105,분당선,KRIC line code mismatch
를 유지하고,
collector의 station matcher가 routeStop lineNumber뿐 아니라 alias stationLineNumber도 station lookup에 사용하도록 수정한다.
```

아직 확인할 것:

```text
마지막 패치 스크립트가 실제로 build-canonical-app-bundle.ts까지 수정되었는지 확인 필요.
사용자에게 git diff를 받아야 함.
그 후 pnpm --filter @repo/collector dev 실행.
마지막으로 apps/web/public/data/kric-canonical-app-bundle.json에서 죽전 결과 확인.
```
