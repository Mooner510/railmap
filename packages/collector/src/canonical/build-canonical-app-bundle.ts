import fs from "node:fs";
import path from "node:path";
import { findRepoRoot, readJsonl, writeJson } from "../shared/fs.js";

type JsonRecord = Record<string, any>;

type MatchResult = {
  station: JsonRecord | null;
  status: string;
  confidence: "high" | "medium" | "low" | "none";
  diagnostics: string[];
};

const ACQUIRED_DATE = "2026-06-19";

type CanonicalSourceLineMapRow = {
  canonicalKey: string;
  lnCd: string;
  canonicalName: string;
  mreaWideCd: string;
  sourceLineNumber: string;
  sourceLineName: string;
  role: "main" | "branch";
};

function loadCanonicalMap(repoRoot: string): CanonicalSourceLineMapRow[] {
  const csv = fs.readFileSync(
    path.join(repoRoot, "data/manual/kric-canonical-source-line-map.csv"),
    "utf8",
  );

  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((row): CanonicalSourceLineMapRow => {
      const [
        canonicalKey,
        lnCd,
        canonicalName,
        mreaWideCd,
        sourceLineNumber,
        sourceLineName,
        role,
      ] = row.split(",");

      const normalizedRole = normalizeKey(role);

      if (normalizedRole !== "main" && normalizedRole !== "branch") {
        throw new Error(`Invalid canonical source line role: ${role}`);
      }

      return {
        canonicalKey: normalizeKey(canonicalKey),
        lnCd: normalizeKey(lnCd),
        canonicalName: normalizeKey(canonicalName),
        mreaWideCd: normalizeKey(mreaWideCd),
        sourceLineNumber: normalizeKey(sourceLineNumber),
        sourceLineName: normalizeKey(sourceLineName),
        role: normalizedRole,
      };
    });
}

function normalizeSpaces(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value: unknown): string {
  return normalizeSpaces(value);
}

function normalizeStationCode(value: unknown): string {
  return String(value ?? "").replace(/[^0-9A-Za-z가-힣]/g, "").trim();
}

function normalizeStationName(value: unknown): string {
  return normalizeSpaces(value)
    .replace(/\([^)]*\)/g, "")
    .replace(/역$/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function getNormalized(record: JsonRecord): JsonRecord {
  return (record.normalized ?? {}) as JsonRecord;
}

function getLineNumber(record: JsonRecord): string {
  return normalizeKey(getNormalized(record).lineNumber);
}

function getLineName(record: JsonRecord): string {
  return normalizeKey(getNormalized(record).lineNameKo);
}

function getStationNumber(station: JsonRecord): string {
  return normalizeKey(getNormalized(station).stationNumber);
}

function getStationName(station: JsonRecord): string {
  return normalizeKey(getNormalized(station).stationNameKo);
}

function getRouteStopName(stop: JsonRecord): string {
  return normalizeKey(getNormalized(stop).stationNameKo);
}

function getSourceStationCode(stop: JsonRecord): string {
  return normalizeKey(getNormalized(stop).sourceStationCode);
}

function getSequence(stop: JsonRecord): number {
  const value = Number(getNormalized(stop).sequence);
  return Number.isFinite(value) ? value : 0;
}

function getLat(station: JsonRecord): number | null {
  const value = Number(getNormalized(station).latitude);
  return Number.isFinite(value) ? value : null;
}

function getLng(station: JsonRecord): number | null {
  const value = Number(getNormalized(station).longitude);
  return Number.isFinite(value) ? value : null;
}

function getRawText(record: JsonRecord, key: string): string {
  return normalizeKey(record.raw?.[key]?.rawText ?? record.raw?.[key]?.rawValue);
}

function getOrigin(line: JsonRecord): string | null {
  const n = getNormalized(line);
  return (
    normalizeKey(n.originStationNameKo) ||
    normalizeKey(n.originStationName) ||
    normalizeKey(n.origin) ||
    normalizeKey(n.startStationNameKo) ||
    normalizeKey(n.startStationName) ||
    getRawText(line, "기점명") ||
    null
  );
}

function getTerminal(line: JsonRecord): string | null {
  const n = getNormalized(line);
  return (
    normalizeKey(n.terminalStationNameKo) ||
    normalizeKey(n.terminalStationName) ||
    normalizeKey(n.terminal) ||
    normalizeKey(n.endStationNameKo) ||
    normalizeKey(n.endStationName) ||
    getRawText(line, "종점명") ||
    null
  );
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();

  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }

  return map;
}

function sortBySequence(a: JsonRecord, b: JsonRecord): number {
  return getSequence(a) - getSequence(b);
}

function uniqueByCandidateId(items: JsonRecord[]): JsonRecord[] {
  const seen = new Set<string>();
  const result: JsonRecord[] = [];

  for (const item of items) {
    const id = normalizeKey(item.candidateId);
    if (!id || seen.has(id)) continue;

    seen.add(id);
    result.push(item);
  }

  return result;
}

function firstWithCoordinate(items: JsonRecord[]): JsonRecord | null {
  return items.find((item) => getLat(item) !== null && getLng(item) !== null) ?? items[0] ?? null;
}

function makeStationPayload(station: JsonRecord): JsonRecord {
  const n = getNormalized(station);

  return {
    id: station.candidateId,
    stationNumber: n.stationNumber,
    nameKo: n.stationNameKo,
    nameEn: n.stationNameEn,
    lineNumber: n.lineNumber,
    lineNameKo: n.lineNameKo,
    lat: n.latitude,
    lng: n.longitude,
    operatorNameKo: n.operatorNameKo,
    sourceCandidateId: station.candidateId,
  };
}

function makeLineSourceKey(lineNumber: string, lineName: string): string {
  return `${normalizeKey(lineNumber)}\u0000${normalizeKey(lineName)}`;
}

function buildStationMatcher(stations: JsonRecord[]) {
  const byLineCode = groupBy(
    stations,
    (station) => `${getLineNumber(station)}\u0000${getStationNumber(station)}`,
  );

  const byLineNormalizedCode = groupBy(
    stations,
    (station) => `${getLineNumber(station)}\u0000${normalizeStationCode(getStationNumber(station))}`,
  );

  const byLineName = groupBy(
    stations,
    (station) => `${getLineNumber(station)}\u0000${normalizeStationName(getStationName(station))}`,
  );

  const byGlobalName = groupBy(
    stations,
    (station) => normalizeStationName(getStationName(station)),
  );

  function resolveCandidates(
    candidates: JsonRecord[],
    stop: JsonRecord,
    relatedLineNumbers: Set<string>,
  ): MatchResult {
    const unique = uniqueByCandidateId(candidates);

    if (unique.length === 0) {
      return {
        station: null,
        status: "missing",
        confidence: "none",
        diagnostics: ["no-station-candidate-match"],
      };
    }

    if (unique.length === 1) {
      return {
        station: unique[0] ?? null,
        status: "name-based",
        confidence: "medium",
        diagnostics: ["matched-by-normalized-name"],
      };
    }

    const stopName = normalizeStationName(getRouteStopName(stop));

    const sameName = unique.filter(
      (station) => normalizeStationName(getStationName(station)) === stopName,
    );

    const related = sameName.filter((station) => relatedLineNumbers.has(getLineNumber(station)));

    if (related.length === 1) {
      return {
        station: related[0] ?? null,
        status: "name-based",
        confidence: "medium",
        diagnostics: ["ambiguous-name-match-resolved-by-related-source-line"],
      };
    }

    if (related.length > 1) {
      return {
        station: firstWithCoordinate(related),
        status: "name-based",
        confidence: "low",
        diagnostics: ["ambiguous-name-match-resolved-by-first-related-source-line"],
      };
    }

    const withCoordinate = firstWithCoordinate(sameName.length > 0 ? sameName : unique);

    return {
      station: withCoordinate,
      status: "name-based",
      confidence: "low",
      diagnostics: ["ambiguous-name-match-resolved-by-first-global-candidate"],
    };
  }

  return function matchStation(stop: JsonRecord, relatedLineNumbers: Set<string>): MatchResult {
    const lineNumber = getLineNumber(stop);
    const sourceStationCode = getSourceStationCode(stop);
    const normalizedCode = normalizeStationCode(sourceStationCode);
    const stopName = normalizeStationName(getRouteStopName(stop));

    const exactCodeMatches = byLineCode.get(`${lineNumber}\u0000${sourceStationCode}`) ?? [];
    if (exactCodeMatches.length === 1) {
      return {
        station: exactCodeMatches[0] ?? null,
        status: "exact",
        confidence: "high",
        diagnostics: [],
      };
    }

    if (exactCodeMatches.length > 1) {
      const resolved = resolveCandidates(exactCodeMatches, stop, relatedLineNumbers);
      return {
        ...resolved,
        status: "exact",
        confidence: resolved.confidence === "none" ? "none" : "medium",
        diagnostics: ["ambiguous-exact-code-match-resolved-by-name", ...resolved.diagnostics],
      };
    }

    const normalizedCodeMatches =
      byLineNormalizedCode.get(`${lineNumber}\u0000${normalizedCode}`) ?? [];

    if (normalizedCodeMatches.length === 1) {
      return {
        station: normalizedCodeMatches[0] ?? null,
        status: "normalized-code",
        confidence: "high",
        diagnostics: ["matched-by-normalized-station-code"],
      };
    }

    if (normalizedCodeMatches.length > 1) {
      const resolved = resolveCandidates(normalizedCodeMatches, stop, relatedLineNumbers);
      return {
        ...resolved,
        status: "normalized-code",
        confidence: resolved.confidence === "none" ? "none" : "medium",
        diagnostics: ["ambiguous-normalized-code-match-resolved-by-name", ...resolved.diagnostics],
      };
    }

    const sameLineNameMatches = byLineName.get(`${lineNumber}\u0000${stopName}`) ?? [];
    if (sameLineNameMatches.length > 0) {
      const resolved = resolveCandidates(sameLineNameMatches, stop, relatedLineNumbers);
      return {
        ...resolved,
        status: "name-based",
        confidence: resolved.confidence === "none" ? "none" : "medium",
      };
    }

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

    return {
      station: null,
      status: "missing",
      confidence: "none",
      diagnostics: ["no-station-candidate-match"],
    };
  };
}

export function buildKricCanonicalAppBundle() {
  const repoRoot = findRepoRoot(process.cwd());

  const collectedDir = path.join(repoRoot, "data/collected", ACQUIRED_DATE, "kric");
  const outputDir = path.join(repoRoot, "data/generated", ACQUIRED_DATE, "app-bundle");
  const publicDataDir = path.join(repoRoot, "apps/web/public/data");

  const canonicalMap = loadCanonicalMap(repoRoot);

  const allowlistCsv = fs.readFileSync(
    path.join(repoRoot, "data/manual/kric-subway-route-info-line-map.csv"),
    "utf8",
  );

  const allowlistRows = allowlistCsv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((row) => {
      const [lnCd, nameKo, mreaWideCd] = row.split(",");
      return {
        canonicalKey: `${normalizeKey(mreaWideCd)}:${normalizeKey(lnCd)}`,
        lnCd: normalizeKey(lnCd),
        nameKo: normalizeKey(nameKo),
        mreaWideCd: normalizeKey(mreaWideCd),
      };
    });

  const lines = readJsonl<JsonRecord>(path.join(collectedDir, "kric-urban-rail-lines.candidate.jsonl"));
  const stations = readJsonl<JsonRecord>(path.join(collectedDir, "kric-urban-rail-stations.candidate.jsonl"));
  const routeStops = readJsonl<JsonRecord>(path.join(collectedDir, "kric-urban-rail-route-stops.candidate.jsonl"));

  const lineBySourceKey = new Map<string, JsonRecord>();
  for (const line of lines) {
    lineBySourceKey.set(makeLineSourceKey(getLineNumber(line), getLineName(line)), line);
  }

  const routeStopsBySourceKey = groupBy(
    routeStops,
    (stop) => makeLineSourceKey(getLineNumber(stop), getLineName(stop)),
  );

  const mapRowsByCanonicalKey = groupBy(
    canonicalMap,
    (row) => normalizeKey(row.canonicalKey),
  );

  const matchStation = buildStationMatcher(stations);

  const appStationsById = new Map<string, JsonRecord>();
  const appRouteStops: JsonRecord[] = [];
  const skippedRouteStops: JsonRecord[] = [];
  const appLines: JsonRecord[] = [];
  const missingCanonicalLines: string[] = [];

  for (const allowlistRow of allowlistRows) {
    const mapRows = mapRowsByCanonicalKey.get(allowlistRow.canonicalKey) ?? [];

    if (mapRows.length === 0) {
      missingCanonicalLines.push(allowlistRow.canonicalKey);
      continue;
    }

    const relatedLineNumbers = new Set(mapRows.map((row) => normalizeKey(row.sourceLineNumber)));
    const branches: JsonRecord[] = [];

    for (const [mapRowIndex, mapRow] of mapRows.entries()) {
      const sourceLineNumber = normalizeKey(mapRow.sourceLineNumber);
      const sourceLineName = normalizeKey(mapRow.sourceLineName);
      const sourceKey = makeLineSourceKey(sourceLineNumber, sourceLineName);

      const line = lineBySourceKey.get(sourceKey);
      const stops = [...(routeStopsBySourceKey.get(sourceKey) ?? [])].sort(sortBySequence);

      const branchId = [
        allowlistRow.canonicalKey,
        normalizeKey(mapRow.role),
        sourceLineNumber,
        sourceLineName,
        String(mapRowIndex),
      ].join(":");

      const branchRouteStops: JsonRecord[] = [];

      for (const stop of stops) {
        const matched = matchStation(stop, relatedLineNumbers);

        if (!matched.station) {
          skippedRouteStops.push({
            stopCandidateId: stop.candidateId,
            canonicalLineId: allowlistRow.canonicalKey,
            branchId,
            sourceLineNumber,
            sourceLineName,
            sourceStationCode: getSourceStationCode(stop),
            stationNameKo: getRouteStopName(stop),
            sequence: getSequence(stop),
            reason: `${matched.status}:${matched.confidence}`,
            diagnostics: matched.diagnostics,
          });
          continue;
        }

        const stationId = normalizeKey(matched.station.candidateId);
        appStationsById.set(stationId, makeStationPayload(matched.station));

        const routeStopPayload = {
          id: `${branchId}:${getSequence(stop)}:${stationId}`,
          canonicalLineId: allowlistRow.canonicalKey,
          branchId,
          sourceLineNumber,
          sourceLineName,
          role: mapRow.role,
          sequence: getSequence(stop),
          stationId,
          sourceStationCode: getSourceStationCode(stop),
          displayNameKo: getRouteStopName(stop),
          matchStatus: matched.status,
          confidence: matched.confidence,
          sourceCandidateId: stop.candidateId,
          diagnostics: matched.diagnostics,
        };

        branchRouteStops.push(routeStopPayload);
        appRouteStops.push(routeStopPayload);
      }

      branches.push({
        id: branchId,
        canonicalLineId: allowlistRow.canonicalKey,
        role: mapRow.role,
        sourceLineNumber,
        sourceLineName,
        origin: line ? getOrigin(line) : null,
        terminal: line ? getTerminal(line) : null,
        routeStops: branchRouteStops,
      });
    }

    appLines.push({
      id: allowlistRow.canonicalKey,
      canonicalKey: allowlistRow.canonicalKey,
      lnCd: allowlistRow.lnCd,
      mreaWideCd: allowlistRow.mreaWideCd,
      nameKo: allowlistRow.nameKo,
      branches,
      sourceLineNumbers: [...new Set(mapRows.map((row) => normalizeKey(row.sourceLineNumber)))],
    });
  }

  const bundle = {
    bundleId: "kric-canonical-app-bundle",
    acquiredDate: ACQUIRED_DATE,
    generatedAt: new Date().toISOString(),
    policy: {
      canonicalLineSource: "data/manual/kric-subway-route-info-line-map.csv",
      canonicalSourceLineMap: "data/manual/kric-canonical-source-line-map.csv",
      includedRouteStopMatches: [
        "exact",
        "normalized-code",
        "name-based",
      ],
      note: "Candidate app bundle generated from KRIC raw candidates and manual canonical line mapping. Manual review is still required before final publication.",
    },
    counts: {
      canonicalLines: appLines.length,
      branches: appLines.reduce((sum, line) => sum + line.branches.length, 0),
      stations: appStationsById.size,
      routeStops: appRouteStops.length,
      skippedRouteStops: skippedRouteStops.length,
      missingCanonicalLines: missingCanonicalLines.length,
    },
    lines: appLines,
    stations: [...appStationsById.values()],
    routeStops: appRouteStops,
    skippedRouteStops,
    missingCanonicalLines,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(publicDataDir, { recursive: true });

  const outputPath = path.join(outputDir, "kric-canonical-app-bundle.json");
  const publicPath = path.join(publicDataDir, "kric-canonical-app-bundle.json");

  writeJson(outputPath, bundle);
  writeJson(publicPath, bundle);

  console.log(`[collector] wrote canonical app bundle: ${path.relative(repoRoot, outputPath)}`);
  console.log(`[collector] copied canonical app bundle: ${path.relative(repoRoot, publicPath)}`);
  console.log(`[collector] canonical bundle counts: ${JSON.stringify(bundle.counts)}`);
}
