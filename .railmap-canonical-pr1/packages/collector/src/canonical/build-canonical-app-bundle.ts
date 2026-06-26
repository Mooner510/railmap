import fs from "node:fs";
import path from "node:path";
import { findRepoRoot, readJsonl, writeJson } from "../shared/fs.js";
import { groupCanonicalMapRows } from "./classify-source-lines.js";
import { loadCanonicalAllowlistKeys, loadCanonicalSourceLineMap } from "./load-canonical-map.js";
import type {
  AppBranch,
  AppCanonicalLine,
  AppRouteStop,
  AppStation,
  CanonicalAppBundle,
  CanonicalSourceLineMapRow,
  MatchConfidence,
  MatchStatus,
  RouteStopCandidate,
  SkippedRouteStop,
  SourceLineCandidate,
  StationCandidate,
} from "./types.js";

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const normalized = value
    .replace(/\r?\n/gu, "")
    .replace(/\s+/gu, "")
    .replace(/역$/u, "")
    .replace(/\([^)]*\)/gu, "")
    .replace(/（[^）]*）/gu, "")
    .replace(/[·ㆍ.\-]/gu, "")
    .trim();

  return normalized.length > 0 ? normalized : null;
}

function normalizeCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const raw = String(value).replace(/^"+|"+$/gu, "").trim();
  if (!raw) return null;

  const normalizedParts = raw.split("-").map((part) => {
    const match = part.match(/^([A-Za-z]*)(\d+)$/u);
    if (!match) return part.toUpperCase();

    const prefix = match[1]?.toUpperCase() ?? "";
    const number = String(Number(match[2]));
    return `${prefix}${number}`;
  });

  return normalizedParts.join("-");
}

function sameName(a: unknown, b: unknown): boolean {
  const left = normalizeName(a);
  const right = normalizeName(b);
  return Boolean(left && right && left === right);
}

function uniqueBy<T>(values: T[], getKey: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const value of values) {
    const key = getKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

function getSourceLineKey(sourceLineNumber: string | null, sourceLineName: string | null, rowNumber?: number): string {
  return `${sourceLineNumber ?? "unknown"}::${sourceLineName ?? "unknown"}::row-${rowNumber ?? "unknown"}`;
}

function getLineOrigin(line: SourceLineCandidate): string | null {
  return line.raw?.["기점명"]?.rawText ?? null;
}

function getLineTerminal(line: SourceLineCandidate): string | null {
  return line.raw?.["종점명"]?.rawText ?? null;
}

function findMatchingSourceLines(
  sourceLines: SourceLineCandidate[],
  mapRow: CanonicalSourceLineMapRow,
): SourceLineCandidate[] {
  const exact = sourceLines.filter(
    (line) =>
      line.normalized.lineNumber === mapRow.sourceLineNumber &&
      line.normalized.lineNameKo === mapRow.sourceLineName,
  );

  if (exact.length > 0) return exact;

  return sourceLines.filter((line) => line.normalized.lineNumber === mapRow.sourceLineNumber);
}

function matchStationForStop(params: {
  stop: RouteStopCandidate;
  sourceLine: SourceLineCandidate;
  stations: StationCandidate[];
}): {
  station: StationCandidate | null;
  status: MatchStatus;
  confidence: MatchConfidence;
  diagnostics: string[];
} {
  const { stop, sourceLine, stations } = params;
  const sourceLineNumber = sourceLine.normalized.lineNumber;
  const sourceLineName = sourceLine.normalized.lineNameKo;
  const stopCode = stop.normalized.sourceStationCode;
  const stopName = stop.normalized.stationNameKo;
  const normalizedStopCode = normalizeCode(stopCode);

  const sameLineStations = stations.filter((station) => station.normalized.lineNumber === sourceLineNumber);

  const exactCode = sameLineStations.filter((station) => station.normalized.stationNumber === stopCode);
  if (exactCode.length === 1) {
    const station = exactCode[0];
    if (!station) return { station: null, status: "missing", confidence: "none", diagnostics: ["unexpected-empty-exact-code-match"] };
    return {
      station,
      status: "exact",
      confidence: sameName(stopName, station.normalized.stationNameKo) ? "high" : "medium",
      diagnostics: sameName(stopName, station.normalized.stationNameKo) ? [] : ["exact-code-name-mismatch"],
    };
  }

  if (exactCode.length > 1) {
    const preferred = exactCode.find((station) => sameName(stopName, station.normalized.stationNameKo)) ?? exactCode.find((station) => sameName(sourceLineName, station.normalized.lineNameKo));
    if (preferred) {
      return {
        station: preferred,
        status: "exact",
        confidence: "medium",
        diagnostics: ["ambiguous-exact-code-match-resolved-by-name"],
      };
    }

    return {
      station: null,
      status: "ambiguous",
      confidence: "low",
      diagnostics: [`ambiguous-exact-code-match:${exactCode.length}`],
    };
  }

  const normalizedCode = sameLineStations.filter(
    (station) => normalizeCode(station.normalized.stationNumber) === normalizedStopCode,
  );
  if (normalizedCode.length === 1) {
    const station = normalizedCode[0];
    if (!station) return { station: null, status: "missing", confidence: "none", diagnostics: ["unexpected-empty-normalized-code-match"] };
    return {
      station,
      status: "normalized-code",
      confidence: sameName(stopName, station.normalized.stationNameKo) ? "high" : "medium",
      diagnostics: ["matched-by-normalized-station-code"],
    };
  }

  if (normalizedCode.length > 1) {
    const preferred = normalizedCode.find((station) => sameName(stopName, station.normalized.stationNameKo));
    if (preferred) {
      return {
        station: preferred,
        status: "normalized-code",
        confidence: "medium",
        diagnostics: ["ambiguous-normalized-code-match-resolved-by-name"],
      };
    }
  }

  const nameMatches = sameLineStations.filter((station) => sameName(station.normalized.stationNameKo, stopName));
  if (nameMatches.length === 1) {
    const station = nameMatches[0];
    if (!station) return { station: null, status: "missing", confidence: "none", diagnostics: ["unexpected-empty-name-match"] };
    return {
      station,
      status: "name-based",
      confidence: "medium",
      diagnostics: ["matched-by-normalized-name"],
    };
  }

  if (nameMatches.length > 1) {
    const preferred = nameMatches.find((station) => sameName(sourceLineName, station.normalized.lineNameKo));
    if (preferred) {
      return {
        station: preferred,
        status: "name-based",
        confidence: "medium",
        diagnostics: ["ambiguous-name-match-resolved-by-source-line-name"],
      };
    }

    return {
      station: null,
      status: "ambiguous",
      confidence: "low",
      diagnostics: [`ambiguous-name-match:${nameMatches.length}`],
    };
  }

  return {
    station: null,
    status: "missing",
    confidence: "none",
    diagnostics: ["no-station-candidate-match"],
  };
}

function addStation(
  stationsById: Map<string, AppStation>,
  station: StationCandidate,
  canonicalLineId: string,
): string {
  const stationId = station.candidateId;
  const existing = stationsById.get(stationId);

  if (existing) {
    if (!existing.canonicalLineIds.includes(canonicalLineId)) existing.canonicalLineIds.push(canonicalLineId);
    const sourceLineNumber = station.normalized.lineNumber;
    if (sourceLineNumber && !existing.sourceLineNumbers.includes(sourceLineNumber)) {
      existing.sourceLineNumbers.push(sourceLineNumber);
    }
    return stationId;
  }

  stationsById.set(stationId, {
    id: stationId,
    stationNumber: station.normalized.stationNumber,
    nameKo: station.normalized.stationNameKo,
    nameEn: station.normalized.stationNameEn,
    lat: station.normalized.latitude,
    lng: station.normalized.longitude,
    operatorNameKo: station.normalized.operatorNameKo,
    sourceCandidateId: station.candidateId,
    sourceLineNumbers: station.normalized.lineNumber ? [station.normalized.lineNumber] : [],
    canonicalLineIds: [canonicalLineId],
  });

  return stationId;
}

export function buildKricCanonicalAppBundle() {
  const repoRoot = findRepoRoot(process.cwd());
  const acquiredDate = "2026-06-19";

  const collectedDir = path.join(repoRoot, "data/collected", acquiredDate, "kric");
  const outputDir = path.join(repoRoot, "data/generated", acquiredDate, "app-bundle");

  const sourceLines = readJsonl<SourceLineCandidate>(path.join(collectedDir, "kric-urban-rail-lines.candidate.jsonl"));
  const stations = readJsonl<StationCandidate>(path.join(collectedDir, "kric-urban-rail-stations.candidate.jsonl"));
  const routeStops = readJsonl<RouteStopCandidate>(path.join(collectedDir, "kric-urban-rail-route-stops.candidate.jsonl"));

  const canonicalMap = loadCanonicalSourceLineMap(repoRoot);
  const allowlistKeys = loadCanonicalAllowlistKeys(repoRoot);
  const groupedMap = groupCanonicalMapRows(canonicalMap);
  const stationsById = new Map<string, AppStation>();
  const skippedRouteStops: SkippedRouteStop[] = [];
  const lines: AppCanonicalLine[] = [];

  const excludedCanonicalKeys = [...allowlistKeys].filter((key) => !groupedMap.has(key));

  for (const [canonicalKey, mapRows] of groupedMap.entries()) {
    const firstMapRow = mapRows[0];
    if (!firstMapRow) continue;

    const canonicalLineId = canonicalKey;
    const branches: AppBranch[] = [];

    for (const [mapRowIndex, mapRow] of mapRows.entries()) {
      const matchingSourceLines = findMatchingSourceLines(sourceLines, mapRow);

      for (const [sourceLineIndex, sourceLine] of matchingSourceLines.entries()) {
        const branchId = `${canonicalKey}:${mapRow.role}:${mapRow.sourceLineNumber}:${sourceLine.sourcePointer.rowNumber}:${mapRowIndex}:${sourceLineIndex}`;
        const sourceLineKey = getSourceLineKey(
          sourceLine.normalized.lineNumber,
          sourceLine.normalized.lineNameKo,
          sourceLine.sourcePointer.rowNumber,
        );

        const sourceRouteStops = routeStops
          .filter(
            (stop) =>
              stop.sourcePointer.rowNumber === sourceLine.sourcePointer.rowNumber &&
              stop.normalized.lineNumber === sourceLine.normalized.lineNumber,
          )
          .sort((a, b) => a.normalized.sequence - b.normalized.sequence);

        const appRouteStops: AppRouteStop[] = [];

        for (const stop of sourceRouteStops) {
          const matched = matchStationForStop({ stop, sourceLine, stations });

          if (!matched.station) {
            skippedRouteStops.push({
              stopCandidateId: stop.candidateId,
              canonicalLineId,
              branchId,
              sourceLineNumber: stop.normalized.lineNumber,
              sourceLineName: stop.normalized.lineNameKo,
              sourceStationCode: stop.normalized.sourceStationCode,
              stationNameKo: stop.normalized.stationNameKo,
              reason: `${matched.status}:${matched.confidence}`,
              diagnostics: matched.diagnostics,
            });
            continue;
          }

          const stationId = addStation(stationsById, matched.station, canonicalLineId);
          appRouteStops.push({
            id: `${branchId}:${stop.normalized.sequence}:${stationId}`,
            canonicalLineId,
            branchId,
            sourceLineNumber: mapRow.sourceLineNumber,
            sourceLineName: mapRow.sourceLineName,
            role: mapRow.role,
            sequence: stop.normalized.sequence,
            stationId,
            sourceStationCode: stop.normalized.sourceStationCode,
            displayNameKo: stop.normalized.stationNameKo,
            matchStatus: matched.status,
            confidence: matched.confidence,
            sourceCandidateId: `${stop.candidateId}:${sourceLineKey}`,
            diagnostics: matched.diagnostics,
          });
        }

        branches.push({
          id: branchId,
          canonicalLineId,
          role: mapRow.role,
          sourceLineNumber: mapRow.sourceLineNumber,
          sourceLineName: mapRow.sourceLineName,
          origin: getLineOrigin(sourceLine),
          terminal: getLineTerminal(sourceLine),
          routeStops: uniqueBy(appRouteStops, (stop) => stop.id),
        });
      }
    }

    const sourceLineNumbers = uniqueBy(
      mapRows.map((row) => row.sourceLineNumber),
      (value) => value,
    );

    lines.push({
      id: canonicalLineId,
      canonicalKey,
      lnCd: firstMapRow.lnCd,
      mreaWideCd: firstMapRow.mreaWideCd,
      nameKo: firstMapRow.canonicalName,
      branches,
      sourceLineNumbers,
    });
  }

  const sortedLines = lines.sort((a, b) => {
    const area = a.mreaWideCd.localeCompare(b.mreaWideCd, "ko");
    if (area !== 0) return area;
    return a.nameKo.localeCompare(b.nameKo, "ko");
  });

  const bundle: CanonicalAppBundle = {
    bundleId: "kric-canonical-app-bundle",
    acquiredDate,
    generatedAt: new Date().toISOString(),
    policy: {
      canonicalSource: "data/manual/kric-subway-route-info-line-map.csv",
      sourceLineMap: "data/manual/kric-canonical-source-line-map.csv",
      excludedCanonicalKeys,
      note: "Canonical line classification is based on the manual KRIC subwayRouteInfo allowlist. GTX-A may be excluded if it has no source-line mapping.",
    },
    counts: {
      canonicalLines: sortedLines.length,
      branches: sortedLines.reduce((sum, line) => sum + line.branches.length, 0),
      stations: stationsById.size,
      routeStops: sortedLines.reduce(
        (sum, line) => sum + line.branches.reduce((branchSum, branch) => branchSum + branch.routeStops.length, 0),
        0,
      ),
      skippedRouteStops: skippedRouteStops.length,
      missingCanonicalLines: excludedCanonicalKeys.length,
    },
    lines: sortedLines,
    stations: [...stationsById.values()].sort((a, b) => (a.nameKo ?? "").localeCompare(b.nameKo ?? "", "ko")),
    skippedRouteStops,
    missingCanonicalLines: excludedCanonicalKeys,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "kric-canonical-app-bundle.json");
  writeJson(outputPath, bundle);

  console.log(`[collector] wrote canonical app bundle: ${path.relative(repoRoot, outputPath)}`);
  console.log(`[collector] canonical bundle counts: ${JSON.stringify(bundle.counts)}`);
}
