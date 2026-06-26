import fs from "node:fs";
import path from "node:path";

export function findRepoRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    if (
      fs.existsSync(path.join(current, "pnpm-workspace.yaml")) &&
      fs.existsSync(path.join(current, "turbo.json"))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Repo root not found from: ${startDir}`);
    }

    current = parent;
  }
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJsonl<T>(filePath: string): T[] {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function writeJson(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

export function writeJsonl(filePath: string, records: unknown[]) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(
    filePath,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8",
  );
}
