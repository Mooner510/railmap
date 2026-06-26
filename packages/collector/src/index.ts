import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

type SheetSchema = {
  fileName: string;
  sheetName: string;
  range: string;
  rowsIncludingHeader: number;
  dataRows: number;
  headers: unknown[];
  diagnostics: string[];
};

function findRepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (
      fs.existsSync(path.join(current, "pnpm-workspace.yaml")) &&
      fs.existsSync(path.join(current, "turbo.json"))
    ) return current;

    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Repo root not found from: ${startDir}`);
    current = parent;
  }
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function collectSheetSchema(filePath: string, fileName: string): SheetSchema[] {
  const workbook = XLSX.readFile(filePath, { cellDates: false, raw: true });

  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const range = sheet?.["!ref"] ?? "unknown";
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });

    const headers = rows[0] ?? [];
    const diagnostics: string[] = [];

    headers.forEach((header, index) => {
      if (header === null || header === undefined || header === "") {
        diagnostics.push(`empty-header-at-column-${index + 1}`);
      }
    });

    return {
      fileName,
      sheetName,
      range,
      rowsIncludingHeader: rows.length,
      dataRows: Math.max(rows.length - 1, 0),
      headers,
      diagnostics,
    };
  });
}

const repoRoot = findRepoRoot(process.cwd());
const acquiredDate = "2026-06-19";
const kricRawDir = path.join(repoRoot, "data/raw", acquiredDate, "kric");
const observedDir = path.join(repoRoot, "data/observed", acquiredDate, "kric");
const outputPath = path.join(observedDir, "kric-urban-rail-observed-schema.json");

const files = [
  "전체_도시철도운행정보_20260228.xlsx",
  "전체_도시철도역사정보_20260228.xlsx",
  "전체_도시철도노선정보_20260228.xlsx",
  "운영기관_역사_코드정보_2026.05.11_일반.xlsx",
];

console.log("[collector] KRIC observed schema");
console.log(`[collector] repo root: ${repoRoot}`);

const schemas: SheetSchema[] = [];

for (const file of files) {
  const filePath = path.join(kricRawDir, file);
  if (!fs.existsSync(filePath)) {
    console.error(`[MISS] ${file}`);
    process.exitCode = 1;
    continue;
  }

  const fileSchemas = collectSheetSchema(filePath, file);
  schemas.push(...fileSchemas);

  console.log(`\n===== ${file} =====`);
  for (const schema of fileSchemas) {
    console.log(`- sheet: ${schema.sheetName}`);
    console.log(`  range: ${schema.range}`);
    console.log(`  dataRows: ${schema.dataRows}`);
    console.log(`  diagnostics: ${schema.diagnostics.length ? schema.diagnostics.join(", ") : "none"}`);
  }
}

ensureDir(observedDir);
fs.writeFileSync(
  outputPath,
  JSON.stringify(
    {
      sourceFamily: "kric",
      acquiredDate,
      generatedAt: new Date().toISOString(),
      schemas,
    },
    null,
    2,
  ),
  "utf8",
);

console.log(`\n[collector] wrote: ${path.relative(repoRoot, outputPath)}`);
console.log("[collector] OK");
