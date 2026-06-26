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
