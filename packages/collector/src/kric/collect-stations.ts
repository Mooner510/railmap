import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { findRepoRoot, writeJsonl } from "../shared/fs.js";
import { toNumberOrNull, toRawText, toStringOrNull, type RawCell } from "../shared/value.js";

type StationCandidateRecord = {
  candidateId: string;
  sourceId: string;
  sourcePointer: { file: string; sheet: string; rowNumber: number };
  raw: Record<string, RawCell>;
  normalized: {
    stationNumber: string | null;
    stationNameKo: string | null;
    lineNumber: string | null;
    lineNameKo: string | null;
    stationNameEn: string | null;
    latitude: number | null;
    longitude: number | null;
    operatorNameKo: string | null;
  };
  parseDiagnostics: string[];
};

export function collectKricStations() {
  const repoRoot = findRepoRoot(process.cwd());
  const acquiredDate = "2026-06-19";
  const sourceId = "kric_urban_rail_xlsx_20260228";

  const fileName = "전체_도시철도역사정보_20260228.xlsx";
  const sheetName = "표준데이터 역사";
  const inputPath = path.join(repoRoot, "data/raw", acquiredDate, "kric", fileName);
  const outputPath = path.join(repoRoot, "data/collected", acquiredDate, "kric", "kric-urban-rail-stations.candidate.jsonl");

  console.log("[collector] KRIC urban rail station candidates");

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

  const records: StationCandidateRecord[] = dataRows.map((row, index) => {
    const rowNumber = index + 2;
    const raw: Record<string, RawCell> = {};
    const parseDiagnostics: string[] = [];

    headers.forEach((header, columnIndex) => {
      if (typeof header !== "string" || header.length === 0) return;
      const value = row[columnIndex];
      raw[header] = { rawValue: value, rawText: toRawText(value) };
    });

    const stationNumber = toStringOrNull(raw["역번호"]?.rawValue);
    const stationNameKo = toStringOrNull(raw["역사명"]?.rawValue);
    const lineNumber = toStringOrNull(raw["노선번호"]?.rawValue);
    const lineNameKo = toStringOrNull(raw["노선명"]?.rawValue);
    const stationNameEn = toStringOrNull(raw["영문역사명"]?.rawValue);
    const latitude = toNumberOrNull(raw["역위도"]?.rawValue);
    const longitude = toNumberOrNull(raw["역경도"]?.rawValue);
    const operatorNameKo = toStringOrNull(raw["운영기관명"]?.rawValue);

    if (!stationNumber) parseDiagnostics.push("missing-station-number");
    if (!stationNameKo) parseDiagnostics.push("missing-station-name-ko");
    if (!lineNumber) parseDiagnostics.push("missing-line-number");
    if (!lineNameKo) parseDiagnostics.push("missing-line-name-ko");
    if (latitude === null) parseDiagnostics.push("missing-or-invalid-latitude");
    if (longitude === null) parseDiagnostics.push("missing-or-invalid-longitude");

    return {
      candidateId: `candidate:kric:urban-rail-station:${lineNumber ?? "unknown-line"}:${stationNumber ?? `row-${rowNumber}`}:row-${rowNumber}`,
      sourceId,
      sourcePointer: { file: fileName, sheet: sheetName, rowNumber },
      raw,
      normalized: {
        stationNumber,
        stationNameKo,
        lineNumber,
        lineNameKo,
        stationNameEn,
        latitude,
        longitude,
        operatorNameKo,
      },
      parseDiagnostics,
    };
  });

  writeJsonl(outputPath, records);
  console.log(`[collector] wrote station records: ${records.length}`);
}
