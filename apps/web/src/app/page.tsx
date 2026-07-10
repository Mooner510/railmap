import fs from "node:fs";
import path from "node:path";
import RailExplorer from "./RailExplorer";
import {
  inferRailLineCategory,
  inferRailServiceTypes,
  isManualLineCoverageStatus,
  isManualRailStatus,
  isManualRailType,
  isRailLineCategory,
  isRailServiceType,
  manualRailTypeToLineCategory,
  type ManualLineCoverageStatus,
  type ManualRailStatus,
  type ManualRailType,
  type RailLineCategory,
  type RailServiceType,
  normalizeManualLineCoverageStatus,
} from "./railExplorerModel";
import {
  type RailMapBranch,
  type RailMapStation,
  type RailMapTransferGroup,
} from "./RailMap";

type MatchConfidence = "high" | "medium" | "low" | "none" | string;

interface CanonicalRouteStop {
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
  confidence: MatchConfidence;
  sourceCandidateId: string;
  diagnostics?: string[];
}

interface CanonicalBranch {
  id: string;
  canonicalLineId: string;
  role: "main" | "branch" | string;
  sourceLineNumber: string;
  sourceLineName: string;
  origin: string | null;
  terminal: string | null;
  routeStops: CanonicalRouteStop[];
  isCircular?: boolean;
}

interface CanonicalLine {
  id: string;
  canonicalKey: string;
  lnCd: string;
  mreaWideCd: string;
  nameKo: string;
  colorHex: string;
  colorSource: string;
  category: RailLineCategory;
  serviceTypes: RailServiceType[];
  trainPerformance?: ManualTrainPerformance | null;
  branches: CanonicalBranch[];
  sourceLineNumbers: string[];
}

interface CanonicalStation {
  id: string;
  stationNumber: string;
  nameKo: string;
  nameEn?: string | null;
  lineNumber: string;
  lineNameKo: string;
  lat: number | null;
  lng: number | null;
  operatorNameKo?: string | null;
  sourceCandidateId: string;
}

interface ManualStationOverride {
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

interface ManualGeometryOverridePoint {
  lng: number;
  lat: number;
  kind: "station" | "control";
  stationId?: string;
}

interface ManualGeometryOverride {
  branchId: string;
  points: ManualGeometryOverridePoint[];
  enabled: boolean;
  note?: string | null;
}

interface ManualBranchStationExclusion {
  id: string;
  branchId: string;
  stationId: string;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

interface ManualBranchRouteOverride {
  id: string;
  branchId: string;
  stationIds: string[];
  circular?: boolean;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

interface ManualLineBranchGeometryPoint {
  lng: number;
  lat: number;
  kind: "station" | "control";
  stationId?: string;
}

interface ManualLineBranchOverride {
  id: string;
  mode: "add-station" | "connect-line";
  parentBranchId: string;
  anchorStationId: string;
  branchStationId?: string;
  connectedBranchId?: string;
  connectedEndpointStationId?: string;
  geometry?: ManualLineBranchGeometryPoint[];
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

interface ManualLineMetadataOverride {
  lineId: string;
  category?: RailLineCategory;
  serviceTypes?: RailServiceType[];
  trainPerformance?: ManualTrainPerformance | null;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

interface ManualTrainPerformance {
  accelerationMps2?: number | null;
  decelerationMps2?: number | null;
  maxSpeedKph?: number | null;
}

interface ManualLineDefinition {
  id: string;
  nameKo: string;
  colorHex: string;
  railType: ManualRailType;
  serviceTypes: RailServiceType[];
  status: ManualRailStatus;
  coverageStatus: ManualLineCoverageStatus;
  trainPerformance?: ManualTrainPerformance | null;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

interface ManualBranchDefinition {
  id: string;
  lineId: string;
  nameKo?: string | null;
  stationIds: string[];
  circular?: boolean;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

interface ManualTransferGroup {
  id: string;
  nameKo: string;
  stationIds: string[];
  transferMinutesByPair: Record<string, number | null>;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

interface ManualTransferEdge {
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

interface ManualTransferReviewEvent {
  id: string;
  type: string;
  transferGroupId?: string | null;
  suggestionKey?: string | null;
  nameKo: string;
  stationIds: string[];
  decidedAt: string;
  reason?: string | null;
  note?: string | null;
}

interface ManualServicePattern {
  id: string;
  nameKo: string;
  lineId?: string | null;
  branchId?: string | null;
  serviceType: RailServiceType;
  direction?: string;
  stops: Array<{ stationId: string; sequence: number; stopType?: string; note?: string | null }>;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

interface ManualTrainRun {
  id: string;
  patternId?: string | null;
  trainNumber?: string | null;
  nameKo?: string | null;
  serviceType: RailServiceType;
  operatingDays?: string[];
  stopTimes: Array<{ stationId: string; sequence: number; arrivalTime?: string | null; departureTime?: string | null; stopType?: string; note?: string | null }>;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

interface PublicDataVersionManifest {
  schemaVersion: number;
  generatedAt: string;
  acquiredDate?: string;
  releaseId?: string;
  versions?: {
    bundle?: { generatedAt?: string | null; acquiredDate?: string | null; bytes?: number | null; sha256?: string | null };
    manualOverlay?: { bytes?: number | null; mtimeMs?: number | null; sha256?: string | null };
  };
}

interface CanonicalBundle {
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
  manualTransferGroups?: ManualTransferGroup[];
  manualTransferEdges?: ManualTransferEdge[];
  stations: CanonicalStation[];
  routeStops: CanonicalRouteStop[];
  skippedRouteStops: unknown[];
  missingCanonicalLines: string[];
}

interface ManualOverlays {
  schemaVersion: 1;
  manualTransferGroups: ManualTransferGroup[];
  manualTransferEdges: ManualTransferEdge[];
  nonTransferStationIds?: string[];
  manualTransferReviewEvents?: ManualTransferReviewEvent[];
  stationOverrides: ManualStationOverride[];
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

function makeTransferPairKey(stationIdA: string, stationIdB: string) {
  return [stationIdA, stationIdB].slice().sort().join("<->");
}

function deriveTransferEdgesFromGroups(
  groups: ManualTransferGroup[],
): ManualTransferEdge[] {
  const edges: ManualTransferEdge[] = [];

  for (const group of groups) {
    const stationIds = [...new Set(group.stationIds)].filter(Boolean);
    if (stationIds.length < 2) continue;

    for (let i = 0; i < stationIds.length - 1; i += 1) {
      for (let j = i + 1; j < stationIds.length; j += 1) {
        const fromStationId = stationIds[i];
        const toStationId = stationIds[j];
        if (!fromStationId || !toStationId || fromStationId === toStationId)
          continue;

        const pairKey = makeTransferPairKey(fromStationId, toStationId);

        edges.push({
          id: `${group.id}:${pairKey}`,
          fromStationId,
          toStationId,
          labelKo: group.nameKo || "수동 환승",
          transferMinutes: group.transferMinutesByPair?.[pairKey] ?? null,
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

function normalizeLineMetadataOverride(value: unknown): ManualLineMetadataOverride | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const lineId = typeof record.lineId === "string" && record.lineId.trim() ? record.lineId.trim() : null;
  if (!lineId) return null;
  const category = isRailLineCategory(record.category) ? record.category : undefined;
  const serviceTypes = Array.isArray(record.serviceTypes)
    ? [...new Set(record.serviceTypes.filter(isRailServiceType))]
    : undefined;
  return {
    lineId,
    category,
    serviceTypes: serviceTypes && serviceTypes.length > 0 ? serviceTypes : undefined,
    enabled: record.enabled !== false,
    source: typeof record.source === "string" ? record.source : "editor",
    note: typeof record.note === "string" ? record.note : null,
  };
}

function normalizeManualRailType(value: unknown) {
  return isManualRailType(value) ? value : "trunk_rail";
}

function normalizeManualRailStatus(value: unknown) {
  return isManualRailStatus(value) ? value : "open";
}

function normalizePositiveDecimal(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function normalizeManualTrainPerformance(value: unknown): ManualLineDefinition["trainPerformance"] {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const accelerationMps2 = normalizePositiveDecimal(record.accelerationMps2);
  const decelerationMps2 = normalizePositiveDecimal(record.decelerationMps2);
  const maxSpeedKph = normalizePositiveDecimal(record.maxSpeedKph);
  return accelerationMps2 || decelerationMps2 || maxSpeedKph
    ? { accelerationMps2, decelerationMps2, maxSpeedKph }
    : null;
}

function normalizeManualLineDefinition(value: unknown): ManualLineDefinition | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
  const nameKo = typeof record.nameKo === "string" && record.nameKo.trim() ? record.nameKo.trim() : null;
  if (!id || !nameKo) return null;
  const serviceTypes = Array.isArray(record.serviceTypes)
    ? [...new Set(record.serviceTypes.filter(isRailServiceType))]
    : [];
  return {
    id,
    nameKo,
    colorHex: typeof record.colorHex === "string" && record.colorHex.trim() ? record.colorHex.trim() : "#64748b",
    railType: normalizeManualRailType(record.railType),
    serviceTypes: serviceTypes.length > 0 ? serviceTypes : ["unknown"],
    status: normalizeManualRailStatus(record.status),
    coverageStatus: normalizeManualLineCoverageStatus(record.coverageStatus),
    trainPerformance: normalizeManualTrainPerformance(record.trainPerformance),
    enabled: record.enabled !== false,
    source: typeof record.source === "string" ? record.source : "editor",
    note: typeof record.note === "string" ? record.note : null,
  };
}

function normalizeManualBranchDefinition(value: unknown): ManualBranchDefinition | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
  const lineId = typeof record.lineId === "string" && record.lineId.trim() ? record.lineId.trim() : null;
  if (!id || !lineId) return null;
  const stationIds = Array.isArray(record.stationIds)
    ? [...new Set(record.stationIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))]
    : [];
  return {
    id,
    lineId,
    nameKo: typeof record.nameKo === "string" && record.nameKo.trim() ? record.nameKo.trim() : null,
    stationIds,
    circular: record.circular === true,
    enabled: record.enabled !== false,
    source: typeof record.source === "string" ? record.source : "editor",
    note: typeof record.note === "string" ? record.note : null,
  };
}

function applyLineMetadataOverrides(
  lines: CanonicalLine[],
  overrides: ManualLineMetadataOverride[],
): CanonicalLine[] {
  const overrideByLineId = new Map(
    overrides
      .filter((override) => override.enabled !== false)
      .map((override) => [override.lineId, override]),
  );

  return lines.map((line) => {
    const fallbackCategory = line.category ?? inferRailLineCategory(line);
    const fallbackServiceTypes =
      line.serviceTypes && line.serviceTypes.length > 0
        ? line.serviceTypes
        : inferRailServiceTypes(line);
    const override = overrideByLineId.get(line.canonicalKey ?? line.id ?? line.nameKo);
    return {
      ...line,
      category: override?.category ?? fallbackCategory,
      serviceTypes: override?.serviceTypes?.length
        ? override.serviceTypes
        : fallbackServiceTypes,
      trainPerformance: override?.trainPerformance ?? line.trainPerformance ?? null,
    };
  });
}

function readManualOverlays(): ManualOverlays {
  const candidates = [
    path.join(process.cwd(), "public/data/manual-overlays.json"),
    path.join(process.cwd(), "../../data/manual/manual-overlays.json"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;

    const parsed = JSON.parse(
      fs.readFileSync(candidate, "utf8"),
    ) as Partial<ManualOverlays>;

    const manualTransferGroups = Array.isArray(parsed.manualTransferGroups)
      ? parsed.manualTransferGroups
      : [];
    const legacyEdges = Array.isArray(parsed.manualTransferEdges)
      ? parsed.manualTransferEdges.filter(
          (edge) => edge.source !== "editor-group",
        )
      : [];

    return {
      schemaVersion: 1,
      manualTransferGroups,
      manualTransferEdges: [
        ...legacyEdges,
        ...deriveTransferEdgesFromGroups(manualTransferGroups),
      ],
      nonTransferStationIds: Array.isArray(parsed.nonTransferStationIds)
        ? parsed.nonTransferStationIds
        : [],
      manualTransferReviewEvents: Array.isArray((parsed as { manualTransferReviewEvents?: unknown }).manualTransferReviewEvents)
        ? (parsed as { manualTransferReviewEvents: ManualTransferReviewEvent[] }).manualTransferReviewEvents
        : [],
      stationOverrides: Array.isArray(parsed.stationOverrides)
        ? parsed.stationOverrides
        : [],
      branchStationExclusions: Array.isArray((parsed as { branchStationExclusions?: unknown }).branchStationExclusions)
        ? ((parsed as { branchStationExclusions: ManualBranchStationExclusion[] }).branchStationExclusions)
        : [],
      branchRouteOverrides: Array.isArray((parsed as { branchRouteOverrides?: unknown }).branchRouteOverrides)
        ? ((parsed as { branchRouteOverrides: ManualBranchRouteOverride[] }).branchRouteOverrides)
        : [],
      lineBranchOverrides: Array.isArray((parsed as { lineBranchOverrides?: unknown }).lineBranchOverrides)
        ? ((parsed as { lineBranchOverrides: ManualLineBranchOverride[] }).lineBranchOverrides)
        : [],
      geometryOverrides: Array.isArray(parsed.geometryOverrides)
        ? parsed.geometryOverrides
        : [],
      lineMetadataOverrides: Array.isArray((parsed as { lineMetadataOverrides?: unknown }).lineMetadataOverrides)
        ? (parsed as { lineMetadataOverrides: unknown[] }).lineMetadataOverrides
            .map(normalizeLineMetadataOverride)
            .filter((override): override is ManualLineMetadataOverride => override !== null)
        : [],
      manualLineDefinitions: Array.isArray((parsed as { manualLineDefinitions?: unknown }).manualLineDefinitions)
        ? (parsed as { manualLineDefinitions: unknown[] }).manualLineDefinitions
            .map(normalizeManualLineDefinition)
            .filter((line): line is ManualLineDefinition => line !== null)
        : [],
      manualBranchDefinitions: Array.isArray((parsed as { manualBranchDefinitions?: unknown }).manualBranchDefinitions)
        ? (parsed as { manualBranchDefinitions: unknown[] }).manualBranchDefinitions
            .map(normalizeManualBranchDefinition)
            .filter((branch): branch is ManualBranchDefinition => branch !== null)
        : [],
      manualServicePatterns: Array.isArray((parsed as { manualServicePatterns?: unknown }).manualServicePatterns)
        ? (parsed as { manualServicePatterns: ManualServicePattern[] }).manualServicePatterns
        : [],
      manualTrainRuns: Array.isArray((parsed as { manualTrainRuns?: unknown }).manualTrainRuns)
        ? (parsed as { manualTrainRuns: ManualTrainRun[] }).manualTrainRuns
        : [],
    };
  }

  return {
    schemaVersion: 1,
    manualTransferGroups: [],
    manualTransferEdges: [],
    nonTransferStationIds: [],
    manualTransferReviewEvents: [],
    stationOverrides: [],
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
}


function makeLineScopedStationId(stationId: string, lineKey: string) {
  const safeLineKey = lineKey.trim().replace(/[^\w가-힣:.-]+/g, "_") || "unknown";
  return `${stationId}::line:${safeLineKey}`;
}

function getLineKey(line: CanonicalLine, branch: CanonicalBranch) {
  return line.canonicalKey ?? line.id ?? branch.sourceLineNumber ?? line.nameKo;
}

type StationLineUsage = {
  lineKey: string;
  lineNameKo: string;
  sourceLineNumber: string;
  sourceLineName: string;
};

function getPrimaryStationLineKey(
  station: CanonicalStation | undefined,
  usages: StationLineUsage[] | undefined,
) {
  if (!station || !usages || usages.length < 1) return null;

  return (
    usages.find(
      (usage) =>
        station.lineNumber &&
        usage.sourceLineNumber &&
        station.lineNumber === usage.sourceLineNumber,
    ) ??
    usages.find(
      (usage) =>
        station.lineNameKo &&
        (station.lineNameKo === usage.lineNameKo ||
          station.lineNameKo === usage.sourceLineName),
    ) ??
    usages[0] ??
    null
  )?.lineKey ?? null;
}

function normalizeSingleLineStationMappings(bundle: CanonicalBundle): CanonicalBundle {
  const stationById = new Map(bundle.stations.map((station) => [station.id, station]));
  const usageByStationId = new Map<string, Map<string, StationLineUsage>>();

  for (const line of bundle.lines) {
    for (const branch of line.branches) {
      const lineKey = getLineKey(line, branch);
      for (const stop of branch.routeStops) {
        const usages = usageByStationId.get(stop.stationId) ?? new Map<string, StationLineUsage>();
        usages.set(lineKey, {
          lineKey,
          lineNameKo: line.nameKo,
          sourceLineNumber: branch.sourceLineNumber,
          sourceLineName: branch.sourceLineName,
        });
        usageByStationId.set(stop.stationId, usages);
      }
    }
  }

  const nextStationById = new Map(bundle.stations.map((station) => [station.id, station]));
  const primaryLineKeyByStationId = new Map(
    [...usageByStationId.entries()].map(([stationId, usages]) => [
      stationId,
      getPrimaryStationLineKey(stationById.get(stationId), [...usages.values()]),
    ]),
  );

  const lines = bundle.lines.map((line) => ({
    ...line,
    branches: line.branches.map((branch) => {
      const lineKey = getLineKey(line, branch);
      return {
        ...branch,
        routeStops: branch.routeStops.map((stop) => {
          const station = stationById.get(stop.stationId);
          const stationUsageCount = usageByStationId.get(stop.stationId)?.size ?? 0;
          const primaryLineKey = primaryLineKeyByStationId.get(stop.stationId);

          if (!station || stationUsageCount <= 1 || lineKey === primaryLineKey) {
            return stop;
          }

          const scopedStationId = makeLineScopedStationId(stop.stationId, lineKey);
          if (!nextStationById.has(scopedStationId)) {
            nextStationById.set(scopedStationId, {
              ...station,
              id: scopedStationId,
              stationNumber: stop.sourceStationCode || station.stationNumber,
              lineNumber: branch.sourceLineNumber || station.lineNumber,
              lineNameKo: line.nameKo || branch.sourceLineName || station.lineNameKo,
            });
          }

          return {
            ...stop,
            stationId: scopedStationId,
          };
        }),
      };
    }),
  }));

  const routeStops = lines.flatMap((line) => line.branches.flatMap((branch) => branch.routeStops));
  const referencedStationIds = new Set(routeStops.map((stop) => stop.stationId));

  return {
    ...bundle,
    stations: [...nextStationById.values()].filter(
      (station) => referencedStationIds.has(station.id) || !usageByStationId.has(station.id),
    ),
    lines,
    routeStops,
  };
}

function buildBranchStationExclusionIndex(exclusions: ManualBranchStationExclusion[]) {
  const index = new Map<string, Set<string>>();

  for (const exclusion of exclusions) {
    if (exclusion.enabled === false) continue;
    const set = index.get(exclusion.branchId) ?? new Set<string>();
    set.add(exclusion.stationId);
    index.set(exclusion.branchId, set);
  }

  return index;
}

function filterBranchRouteStops(branch: CanonicalBranch, exclusionIndex: Map<string, Set<string>>) {
  const excludedStationIds = exclusionIndex.get(branch.id);
  if (!excludedStationIds || excludedStationIds.size === 0) return branch.routeStops;
  return branch.routeStops.filter((stop) => !excludedStationIds.has(stop.stationId));
}

function applyBranchStationExclusions(bundle: CanonicalBundle, exclusions: ManualBranchStationExclusion[]): CanonicalBundle {
  const exclusionIndex = buildBranchStationExclusionIndex(exclusions);
  if (exclusionIndex.size === 0) return bundle;

  const lines = bundle.lines.map((line) => ({
    ...line,
    branches: line.branches.map((branch) => ({
      ...branch,
      routeStops: filterBranchRouteStops(branch, exclusionIndex),
    })),
  }));

  return {
    ...bundle,
    lines,
    routeStops: lines.flatMap((line) => line.branches.flatMap((branch) => branch.routeStops)),
  };
}

function applyBranchRouteOverrides(
  bundle: CanonicalBundle,
  overrides: ManualBranchRouteOverride[],
): CanonicalBundle {
  const stationById = new Map(bundle.stations.map((station) => [station.id, station]));
  const overrideByBranchId = new Map(
    overrides
      .filter((override) => override.enabled !== false && override.stationIds.length >= 2)
      .map((override) => [override.branchId, override]),
  );
  if (overrideByBranchId.size === 0) return bundle;

  const lines = bundle.lines.map((line) => ({
    ...line,
    branches: line.branches.map((branch) => {
      const override = overrideByBranchId.get(branch.id);
      if (!override) return branch;

      const stopByStationId = new Map(
        branch.routeStops.map((stop) => [stop.stationId, stop] as const),
      );
      return {
        ...branch,
        isCircular: override.circular === true,
        routeStops: override.stationIds.map((stationId, index) => {
          const existing = stopByStationId.get(stationId);
          const station = stationById.get(stationId);
          if (existing) return { ...existing, sequence: index + 1 };

          return {
            id: `${branch.id}:manual-route:${index + 1}:${stationId}`,
            canonicalLineId: line.canonicalKey,
            branchId: branch.id,
            sourceLineNumber: branch.sourceLineNumber,
            sourceLineName: branch.sourceLineName,
            role: branch.role,
            sequence: index + 1,
            stationId,
            sourceStationCode: station?.stationNumber ?? "",
            displayNameKo: station?.nameKo ?? stationId,
            matchStatus: "manual",
            confidence: "manual",
            sourceCandidateId: stationId,
            diagnostics: ["manual-branch-route-override"],
          } satisfies CanonicalRouteStop;
        }),
      };
    }),
  }));

  return {
    ...bundle,
    lines,
    routeStops: lines.flatMap((line) =>
      line.branches.flatMap((branch) => branch.routeStops),
    ),
  };
}

function createManualStationFromOverride(
  override: ManualStationOverride,
): CanonicalStation | null {
  if (override.enabled === false) return null;
  if (!override.nameKo?.trim()) return null;
  if (typeof override.lng !== "number" || typeof override.lat !== "number") return null;
  if (!Number.isFinite(override.lng) || !Number.isFinite(override.lat)) return null;

  return {
    id: override.stationId,
    stationNumber: override.stationNumber?.trim() || "MANUAL",
    nameKo: override.nameKo.trim(),
    nameEn: null,
    lineNumber: override.lineNumber?.trim() || "manual",
    lineNameKo: override.lineNameKo?.trim() || "수동 추가 역",
    lat: override.lat,
    lng: override.lng,
    operatorNameKo: null,
    sourceCandidateId: override.stationId,
  };
}

function applyStationOverrides(
  stations: CanonicalStation[],
  overrides: ManualStationOverride[],
): CanonicalStation[] {
  const overrideByStationId = new Map(
    overrides
      .filter((override) => override.enabled !== false)
      .map((override) => [override.stationId, override]),
  );
  const baseStationIds = new Set(stations.map((station) => station.id));

  const updatedStations = stations.map((station) => {
    const override = overrideByStationId.get(station.id);
    if (!override) return station;

    return {
      ...station,
      nameKo: override.nameKo?.trim() || station.nameKo,
      stationNumber: override.stationNumber?.trim() || station.stationNumber,
      lineNameKo: override.lineNameKo?.trim() || station.lineNameKo,
      lineNumber: override.lineNumber?.trim() || station.lineNumber,
      lat:
        typeof override.lat === "number" && Number.isFinite(override.lat)
          ? override.lat
          : station.lat,
      lng:
        typeof override.lng === "number" && Number.isFinite(override.lng)
          ? override.lng
          : station.lng,
    };
  });

  const manualStations = overrides
    .filter((override) => !baseStationIds.has(override.stationId))
    .map(createManualStationFromOverride)
    .filter((station): station is CanonicalStation => station !== null);

  return [...updatedStations, ...manualStations];
}

function applyManualLineDefinitions(
  bundle: CanonicalBundle,
  lineDefinitions: ManualLineDefinition[],
  branchDefinitions: ManualBranchDefinition[],
): CanonicalBundle {
  const enabledLines = lineDefinitions.filter((line) => line.enabled !== false);
  const enabledBranches = branchDefinitions.filter((branch) => branch.enabled !== false);
  if (enabledLines.length === 0) return bundle;

  const lineIds = new Set(bundle.lines.map((line) => line.canonicalKey ?? line.id));
  const stationIds = new Set(bundle.stations.map((station) => station.id));
  const manualLines: CanonicalLine[] = [];
  const manualRouteStops: CanonicalRouteStop[] = [];

  for (const line of enabledLines) {
    if (lineIds.has(line.id)) continue;
    const branches = enabledBranches
      .filter((branch) => branch.lineId === line.id)
      .map((branch): CanonicalBranch => {
        const routeStops = branch.stationIds
          .filter((stationId) => stationIds.has(stationId))
          .map((stationId, index): CanonicalRouteStop => {
            const station = bundle.stations.find((item) => item.id === stationId);
            return {
              id: `${branch.id}:manual-route:${index + 1}:${stationId}`,
              canonicalLineId: line.id,
              branchId: branch.id,
              sourceLineNumber: line.id,
              sourceLineName: branch.nameKo ?? line.nameKo,
              role: "main",
              sequence: index + 1,
              stationId,
              sourceStationCode: station?.stationNumber ?? "MANUAL",
              displayNameKo: station?.nameKo ?? stationId,
              matchStatus: "manual",
              confidence: "manual",
              sourceCandidateId: stationId,
              diagnostics: ["manual-line-definition"],
            };
          });
        manualRouteStops.push(...routeStops);
        return {
          id: branch.id,
          canonicalLineId: line.id,
          role: "main",
          sourceLineNumber: line.id,
          sourceLineName: branch.nameKo ?? line.nameKo,
          origin: routeStops[0]?.displayNameKo ?? null,
          terminal: routeStops[routeStops.length - 1]?.displayNameKo ?? null,
          routeStops,
          isCircular: branch.circular === true,
        };
      });

    manualLines.push({
      id: line.id,
      canonicalKey: line.id,
      lnCd: line.id,
      mreaWideCd: "manual",
      nameKo: line.nameKo,
      colorHex: line.colorHex,
      colorSource: "manual-line-definition",
      category: manualRailTypeToLineCategory(line.railType),
      serviceTypes: line.serviceTypes,
      trainPerformance: line.trainPerformance ?? null,
      branches,
      sourceLineNumbers: [line.id],
    });
  }

  if (manualLines.length === 0) return bundle;

  return {
    ...bundle,
    counts: {
      ...bundle.counts,
      canonicalLines: bundle.counts.canonicalLines + manualLines.length,
      branches: bundle.counts.branches + manualLines.reduce((sum, line) => sum + line.branches.length, 0),
      routeStops: bundle.counts.routeStops + manualRouteStops.length,
    },
    lines: [...bundle.lines, ...manualLines],
    routeStops: [...(bundle.routeStops ?? []), ...manualRouteStops],
  };
}

function readPublicDataVersionManifest(): PublicDataVersionManifest | null {
  const manifestPath = path.join(process.cwd(), "public/data/data-version.json");
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PublicDataVersionManifest;
}

function readBundle(): CanonicalBundle {
  const bundlePath = path.join(
    process.cwd(),
    "public/data/kric-canonical-app-bundle.json",
  );

  const bundle = JSON.parse(
    fs.readFileSync(bundlePath, "utf8"),
  ) as CanonicalBundle;
  const manualOverlays = readManualOverlays();

  const stations = applyStationOverrides(
    bundle.stations,
    manualOverlays.stationOverrides,
  );

  const withManualLines = applyManualLineDefinitions(
    {
      ...bundle,
      lines: applyLineMetadataOverrides(bundle.lines, manualOverlays.lineMetadataOverrides),
      stations,
      manualTransferGroups: manualOverlays.manualTransferGroups,
      manualTransferEdges: [
        ...(bundle.manualTransferEdges ?? []),
        ...manualOverlays.manualTransferEdges,
      ].filter((edge) => edge.enabled),
    },
    manualOverlays.manualLineDefinitions,
    manualOverlays.manualBranchDefinitions,
  );

  return normalizeSingleLineStationMappings(
    applyBranchStationExclusions(
      applyBranchRouteOverrides(
        withManualLines,
        manualOverlays.branchRouteOverrides,
      ),
      manualOverlays.branchStationExclusions,
    ),
  );
}

function toMapStations(stations: CanonicalStation[]): RailMapStation[] {
  return stations.map((station) => ({
    id: station.id,
    nameKo: station.nameKo,
    lineNameKo: station.lineNameKo,
    lat: station.lat,
    lng: station.lng,
  }));
}

function buildMapStationIndex(stations: RailMapStation[]) {
  return new Map(stations.map((station) => [station.id, station]));
}

function resolveGeometryPointStationAnchors<
  TPoint extends { lng: number; lat: number; kind: string; stationId?: string },
>(points: TPoint[], stationById: Map<string, RailMapStation>): TPoint[] {
  return points.map((point) => {
    if (point.kind !== "station" || !point.stationId) return point;
    const station = stationById.get(point.stationId);
    if (
      !station ||
      typeof station.lng !== "number" ||
      typeof station.lat !== "number" ||
      !Number.isFinite(station.lng) ||
      !Number.isFinite(station.lat)
    ) {
      return point;
    }

    return {
      ...point,
      lng: station.lng,
      lat: station.lat,
    };
  });
}

function toMapLineBranchOverrides(
  overrides: ManualLineBranchOverride[],
  stationById: Map<string, RailMapStation>,
): ManualLineBranchOverride[] {
  return overrides.map((override) =>
    override.geometry?.length
      ? {
          ...override,
          geometry: resolveGeometryPointStationAnchors(
            override.geometry,
            stationById,
          ),
        }
      : override,
  );
}

function toMapBranches(
  bundle: CanonicalBundle,
  geometryOverrides: ManualGeometryOverride[],
  branchStationExclusions: ManualBranchStationExclusion[],
  stationById: Map<string, RailMapStation>,
): RailMapBranch[] {
  const exclusionByBranchId = buildBranchStationExclusionIndex(branchStationExclusions);
  const overrideByBranchId = new Map(
    geometryOverrides
      .filter(
        (override) => override.enabled !== false && override.points.length >= 2,
      )
      .map((override) => [override.branchId, override]),
  );

  return bundle.lines.flatMap((line) =>
    line.branches.map((branch) => {
      const override = overrideByBranchId.get(branch.id);

      return {
        id: branch.id,
        canonicalLineId: line.canonicalKey,
        canonicalLineNameKo: line.nameKo,
        colorHex: line.colorHex,
        role: branch.role,
        sourceLineNumber: branch.sourceLineNumber,
        sourceLineName: branch.sourceLineName,
        isCircular: branch.isCircular === true,
        geometryOverrideCoordinates: override
          ? resolveGeometryPointStationAnchors(
              override.points.filter(
                (point) =>
                  !exclusionByBranchId.get(branch.id)?.has(
                    point.stationId ?? "",
                  ),
              ),
              stationById,
            )
              .filter(
                (point) =>
                  Number.isFinite(point.lng) && Number.isFinite(point.lat),
              )
              .map((point) => [point.lng, point.lat] as [number, number])
          : undefined,
        routeStops: branch.routeStops.map((stop) => ({
          id: stop.id,
          sequence: stop.sequence,
          displayNameKo: stop.displayNameKo,
          station: stationById.get(stop.stationId) ?? null,
          confidence: stop.confidence,
        })),
      };
    }),
  );
}

function toMapTransferGroups(
  groups: ManualTransferGroup[],
): RailMapTransferGroup[] {
  return groups
    .filter((group) => group.enabled !== false && group.stationIds.length >= 2)
    .map((group) => ({
      id: group.id,
      nameKo: group.nameKo,
      stationIds: group.stationIds,
      enabled: group.enabled,
      note: group.note ?? null,
    }));
}

export default function Home() {
  const bundle = readBundle();
  const manualOverlays = readManualOverlays();
  const dataVersionManifest = readPublicDataVersionManifest();
  const mapStations = toMapStations(bundle.stations);
  const mapStationById = buildMapStationIndex(mapStations);

  return (
    <main className="h-[100dvh] overflow-hidden bg-slate-950 text-slate-950">
      <RailExplorer
        bundle={bundle}
        dataVersionManifest={dataVersionManifest}
        mapStations={mapStations}
        mapBranches={toMapBranches(
          bundle,
          manualOverlays.geometryOverrides,
          manualOverlays.branchStationExclusions,
          mapStationById,
        )}
        lineBranchOverrides={toMapLineBranchOverrides(
          manualOverlays.lineBranchOverrides,
          mapStationById,
        )}
        transferGroups={toMapTransferGroups(
          manualOverlays.manualTransferGroups,
        )}
        servicePatterns={(manualOverlays.manualServicePatterns ?? []).filter((pattern) => pattern.enabled !== false)}
        trainRuns={(manualOverlays.manualTrainRuns ?? []).filter((run) => run.enabled !== false)}
      />
    </main>
  );
}
