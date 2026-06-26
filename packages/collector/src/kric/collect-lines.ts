import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { ensureDir, findRepoRoot, writeJsonl } from "../shared/fs.js";
import { toRawText, toStringOrNull, type RawCell } from "../shared/value.js";

type LineCandidateRecord = {
  candidateId: string;
  sourceId: string;
  sourcePointer: { file: string; sheet: string; rowNumber: number };
  raw: Record<string, RawCell>;
  normalized: { lineNumber: string | null; lineNameKo: string | null };
  parseDiagnostics: string[];
};

type RouteStopCandidateRecord = {
  candidateId: string;
  sourceId: string;
  sourcePointer: {
    file: string;
    sheet: string;
    rowNumber: number;
    rawField: "정거장구성";
  };
  normalized: {
    lineNumber: string | null;
    lineNameKo: string | null;
    sequence: number;
    sourceStationCode: string | null;
    stationNameKo: string | null;
  };
  rawToken: string;
  parseDiagnostics: string[];
};

function parseStationComposition(rawValue: unknown) {
  const text = toStringOrNull(rawValue);
  if (!text) return [];

  return text.split(/[,+]/).map((token, index) => {
    const rawToken = token.trim();
    const parseDiagnostics: string[] = [];

    if (!rawToken) {
      parseDiagnostics.push("empty-station-composition-token");
      return { sequence: index + 1, sourceStationCode: null, stationNameKo: null, rawToken, parseDiagnostics };
    }

    const cleanedToken = rawToken.replace(/^"+|"+$/gu, "");
    const parts = cleanedToken.split("-").map((part) => part.trim());

    if (parts.length < 2) {
      parseDiagnostics.push("missing-station-code-name-separator");
      return { sequence: index + 1, sourceStationCode: null, stationNameKo: cleanedToken, rawToken, parseDiagnostics };
    }

    let sourceStationCode: string;
    let stationNameKo: string;

    if (parts.length >= 3 && /^\d+$/u.test(parts[0] ?? "") && /^\d+$/u.test(parts[1] ?? "")) {
      sourceStationCode = `${parts[0]}-${parts[1]}`;
      stationNameKo = parts.slice(2).join("-");
      parseDiagnostics.push("parsed-branch-station-token");
    } else {
      sourceStationCode = parts[0] ?? "";
      stationNameKo = parts.slice(1).join("-");
    }

    if (!sourceStationCode) parseDiagnostics.push("missing-source-station-code");
    if (!stationNameKo) parseDiagnostics.push("missing-station-name-ko");

    return {
      sequence: index + 1,
      sourceStationCode: sourceStationCode || null,
      stationNameKo: stationNameKo || null,
      rawToken,
      parseDiagnostics,
    };
  });
}

export function collectKricLines() {
  const repoRoot = findRepoRoot(process.cwd());
  const acquiredDate = "2026-06-19";
  const sourceId = "kric_urban_rail_xlsx_20260228";

  const fileName = "전체_도시철도노선정보_20260228.xlsx";
  const sheetName = "표준데이터 노선(전체)";
  const inputPath = path.join(repoRoot, "data/raw", acquiredDate, "kric", fileName);
  const outputDir = path.join(repoRoot, "data/collected", acquiredDate, "kric");
  const linesOutputPath = path.join(outputDir, "kric-urban-rail-lines.candidate.jsonl");
  const routeStopsOutputPath = path.join(outputDir, "kric-urban-rail-route-stops.candidate.jsonl");

  console.log("[collector] KRIC urban rail line candidates");

  if (!fs.existsSync(inputPath)) throw new Error(`Input XLSX not found: ${inputPath}`);

  const workbook = XLSX.readFile(inputPath, { cellDates: false, raw: true });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });

  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);
  const routeStopRecords: RouteStopCandidateRecord[] = [];

  const lineRecords: LineCandidateRecord[] = dataRows.map((row, index) => {
    const rowNumber = index + 2;
    const raw: Record<string, RawCell> = {};
    const parseDiagnostics: string[] = [];

    headers.forEach((header, columnIndex) => {
      if (typeof header !== "string" || header.length === 0) {
        const value = row[columnIndex];
        if (value !== null && value !== undefined && value !== "") {
          parseDiagnostics.push(`value-under-empty-header-column-${columnIndex + 1}`);
        }
        return;
      }

      const value = row[columnIndex];
      raw[header] = { rawValue: value, rawText: toRawText(value) };
    });

    const lineNumber = toStringOrNull(raw["노선번호"]?.rawValue);
    const lineNameKo = toStringOrNull(raw["노선명"]?.rawValue);

    if (!lineNumber) parseDiagnostics.push("missing-line-number");
    if (!lineNameKo) parseDiagnostics.push("missing-line-name-ko");

    for (const stop of parseStationComposition(raw["정거장구성"]?.rawValue)) {
      routeStopRecords.push({
        candidateId: `candidate:kric:urban-rail-route-stop:${lineNumber ?? `row-${rowNumber}`}:${stop.sequence}`,
        sourceId,
        sourcePointer: { file: fileName, sheet: sheetName, rowNumber, rawField: "정거장구성" },
        normalized: {
          lineNumber,
          lineNameKo,
          sequence: stop.sequence,
          sourceStationCode: stop.sourceStationCode,
          stationNameKo: stop.stationNameKo,
        },
        rawToken: stop.rawToken,
        parseDiagnostics: stop.parseDiagnostics,
      });
    }

    return {
      candidateId: `candidate:kric:urban-rail-line:${lineNumber ?? `row-${rowNumber}`}`,
      sourceId,
      sourcePointer: { file: fileName, sheet: sheetName, rowNumber },
      raw,
      normalized: { lineNumber, lineNameKo },
      parseDiagnostics,
    };
  });

  ensureDir(outputDir);
  writeJsonl(linesOutputPath, lineRecords);
  writeJsonl(routeStopsOutputPath, routeStopRecords);

  console.log(`[collector] wrote line records: ${lineRecords.length}`);
  console.log(`[collector] wrote route stop records: ${routeStopRecords.length}`);
}
