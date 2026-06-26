import fs from "node:fs";
import path from "node:path";
import type { CanonicalSourceLineMapRow } from "./types.js";

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

export function loadCanonicalSourceLineMap(repoRoot: string): CanonicalSourceLineMapRow[] {
  const filePath = path.join(repoRoot, "data/manual/kric-canonical-source-line-map.csv");
  const csv = fs.readFileSync(filePath, "utf8").trim();
  const [header, ...rows] = csv.split(/\r?\n/);

  if (header !== "canonicalKey,canonicalLnCd,canonicalName,canonicalMreaWideCd,sourceLineNumber,sourceLineName,role") {
    throw new Error(`Unexpected canonical source line map header: ${header}`);
  }

  return rows.filter(Boolean).map((row, index) => {
    const [canonicalKey, lnCd, canonicalName, mreaWideCd, sourceLineNumber, sourceLineName, role] = parseCsvLine(row);

    if (!canonicalKey || !lnCd || !canonicalName || !mreaWideCd || !sourceLineNumber || !sourceLineName) {
      throw new Error(`Invalid canonical source line map row ${index + 2}: ${row}`);
    }

    if (role !== "main" && role !== "branch") {
      throw new Error(`Invalid canonical source line role at row ${index + 2}: ${role}`);
    }

    return {
      canonicalKey,
      lnCd,
      canonicalName,
      mreaWideCd,
      sourceLineNumber,
      sourceLineName,
      role,
    };
  });
}

export function loadCanonicalAllowlistKeys(repoRoot: string): Set<string> {
  const filePath = path.join(repoRoot, "data/manual/kric-subway-route-info-line-map.csv");
  const csv = fs.readFileSync(filePath, "utf8").trim();
  const [header, ...rows] = csv.split(/\r?\n/);

  if (header !== "lnCd,노선명,mreaWideCd") {
    throw new Error(`Unexpected KRIC allowlist header: ${header}`);
  }

  return new Set(
    rows.filter(Boolean).map((row) => {
      const [lnCd, , mreaWideCd] = parseCsvLine(row);
      return `${mreaWideCd}:${lnCd}`;
    }),
  );
}
