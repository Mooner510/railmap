import path from "node:path";
import { findRepoRoot, readJsonl, writeJson } from "../shared/fs.js";

type JsonRecord = Record<string, any>;

export async function diagnoseKricRouteStopStationMatch() {
  const repoRoot = findRepoRoot(process.cwd());
  const acquiredDate = "2026-06-19";
  const collectedDir = path.join(repoRoot, "data/collected", acquiredDate, "kric");
  const observedDir = path.join(repoRoot, "data/observed", acquiredDate, "kric");

  const stations = readJsonl<JsonRecord>(path.join(collectedDir, "kric-urban-rail-stations.candidate.jsonl"));
  const routeStops = readJsonl<JsonRecord>(path.join(collectedDir, "kric-urban-rail-route-stops.candidate.jsonl"));

  const stationsByLineAndStationNumber = new Map<string, JsonRecord[]>();
  const stationsByStationNumber = new Map<string, JsonRecord[]>();

  for (const station of stations) {
    const lineNumber = station.normalized?.lineNumber;
    const stationNumber = station.normalized?.stationNumber;
    if (!stationNumber) continue;

    const exactKey = `${lineNumber}:${stationNumber}`;
    stationsByLineAndStationNumber.set(exactKey, [...(stationsByLineAndStationNumber.get(exactKey) ?? []), station]);
    stationsByStationNumber.set(stationNumber, [...(stationsByStationNumber.get(stationNumber) ?? []), station]);
  }

  const exactMatches: JsonRecord[] = [];
  const codeOnlyMatches: JsonRecord[] = [];
  const missingMatches: JsonRecord[] = [];
  const nameBasedMatches: JsonRecord[] = [];
  const ambiguousExactMatches: JsonRecord[] = [];
  const reviewRecords: JsonRecord[] = [];

  const stationsByLineAndNormalizedName = new Map<string, JsonRecord[]>();

  function normalizeStationName(value: unknown): string | null {
    if (typeof value !== "string") return null;
    return value
      .replace(/역$/u, "")
      .replace(/\s+/gu, "")
      .replace(/\([^)]*\)/gu, "")
      .replace(/（[^）]*）/gu, "")
      .trim();
  }

  for (const station of stations) {
    const lineNumber = station.normalized?.lineNumber;
    const normalizedName = normalizeStationName(station.normalized?.stationNameKo);
    if (!lineNumber || !normalizedName) continue;

    const key = `${lineNumber}:${normalizedName}`;
    stationsByLineAndNormalizedName.set(key, [
      ...(stationsByLineAndNormalizedName.get(key) ?? []),
      station,
    ]);
  }

  for (const stop of routeStops) {
    const lineNumber = stop.normalized?.lineNumber;
    const sourceStationCode = stop.normalized?.sourceStationCode;
    const stationNameKo = stop.normalized?.stationNameKo;

    if (!sourceStationCode) {
      missingMatches.push({ stop, reason: "missing-source-station-code" });
      continue;
    }

    const exact = stationsByLineAndStationNumber.get(`${lineNumber}:${sourceStationCode}`) ?? [];

    if (exact.length === 1) {
      const station = exact[0];
      if (!station) {
        missingMatches.push({ stop, reason: "unexpected-empty-exact-match" });
        continue;
      }
      const reviewRecord = {
        stopCandidateId: stop.candidateId,
        matchStatus: "exact",
        confidence: stationNameKo === station.normalized?.stationNameKo ? "high" : "medium",
        lineNumber,
        sourceStationCode,
        routeStopNameKo: stationNameKo,
        selectedStationCandidateId: station.candidateId,
        selectedStationNumber: station.normalized?.stationNumber,
        selectedStationNameKo: station.normalized?.stationNameKo,
        candidateStationMatches: [station.candidateId],
        diagnostics: stationNameKo === station.normalized?.stationNameKo ? [] : ["exact-code-name-mismatch"],
      };
      exactMatches.push({
        stopCandidateId: stop.candidateId,
        stationCandidateId: station.candidateId,
        lineNumber,
        sourceStationCode,
        routeStopNameKo: stationNameKo,
        stationNameKo: station.normalized?.stationNameKo,
        nameMatches: stationNameKo === station.normalized?.stationNameKo,
      });
      reviewRecords.push(reviewRecord);
      continue;
    }

    if (exact.length > 1) {
      ambiguousExactMatches.push({ stop, matches: exact });
      reviewRecords.push({
        stopCandidateId: stop.candidateId,
        matchStatus: "ambiguous",
        confidence: "low",
        lineNumber,
        sourceStationCode,
        routeStopNameKo: stationNameKo,
        selectedStationCandidateId: null,
        selectedStationNumber: null,
        selectedStationNameKo: null,
        candidateStationMatches: exact.map((station) => station.candidateId),
        diagnostics: ["ambiguous-exact-code-match"],
      });
      continue;
    }

    const codeOnly = stationsByStationNumber.get(sourceStationCode) ?? [];
    if (codeOnly.length > 0) {
      codeOnlyMatches.push({
        stopCandidateId: stop.candidateId,
        lineNumber,
        sourceStationCode,
        routeStopNameKo: stationNameKo,
        codeOnlyMatches: codeOnly.map((station) => ({
          stationCandidateId: station.candidateId,
          lineNumber: station.normalized?.lineNumber,
          stationNameKo: station.normalized?.stationNameKo,
        })),
      });
      reviewRecords.push({
        stopCandidateId: stop.candidateId,
        matchStatus: "code-only",
        confidence: codeOnly.length === 1 ? "medium" : "low",
        lineNumber,
        sourceStationCode,
        routeStopNameKo: stationNameKo,
        selectedStationCandidateId: codeOnly.length === 1 ? codeOnly[0]?.candidateId ?? null : null,
        selectedStationNumber: codeOnly.length === 1 ? codeOnly[0]?.normalized?.stationNumber ?? null : null,
        selectedStationNameKo: codeOnly.length === 1 ? codeOnly[0]?.normalized?.stationNameKo ?? null : null,
        candidateStationMatches: codeOnly.map((station) => station.candidateId),
        diagnostics: ["station-code-found-on-different-line"],
      });
    } else {
      const normalizedRouteStopName = normalizeStationName(stationNameKo);
      const nameMatches = normalizedRouteStopName
        ? stationsByLineAndNormalizedName.get(`${lineNumber}:${normalizedRouteStopName}`) ?? []
        : [];

      if (nameMatches.length > 0) {
        nameBasedMatches.push({
          stopCandidateId: stop.candidateId,
          lineNumber,
          sourceStationCode,
          routeStopNameKo: stationNameKo,
          normalizedRouteStopName,
          nameBasedMatches: nameMatches.map((station) => ({
            stationCandidateId: station.candidateId,
            stationNumber: station.normalized?.stationNumber,
            stationNameKo: station.normalized?.stationNameKo,
          })),
        });
        reviewRecords.push({
          stopCandidateId: stop.candidateId,
          matchStatus: "name-based",
          confidence: nameMatches.length === 1 ? "medium" : "low",
          lineNumber,
          sourceStationCode,
          routeStopNameKo: stationNameKo,
          selectedStationCandidateId: nameMatches.length === 1 ? nameMatches[0]?.candidateId ?? null : null,
          selectedStationNumber: nameMatches.length === 1 ? nameMatches[0]?.normalized?.stationNumber ?? null : null,
          selectedStationNameKo: nameMatches.length === 1 ? nameMatches[0]?.normalized?.stationNameKo ?? null : null,
          candidateStationMatches: nameMatches.map((station) => station.candidateId),
          diagnostics: ["matched-by-normalized-name"],
        });
      } else {
        const missing = {
          stopCandidateId: stop.candidateId,
          lineNumber,
          sourceStationCode,
          routeStopNameKo: stationNameKo,
          reason: "no-station-number-match",
        };
        missingMatches.push(missing);
        reviewRecords.push({
          stopCandidateId: stop.candidateId,
          matchStatus: "missing",
          confidence: "none",
          lineNumber,
          sourceStationCode,
          routeStopNameKo: stationNameKo,
          selectedStationCandidateId: null,
          selectedStationNumber: null,
          selectedStationNameKo: null,
          candidateStationMatches: [],
          diagnostics: ["no-station-candidate-match"],
        });
      }
    }
  }

  const nameMismatchExactMatches = exactMatches.filter((match) => !match.nameMatches);

  const result = {
    acquiredDate,
    generatedAt: new Date().toISOString(),
    counts: {
      stations: stations.length,
      routeStops: routeStops.length,
      exactMatches: exactMatches.length,
      exactNameMismatches: nameMismatchExactMatches.length,
      codeOnlyMatches: codeOnlyMatches.length,
      nameBasedMatches: nameBasedMatches.length,
      missingMatches: missingMatches.length,
      ambiguousExactMatches: ambiguousExactMatches.length,
    },
    samples: {
      exactNameMismatches: nameMismatchExactMatches.slice(0, 30),
      codeOnlyMatches: codeOnlyMatches.slice(0, 30),
      nameBasedMatches: nameBasedMatches.slice(0, 50),
      missingMatches: missingMatches.slice(0, 30),
      ambiguousExactMatches: ambiguousExactMatches.slice(0, 10),
    },
  };

  const outputPath = path.join(observedDir, "kric-route-stop-station-match-diagnostics.json");
  const reviewOutputPath = path.join(observedDir, "kric-route-stop-station-review.candidate.jsonl");
  writeJson(outputPath, result);
  const reviewJsonl = reviewRecords.map((record) => JSON.stringify(record)).join("\n") + "\n";
  await import("node:fs").then((fs) => fs.writeFileSync(reviewOutputPath, reviewJsonl, "utf8"));

  console.log("[collector] KRIC route-stop/station match diagnostics");
  console.log(`[collector] route stops: ${routeStops.length}`);
  console.log(`[collector] exact matches: ${exactMatches.length}`);
  console.log(`[collector] exact name mismatches: ${nameMismatchExactMatches.length}`);
  console.log(`[collector] code-only matches: ${codeOnlyMatches.length}`);
  console.log(`[collector] name-based matches: ${nameBasedMatches.length}`);
  console.log(`[collector] missing matches: ${missingMatches.length}`);
  console.log(`[collector] ambiguous exact matches: ${ambiguousExactMatches.length}`);
}
