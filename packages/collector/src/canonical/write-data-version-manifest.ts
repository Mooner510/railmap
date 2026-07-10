import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { findRepoRoot, writeJson } from "../shared/fs.js";

type JsonRecord = Record<string, any>;

const ACQUIRED_DATE = "2026-06-19";
const DATA_VERSION_SCHEMA = 2;

function readJsonIfExists(filePath: string): JsonRecord | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonRecord;
}

function getFileVersion(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, bytes: 0, mtimeMs: null as number | null, sha256: null as string | null };
  }

  const stats = fs.statSync(filePath);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  return { exists: true, bytes: stats.size, mtimeMs: Math.round(stats.mtimeMs), sha256 };
}

function makePublicDataVersion(input: {
  bundle: JsonRecord | null;
  bundlePath: string;
  manualOverlayPath: string;
}) {
  const bundleVersion = getFileVersion(input.bundlePath);
  const manualOverlayVersion = getFileVersion(input.manualOverlayPath);
  const bundleGeneratedAt =
    typeof input.bundle?.generatedAt === "string" ? input.bundle.generatedAt : null;
  const acquiredDate =
    typeof input.bundle?.acquiredDate === "string" ? input.bundle.acquiredDate : ACQUIRED_DATE;
  const generatedAt = new Date().toISOString();
  const releaseSeed = `${bundleVersion.sha256 ?? "missing"}:${manualOverlayVersion.sha256 ?? "missing"}`;
  const releaseId = crypto.createHash("sha256").update(releaseSeed).digest("hex").slice(0, 16);

  return {
    schemaVersion: DATA_VERSION_SCHEMA,
    generatedAt,
    acquiredDate,
    releaseId,
    cachePolicy: {
      manifest: "no-store",
      dataArtifacts: "content-hash-versioned",
      note: "manifest releaseId와 각 artifact sha256으로 데이터 변경 여부를 판단한다.",
    },
    versions: {
      bundle: {
        id: input.bundle?.bundleId ?? "kric-canonical-app-bundle",
        generatedAt: bundleGeneratedAt,
        acquiredDate,
        file: "kric-canonical-app-bundle.json",
        bytes: bundleVersion.bytes,
        mtimeMs: bundleVersion.mtimeMs,
        sha256: bundleVersion.sha256,
      },
      manualOverlay: {
        id: "manual-overlays",
        file: "manual-overlays.json",
        bytes: manualOverlayVersion.bytes,
        mtimeMs: manualOverlayVersion.mtimeMs,
        sha256: manualOverlayVersion.sha256,
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
