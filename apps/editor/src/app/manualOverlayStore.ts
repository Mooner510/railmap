import fs from "node:fs/promises";
import path from "node:path";
import {
  EMPTY_MANUAL_OVERLAY_BUNDLE,
  type ManualOverlayBundle,
  type ManualTransferEdge,
} from "./editorModel";

function projectRoot() {
  return path.resolve(process.cwd(), "../..");
}

export function getManualOverlayPaths() {
  const root = projectRoot();

  return [
    path.join(root, "data/manual/manual-overlays.json"),
    path.join(root, "apps/web/public/data/manual-overlays.json"),
  ];
}

export function getBundlePath() {
  return path.join(projectRoot(), "apps/web/public/data/kric-canonical-app-bundle.json");
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.round(numberValue)) : null;
}

function normalizeTransferEdge(value: unknown, index: number): ManualTransferEdge | null {
  if (!value || typeof value !== "object") return null;

  const edge = value as Record<string, unknown>;
  const fromStationId = asString(edge.fromStationId);
  const toStationId = asString(edge.toStationId);

  if (!fromStationId || !toStationId || fromStationId === toStationId) return null;

  return {
    id: asString(edge.id) ?? `manual-transfer:${fromStationId}:${toStationId}:${index}`,
    fromStationId,
    toStationId,
    labelKo: asNullableString(edge.labelKo),
    transferMinutes: asNullableNumber(edge.transferMinutes),
    bidirectional: edge.bidirectional !== false,
    enabled: edge.enabled !== false,
    source: asString(edge.source) ?? "editor",
    note: asNullableString(edge.note),
  };
}

export function normalizeManualOverlays(value: unknown): ManualOverlayBundle {
  if (!value || typeof value !== "object") return EMPTY_MANUAL_OVERLAY_BUNDLE;

  const data = value as Partial<ManualOverlayBundle>;

  return {
    schemaVersion: 1,
    manualTransferEdges: Array.isArray(data.manualTransferEdges)
      ? data.manualTransferEdges
          .map((edge, index) => normalizeTransferEdge(edge, index))
          .filter((edge): edge is ManualTransferEdge => edge !== null)
      : [],
    stationOverrides: Array.isArray(data.stationOverrides) ? data.stationOverrides : [],
    branchOverrides: Array.isArray(data.branchOverrides) ? data.branchOverrides : [],
    geometryOverrides: Array.isArray(data.geometryOverrides) ? data.geometryOverrides : [],
  };
}

export async function readManualOverlays(): Promise<ManualOverlayBundle> {
  for (const filePath of getManualOverlayPaths()) {
    const json = await readJsonFile(filePath);
    if (json !== null) return normalizeManualOverlays(json);
  }

  return EMPTY_MANUAL_OVERLAY_BUNDLE;
}

export async function writeManualOverlays(overlays: ManualOverlayBundle) {
  const normalized = normalizeManualOverlays(overlays);
  const body = `${JSON.stringify(normalized, null, 2)}\n`;

  for (const filePath of getManualOverlayPaths()) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body, "utf8");
  }

  return normalized;
}
