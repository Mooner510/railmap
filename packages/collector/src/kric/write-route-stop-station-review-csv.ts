import path from "node:path";
import { findRepoRoot, readJsonl } from "../shared/fs.js";
import fs from "node:fs";

type ReviewRecord = {
  stopCandidateId: string;
  matchStatus: string;
  confidence: string;
  lineNumber: string | null;
  sourceStationCode: string | null;
  routeStopNameKo: string | null;
  selectedStationCandidateId: string | null;
  selectedStationNumber: string | null;
  selectedStationNameKo: string | null;
  candidateStationMatches: string[];
  diagnostics: string[];
};

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function writeKricRouteStopStationReviewCsv() {
  const repoRoot = findRepoRoot(process.cwd());
  const acquiredDate = "2026-06-19";
  const observedDir = path.join(repoRoot, "data/observed", acquiredDate, "kric");

  const inputPath = path.join(observedDir, "kric-route-stop-station-review.candidate.jsonl");
  const outputPath = path.join(observedDir, "kric-route-stop-station-review.candidate.csv");

  const rows = readJsonl<ReviewRecord>(inputPath);

  const headers = [
    "matchStatus",
    "confidence",
    "lineNumber",
    "sourceStationCode",
    "routeStopNameKo",
    "selectedStationNumber",
    "selectedStationNameKo",
    "selectedStationCandidateId",
    "candidateStationMatches",
    "diagnostics",
    "stopCandidateId"
  ];

  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.matchStatus,
        row.confidence,
        row.lineNumber,
        row.sourceStationCode,
        row.routeStopNameKo,
        row.selectedStationNumber,
        row.selectedStationNameKo,
        row.selectedStationCandidateId,
        row.candidateStationMatches.join(" | "),
        row.diagnostics.join(" | "),
        row.stopCandidateId
      ].map(csvEscape).join(",")
    )
  ].join("\n") + "\n";

  fs.writeFileSync(outputPath, csv, "utf8");

  console.log(`[collector] wrote review csv: ${path.relative(repoRoot, outputPath)}`);
}
