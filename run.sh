{
  echo "[1/5] canonical diagnostics 생성기 추가..." >&2

  cat > packages/collector/src/canonical/write-canonical-diagnostics.ts <<'EOF'
import fs from "node:fs";
import path from "node:path";
import { findRepoRoot, writeJson } from "../shared/fs.js";

type JsonRecord = Record<string, any>;

const ACQUIRED_DATE = "2026-06-19";

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(filePath: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) {
    fs.writeFileSync(filePath, "", "utf8");
    return;
  }

  const headers = Object.keys(rows[0] ?? {});
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");

  fs.writeFileSync(filePath, `${csv}\n`, "utf8");
}

function summarizeConfidence(routeStops: JsonRecord[]) {
  const summary: Record<string, number> = {};

  for (const stop of routeStops) {
    const key = String(stop.confidence ?? "unknown");
    summary[key] = (summary[key] ?? 0) + 1;
  }

  return summary;
}

function summarizeMatchStatus(routeStops: JsonRecord[]) {
  const summary: Record<string, number> = {};

  for (const stop of routeStops) {
    const key = String(stop.matchStatus ?? "unknown");
    summary[key] = (summary[key] ?? 0) + 1;
  }

  return summary;
}

function loadBundle(repoRoot: string): JsonRecord {
  const bundlePath = path.join(
    repoRoot,
    "data/generated",
    ACQUIRED_DATE,
    "app-bundle/kric-canonical-app-bundle.json",
  );

  return JSON.parse(fs.readFileSync(bundlePath, "utf8")) as JsonRecord;
}

export function writeKricCanonicalDiagnostics() {
  const repoRoot = findRepoRoot(process.cwd());
  const observedDir = path.join(repoRoot, "data/observed", ACQUIRED_DATE, "kric");

  fs.mkdirSync(observedDir, { recursive: true });

  const bundle = loadBundle(repoRoot);
  const lines = (bundle.lines ?? []) as JsonRecord[];
  const flatRouteStops = (bundle.routeStops ?? []) as JsonRecord[];
  const skippedRouteStops = (bundle.skippedRouteStops ?? []) as JsonRecord[];

  const branchSummaries = lines.flatMap((line) => {
    const branches = (line.branches ?? []) as JsonRecord[];

    return branches.map((branch) => {
      const routeStops = (branch.routeStops ?? []) as JsonRecord[];
      const lowConfidenceStops = routeStops.filter((stop) => stop.confidence === "low");

      return {
        canonicalKey: line.canonicalKey,
        canonicalName: line.nameKo,
        lnCd: line.lnCd,
        mreaWideCd: line.mreaWideCd,
        branchId: branch.id,
        role: branch.role,
        sourceLineNumber: branch.sourceLineNumber,
        sourceLineName: branch.sourceLineName,
        origin: branch.origin,
        terminal: branch.terminal,
        routeStopCount: routeStops.length,
        lowConfidenceCount: lowConfidenceStops.length,
        firstStation: routeStops[0]?.displayNameKo ?? null,
        lastStation: routeStops.at(-1)?.displayNameKo ?? null,
        confidenceSummary: summarizeConfidence(routeStops),
        matchStatusSummary: summarizeMatchStatus(routeStops),
      };
    });
  });

  const lineSummaries = lines.map((line) => {
    const branches = (line.branches ?? []) as JsonRecord[];
    const routeStops = branches.flatMap((branch) => (branch.routeStops ?? []) as JsonRecord[]);
    const lowConfidenceStops = routeStops.filter((stop) => stop.confidence === "low");

    return {
      canonicalKey: line.canonicalKey,
      canonicalName: line.nameKo,
      lnCd: line.lnCd,
      mreaWideCd: line.mreaWideCd,
      branchCount: branches.length,
      routeStopCount: routeStops.length,
      lowConfidenceCount: lowConfidenceStops.length,
      firstStation: routeStops[0]?.displayNameKo ?? null,
      lastStation: routeStops.at(-1)?.displayNameKo ?? null,
      sourceLineNumbers: line.sourceLineNumbers ?? [],
      confidenceSummary: summarizeConfidence(routeStops),
      matchStatusSummary: summarizeMatchStatus(routeStops),
    };
  });

  const lowConfidenceRouteStops = lines.flatMap((line) => {
    const branches = (line.branches ?? []) as JsonRecord[];

    return branches.flatMap((branch) => {
      const routeStops = (branch.routeStops ?? []) as JsonRecord[];

      return routeStops
        .filter((stop) => stop.confidence === "low")
        .map((stop) => ({
          canonicalKey: line.canonicalKey,
          canonicalName: line.nameKo,
          branchId: branch.id,
          role: branch.role,
          sourceLineNumber: branch.sourceLineNumber,
          sourceLineName: branch.sourceLineName,
          sequence: stop.sequence,
          sourceStationCode: stop.sourceStationCode,
          displayNameKo: stop.displayNameKo,
          stationId: stop.stationId,
          matchStatus: stop.matchStatus,
          confidence: stop.confidence,
          diagnostics: Array.isArray(stop.diagnostics) ? stop.diagnostics.join("; ") : "",
          sourceCandidateId: stop.sourceCandidateId,
        }));
    });
  });

  const diagnostics = {
    diagnosticsId: "kric-canonical-app-bundle-diagnostics",
    acquiredDate: ACQUIRED_DATE,
    generatedAt: new Date().toISOString(),
    sourceBundle: "data/generated/2026-06-19/app-bundle/kric-canonical-app-bundle.json",
    policy: {
      lowConfidenceMeaning:
        "Route stop was matched by fallback logic, usually global normalized station name rather than exact same-line station code.",
      publishability:
        "Candidate bundle is usable for development preview. Low-confidence route stops should be manually reviewed before final publication.",
      intentionallyMissingCanonicalLines: {
        "01:A": "GTX-A is intentionally excluded for now.",
      },
    },
    counts: {
      canonicalLines: lines.length,
      branches: branchSummaries.length,
      stations: Array.isArray(bundle.stations) ? bundle.stations.length : 0,
      routeStops: flatRouteStops.length,
      skippedRouteStops: skippedRouteStops.length,
      lowConfidenceRouteStops: lowConfidenceRouteStops.length,
      missingCanonicalLines: Array.isArray(bundle.missingCanonicalLines)
        ? bundle.missingCanonicalLines.length
        : 0,
    },
    missingCanonicalLines: bundle.missingCanonicalLines ?? [],
    lineSummaries,
    branchSummaries,
    lowConfidenceRouteStops,
    skippedRouteStops,
  };

  const diagnosticsPath = path.join(
    observedDir,
    "kric-canonical-app-bundle-diagnostics.json",
  );
  const lowConfidenceCsvPath = path.join(
    observedDir,
    "kric-canonical-low-confidence-route-stops.csv",
  );
  const branchSummaryCsvPath = path.join(
    observedDir,
    "kric-canonical-branch-summary.csv",
  );
  const lineSummaryCsvPath = path.join(
    observedDir,
    "kric-canonical-line-summary.csv",
  );

  writeJson(diagnosticsPath, diagnostics);

  writeCsv(lowConfidenceCsvPath, lowConfidenceRouteStops);
  writeCsv(
    branchSummaryCsvPath,
    branchSummaries.map((row) => ({
      canonicalKey: row.canonicalKey,
      canonicalName: row.canonicalName,
      lnCd: row.lnCd,
      mreaWideCd: row.mreaWideCd,
      role: row.role,
      sourceLineNumber: row.sourceLineNumber,
      sourceLineName: row.sourceLineName,
      origin: row.origin,
      terminal: row.terminal,
      routeStopCount: row.routeStopCount,
      lowConfidenceCount: row.lowConfidenceCount,
      firstStation: row.firstStation,
      lastStation: row.lastStation,
      confidenceSummary: JSON.stringify(row.confidenceSummary),
      matchStatusSummary: JSON.stringify(row.matchStatusSummary),
    })),
  );
  writeCsv(
    lineSummaryCsvPath,
    lineSummaries.map((row) => ({
      canonicalKey: row.canonicalKey,
      canonicalName: row.canonicalName,
      lnCd: row.lnCd,
      mreaWideCd: row.mreaWideCd,
      branchCount: row.branchCount,
      routeStopCount: row.routeStopCount,
      lowConfidenceCount: row.lowConfidenceCount,
      firstStation: row.firstStation,
      lastStation: row.lastStation,
      sourceLineNumbers: Array.isArray(row.sourceLineNumbers)
        ? row.sourceLineNumbers.join("|")
        : "",
      confidenceSummary: JSON.stringify(row.confidenceSummary),
      matchStatusSummary: JSON.stringify(row.matchStatusSummary),
    })),
  );

  console.log(
    `[collector] wrote canonical diagnostics: ${path.relative(repoRoot, diagnosticsPath)}`,
  );
  console.log(
    `[collector] wrote low-confidence route stop csv: ${path.relative(repoRoot, lowConfidenceCsvPath)}`,
  );
  console.log(
    `[collector] wrote canonical branch summary csv: ${path.relative(repoRoot, branchSummaryCsvPath)}`,
  );
  console.log(
    `[collector] wrote canonical line summary csv: ${path.relative(repoRoot, lineSummaryCsvPath)}`,
  );
  console.log(`[collector] canonical diagnostics counts: ${JSON.stringify(diagnostics.counts)}`);
}
EOF

  echo "[2/5] index.ts에 diagnostics 단계 추가..." >&2

  python3 - <<'PY'
from pathlib import Path

p = Path("packages/collector/src/index.ts")
s = p.read_text()

import_line = 'import { writeKricCanonicalDiagnostics } from "./canonical/write-canonical-diagnostics.js";\n'
if import_line not in s:
    lines = s.splitlines(keepends=True)
    insert_at = 0
    for i, line in enumerate(lines):
        if line.startswith("import "):
            insert_at = i + 1
    lines.insert(insert_at, import_line)
    s = "".join(lines)

call_line = "writeKricCanonicalDiagnostics();"
if call_line not in s:
    if "buildKricCanonicalAppBundle();" in s:
        s = s.replace(
            "buildKricCanonicalAppBundle();",
            "buildKricCanonicalAppBundle();\nwriteKricCanonicalDiagnostics();",
        )
    else:
        raise SystemExit("buildKricCanonicalAppBundle() call not found")

p.write_text(s)
PY

  echo "[3/5] 타입 체크 + collector 실행..." >&2
  pnpm --filter @repo/collector check-types
  pnpm --filter @repo/collector dev

  echo "\n[4/5] web 타입 체크..." >&2
  pnpm --filter web check-types

  echo "\n[5/5] diagnostics 요약 확인..." >&2
  node - <<'NODE'
const fs = require("fs");

const diagnostics = JSON.parse(
  fs.readFileSync(
    "data/observed/2026-06-19/kric/kric-canonical-app-bundle-diagnostics.json",
    "utf8",
  ),
);

console.log("===== diagnostics counts =====");
console.log(JSON.stringify(diagnostics.counts, null, 2));

console.log("\n===== low confidence by line =====");
for (const line of diagnostics.lineSummaries.filter((x) => x.lowConfidenceCount > 0)) {
  console.log(JSON.stringify({
    canonicalKey: line.canonicalKey,
    canonicalName: line.canonicalName,
    routeStopCount: line.routeStopCount,
    lowConfidenceCount: line.lowConfidenceCount,
  }, null, 2));
}

console.log("\n===== output files =====");
for (const p of [
  "data/observed/2026-06-19/kric/kric-canonical-app-bundle-diagnostics.json",
  "data/observed/2026-06-19/kric/kric-canonical-low-confidence-route-stops.csv",
  "data/observed/2026-06-19/kric/kric-canonical-branch-summary.csv",
  "data/observed/2026-06-19/kric/kric-canonical-line-summary.csv",
]) {
  const stat = fs.statSync(p);
  console.log(`${p} ${stat.size} bytes`);
}
NODE
} | tee /dev/stderr | pbcopy

echo "완료: 결과가 클립보드에 복사됐습니다. 붙여넣어 주세요."
