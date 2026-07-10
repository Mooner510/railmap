
export const RAIL_LINE_CATEGORIES = [
  "urban_rail",
  "gtx",
  "conventional_rail",
  "high_speed_rail",
] as const;

export type RailLineCategory = (typeof RAIL_LINE_CATEGORIES)[number];

export const RAIL_SERVICE_TYPES = [
  "subway",
  "gtx",
  "ktx",
  "srt",
  "itx",
  "saemaeul",
  "mugunghwa",
  "nuriro",
  "airport_rail",
  "unknown",
] as const;

export type RailServiceType = (typeof RAIL_SERVICE_TYPES)[number];

export const MANUAL_RAIL_TYPES = [
  "high_speed_rail",
  "semi_high_speed_rail",
  "trunk_rail",
  "branch_rail",
  "urban_rail",
] as const;

export type ManualRailType = (typeof MANUAL_RAIL_TYPES)[number];

export const MANUAL_RAIL_STATUSES = [
  "open",
  "construction",
  "planned",
  "closed",
] as const;

export type ManualRailStatus = (typeof MANUAL_RAIL_STATUSES)[number];

export const MANUAL_LINE_COVERAGE_STATUSES = [
  "draft",
  "partial",
  "complete",
] as const;

export type ManualLineCoverageStatus = (typeof MANUAL_LINE_COVERAGE_STATUSES)[number];

export function isManualRailType(value: unknown): value is ManualRailType {
  return typeof value === "string" && MANUAL_RAIL_TYPES.includes(value as ManualRailType);
}

export function isManualRailStatus(value: unknown): value is ManualRailStatus {
  return typeof value === "string" && MANUAL_RAIL_STATUSES.includes(value as ManualRailStatus);
}

export function isManualLineCoverageStatus(value: unknown): value is ManualLineCoverageStatus {
  return typeof value === "string" && MANUAL_LINE_COVERAGE_STATUSES.includes(value as ManualLineCoverageStatus);
}

export function manualRailTypeToLineCategory(railType: ManualRailType): RailLineCategory {
  if (railType === "high_speed_rail") return "high_speed_rail";
  if (railType === "urban_rail") return "urban_rail";
  return "conventional_rail";
}

export function formatManualLineCoverageStatus(status: ManualLineCoverageStatus) {
  switch (status) {
    case "draft":
      return "작성 중";
    case "partial":
      return "일부 역만 입력";
    case "complete":
      return "전체 역 입력 완료";
  }
}

export function formatManualRailType(railType: ManualRailType) {
  switch (railType) {
    case "high_speed_rail":
      return "고속선";
    case "semi_high_speed_rail":
      return "준고속선";
    case "trunk_rail":
      return "간선철도";
    case "branch_rail":
      return "지선철도";
    case "urban_rail":
      return "도시철도";
  }
}

export function isRailLineCategory(value: unknown): value is RailLineCategory {
  return typeof value === "string" && RAIL_LINE_CATEGORIES.includes(value as RailLineCategory);
}

export function isRailServiceType(value: unknown): value is RailServiceType {
  return typeof value === "string" && RAIL_SERVICE_TYPES.includes(value as RailServiceType);
}

export function inferRailLineCategory(line: { canonicalKey?: string | null; lnCd?: string | null; nameKo?: string | null }): RailLineCategory {
  const key = `${line.canonicalKey ?? ""} ${line.lnCd ?? ""} ${line.nameKo ?? ""}`.toLowerCase();
  if (key.includes("gtx") || key.includes("수도권광역급행철도")) return "gtx";
  return "urban_rail";
}

export function inferRailServiceTypes(line: { canonicalKey?: string | null; lnCd?: string | null; nameKo?: string | null }): RailServiceType[] {
  const category = inferRailLineCategory(line);
  if (category === "gtx") return ["gtx"];
  if ((line.nameKo ?? "").includes("공항철도")) return ["airport_rail"];
  return ["subway"];
}

export function formatRailLineCategory(category: RailLineCategory) {
  switch (category) {
    case "urban_rail":
      return "도시철도";
    case "gtx":
      return "GTX";
    case "conventional_rail":
      return "일반철도";
    case "high_speed_rail":
      return "고속철도";
  }
}

export function formatRailServiceType(serviceType: RailServiceType) {
  switch (serviceType) {
    case "subway":
      return "지하철";
    case "gtx":
      return "GTX";
    case "ktx":
      return "KTX";
    case "srt":
      return "SRT";
    case "itx":
      return "ITX";
    case "saemaeul":
      return "새마을";
    case "mugunghwa":
      return "무궁화";
    case "nuriro":
      return "누리로";
    case "airport_rail":
      return "공항철도";
    case "unknown":
      return "미정";
  }
}

export interface ManualLineMetadataOverride {
  lineId: string;
  category?: RailLineCategory;
  serviceTypes?: RailServiceType[];
  trainPerformance?: ManualTrainPerformance | null;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

export interface ManualTrainPerformance {
  accelerationMps2?: number | null;
  decelerationMps2?: number | null;
  maxSpeedKph?: number | null;
}

export interface ManualLineDefinition {
  id: string;
  nameKo: string;
  colorHex: string;
  railType: ManualRailType;
  serviceTypes: RailServiceType[];
  status: ManualRailStatus;
  coverageStatus?: ManualLineCoverageStatus;
  trainPerformance?: ManualTrainPerformance | null;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

export interface ManualBranchDefinition {
  id: string;
  lineId: string;
  nameKo?: string | null;
  stationIds: string[];
  circular?: boolean;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

export interface EditorStation {
  id: string;
  stationNumber: string;
  nameKo: string;
  lineNameKo: string;
  lineNumber?: string;
  colorHex?: string | null;
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

export type ManualTransferReviewEventType =
  | "suggestion-approved"
  | "suggestion-dismissed"
  | "group-created"
  | "group-updated"
  | "group-deleted"
  | "transfer-time-pending"
  | "transfer-time-completed";

export interface ManualTransferReviewEvent {
  id: string;
  type: ManualTransferReviewEventType;
  transferGroupId?: string | null;
  suggestionKey?: string | null;
  nameKo: string;
  stationIds: string[];
  decidedAt: string;
  reason?: string | null;
  note?: string | null;
}

export interface ManualServicePatternStop {
  stationId: string;
  sequence: number;
  stopType?: "stop" | "pass" | "origin" | "terminal" | string;
  note?: string | null;
}

export interface ManualServicePattern {
  id: string;
  nameKo: string;
  lineId?: string | null;
  branchId?: string | null;
  serviceType: RailServiceType;
  direction?: "up" | "down" | "loop" | "unknown" | string;
  stops: ManualServicePatternStop[];
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

export interface ManualTrainStopTime {
  stationId: string;
  sequence: number;
  arrivalTime?: string | null;
  departureTime?: string | null;
  stopType?: "stop" | "pass" | "origin" | "terminal" | string;
  note?: string | null;
}

export interface ManualTrainRun {
  id: string;
  patternId?: string | null;
  trainNumber?: string | null;
  nameKo?: string | null;
  serviceType: RailServiceType;
  operatingDays?: string[];
  stopTimes: ManualTrainStopTime[];
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

export interface ManualStationOverride {
  stationId: string;
  nameKo?: string;
  stationNumber?: string;
  lineNameKo?: string;
  lineNumber?: string;
  colorHex?: string | null;
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

export interface ManualBranchStationExclusion {
  id: string;
  branchId: string;
  stationId: string;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

export type ManualBranchRouteDirection = "bidirectional" | "forward" | "reverse";

export interface ManualBranchRouteOverride {
  id: string;
  branchId: string;
  stationIds: string[];
  circular?: boolean;
  routeDirection?: ManualBranchRouteDirection;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

export type ManualLineBranchMode = "add-station" | "connect-line";
export type ManualLineBranchDirection = "toward-start" | "toward-end";

export interface ManualLineBranchGeometryPoint {
  lng: number;
  lat: number;
  kind: "station" | "control";
  stationId?: string;
}

export interface ManualLineBranchOverride {
  id: string;
  mode: ManualLineBranchMode;
  parentBranchId: string;
  anchorStationId: string;
  branchStationId?: string;
  connectedBranchId?: string;
  connectedEndpointStationId?: string;
  connectedDirection?: ManualLineBranchDirection;
  geometry?: ManualLineBranchGeometryPoint[];
  enabled: boolean;
  source?: "manual" | "editor" | string;
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
  dismissedTransferGroupSuggestionKeys: string[];
  dismissedTransferGroupSuggestionNotes: Record<string, string>;
  transferTimePendingGroupIds: string[];
  manualTransferReviewEvents: ManualTransferReviewEvent[];
  stationOverrides: ManualStationOverride[];
  branchOverrides: ManualBranchOverride[];
  branchStationExclusions: ManualBranchStationExclusion[];
  branchRouteOverrides: ManualBranchRouteOverride[];
  lineBranchOverrides: ManualLineBranchOverride[];
  geometryOverrides: ManualGeometryOverride[];
  lineMetadataOverrides: ManualLineMetadataOverride[];
  manualLineDefinitions: ManualLineDefinition[];
  manualBranchDefinitions: ManualBranchDefinition[];
  manualServicePatterns: ManualServicePattern[];
  manualTrainRuns: ManualTrainRun[];
}

export interface CanonicalBundle {
  stations: EditorStation[];
}

export const EMPTY_MANUAL_OVERLAY_BUNDLE: ManualOverlayBundle = {
  schemaVersion: 1,
  manualTransferGroups: [],
  manualTransferEdges: [],
  nonTransferStationIds: [],
  dismissedTransferGroupSuggestionKeys: [],
  dismissedTransferGroupSuggestionNotes: {},
  transferTimePendingGroupIds: [],
  manualTransferReviewEvents: [],
  stationOverrides: [],
  branchOverrides: [],
  branchStationExclusions: [],
  branchRouteOverrides: [],
  lineBranchOverrides: [],
  geometryOverrides: [],
  lineMetadataOverrides: [],
  manualLineDefinitions: [],
  manualBranchDefinitions: [],
  manualServicePatterns: [],
  manualTrainRuns: [],
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


export function makeLineBranchOverrideId(mode: ManualLineBranchMode, parentBranchId: string, anchorStationId: string, targetId: string) {
  return `manual-line-branch:${mode}:${parentBranchId}:${anchorStationId}:${targetId}`;
}

export function makeBranchStationExclusionId(branchId: string, stationId: string) {
  return `manual-branch-station-exclusion:${branchId}:${stationId}`;
}

export function makeBranchRouteOverrideId(branchId: string) {
  return `manual-branch-route:${branchId}`;
}
