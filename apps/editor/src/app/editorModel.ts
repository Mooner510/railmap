export interface EditorStation {
  id: string;
  stationNumber: string;
  nameKo: string;
  lineNameKo: string;
  lineNumber?: string;
  lat: number | null;
  lng: number | null;
}

export interface ManualTransferGroup {
  id: string;
  nameKo: string;
  stationIds: string[];
  transferMinutesByPair: Record<string, number | null>;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

export interface ManualTransferEdge {
  id: string;
  fromStationId: string;
  toStationId: string;
  labelKo?: string | null;
  transferMinutes?: number | null;
  bidirectional?: boolean;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

export interface ManualStationOverride {
  stationId: string;
  nameKo?: string;
  lat?: number | null;
  lng?: number | null;
  enabled: boolean;
  note?: string | null;
}

export interface ManualBranchOverride {
  branchId: string;
  displayNameKo?: string;
  enabled: boolean;
  note?: string | null;
}

export interface ManualGeometryOverridePoint {
  lng: number;
  lat: number;
  kind: "station" | "control";
  stationId?: string;
}

export interface ManualGeometryOverride {
  branchId: string;
  points: ManualGeometryOverridePoint[];
  enabled: boolean;
  note?: string | null;
}

export interface ManualOverlayBundle {
  schemaVersion: 1;
  manualTransferGroups: ManualTransferGroup[];
  manualTransferEdges: ManualTransferEdge[];
  nonTransferStationIds: string[];
  stationOverrides: ManualStationOverride[];
  branchOverrides: ManualBranchOverride[];
  geometryOverrides: ManualGeometryOverride[];
}

export interface CanonicalBundle {
  stations: EditorStation[];
}

export const EMPTY_MANUAL_OVERLAY_BUNDLE: ManualOverlayBundle = {
  schemaVersion: 1,
  manualTransferGroups: [],
  manualTransferEdges: [],
  nonTransferStationIds: [],
  stationOverrides: [],
  branchOverrides: [],
  geometryOverrides: [],
};

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function makeTransferGroupId(nameKo: string, stationIds: string[]) {
  const slug = normalizeSearchText(nameKo || "transfer") || "transfer";
  return `manual-transfer-group:${slug}:${stationIds.slice().sort().join(":")}`;
}

export function makeTransferPairKey(stationIdA: string, stationIdB: string) {
  return [stationIdA, stationIdB].slice().sort().join("<->");
}

export function deriveTransferEdgesFromGroups(groups: ManualTransferGroup[]): ManualTransferEdge[] {
  const edges: ManualTransferEdge[] = [];

  for (const group of groups) {
    if (!group.enabled) continue;

    const stationIds = [...new Set(group.stationIds)].filter(Boolean);
    if (stationIds.length < 2) continue;

    for (let i = 0; i < stationIds.length - 1; i += 1) {
      for (let j = i + 1; j < stationIds.length; j += 1) {
        const fromStationId = stationIds[i];
        const toStationId = stationIds[j];
        if (!fromStationId || !toStationId || fromStationId === toStationId) continue;

        const pairKey = makeTransferPairKey(fromStationId, toStationId);
        const transferMinutes = group.transferMinutesByPair[pairKey] ?? null;

        edges.push({
          id: `${group.id}:${pairKey}`,
          fromStationId,
          toStationId,
          labelKo: group.nameKo || "수동 환승",
          transferMinutes,
          bidirectional: true,
          enabled: true,
          source: "editor-group",
          note: group.note ?? null,
        });
      }
    }
  }

  return edges;
}
