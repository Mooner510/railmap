import fs from "node:fs/promises";
import path from "node:path";
import {
  EMPTY_MANUAL_OVERLAY_BUNDLE,
  deriveTransferEdgesFromGroups,
  makeBranchRouteOverrideId,
  makeTransferPairKey,
  type ManualOverlayBundle,
  type ManualBranchRouteOverride,
  type ManualBranchStationExclusion,
  type ManualGeometryOverride,
  type ManualGeometryOverridePoint,
  type ManualLineBranchDirection,
  type ManualLineBranchGeometryPoint,
  type ManualLineBranchMode,
  type ManualLineBranchOverride,
  type ManualLineMetadataOverride,
  type ManualLineDefinition,
  type ManualBranchDefinition,
  type ManualServicePattern,
  type ManualServicePatternStop,
  type ManualTrainRun,
  type ManualTrainStopTime,
  type ManualTransferReviewEvent,
  type ManualStationOverride,
  isManualLineCoverageStatus,
  isManualRailStatus,
  isManualRailType,
  isRailLineCategory,
  isRailServiceType,
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

export function getManualOverlaySplitPaths() {
  const root = projectRoot();
  const manualRoot = path.join(root, "data/manual");

  return {
    index: path.join(manualRoot, "index.json"),
    stations: path.join(manualRoot, "stations.json"),
    transfers: path.join(manualRoot, "transfers.json"),
    geometry: path.join(manualRoot, "geometry.json"),
    settings: path.join(manualRoot, "settings.json"),
  };
}

export function getBundlePath() {
  return path.join(
    projectRoot(),
    "apps/web/public/data/kric-canonical-app-bundle.json",
  );
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
  return Number.isFinite(numberValue)
    ? Math.max(0, Math.round(numberValue))
    : null;
}

function asNullableCoordinateNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function asLineBranchMode(value: unknown): ManualLineBranchMode | null {
  return value === "add-station" || value === "connect-line" ? value : null;
}

function asLineBranchDirection(
  value: unknown,
): ManualLineBranchDirection | null {
  return value === "toward-start" || value === "toward-end" ? value : null;
}

function normalizeMinutesByPair(
  value: unknown,
  stationIds: string[],
): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  for (let i = 0; i < stationIds.length - 1; i += 1) {
    for (let j = i + 1; j < stationIds.length; j += 1) {
      const pairKey = makeTransferPairKey(
        stationIds[i] ?? "",
        stationIds[j] ?? "",
      );
      result[pairKey] = asNullableNumber(source[pairKey]);
    }
  }

  return result;
}

function normalizeTransferGroup(
  value: unknown,
  index: number,
): ManualTransferGroup | null {
  if (!value || typeof value !== "object") return null;

  const group = value as Record<string, unknown>;
  const stationIds = Array.isArray(group.stationIds)
    ? [
        ...new Set(
          group.stationIds
            .map(asString)
            .filter((id): id is string => id !== null),
        ),
      ]
    : [];

  if (stationIds.length < 2) return null;

  const nameKo = asString(group.nameKo) ?? `수동 환승 그룹 ${index + 1}`;

  return {
    id: asString(group.id) ?? `manual-transfer-group:${index + 1}`,
    nameKo,
    stationIds,
    transferMinutesByPair: normalizeMinutesByPair(
      group.transferMinutesByPair,
      stationIds,
    ),
    enabled: true,
    source: asString(group.source) ?? "editor",
    note: asNullableString(group.note),
  };
}

function normalizeStationOverride(
  value: unknown,
): ManualStationOverride | null {
  if (!value || typeof value !== "object") return null;

  const override = value as Record<string, unknown>;
  const stationId = asString(override.stationId);
  if (!stationId) return null;

  return {
    stationId,
    nameKo: asNullableString(override.nameKo) ?? undefined,
    stationNumber: asNullableString(override.stationNumber) ?? undefined,
    lineNameKo: asNullableString(override.lineNameKo) ?? undefined,
    lineNumber: asNullableString(override.lineNumber) ?? undefined,
    colorHex: asNullableString(override.colorHex),
    lat: asNullableCoordinateNumber(override.lat),
    lng: asNullableCoordinateNumber(override.lng),
    enabled: override.enabled !== false,
    note: asNullableString(override.note),
  };
}

function normalizeBranchStationExclusion(
  value: unknown,
): ManualBranchStationExclusion | null {
  if (!value || typeof value !== "object") return null;

  const exclusion = value as Record<string, unknown>;
  const branchId = asString(exclusion.branchId);
  const stationId = asString(exclusion.stationId);
  if (!branchId || !stationId) return null;

  return {
    id:
      asString(exclusion.id) ??
      `manual-branch-station-exclusion:${branchId}:${stationId}`,
    branchId,
    stationId,
    enabled: exclusion.enabled !== false,
    source: asString(exclusion.source) ?? "editor",
    note: asNullableString(exclusion.note),
  };
}

function normalizeBranchRouteOverride(
  value: unknown,
): ManualBranchRouteOverride | null {
  if (!value || typeof value !== "object") return null;

  const override = value as Record<string, unknown>;
  const branchId = asString(override.branchId);
  if (!branchId) return null;

  const stationIds = Array.isArray(override.stationIds)
    ? [
        ...new Set(
          override.stationIds
            .map(asString)
            .filter((id): id is string => id !== null),
        ),
      ]
    : [];

  if (stationIds.length < 2) return null;

  return {
    id: asString(override.id) ?? makeBranchRouteOverrideId(branchId),
    branchId,
    stationIds,
    circular: override.circular === true,
    enabled: override.enabled !== false,
    source: asString(override.source) ?? "editor",
    note: asNullableString(override.note),
  };
}

function normalizeLineBranchGeometryPoint(
  value: unknown,
): ManualLineBranchGeometryPoint | null {
  if (!value || typeof value !== "object") return null;

  const point = value as Record<string, unknown>;
  const lng = asNullableCoordinateNumber(point.lng);
  const lat = asNullableCoordinateNumber(point.lat);
  if (lng === null || lat === null) return null;

  const kind = point.kind === "station" ? "station" : "control";
  const stationId = asString(point.stationId);

  return {
    lng,
    lat,
    kind,
    stationId: stationId ?? undefined,
  };
}

function normalizeGeometryPoint(
  value: unknown,
): ManualGeometryOverridePoint | null {
  if (!value || typeof value !== "object") return null;

  const point = value as Record<string, unknown>;
  const lng = asNullableCoordinateNumber(point.lng);
  const lat = asNullableCoordinateNumber(point.lat);
  if (lng === null || lat === null) return null;

  const kind = point.kind === "station" ? "station" : "control";
  const stationId = asString(point.stationId);

  return {
    lng,
    lat,
    kind,
    stationId: stationId ?? undefined,
  };
}

function normalizeLineBranchOverride(
  value: unknown,
): ManualLineBranchOverride | null {
  if (!value || typeof value !== "object") return null;

  const override = value as Record<string, unknown>;
  const mode = asLineBranchMode(override.mode);
  const parentBranchId = asString(override.parentBranchId);
  const anchorStationId = asString(override.anchorStationId);

  if (!mode || !parentBranchId || !anchorStationId) return null;

  const branchStationId = asString(override.branchStationId) ?? undefined;
  const connectedBranchId = asString(override.connectedBranchId) ?? undefined;
  const connectedEndpointStationId =
    asString(override.connectedEndpointStationId) ?? undefined;
  const connectedDirection =
    asLineBranchDirection(override.connectedDirection) ?? "toward-end";

  if (mode === "add-station" && !branchStationId) return null;
  if (
    mode === "connect-line" &&
    (!connectedBranchId || !connectedEndpointStationId)
  )
    return null;

  const geometry = Array.isArray(override.geometry)
    ? override.geometry
        .map(normalizeLineBranchGeometryPoint)
        .filter(
          (point): point is ManualLineBranchGeometryPoint => point !== null,
        )
    : undefined;

  return {
    id:
      asString(override.id) ??
      `manual-line-branch:${mode}:${parentBranchId}:${anchorStationId}:${branchStationId ?? connectedBranchId}`,
    mode,
    parentBranchId,
    anchorStationId,
    branchStationId,
    connectedBranchId,
    connectedEndpointStationId,
    connectedDirection,
    geometry: geometry && geometry.length >= 2 ? geometry : undefined,
    enabled: override.enabled !== false,
    source: asString(override.source) ?? "editor",
    note: asNullableString(override.note),
  };
}

function normalizeLineMetadataOverride(
  value: unknown,
): ManualLineMetadataOverride | null {
  if (!value || typeof value !== "object") return null;

  const override = value as Record<string, unknown>;
  const lineId = asString(override.lineId);
  if (!lineId) return null;

  const category = isRailLineCategory(override.category)
    ? override.category
    : undefined;
  const serviceTypes = Array.isArray(override.serviceTypes)
    ? [...new Set(override.serviceTypes.filter(isRailServiceType))]
    : undefined;

  return {
    lineId,
    category,
    serviceTypes: serviceTypes && serviceTypes.length > 0 ? serviceTypes : undefined,
    enabled: override.enabled !== false,
    source: asString(override.source) ?? "editor",
    note: asNullableString(override.note),
  };
}

function normalizeManualLineDefinition(value: unknown): ManualLineDefinition | null {
  if (!value || typeof value !== "object") return null;

  const line = value as Record<string, unknown>;
  const id = asString(line.id);
  const nameKo = asString(line.nameKo);
  if (!id || !nameKo) return null;

  const railType = isManualRailType(line.railType) ? line.railType : "trunk_rail";
  const serviceTypes = Array.isArray(line.serviceTypes)
    ? [...new Set(line.serviceTypes.filter(isRailServiceType))]
    : [];

  return {
    id,
    nameKo,
    colorHex: asString(line.colorHex) ?? "#64748b",
    railType,
    serviceTypes: serviceTypes.length > 0 ? serviceTypes : ["unknown"],
    status: isManualRailStatus(line.status) ? line.status : "open",
    coverageStatus: isManualLineCoverageStatus(line.coverageStatus) ? line.coverageStatus : "draft",
    enabled: line.enabled !== false,
    source: asString(line.source) ?? "editor",
    note: asNullableString(line.note),
  };
}

function normalizeManualBranchDefinition(value: unknown): ManualBranchDefinition | null {
  if (!value || typeof value !== "object") return null;

  const branch = value as Record<string, unknown>;
  const id = asString(branch.id);
  const lineId = asString(branch.lineId);
  if (!id || !lineId) return null;

  const stationIds = Array.isArray(branch.stationIds)
    ? [...new Set(branch.stationIds.map(asString).filter((id): id is string => id !== null))]
    : [];

  return {
    id,
    lineId,
    nameKo: asNullableString(branch.nameKo),
    stationIds,
    circular: branch.circular === true,
    enabled: branch.enabled !== false,
    source: asString(branch.source) ?? "editor",
    note: asNullableString(branch.note),
  };
}

function normalizeTransferReviewEvent(value: unknown, index: number): ManualTransferReviewEvent | null {
  if (!value || typeof value !== "object") return null;

  const event = value as Record<string, unknown>;
  const type = asString(event.type);
  const nameKo = asString(event.nameKo);
  if (!type || !nameKo) return null;

  const stationIds = Array.isArray(event.stationIds)
    ? [...new Set(event.stationIds.map(asString).filter((id): id is string => id !== null))]
    : [];

  return {
    id: asString(event.id) ?? `manual-transfer-review-event:${Date.now()}:${index}`,
    type: type as ManualTransferReviewEvent["type"],
    transferGroupId: asNullableString(event.transferGroupId),
    suggestionKey: asNullableString(event.suggestionKey),
    nameKo,
    stationIds,
    decidedAt: asString(event.decidedAt) ?? new Date(0).toISOString(),
    reason: asNullableString(event.reason),
    note: asNullableString(event.note),
  };
}

function normalizeServicePatternStop(value: unknown, index: number): ManualServicePatternStop | null {
  if (!value || typeof value !== "object") return null;
  const stop = value as Record<string, unknown>;
  const stationId = asString(stop.stationId);
  if (!stationId) return null;
  const sequenceValue = Number(stop.sequence);
  return {
    stationId,
    sequence: Number.isFinite(sequenceValue) ? sequenceValue : index,
    stopType: asString(stop.stopType) ?? "stop",
    note: asNullableString(stop.note),
  };
}

function normalizeManualServicePattern(value: unknown): ManualServicePattern | null {
  if (!value || typeof value !== "object") return null;
  const pattern = value as Record<string, unknown>;
  const id = asString(pattern.id);
  const nameKo = asString(pattern.nameKo);
  if (!id || !nameKo) return null;
  const stops = Array.isArray(pattern.stops)
    ? pattern.stops
        .map((stop, index) => normalizeServicePatternStop(stop, index))
        .filter((stop): stop is ManualServicePatternStop => stop !== null)
        .sort((a, b) => a.sequence - b.sequence)
    : [];

  return {
    id,
    nameKo,
    lineId: asNullableString(pattern.lineId),
    branchId: asNullableString(pattern.branchId),
    serviceType: isRailServiceType(pattern.serviceType) ? pattern.serviceType : "unknown",
    direction: asString(pattern.direction) ?? "unknown",
    stops,
    enabled: pattern.enabled !== false,
    source: asString(pattern.source) ?? "editor",
    note: asNullableString(pattern.note),
  };
}

function normalizeTrainStopTime(value: unknown, index: number): ManualTrainStopTime | null {
  if (!value || typeof value !== "object") return null;
  const stop = value as Record<string, unknown>;
  const stationId = asString(stop.stationId);
  if (!stationId) return null;
  const sequenceValue = Number(stop.sequence);
  return {
    stationId,
    sequence: Number.isFinite(sequenceValue) ? sequenceValue : index,
    arrivalTime: asNullableString(stop.arrivalTime),
    departureTime: asNullableString(stop.departureTime),
    stopType: asString(stop.stopType) ?? "stop",
    note: asNullableString(stop.note),
  };
}

function normalizeManualTrainRun(value: unknown): ManualTrainRun | null {
  if (!value || typeof value !== "object") return null;
  const run = value as Record<string, unknown>;
  const id = asString(run.id);
  if (!id) return null;
  const stopTimes = Array.isArray(run.stopTimes)
    ? run.stopTimes
        .map((stop, index) => normalizeTrainStopTime(stop, index))
        .filter((stop): stop is ManualTrainStopTime => stop !== null)
        .sort((a, b) => a.sequence - b.sequence)
    : [];
  const operatingDays = Array.isArray(run.operatingDays)
    ? [...new Set(run.operatingDays.map(asString).filter((day): day is string => day !== null))]
    : [];

  return {
    id,
    patternId: asNullableString(run.patternId),
    trainNumber: asNullableString(run.trainNumber),
    nameKo: asNullableString(run.nameKo),
    serviceType: isRailServiceType(run.serviceType) ? run.serviceType : "unknown",
    operatingDays,
    stopTimes,
    enabled: run.enabled !== false,
    source: asString(run.source) ?? "editor",
    note: asNullableString(run.note),
  };
}

function normalizeGeometryOverride(
  value: unknown,
): ManualGeometryOverride | null {
  if (!value || typeof value !== "object") return null;

  const override = value as Record<string, unknown>;
  const branchId = asString(override.branchId);
  if (!branchId) return null;

  const points = Array.isArray(override.points)
    ? override.points
        .map(normalizeGeometryPoint)
        .filter((point): point is ManualGeometryOverridePoint => point !== null)
    : [];

  if (points.length < 2) return null;

  return {
    branchId,
    points,
    enabled: override.enabled !== false,
    note: asNullableString(override.note),
  };
}

function normalizeLegacyTransferEdge(
  value: unknown,
  index: number,
): ManualTransferEdge | null {
  if (!value || typeof value !== "object") return null;

  const edge = value as Record<string, unknown>;
  const fromStationId = asString(edge.fromStationId);
  const toStationId = asString(edge.toStationId);

  if (!fromStationId || !toStationId || fromStationId === toStationId)
    return null;

  return {
    id:
      asString(edge.id) ??
      `manual-transfer:${fromStationId}:${toStationId}:${index}`,
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
        .filter(
          (edge): edge is ManualTransferEdge =>
            edge !== null && edge.source !== "editor-group",
        )
    : [];

  const nonTransferStationIds = Array.isArray(
    (data as { nonTransferStationIds?: unknown }).nonTransferStationIds,
  )
    ? [
        ...new Set(
          (data as { nonTransferStationIds: unknown[] }).nonTransferStationIds
            .map(asString)
            .filter((id): id is string => id !== null),
        ),
      ]
    : [];

  const dismissedTransferGroupSuggestionKeys = Array.isArray(
    (data as { dismissedTransferGroupSuggestionKeys?: unknown }).dismissedTransferGroupSuggestionKeys,
  )
    ? [
        ...new Set(
          (data as { dismissedTransferGroupSuggestionKeys: unknown[] }).dismissedTransferGroupSuggestionKeys
            .map(asString)
            .filter((id): id is string => id !== null),
        ),
      ]
    : [];



  const dismissedTransferGroupSuggestionNotes = (() => {
    const raw = (data as { dismissedTransferGroupSuggestionNotes?: unknown }).dismissedTransferGroupSuggestionNotes;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {} as Record<string, string>;
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>)
        .map(([key, value]) => [key, asString(value)] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[0]) && entry[1] !== null),
    );
  })();

  const transferTimePendingGroupIds = Array.isArray(
    (data as { transferTimePendingGroupIds?: unknown }).transferTimePendingGroupIds,
  )
    ? [
        ...new Set(
          (data as { transferTimePendingGroupIds: unknown[] }).transferTimePendingGroupIds
            .map(asString)
            .filter((id): id is string => id !== null),
        ),
      ]
    : [];

  const manualTransferReviewEvents = Array.isArray(
    (data as { manualTransferReviewEvents?: unknown }).manualTransferReviewEvents,
  )
    ? (data as { manualTransferReviewEvents: unknown[] }).manualTransferReviewEvents
        .map(normalizeTransferReviewEvent)
        .filter((event): event is ManualTransferReviewEvent => event !== null)
    : [];

  return {
    schemaVersion: 1,
    manualTransferGroups,
    manualTransferEdges: [
      ...legacyEdges,
      ...deriveTransferEdgesFromGroups(manualTransferGroups),
    ],
    nonTransferStationIds,
    dismissedTransferGroupSuggestionKeys,
    dismissedTransferGroupSuggestionNotes,
    transferTimePendingGroupIds,
    manualTransferReviewEvents,
    stationOverrides: Array.isArray(data.stationOverrides)
      ? data.stationOverrides
          .map(normalizeStationOverride)
          .filter(
            (override): override is ManualStationOverride => override !== null,
          )
      : [],
    branchOverrides: Array.isArray(data.branchOverrides)
      ? data.branchOverrides
      : [],
    branchStationExclusions: Array.isArray(
      (data as { branchStationExclusions?: unknown }).branchStationExclusions,
    )
      ? (data as { branchStationExclusions: unknown[] }).branchStationExclusions
          .map(normalizeBranchStationExclusion)
          .filter(
            (exclusion): exclusion is ManualBranchStationExclusion =>
              exclusion !== null,
          )
      : [],
    branchRouteOverrides: Array.isArray(
      (data as { branchRouteOverrides?: unknown }).branchRouteOverrides,
    )
      ? (data as { branchRouteOverrides: unknown[] }).branchRouteOverrides
          .map(normalizeBranchRouteOverride)
          .filter(
            (override): override is ManualBranchRouteOverride =>
              override !== null,
          )
      : [],
    lineBranchOverrides: Array.isArray(
      (data as { lineBranchOverrides?: unknown }).lineBranchOverrides,
    )
      ? (data as { lineBranchOverrides: unknown[] }).lineBranchOverrides
          .map(normalizeLineBranchOverride)
          .filter(
            (override): override is ManualLineBranchOverride =>
              override !== null,
          )
      : [],
    geometryOverrides: Array.isArray(data.geometryOverrides)
      ? data.geometryOverrides
          .map(normalizeGeometryOverride)
          .filter(
            (override): override is ManualGeometryOverride => override !== null,
          )
      : [],
    lineMetadataOverrides: Array.isArray(
      (data as { lineMetadataOverrides?: unknown }).lineMetadataOverrides,
    )
      ? (data as { lineMetadataOverrides: unknown[] }).lineMetadataOverrides
          .map(normalizeLineMetadataOverride)
          .filter(
            (override): override is ManualLineMetadataOverride =>
              override !== null,
          )
      : [],
    manualLineDefinitions: Array.isArray(
      (data as { manualLineDefinitions?: unknown }).manualLineDefinitions,
    )
      ? (data as { manualLineDefinitions: unknown[] }).manualLineDefinitions
          .map(normalizeManualLineDefinition)
          .filter((line): line is ManualLineDefinition => line !== null)
      : [],
    manualBranchDefinitions: Array.isArray(
      (data as { manualBranchDefinitions?: unknown }).manualBranchDefinitions,
    )
      ? (data as { manualBranchDefinitions: unknown[] }).manualBranchDefinitions
          .map(normalizeManualBranchDefinition)
          .filter((branch): branch is ManualBranchDefinition => branch !== null)
      : [],
    manualServicePatterns: Array.isArray(
      (data as { manualServicePatterns?: unknown }).manualServicePatterns,
    )
      ? (data as { manualServicePatterns: unknown[] }).manualServicePatterns
          .map(normalizeManualServicePattern)
          .filter((pattern): pattern is ManualServicePattern => pattern !== null)
      : [],
    manualTrainRuns: Array.isArray(
      (data as { manualTrainRuns?: unknown }).manualTrainRuns,
    )
      ? (data as { manualTrainRuns: unknown[] }).manualTrainRuns
          .map(normalizeManualTrainRun)
          .filter((run): run is ManualTrainRun => run !== null)
      : [],
  };
}

export async function readManualOverlays(): Promise<ManualOverlayBundle> {
  for (const filePath of getManualOverlayPaths()) {
    const json = await readJsonFile(filePath);
    if (json !== null) return normalizeManualOverlays(json);
  }

  return EMPTY_MANUAL_OVERLAY_BUNDLE;
}

async function writeManualOverlaySplitFiles(overlays: ManualOverlayBundle) {
  const paths = getManualOverlaySplitPaths();
  const writeJson = async (filePath: string, value: unknown) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  };

  await Promise.all([
    writeJson(paths.index, {
      schemaVersion: overlays.schemaVersion,
      files: {
        stations: "stations.json",
        transfers: "transfers.json",
        geometry: "geometry.json",
        settings: "settings.json",
      },
      updatedAt: new Date().toISOString(),
    }),
    writeJson(paths.stations, {
      schemaVersion: overlays.schemaVersion,
      stationOverrides: overlays.stationOverrides,
      nonTransferStationIds: overlays.nonTransferStationIds,
    }),
    writeJson(paths.transfers, {
      schemaVersion: overlays.schemaVersion,
      manualTransferGroups: overlays.manualTransferGroups,
      manualTransferEdges: [],
      dismissedTransferGroupSuggestionKeys: overlays.dismissedTransferGroupSuggestionKeys,
      dismissedTransferGroupSuggestionNotes: overlays.dismissedTransferGroupSuggestionNotes,
      transferTimePendingGroupIds: overlays.transferTimePendingGroupIds,
      manualTransferReviewEvents: overlays.manualTransferReviewEvents,
    }),
    writeJson(paths.geometry, {
      schemaVersion: overlays.schemaVersion,
      branchOverrides: overlays.branchOverrides,
      branchStationExclusions: overlays.branchStationExclusions,
      branchRouteOverrides: overlays.branchRouteOverrides,
      lineBranchOverrides: overlays.lineBranchOverrides,
      geometryOverrides: overlays.geometryOverrides,
    }),
    writeJson(paths.settings, {
      schemaVersion: overlays.schemaVersion,
      editor: { autosave: false, unifiedEditor: true },
      lineMetadataOverrides: overlays.lineMetadataOverrides,
      manualLineDefinitions: overlays.manualLineDefinitions,
      manualBranchDefinitions: overlays.manualBranchDefinitions,
      manualServicePatterns: overlays.manualServicePatterns,
      manualTrainRuns: overlays.manualTrainRuns,
    }),
  ]);
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

  await writeManualOverlaySplitFiles(persisted);

  return normalized;
}

export type ManualOverlaySnapshotSummary = {
  id: string;
  title: string;
  subtitle: string | null;
  createdAt: string;
  fileName: string;
};

function getSnapshotRoot() {
  return path.join(projectRoot(), "data/manual/snapshots");
}

function formatSnapshotDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return formatter.format(date).replace("T", " ");
}

function makeSnapshotFileName(createdAt: string) {
  return `${createdAt.replace(/[-: ]/g, "")}.json`;
}

function normalizeSnapshotSubtitle(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function makeSnapshotTitle(createdAt: string, subtitle: string | null) {
  return subtitle ? `${createdAt} - ${subtitle}` : createdAt;
}

export async function listManualOverlaySnapshots(): Promise<
  ManualOverlaySnapshotSummary[]
> {
  const root = getSnapshotRoot();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }

  const snapshots = await Promise.all(
    entries
      .filter((fileName) => fileName.endsWith(".json"))
      .map(async (fileName) => {
        const filePath = path.join(root, fileName);
        const json = await readJsonFile(filePath);
        if (!json || typeof json !== "object") return null;
        const record = json as Record<string, unknown>;
        const id = asString(record.id) ?? fileName.replace(/\.json$/, "");
        const createdAt = asString(record.createdAt) ?? id;
        const subtitle = normalizeSnapshotSubtitle(record.subtitle);
        return {
          id,
          title: makeSnapshotTitle(createdAt, subtitle),
          subtitle,
          createdAt,
          fileName,
        } satisfies ManualOverlaySnapshotSummary;
      }),
  );

  return snapshots
    .filter(
      (snapshot): snapshot is ManualOverlaySnapshotSummary => snapshot !== null,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveManualOverlaySnapshot(subtitle?: string | null) {
  const createdAt = formatSnapshotDate();
  const normalizedSubtitle = normalizeSnapshotSubtitle(subtitle);
  const id = makeSnapshotFileName(createdAt).replace(/\.json$/, "");
  const fileName = `${id}.json`;
  const root = getSnapshotRoot();
  const overlays = await readManualOverlays();
  const snapshot = {
    id,
    title: makeSnapshotTitle(createdAt, normalizedSubtitle),
    subtitle: normalizedSubtitle,
    createdAt,
    schemaVersion: overlays.schemaVersion,
    overlays,
  };

  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, fileName),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );

  return {
    id,
    title: snapshot.title,
    subtitle: normalizedSubtitle,
    createdAt,
    fileName,
  } satisfies ManualOverlaySnapshotSummary;
}

export async function readManualOverlaySnapshot(
  snapshotId: string,
): Promise<ManualOverlayBundle | null> {
  const safeId = snapshotId.replace(/[^0-9A-Za-z_-]/g, "");
  if (!safeId) return null;
  const json = await readJsonFile(
    path.join(getSnapshotRoot(), `${safeId}.json`),
  );
  if (!json || typeof json !== "object") return null;
  const record = json as Record<string, unknown>;
  return normalizeManualOverlays(record.overlays);
}

export async function loadManualOverlaySnapshot(snapshotId: string) {
  const snapshot = await readManualOverlaySnapshot(snapshotId);
  if (!snapshot) return null;

  const mainSnapshot = await saveManualOverlaySnapshot("메인 스냅샷");
  const saved = await writeManualOverlays(snapshot);

  return { overlays: saved, mainSnapshot };
}
