import fs from "node:fs";
import path from "node:path";
import { findRepoRoot } from "../shared/fs.js";

type JsonRecord = Record<string, any>;

type ManualOverlayBundle = {
  branchRouteOverrides?: Array<{
    id?: string;
    branchId?: string;
    stationIds?: string[];
    enabled?: boolean;
  }>;
  geometryOverrides?: Array<{
    branchId?: string;
    enabled?: boolean;
    points?: Array<{ kind?: string; stationId?: string }>;
  }>;
  lineBranchOverrides?: Array<{
    id?: string;
    mode?: string;
    parentBranchId?: string;
    anchorStationId?: string;
    branchStationId?: string;
    connectedBranchId?: string;
    connectedEndpointStationId?: string;
    geometry?: Array<{ kind?: string; stationId?: string }>;
    enabled?: boolean;
  }>;
};

type BranchContext = {
  id: string;
  lineId: string;
  lineNameKo: string;
  sourceLineNumber: string;
  sourceLineName: string;
};

function readJson(filePath: string): JsonRecord | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonRecord;
}

function normalizeIdentityKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function getLineScopedStationKey(stationId: string) {
  const marker = "::line:";
  const index = stationId.indexOf(marker);
  if (index < 0) return null;
  return normalizeIdentityKey(stationId.slice(index + marker.length));
}

function getBranchIdentityKeys(branch: BranchContext | undefined) {
  if (!branch) return new Set<string>();
  return new Set(
    [branch.lineId, branch.lineNameKo, branch.sourceLineNumber, branch.sourceLineName]
      .map(normalizeIdentityKey)
      .filter(Boolean),
  );
}

function stationMatchesBranch(
  stationId: string | undefined,
  branch: BranchContext | undefined,
  stationById: Map<string, JsonRecord>,
) {
  if (!stationId || !branch) return true;
  const branchKeys = getBranchIdentityKeys(branch);
  if (branchKeys.size === 0) return true;

  const scopedLineKey = getLineScopedStationKey(stationId);
  if (scopedLineKey) return branchKeys.has(scopedLineKey);

  const station = stationById.get(stationId);
  if (!station) return true;

  const stationKeys = [station.lineNumber, station.lineNameKo]
    .map(normalizeIdentityKey)
    .filter(Boolean);

  return stationKeys.some((key) => branchKeys.has(key));
}

function describeStation(stationId: string | undefined, stationById: Map<string, JsonRecord>) {
  if (!stationId) return "-";
  const station = stationById.get(stationId);
  if (!station) return stationId;
  return `${station.nameKo ?? stationId}(${station.lineNameKo ?? "-"}, ${stationId})`;
}

function buildBranchContext(bundle: JsonRecord) {
  const branchById = new Map<string, BranchContext>();
  for (const line of (bundle.lines ?? []) as JsonRecord[]) {
    const lineId = String(line.canonicalKey ?? line.id ?? "");
    const lineNameKo = String(line.nameKo ?? "");
    for (const branch of (line.branches ?? []) as JsonRecord[]) {
      const id = String(branch.id ?? "");
      if (!id) continue;
      branchById.set(id, {
        id,
        lineId,
        lineNameKo,
        sourceLineNumber: String(branch.sourceLineNumber ?? ""),
        sourceLineName: String(branch.sourceLineName ?? ""),
      });
    }
  }
  return branchById;
}

function pushIssue(
  issues: string[],
  context: string,
  stationId: string | undefined,
  branch: BranchContext | undefined,
  stationById: Map<string, JsonRecord>,
) {
  issues.push(
    `${context}: 다른 노선의 역 ID를 직접 참조함 - ${describeStation(stationId, stationById)} -> ${branch?.lineNameKo ?? branch?.id ?? "unknown branch"}`,
  );
}

export function validateStationLineIdentity() {
  const repoRoot = findRepoRoot(process.cwd());
  const bundlePath = path.join(repoRoot, "apps/web/public/data/kric-canonical-app-bundle.json");
  const overlayPath = path.join(repoRoot, "data/manual/manual-overlays.json");

  const bundle = readJson(bundlePath);
  const overlays = readJson(overlayPath) as ManualOverlayBundle | null;

  if (!bundle || !overlays) {
    console.log("[collector] station-line identity validation skipped: bundle or manual overlays missing");
    return;
  }

  const stationById = new Map(
    ((bundle.stations ?? []) as JsonRecord[])
      .filter((station) => station.id)
      .map((station) => [String(station.id), station]),
  );
  const branchById = buildBranchContext(bundle);
  const issues: string[] = [];

  for (const override of overlays.branchRouteOverrides ?? []) {
    if (override.enabled === false) continue;
    const branch = override.branchId ? branchById.get(override.branchId) : undefined;
    for (const stationId of override.stationIds ?? []) {
      if (stationMatchesBranch(stationId, branch, stationById)) continue;
      pushIssue(issues, `branchRouteOverrides:${override.id ?? override.branchId}`, stationId, branch, stationById);
    }
  }

  for (const override of overlays.geometryOverrides ?? []) {
    if (override.enabled === false) continue;
    const branch = override.branchId ? branchById.get(override.branchId) : undefined;
    for (const [index, point] of (override.points ?? []).entries()) {
      if (point.kind !== "station" || !point.stationId) continue;
      if (stationMatchesBranch(point.stationId, branch, stationById)) continue;
      pushIssue(issues, `geometryOverrides:${override.branchId}:${index}`, point.stationId, branch, stationById);
    }
  }

  for (const override of overlays.lineBranchOverrides ?? []) {
    if (override.enabled === false) continue;
    const parentBranch = override.parentBranchId ? branchById.get(override.parentBranchId) : undefined;
    const connectedBranch = override.connectedBranchId ? branchById.get(override.connectedBranchId) : undefined;

    if (!stationMatchesBranch(override.anchorStationId, parentBranch, stationById)) {
      pushIssue(issues, `lineBranchOverrides:${override.id}:anchor`, override.anchorStationId, parentBranch, stationById);
    }

    if (override.mode === "add-station" && !stationMatchesBranch(override.branchStationId, parentBranch, stationById)) {
      pushIssue(issues, `lineBranchOverrides:${override.id}:branchStation`, override.branchStationId, parentBranch, stationById);
    }

    if (
      override.mode === "connect-line" &&
      !stationMatchesBranch(override.connectedEndpointStationId, connectedBranch, stationById)
    ) {
      pushIssue(issues, `lineBranchOverrides:${override.id}:connectedStation`, override.connectedEndpointStationId, connectedBranch, stationById);
    }

    for (const [index, point] of (override.geometry ?? []).entries()) {
      if (point.kind !== "station" || !point.stationId) continue;
      const allowed =
        stationMatchesBranch(point.stationId, parentBranch, stationById) ||
        stationMatchesBranch(point.stationId, connectedBranch, stationById);
      if (allowed) continue;
      pushIssue(issues, `lineBranchOverrides:${override.id}:geometry:${index}`, point.stationId, parentBranch, stationById);
    }
  }

  if (issues.length > 0) {
    throw new Error(
      [
        `[collector] station-line identity validation failed: ${issues.length} issue(s)`,
        "한 stationId를 다른 노선의 역처럼 직접 연결할 수 없습니다. 같은 물리 위치라도 노선별 stationId를 분리하거나 control point를 사용하세요.",
        ...issues.slice(0, 30),
        issues.length > 30 ? `... ${issues.length - 30} more issue(s)` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  console.log("[collector] station-line identity validation OK");
}
