import fs from "node:fs";
import path from "node:path";
import { findRepoRoot, writeJson } from "../shared/fs.js";

type JsonRecord = Record<string, any>;

const ACQUIRED_DATE = "2026-06-19";
const DATA_VERSION_SCHEMA = 1;

function readJsonIfExists(filePath: string): JsonRecord | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonRecord;
}

function getFileStats(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, bytes: 0, mtimeMs: null as number | null };
  }

  const stats = fs.statSync(filePath);
  return { exists: true, bytes: stats.size, mtimeMs: Math.round(stats.mtimeMs) };
}

function makePublicDataVersion(input: {
  bundle: JsonRecord | null;
  bundlePath: string;
  manualOverlayPath: string;
}) {
  const bundleStats = getFileStats(input.bundlePath);
  const manualOverlayStats = getFileStats(input.manualOverlayPath);
  const bundleGeneratedAt =
    typeof input.bundle?.generatedAt === "string" ? input.bundle.generatedAt : null;
  const acquiredDate =
    typeof input.bundle?.acquiredDate === "string" ? input.bundle.acquiredDate : ACQUIRED_DATE;
  const generatedAt = new Date().toISOString();

  return {
    schemaVersion: DATA_VERSION_SCHEMA,
    generatedAt,
    acquiredDate,
    cachePolicy: {
      manifest: "no-store",
      dataArtifacts: "immutable-after-version",
      note: "배포 시 manifest를 먼저 확인하고 bundle/manual overlay 변경 여부를 판단한다.",
    },
    versions: {
      bundle: {
        id: input.bundle?.bundleId ?? "kric-canonical-app-bundle",
        generatedAt: bundleGeneratedAt,
        acquiredDate,
        file: "kric-canonical-app-bundle.json",
        bytes: bundleStats.bytes,
        mtimeMs: bundleStats.mtimeMs,
      },
      manualOverlay: {
        id: "manual-overlays",
        file: "manual-overlays.json",
        bytes: manualOverlayStats.bytes,
        mtimeMs: manualOverlayStats.mtimeMs,
      },
    },
  };
}

export function writePublicDataVersionManifest() {
  const repoRoot = findRepoRoot(process.cwd());
  const publicDataDir = path.join(repoRoot, "apps/web/public/data");
  const bundlePath = path.join(publicDataDir, "kric-canonical-app-bundle.json");
  const manualOverlayPath = path.join(publicDataDir, "manual-overlays.json");
  const manifestPath = path.join(publicDataDir, "data-version.json");

  const bundle = readJsonIfExists(bundlePath);
  writeJson(
    manifestPath,
    makePublicDataVersion({ bundle, bundlePath, manualOverlayPath }),
  );
}
