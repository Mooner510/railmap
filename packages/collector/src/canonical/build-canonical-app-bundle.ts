import fs from "node:fs";
import path from "node:path";
import { findRepoRoot, readJsonl, writeJson } from "../shared/fs.js";

type JsonRecord = Record<string, any>;

export function buildKricMinimalAppBundle() {
  const repoRoot = findRepoRoot(process.cwd());
  const acquiredDate = "2026-06-19";

  const collectedDir = path.join(repoRoot, "data/collected", acquiredDate, "kric");
  const observedDir = path.join(repoRoot, "data/observed", acquiredDate, "kric");
  const outputDir = path.join(repoRoot, "data/generated", acquiredDate, "app-bundle");

  const lines = readJsonl<JsonRecord>(path.join(collectedDir, "kric-urban-rail-lines.candidate.jsonl"));
  const stations = readJsonl<JsonRecord>(path.join(collectedDir, "kric-urban-rail-stations.candidate.jsonl"));
  const routeStops = readJsonl<JsonRecord>(path.join(collectedDir, "kric-urban-rail-route-stops.candidate.jsonl"));
  const reviews = readJsonl<JsonRecord>(path.join(observedDir, "kric-route-stop-station-review.candidate.jsonl"));

  const stationByCandidateId = new Map(stations.map((station) => [station.candidateId, station]));
  const reviewByStopCandidateId = new Map(reviews.map((review) => [review.stopCandidateId, review]));

  const publishableStatuses = new Set(["exact", "name-based", "code-only"]);
  const publishableConfidences = new Set(["high", "medium"]);

  const appLines = lines.map((line) => ({
    id: line.normalized.lineNumber,
    nameKo: line.normalized.lineNameKo,
    sourceCandidateId: line.candidateId,
  }));

  const appStationsById = new Map<string, JsonRecord>();
  const appRouteStops: JsonRecord[] = [];
  const skippedRouteStops: JsonRecord[] = [];

  for (const stop of routeStops) {
    const review = reviewByStopCandidateId.get(stop.candidateId);

    if (
      !review ||
      !publishableStatuses.has(review.matchStatus) ||
      !publishableConfidences.has(review.confidence) ||
      !review.selectedStationCandidateId
    ) {
      skippedRouteStops.push({
        stopCandidateId: stop.candidateId,
        lineNumber: stop.normalized?.lineNumber,
        sourceStationCode: stop.normalized?.sourceStationCode,
        stationNameKo: stop.normalized?.stationNameKo,
        reason: review ? `${review.matchStatus}:${review.confidence}` : "no-review-record",
      });
      continue;
    }

    const station = stationByCandidateId.get(review.selectedStationCandidateId);
    if (!station) {
      skippedRouteStops.push({
        stopCandidateId: stop.candidateId,
        reason: "selected-station-not-found",
      });
      continue;
    }

    const stationId = station.candidateId;
    appStationsById.set(stationId, {
      id: stationId,
      stationNumber: station.normalized.stationNumber,
      nameKo: station.normalized.stationNameKo,
      nameEn: station.normalized.stationNameEn,
      lineNumber: station.normalized.lineNumber,
      lineNameKo: station.normalized.lineNameKo,
      lat: station.normalized.latitude,
      lng: station.normalized.longitude,
      operatorNameKo: station.normalized.operatorNameKo,
      sourceCandidateId: station.candidateId,
    });

    appRouteStops.push({
      lineId: stop.normalized.lineNumber,
      sequence: stop.normalized.sequence,
      stationId,
      sourceStationCode: stop.normalized.sourceStationCode,
      displayNameKo: stop.normalized.stationNameKo,
      matchStatus: review.matchStatus,
      confidence: review.confidence,
      sourceCandidateId: stop.candidateId,
    });
  }

  const bundle = {
    bundleId: "kric-minimal-app-bundle",
    acquiredDate,
    generatedAt: new Date().toISOString(),
    policy: {
      includedRouteStops: ["exact:high", "exact:medium", "name-based:medium", "code-only:medium"],
      excludedRouteStops: ["missing", "ambiguous", "code-only:low"],
      note: "This is a candidate app bundle. Manual review is still required before final publication.",
    },
    counts: {
      lines: appLines.length,
      stations: appStationsById.size,
      routeStops: appRouteStops.length,
      skippedRouteStops: skippedRouteStops.length,
    },
    lines: appLines,
    stations: [...appStationsById.values()],
    routeStops: appRouteStops,
    skippedRouteStops,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  writeJson(path.join(outputDir, "kric-minimal-app-bundle.json"), bundle);

  console.log(`[collector] wrote app bundle: ${path.relative(repoRoot, path.join(outputDir, "kric-minimal-app-bundle.json"))}`);
  console.log(`[collector] bundle counts: ${JSON.stringify(bundle.counts)}`);
}
