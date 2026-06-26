export interface CanonicalRouteStop {
  id: string;
  canonicalLineId: string;
  branchId: string;
  sourceLineNumber: string;
  sourceLineName: string;
  role: string;
  sequence: number;
  stationId: string;
  sourceStationCode: string;
  displayNameKo: string;
  matchStatus: string;
  confidence: string;
  sourceCandidateId: string;
  diagnostics?: string[];
}

export interface CanonicalBranch {
  id: string;
  canonicalLineId: string;
  role: "main" | "branch" | string;
  sourceLineNumber: string;
  sourceLineName: string;
  origin: string | null;
  terminal: string | null;
  routeStops: CanonicalRouteStop[];
}

export interface CanonicalLine {
  id: string;
  canonicalKey: string;
  lnCd: string;
  mreaWideCd: string;
  nameKo: string;
  colorHex: string;
  colorSource: string;
  branches: CanonicalBranch[];
  sourceLineNumbers: string[];
}

export interface CanonicalBundle {
  bundleId: string;
  acquiredDate: string;
  generatedAt: string;
  counts: {
    canonicalLines: number;
    branches: number;
    stations: number;
    routeStops: number;
    skippedRouteStops: number;
    missingCanonicalLines: number;
  };
  lines: CanonicalLine[];
  missingCanonicalLines: string[];
}

export type RouteGeometrySource = "station_sequence_smooth" | "manual_adjusted";

export interface RouteGeometryPoint {
  lng: number;
  lat: number;
  kind: "station" | "control";
  stationId?: string;
}

const AREA_NAME_BY_CODE: Record<string, string> = {
  "01": "수도권",
  "02": "부산",
  "03": "대구",
  "04": "광주",
  "05": "대전",
};

export function formatAreaName(areaCode: string): string {
  if (areaCode === "all") return "전체";
  return AREA_NAME_BY_CODE[areaCode] ?? areaCode;
}

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function countRouteStops(line: CanonicalLine): number {
  return line.branches.reduce((sum, branch) => sum + branch.routeStops.length, 0);
}

export function formatBranchRole(role: string): string {
  if (role === "main") return "본선";
  if (role === "branch") return "지선";
  return role;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("ko-KR");
}

export function getFirstStop(branch: CanonicalBranch): string {
  return branch.routeStops[0]?.displayNameKo ?? "-";
}

export function getLastStop(branch: CanonicalBranch): string {
  return branch.routeStops[branch.routeStops.length - 1]?.displayNameKo ?? "-";
}
