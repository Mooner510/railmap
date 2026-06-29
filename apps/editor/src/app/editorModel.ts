export interface EditorStation {
  id: string;
  stationNumber: string;
  nameKo: string;
  lineNameKo: string;
  lineNumber?: string;
  lat: number | null;
  lng: number | null;
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
  manualTransferEdges: ManualTransferEdge[];
  stationOverrides: ManualStationOverride[];
  branchOverrides: ManualBranchOverride[];
  geometryOverrides: ManualGeometryOverride[];
}

export interface CanonicalBundle {
  stations: EditorStation[];
}

export const EMPTY_MANUAL_OVERLAY_BUNDLE: ManualOverlayBundle = {
  schemaVersion: 1,
  manualTransferEdges: [],
  stationOverrides: [],
  branchOverrides: [],
  geometryOverrides: [],
};

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function makeTransferId(fromStationId: string, toStationId: string) {
  return `manual-transfer:${fromStationId}:${toStationId}`;
}
