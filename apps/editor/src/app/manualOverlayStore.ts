import fs from "node:fs/promises";
import path from "node:path";
import {
  EMPTY_MANUAL_OVERLAY_BUNDLE,
  deriveTransferEdgesFromGroups,
  makeTransferPairKey,
  type ManualOverlayBundle,
  type ManualTransferEdge,
  type ManualTransferGroup,
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

function normalizeMinutesByPair(value: unknown, stationIds: string[]): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  for (let i = 0; i < stationIds.length - 1; i += 1) {
    for (let j = i + 1; j < stationIds.length; j += 1) {
      const pairKey = makeTransferPairKey(stationIds[i] ?? "", stationIds[j] ?? "");
      result[pairKey] = asNullableNumber(source[pairKey]);
    }
  }

  return result;
}

function normalizeTransferGroup(value: unknown, index: number): ManualTransferGroup | null {
  if (!value || typeof value !== "object") return null;

  const group = value as Record<string, unknown>;
  const stationIds = Array.isArray(group.stationIds)
    ? [...new Set(group.stationIds.map(asString).filter((id): id is string => id !== null))]
    : [];

  if (stationIds.length < 2) return null;

  const nameKo = asString(group.nameKo) ?? `수동 환승 그룹 ${index + 1}`;

  return {
    id: asString(group.id) ?? `manual-transfer-group:${index + 1}`,
    nameKo,
    stationIds,
    transferMinutesByPair: normalizeMinutesByPair(group.transferMinutesByPair, stationIds),
    enabled: group.enabled !== false,
    source: asString(group.source) ?? "editor",
    note: asNullableString(group.note),
  };
}

function normalizeLegacyTransferEdge(value: unknown, index: number): ManualTransferEdge | null {
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
    bidirectional: true,
    enabled: edge.enabled !== false,
    source: asString(edge.source) ?? "manual",
    note: asNullableString(edge.note),
  };
}

export function normalizeManualOverlays(value: unknown): ManualOverlayBundle {
  if (!value || typeof value !== "object") return EMPTY_MANUAL_OVERLAY_BUNDLE;

  const data = value as Partial<ManualOverlayBundle>;
  const manualTransferGroups = Array.isArray(data.manualTransferGroups)
    ? data.manualTransferGroups
        .map((group, index) => normalizeTransferGroup(group, index))
        .filter((group): group is ManualTransferGroup => group !== null)
    : [];
  const legacyEdges = Array.isArray(data.manualTransferEdges)
    ? data.manualTransferEdges
        .map((edge, index) => normalizeLegacyTransferEdge(edge, index))
        .filter((edge): edge is ManualTransferEdge => edge !== null && edge.source !== "editor-group")
    : [];

  return {
    schemaVersion: 1,
    manualTransferGroups,
    manualTransferEdges: [...legacyEdges, ...deriveTransferEdgesFromGroups(manualTransferGroups)],
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
  const persisted: ManualOverlayBundle = {
    ...normalized,
    manualTransferEdges: [],
  };
  const body = `${JSON.stringify(persisted, null, 2)}\n`;

  for (const filePath of getManualOverlayPaths()) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body, "utf8");
  }

  return normalized;
}
