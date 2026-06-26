import fs from "node:fs";
import path from "node:path";

export interface CanonicalSourceLine {
  canonicalKey: string;
  lnCd: string;
  canonicalName: string;
  mreaWideCd: string;
  sourceLineNumber: string;
  sourceLineName: string;
  role: "main" | "branch";
}

export function loadCanonicalMap(repoRoot: string): CanonicalSourceLine[] {
  const csv = fs.readFileSync(
    path.join(
      repoRoot,
      "data/manual/kric-canonical-source-line-map.csv",
    ),
    "utf8",
  );

  const rows = csv.trim().split(/\r?\n/);

  rows.shift();

  return rows.map((row) => {
    const [
      canonicalKey,
      lnCd,
      canonicalName,
      mreaWideCd,
      sourceLineNumber,
      sourceLineName,
      role,
    ] = row.split(",");

    return {
      canonicalKey,
      lnCd,
      canonicalName,
      mreaWideCd,
      sourceLineNumber,
      sourceLineName,
      role: role as "main" | "branch",
    };
  });
}
