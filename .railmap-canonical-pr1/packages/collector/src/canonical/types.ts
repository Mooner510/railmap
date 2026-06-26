export type MatchStatus =
  | "exact"
  | "normalized-code"
  | "name-based"
  | "missing"
  | "ambiguous";

export type MatchConfidence = "high" | "medium" | "low" | "none";

export type BranchRole = "main" | "branch";

export interface CanonicalSourceLineMapRow {
  canonicalKey: string;
  lnCd: string;
  canonicalName: string;
  mreaWideCd: string;
  sourceLineNumber: string;
  sourceLineName: string;
  role: BranchRole;
}

export interface SourceLineCandidate {
  candidateId: string;
  sourceId: string;
  sourcePointer: {
    file: string;
    sheet: string;
    rowNumber: number;
  };
  raw: Record<string, { rawValue: unknown; rawText: string | null }>;
  normalized: {
    lineNumber: string | null;
    lineNameKo: string | null;
  };
  parseDiagnostics: string[];
}

export interface StationCandidate {
  candidateId: string;
  sourceId: string;
  sourcePointer: {
    file: string;
    sheet: string;
    rowNumber: number;
  };
  raw: Record<string, { rawValue: unknown; rawText: string | null }>;
  normalized: {
    stationNumber: string | null;
    stationNameKo: string | null;
    lineNumber: string | null;
    lineNameKo: string | null;
    stationNameEn: string | null;
    latitude: number | null;
    longitude: number | null;
    operatorNameKo: string | null;
  };
  parseDiagnostics: string[];
}

export interface RouteStopCandidate {
  candidateId: string;
  sourceId: string;
  sourcePointer: {
    file: string;
    sheet: string;
    rowNumber: number;
    rawField: "정거장구성";
  };
  normalized: {
    lineNumber: string | null;
    lineNameKo: string | null;
    sequence: number;
    sourceStationCode: string | null;
    stationNameKo: string | null;
  };
  rawToken: string;
  parseDiagnostics: string[];
}

export interface AppStation {
  id: string;
  stationNumber: string | null;
  nameKo: string | null;
  nameEn: string | null;
  lat: number | null;
  lng: number | null;
  operatorNameKo: string | null;
  sourceCandidateId: string;
  sourceLineNumbers: string[];
  canonicalLineIds: string[];
}

export interface AppRouteStop {
  id: string;
  canonicalLineId: string;
  branchId: string;
  sourceLineNumber: string;
  sourceLineName: string;
  role: BranchRole;
  sequence: number;
  stationId: string;
  sourceStationCode: string | null;
  displayNameKo: string | null;
  matchStatus: MatchStatus;
  confidence: MatchConfidence;
  sourceCandidateId: string;
  diagnostics: string[];
}

export interface AppBranch {
  id: string;
  canonicalLineId: string;
  role: BranchRole;
  sourceLineNumber: string;
  sourceLineName: string;
  origin: string | null;
  terminal: string | null;
  routeStops: AppRouteStop[];
}

export interface AppCanonicalLine {
  id: string;
  canonicalKey: string;
  lnCd: string;
  mreaWideCd: string;
  nameKo: string;
  branches: AppBranch[];
  sourceLineNumbers: string[];
}

export interface SkippedRouteStop {
  stopCandidateId: string;
  canonicalLineId: string | null;
  branchId: string | null;
  sourceLineNumber: string | null;
  sourceLineName: string | null;
  sourceStationCode: string | null;
  stationNameKo: string | null;
  reason: string;
  diagnostics: string[];
}

export interface CanonicalAppBundle {
  bundleId: "kric-canonical-app-bundle";
  acquiredDate: string;
  generatedAt: string;
  policy: {
    canonicalSource: string;
    sourceLineMap: string;
    excludedCanonicalKeys: string[];
    note: string;
  };
  counts: {
    canonicalLines: number;
    branches: number;
    stations: number;
    routeStops: number;
    skippedRouteStops: number;
    missingCanonicalLines: number;
  };
  lines: AppCanonicalLine[];
  stations: AppStation[];
  skippedRouteStops: SkippedRouteStop[];
  missingCanonicalLines: string[];
}
