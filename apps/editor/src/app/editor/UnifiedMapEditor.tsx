"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Input, Textarea } from "@repo/ui/input";
import { AppShell, InspectorGrid } from "@repo/ui/layout";
import { Panel, PanelBody, PanelHeader } from "@repo/ui/panel";
import { TabButton, TabList } from "@repo/ui/tabs";
import { Toast, type ToastTone } from "@repo/ui/toast";
import { cn } from "@repo/ui/utils";
import {
  ChevronRight,
  Command,
  Layers3,
  LocateFixed,
  MapPin,
  MousePointer2,
  Plus,
  Redo2,
  Route,
  Save,
  Search,
  Settings2,
  Trash2,
  Undo2,
  Waypoints,
  X,
} from "lucide-react";
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type StyleSpecification,
} from "maplibre-gl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type {
  EditorStation,
  ManualBranchStationExclusion,
  ManualGeometryOverride,
  ManualGeometryOverridePoint,
  ManualLineBranchOverride,
  ManualOverlayBundle,
  ManualStationOverride,
  ManualTransferGroup,
} from "../editorModel";
import {
  EMPTY_MANUAL_OVERLAY_BUNDLE,
  makeBranchStationExclusionId,
  makeLineBranchOverrideId,
  makeTransferGroupId,
  makeTransferPairKey,
  normalizeSearchText,
} from "../editorModel";
import type { EditorMapBranch, UnifiedEditorData } from "../editorData";

type Selection =
  | { type: "none" }
  | { type: "station"; id: string }
  | { type: "branch"; id: string }
  | { type: "transferGroup"; id: string }
  | { type: "multiStation"; ids: string[] };

type SidebarTab = "search" | "layers" | "transfers" | "validation" | "history";
type ToolMode = "select" | "box" | "geometry";
type IconComponent = ComponentType<{ className?: string }>;
type LngLatTuple = [number, number];

const TRANSFER_DETAIL_ZOOM_THRESHOLD = 13.8;
const TRANSFER_GROUP_AREA_MIN_RADIUS = 0.0018;
const TRANSFER_GROUP_AREA_MAX_RADIUS = 0.012;
const TRANSFER_GROUP_AREA_PADDING_RATIO = 1.55;
const TRANSFER_GROUP_AREA_SEGMENTS = 56;
const STATION_GEOMETRY_ANCHOR_TOLERANCE = 0.00015;
const SAVED_STATION_ANCHOR_TOLERANCE = 0.0000001;

type ContextMenuState = {
  x: number;
  y: number;
  stationId?: string;
  branchId?: string;
} | null;

type OverlayCommandRecord = {
  id: string;
  label: string;
  before: ManualOverlayBundle;
  after: ManualOverlayBundle;
  createdAt: number;
};

type TransferGroupDraft = {
  id?: string;
  nameKo: string;
  stationIds: string[];
  transferMinutesByPair: Record<string, number | null>;
  note: string;
};

type GeometryTargetType = "branch" | "lineBranch";
type GeometryTargetFilter = "all" | "branch" | "add-station" | "connect-line";

type GeometryDraft = {
  targetType: GeometryTargetType;
  targetId: string;
  branchId: string;
  points: ManualGeometryOverridePoint[];
  note: string;
};

type GeometryDraftHistoryRecord = {
  before: GeometryDraft | null;
  after: GeometryDraft | null;
};

type GeometryDraftMap = Record<string, GeometryDraft>;

type GeometryWorkspaceSummary = {
  changedTargetCount: number;
  addedControlPointCount: number;
  removedControlPointCount: number;
  movedStationCount: number;
  movedStationLabels: string[];
};

type GeometryPointDragState = {
  targetType: GeometryTargetType;
  targetId: string;
  pointIndex: number;
} | null;

type PendingTransferSelection =
  | { type: "station"; stationId: string; shouldFocus: boolean }
  | { type: "multiStation"; ids: string[] };

type GeometryEditTarget = {
  type: GeometryTargetType;
  id: string;
  branchId: string;
  title: string;
  subtitle: string;
  colorHex: string;
  meta: string;
  kind: GeometryTargetFilter;
  hasSavedGeometry: boolean;
  savedPointCount: number;
};

type LineBranchValidationIssue = {
  id: string;
  message: string;
};

type LineBranchDirection = "toward-start" | "toward-end";

type LineBranchDirectionOption = {
  value: LineBranchDirection;
  label: string;
};

const defaultLayers = {
  stations: true,
  lines: true,
  labels: true,
  nonTransfer: true,
};

const layerOptions: Array<{
  key: keyof typeof defaultLayers;
  label: string;
  Icon: IconComponent;
}> = [
  { key: "lines", label: "노선선", Icon: Layers3 },
  { key: "stations", label: "역 아이콘", Icon: MapPin },
  { key: "labels", label: "역명 라벨", Icon: Settings2 },
  { key: "nonTransfer", label: "미환승역 상태", Icon: Waypoints },
];

const toolOptions: Array<{
  mode: ToolMode;
  label: string;
  description: string;
  Icon: IconComponent;
}> = [
  {
    mode: "select",
    label: "선택",
    description: "역을 우선 선택하고, 역이 없으면 노선선을 선택",
    Icon: MousePointer2,
  },
  {
    mode: "geometry",
    label: "선형 편집",
    description: "선형 보정 전용 모드",
    Icon: Route,
  },
];

const KOREA_MAX_BOUNDS: [[number, number], [number, number]] = [
  [121.4, 30.9],
  [134.3, 43.1],
];

const baseMapStyle = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  layers: [{ id: "osm", type: "raster", source: "osm" }],
} as const;

type RailFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: {
      type: "Point" | "LineString" | "Polygon";
      coordinates: LngLatTuple | LngLatTuple[] | LngLatTuple[][];
    };
  }>;
};

const EMPTY_FEATURE_COLLECTION: RailFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

type TransferGroupMapInfo = {
  id: string;
  nameKo: string;
  stationIds: string[];
  selected: boolean;
};

const EMPTY_UNIFIED_EDITOR_DATA: UnifiedEditorData = {
  stations: [],
  branches: [],
  lines: [],
  overlays: EMPTY_MANUAL_OVERLAY_BUNDLE,
};

function yieldToMainThread() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function buildBranchFeaturesChunked(
  branches: EditorMapBranch[],
  visible: boolean,
  isCancelled: () => boolean,
): Promise<RailFeatureCollection | null> {
  if (!visible) return EMPTY_FEATURE_COLLECTION;

  const features: RailFeatureCollection["features"] = [];
  const batchSize = 24;

  for (let start = 0; start < branches.length; start += batchSize) {
    if (isCancelled()) return null;

    for (const branch of branches.slice(start, start + batchSize)) {
      const coordinates = branchCoordinates(branch);
      if (coordinates.length < 2) continue;

      features.push({
        type: "Feature",
        properties: {
          id: branch.id,
          colorHex: branch.colorHex,
          nameKo: branch.canonicalLineNameKo,
        },
        geometry: {
          type: "LineString",
          coordinates: optimizeCoordinates(coordinates),
        },
      });
    }

    await yieldToMainThread();
  }

  return { type: "FeatureCollection", features };
}

async function buildStationFeaturesChunked(
  stations: EditorStation[],
  selectedIds: Set<string>,
  nonTransferIds: Set<string>,
  stationTransferGroupIndex: Map<string, TransferGroupMapInfo>,
  visible: boolean,
  showNonTransferState: boolean,
  isCancelled: () => boolean,
): Promise<RailFeatureCollection | null> {
  if (!visible) return EMPTY_FEATURE_COLLECTION;

  const features: RailFeatureCollection["features"] = [];
  const batchSize = 500;

  for (let start = 0; start < stations.length; start += batchSize) {
    if (isCancelled()) return null;

    for (const station of stations.slice(start, start + batchSize)) {
      if (!isValidStation(station)) continue;
      const selected = selectedIds.has(station.id);
      const nonTransfer = nonTransferIds.has(station.id);
      const transferGroup = stationTransferGroupIndex.get(station.id) ?? null;

      features.push({
        type: "Feature",
        properties: {
          id: station.id,
          nameKo: station.nameKo,
          labelNameKo: transferGroup
            ? `${transferGroup.nameKo}(${station.lineNameKo || "노선"})`
            : station.nameKo,
          lineNameKo: station.lineNameKo,
          stationNumber: station.stationNumber,
          colorHex: station.colorHex ?? "#64748b",
          selected,
          nonTransfer: showNonTransferState && nonTransfer,
          isTransferChild: Boolean(transferGroup),
          transferGroupId: transferGroup?.id ?? "",
          transferGroupNameKo: transferGroup?.nameKo ?? "",
        },
        geometry: {
          type: "Point",
          coordinates: [station.lng, station.lat] as LngLatTuple,
        },
      });
    }

    await yieldToMainThread();
  }

  return { type: "FeatureCollection", features };
}

function buildTransferGroupCircleGeometry(
  members: Array<EditorStation & { lat: number; lng: number }>,
) {
  const centerLng =
    members.reduce((sum, station) => sum + station.lng, 0) / members.length;
  const centerLat =
    members.reduce((sum, station) => sum + station.lat, 0) / members.length;
  const lngScale = Math.max(0.35, Math.cos((centerLat * Math.PI) / 180));
  const farthestMemberRadius = Math.max(
    0,
    ...members.map((station) => {
      const dx = (station.lng - centerLng) * lngScale;
      const dy = station.lat - centerLat;
      return Math.sqrt(dx * dx + dy * dy);
    }),
  );
  const radius = clampTransferGroupRadius(
    farthestMemberRadius * TRANSFER_GROUP_AREA_PADDING_RATIO,
  );

  const coordinates: LngLatTuple[] = [];
  for (let index = 0; index <= TRANSFER_GROUP_AREA_SEGMENTS; index += 1) {
    const angle = (Math.PI * 2 * index) / TRANSFER_GROUP_AREA_SEGMENTS;
    coordinates.push([
      centerLng + (Math.cos(angle) * radius) / lngScale,
      centerLat + Math.sin(angle) * radius,
    ]);
  }

  return { center: [centerLng, centerLat] as LngLatTuple, radius, coordinates };
}

async function buildTransferGroupAreaFeaturesChunked(
  groups: ManualTransferGroup[],
  stationById: Map<string, EditorStation>,
  selectedGroupIds: ReadonlySet<string>,
  isCancelled: () => boolean,
): Promise<RailFeatureCollection | null> {
  const features: RailFeatureCollection["features"] = [];
  const batchSize = 80;

  for (let start = 0; start < groups.length; start += batchSize) {
    if (isCancelled()) return null;

    for (const group of groups.slice(start, start + batchSize)) {
      if (group.enabled === false) continue;
      const members = group.stationIds
        .map((stationId) => stationById.get(stationId))
        .filter(
          (station): station is EditorStation & { lat: number; lng: number } =>
            Boolean(station && isValidStation(station)),
        );
      if (members.length < 2) continue;

      const circle = buildTransferGroupCircleGeometry(members);

      features.push({
        type: "Feature",
        properties: {
          id: group.id,
          nameKo: group.nameKo,
          stationCount: members.length,
          selected: selectedGroupIds.has(group.id),
          radius: circle.radius,
        },
        geometry: { type: "Polygon", coordinates: [circle.coordinates] },
      });
    }

    await yieldToMainThread();
  }

  return { type: "FeatureCollection", features };
}

async function buildTransferGroupIconFeaturesChunked(
  groups: ManualTransferGroup[],
  stationById: Map<string, EditorStation>,
  selectedGroupIds: ReadonlySet<string>,
  isCancelled: () => boolean,
): Promise<RailFeatureCollection | null> {
  const features: RailFeatureCollection["features"] = [];
  const batchSize = 120;

  for (let start = 0; start < groups.length; start += batchSize) {
    if (isCancelled()) return null;

    for (const group of groups.slice(start, start + batchSize)) {
      if (group.enabled === false) continue;
      const members = group.stationIds
        .map((stationId) => stationById.get(stationId))
        .filter(
          (station): station is EditorStation & { lat: number; lng: number } =>
            Boolean(station && isValidStation(station)),
        );
      if (members.length < 2) continue;

      const circle = buildTransferGroupCircleGeometry(members);

      features.push({
        type: "Feature",
        properties: {
          id: group.id,
          nameKo: group.nameKo,
          stationCount: members.length,
          selected: selectedGroupIds.has(group.id),
          radius: circle.radius,
        },
        geometry: { type: "Point", coordinates: circle.center },
      });
    }

    await yieldToMainThread();
  }

  return { type: "FeatureCollection", features };
}

function buildStationTransferGroupIndex(groups: ManualTransferGroup[]) {
  const index = new Map<string, TransferGroupMapInfo>();

  for (const group of groups) {
    if (group.enabled === false) continue;
    const info: TransferGroupMapInfo = {
      id: group.id,
      nameKo: group.nameKo,
      stationIds: group.stationIds,
      selected: false,
    };
    for (const stationId of group.stationIds) {
      if (!index.has(stationId)) index.set(stationId, info);
    }
  }

  return index;
}

function scheduleIdle(callback: () => void) {
  if (typeof window === "undefined") return 0;
  const requestIdle = (
    window as Window & {
      requestIdleCallback?: (
        cb: () => void,
        options?: { timeout: number },
      ) => number;
    }
  ).requestIdleCallback;
  if (requestIdle) return requestIdle(callback, { timeout: 600 });
  return window.setTimeout(callback, 16);
}

function cancelIdle(id: number) {
  if (typeof window === "undefined") return;
  const cancel = (
    window as Window & { cancelIdleCallback?: (id: number) => void }
  ).cancelIdleCallback;
  if (cancel) cancel(id);
  else window.clearTimeout(id);
}

function optimizeCoordinates(coordinates: LngLatTuple[]) {
  if (coordinates.length <= 360) return coordinates;
  const stride = Math.ceil(coordinates.length / 360);
  const result = coordinates.filter((_, index) => index % stride === 0);
  const last = coordinates.at(-1);
  if (last && result.at(-1) !== last) result.push(last);
  return result;
}

function isValidStation(
  station: EditorStation,
): station is EditorStation & { lat: number; lng: number } {
  return Number.isFinite(station.lat) && Number.isFinite(station.lng);
}

function catmullRomPoint(
  p0: LngLatTuple,
  p1: LngLatTuple,
  p2: LngLatTuple,
  p3: LngLatTuple,
  t: number,
): LngLatTuple {
  const [p0Lng, p0Lat] = p0;
  const [p1Lng, p1Lat] = p1;
  const [p2Lng, p2Lat] = p2;
  const [p3Lng, p3Lat] = p3;
  const t2 = t * t;
  const t3 = t2 * t;

  return [
    0.5 *
      (2 * p1Lng +
        (-p0Lng + p2Lng) * t +
        (2 * p0Lng - 5 * p1Lng + 4 * p2Lng - p3Lng) * t2 +
        (-p0Lng + 3 * p1Lng - 3 * p2Lng + p3Lng) * t3),
    0.5 *
      (2 * p1Lat +
        (-p0Lat + p2Lat) * t +
        (2 * p0Lat - 5 * p1Lat + 4 * p2Lat - p3Lat) * t2 +
        (-p0Lat + 3 * p1Lat - 3 * p2Lat + p3Lat) * t3),
  ];
}

function smoothCoordinates(coordinates: LngLatTuple[]): LngLatTuple[] {
  if (coordinates.length < 3) return coordinates;
  const result: LngLatTuple[] = [];
  const samplesPerSegment = 5;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const p0 = coordinates[Math.max(0, index - 1)] ?? coordinates[index];
    const p1 = coordinates[index];
    const p2 = coordinates[index + 1];
    const p3 = coordinates[Math.min(coordinates.length - 1, index + 2)] ?? p2;
    if (!p0 || !p1 || !p2 || !p3) continue;
    if (index === 0) result.push(p1);
    for (let step = 1; step <= samplesPerSegment; step += 1)
      result.push(catmullRomPoint(p0, p1, p2, p3, step / samplesPerSegment));
  }

  return result;
}

function smoothCoordinateRange(
  coordinates: LngLatTuple[],
  startIndex: number,
  endIndex: number,
): LngLatTuple[] {
  if (coordinates.length < 2 || startIndex === endIndex) return [];

  const start = Math.max(0, Math.min(startIndex, endIndex));
  const end = Math.min(coordinates.length - 1, Math.max(startIndex, endIndex));
  if (coordinates.length < 3) return coordinates.slice(start, end + 1);

  const result: LngLatTuple[] = [];
  const samplesPerSegment = 5;

  for (let index = start; index < end; index += 1) {
    const p0 = coordinates[Math.max(0, index - 1)] ?? coordinates[index];
    const p1 = coordinates[index];
    const p2 = coordinates[index + 1];
    const p3 = coordinates[Math.min(coordinates.length - 1, index + 2)] ?? p2;
    if (!p0 || !p1 || !p2 || !p3) continue;
    if (index === start) result.push(p1);
    for (let step = 1; step <= samplesPerSegment; step += 1) {
      result.push(catmullRomPoint(p0, p1, p2, p3, step / samplesPerSegment));
    }
  }

  return startIndex <= endIndex ? result : [...result].reverse();
}

function cubicBezierPoint(
  start: LngLatTuple,
  control1: LngLatTuple,
  control2: LngLatTuple,
  end: LngLatTuple,
  t: number,
): LngLatTuple {
  const inverse = 1 - t;
  const inverse2 = inverse * inverse;
  const inverse3 = inverse2 * inverse;
  const t2 = t * t;
  const t3 = t2 * t;

  return [
    inverse3 * start[0] +
      3 * inverse2 * t * control1[0] +
      3 * inverse * t2 * control2[0] +
      t3 * end[0],
    inverse3 * start[1] +
      3 * inverse2 * t * control1[1] +
      3 * inverse * t2 * control2[1] +
      t3 * end[1],
  ];
}

function getCoordinateDistance(a: LngLatTuple, b: LngLatTuple) {
  const lngScale = Math.max(
    0.35,
    Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180),
  );
  const dx = (b[0] - a[0]) * lngScale;
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function normalizeCoordinateVector(
  from: LngLatTuple,
  to: LngLatTuple,
): LngLatTuple | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(length) || length <= 0) return null;
  return [dx / length, dy / length];
}

function buildSmoothConnectionCurve(
  start: LngLatTuple,
  end: LngLatTuple,
  startContext: LngLatTuple | null,
  endContext: LngLatTuple | null,
): LngLatTuple[] {
  const distance = getCoordinateDistance(start, end);
  if (!Number.isFinite(distance) || distance <= 0) return [start, end];

  const controlDistance = Math.min(Math.max(distance * 0.42, 0.0012), 0.08);
  const startDirection = startContext
    ? normalizeCoordinateVector(startContext, start)
    : normalizeCoordinateVector(start, end);
  const endDirection = endContext
    ? normalizeCoordinateVector(end, endContext)
    : normalizeCoordinateVector(start, end);

  const control1: LngLatTuple = startDirection
    ? [
        start[0] + startDirection[0] * controlDistance,
        start[1] + startDirection[1] * controlDistance,
      ]
    : [
        start[0] + (end[0] - start[0]) * 0.33,
        start[1] + (end[1] - start[1]) * 0.33,
      ];
  const control2: LngLatTuple = endDirection
    ? [
        end[0] - endDirection[0] * controlDistance,
        end[1] - endDirection[1] * controlDistance,
      ]
    : [
        start[0] + (end[0] - start[0]) * 0.66,
        start[1] + (end[1] - start[1]) * 0.66,
      ];

  const coordinates: LngLatTuple[] = [start];
  const segments = 28;
  for (let step = 1; step <= segments; step += 1) {
    coordinates.push(
      cubicBezierPoint(start, control1, control2, end, step / segments),
    );
  }
  return coordinates;
}

function getBranchStationIds(branch: EditorMapBranch): string[] {
  return branch.routeStops
    .map((stop) => stop.station?.id ?? null)
    .filter((stationId): stationId is string => Boolean(stationId));
}

function getBranchEndpointStationIds(branch: EditorMapBranch): Set<string> {
  const stationIds = getBranchStationIds(branch);
  return new Set(
    [stationIds[0], stationIds.at(-1)].filter(
      (stationId): stationId is string => Boolean(stationId),
    ),
  );
}

function validateLineBranchOverrides(
  overlays: ManualOverlayBundle,
  branches: EditorMapBranch[],
  stationById: Map<string, EditorStation>,
): LineBranchValidationIssue[] {
  const issues: LineBranchValidationIssue[] = [];
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));
  const assignedStationIds = new Set(branches.flatMap(getBranchStationIds));

  for (const override of overlays.lineBranchOverrides ?? []) {
    if (override.enabled === false) continue;

    const parentBranch = branchById.get(override.parentBranchId);
    if (!parentBranch) {
      issues.push({
        id: `${override.id}:parent`,
        message: `상위 노선을 찾을 수 없음: ${override.parentBranchId}`,
      });
      continue;
    }

    const parentStationIds = new Set(getBranchStationIds(parentBranch));
    if (!parentStationIds.has(override.anchorStationId)) {
      issues.push({
        id: `${override.id}:anchor`,
        message: `연결 기준 역이 상위 노선에 없음: ${formatStationDisplayName(stationById.get(override.anchorStationId))}`,
      });
    }

    if (override.mode === "add-station") {
      const branchStationId = override.branchStationId;
      if (!branchStationId || !stationById.has(branchStationId)) {
        issues.push({
          id: `${override.id}:branch-station`,
          message: `추가할 지선 역을 찾을 수 없음: ${branchStationId ?? "-"}`,
        });
      } else if (assignedStationIds.has(branchStationId)) {
        issues.push({
          id: `${override.id}:branch-station-assigned`,
          message: `추가할 지선 역이 이미 다른 노선에 소속됨: ${formatStationDisplayName(stationById.get(branchStationId))}`,
        });
      }
    }

    if (override.mode === "connect-line") {
      const connectedBranch = override.connectedBranchId
        ? branchById.get(override.connectedBranchId)
        : null;
      if (!connectedBranch) {
        issues.push({
          id: `${override.id}:connected`,
          message: `연결할 노선을 찾을 수 없음: ${override.connectedBranchId ?? "-"}`,
        });
        continue;
      }

      if (connectedBranch.id === parentBranch.id) {
        issues.push({
          id: `${override.id}:same-branch`,
          message: "같은 branch끼리는 지선 결합할 수 없음",
        });
      }
      const connectedStationId = override.connectedEndpointStationId;
      const connectedStationIds = new Set(getBranchStationIds(connectedBranch));
      if (!connectedStationId || !connectedStationIds.has(connectedStationId)) {
        issues.push({
          id: `${override.id}:connected-station`,
          message: `연결 노선의 선택 역이 노선에 없음: ${formatStationDisplayName(connectedStationId ? stationById.get(connectedStationId) : null)}`,
        });
      }
    }
  }

  return issues;
}

function validateBranchStationExclusions(
  overlays: ManualOverlayBundle,
  branches: EditorMapBranch[],
  stationById: Map<string, EditorStation>,
): LineBranchValidationIssue[] {
  const issues: LineBranchValidationIssue[] = [];
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));

  for (const exclusion of overlays.branchStationExclusions ?? []) {
    if (exclusion.enabled === false) continue;
    const branch = branchById.get(exclusion.branchId);
    if (!branch) {
      issues.push({
        id: `${exclusion.id}:branch`,
        message: `역 제거 대상 노선을 찾을 수 없음: ${exclusion.branchId}`,
      });
      continue;
    }

    if (!stationById.has(exclusion.stationId)) {
      issues.push({
        id: `${exclusion.id}:station`,
        message: `제거 대상 역을 찾을 수 없음: ${exclusion.stationId}`,
      });
    }
  }

  return issues;
}

function getPublicWebManualChangeRows(overlays: ManualOverlayBundle) {
  return [
    {
      label: "역 보정",
      count: overlays.stationOverrides.length,
      description:
        "역 표시명, 위치 override, 메모가 공개 Web 역/선형 계산에 반영됩니다.",
    },
    {
      label: "환승 그룹",
      count: overlays.manualTransferGroups.length,
      description:
        "환승역 collapsed/expanded 표시와 환승 그룹 라벨에 반영됩니다.",
    },
    {
      label: "미환승역",
      count: overlays.nonTransferStationIds.length,
      description: "환승 후보에서 제외되는 역 목록입니다.",
    },
    {
      label: "노선별 역 제외",
      count: overlays.branchStationExclusions.length,
      description: "특정 branch에서 역을 제거한 override입니다.",
    },
    {
      label: "지선 overlay",
      count: (overlays.lineBranchOverrides ?? []).length,
      description: "역 추가/노선 결합으로 만든 수동 지선 선형입니다.",
    },
    {
      label: "선형 보정",
      count: overlays.geometryOverrides.length,
      description:
        "일반 branch의 수동 station anchor/control point 보정입니다.",
    },
    {
      label: "노선 보정",
      count: overlays.branchOverrides.length,
      description: "노선 단위 표시/메타 보정입니다.",
    },
  ];
}

function getPublicWebManualChangeTotal(overlays: ManualOverlayBundle) {
  return getPublicWebManualChangeRows(overlays).reduce(
    (total, row) => total + row.count,
    0,
  );
}

function stationGeometryDistance(left: LngLatTuple, right: LngLatTuple) {
  return getCoordinateDistance(left, right);
}

function distanceToCoordinatePolyline(
  point: LngLatTuple,
  coordinates: LngLatTuple[],
) {
  if (coordinates.length < 1) return Number.POSITIVE_INFINITY;
  if (coordinates.length === 1)
    return stationGeometryDistance(point, coordinates[0] ?? point);

  let best = Number.POSITIVE_INFINITY;
  const probe: ManualGeometryOverridePoint = {
    lng: point[0],
    lat: point[1],
    kind: "control",
  };

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const startCoordinate = coordinates[index];
    const endCoordinate = coordinates[index + 1];
    if (!startCoordinate || !endCoordinate) continue;

    const start: ManualGeometryOverridePoint = {
      lng: startCoordinate[0],
      lat: startCoordinate[1],
      kind: "control",
    };
    const end: ManualGeometryOverridePoint = {
      lng: endCoordinate[0],
      lat: endCoordinate[1],
      kind: "control",
    };
    const distanceSquared = distanceToCoordinateSegmentSquared(
      probe,
      start,
      end,
    );
    if (distanceSquared < best) best = distanceSquared;
  }

  return Math.sqrt(best);
}

function validateSavedGeometryStationAnchors(
  geometryOverrides: ManualGeometryOverride[],
  lineBranchOverrides: ManualLineBranchOverride[],
  stationById: Map<string, EditorStation>,
): LineBranchValidationIssue[] {
  const issues: LineBranchValidationIssue[] = [];

  for (const override of geometryOverrides) {
    if (override.enabled === false) continue;
    for (const point of override.points) {
      if (point.kind !== "station" || !point.stationId) continue;
      const coordinate = getStationCoordinate(stationById.get(point.stationId));
      if (!coordinate) continue;
      const distance = stationGeometryDistance(coordinate, [
        point.lng,
        point.lat,
      ]);
      if (distance <= SAVED_STATION_ANCHOR_TOLERANCE) continue;
      issues.push({
        id: `${override.branchId}:${point.stationId}:stale-anchor`,
        message: `저장된 선형 보정의 역 anchor가 현재 역 위치와 다름: ${formatStationDisplayName(stationById.get(point.stationId))}`,
      });
    }
  }

  for (const override of lineBranchOverrides) {
    if (override.enabled === false || !override.geometry?.length) continue;
    for (const point of override.geometry) {
      if (point.kind !== "station" || !point.stationId) continue;
      const coordinate = getStationCoordinate(stationById.get(point.stationId));
      if (!coordinate) continue;
      const distance = stationGeometryDistance(coordinate, [
        point.lng,
        point.lat,
      ]);
      if (distance <= SAVED_STATION_ANCHOR_TOLERANCE) continue;
      issues.push({
        id: `${override.id}:${point.stationId}:stale-line-branch-anchor`,
        message: `저장된 지선 선형의 역 anchor가 현재 역 위치와 다름: ${formatStationDisplayName(stationById.get(point.stationId))}`,
      });
    }
  }

  return issues;
}

function replaceStaleSavedStationAnchorPoints(
  points: ManualGeometryOverridePoint[],
  stationId: string,
  coordinate: LngLatTuple,
) {
  let changedCount = 0;
  const nextPoints = points.map((point) => {
    if (point.kind !== "station" || point.stationId !== stationId) return point;
    if (
      Math.abs(point.lng - coordinate[0]) <= SAVED_STATION_ANCHOR_TOLERANCE &&
      Math.abs(point.lat - coordinate[1]) <= SAVED_STATION_ANCHOR_TOLERANCE
    ) {
      return point;
    }
    changedCount += 1;
    return {
      ...point,
      lng: coordinate[0],
      lat: coordinate[1],
    };
  });
  return { points: nextPoints, changedCount };
}

function syncSavedGeometryAnchorsForStation(
  overlays: ManualOverlayBundle,
  stationId: string,
  stationById: Map<string, EditorStation>,
) {
  const coordinate = getStationCoordinate(stationById.get(stationId));
  if (!coordinate) return { overlays, changedCount: 0 };

  let changedCount = 0;
  const geometryOverrides = overlays.geometryOverrides.map((override) => {
    const replaced = replaceStaleSavedStationAnchorPoints(
      override.points,
      stationId,
      coordinate,
    );
    changedCount += replaced.changedCount;
    return replaced.changedCount > 0
      ? { ...override, points: replaced.points }
      : override;
  });

  const lineBranchOverrides = (overlays.lineBranchOverrides ?? []).map(
    (override) => {
      if (!override.geometry?.length) return override;
      const replaced = replaceStaleSavedStationAnchorPoints(
        override.geometry,
        stationId,
        coordinate,
      );
      changedCount += replaced.changedCount;
      return replaced.changedCount > 0
        ? { ...override, geometry: replaced.points }
        : override;
    },
  );

  if (changedCount === 0) return { overlays, changedCount };

  return {
    overlays: {
      ...overlays,
      geometryOverrides,
      lineBranchOverrides,
    },
    changedCount,
  };
}

function countStaleSavedGeometryAnchorsForStation(
  overlays: ManualOverlayBundle,
  stationId: string,
  stationById: Map<string, EditorStation>,
) {
  return syncSavedGeometryAnchorsForStation(overlays, stationId, stationById)
    .changedCount;
}

function validateStationGeometryAlignment(
  branches: EditorMapBranch[],
  lineBranchOverrides: ManualLineBranchOverride[],
  stationById: Map<string, EditorStation>,
): LineBranchValidationIssue[] {
  const issues: LineBranchValidationIssue[] = [];

  for (const branch of branches) {
    const coordinates = branchCoordinates(branch);
    if (coordinates.length < 2) continue;

    const reportedStationIds = new Set<string>();
    for (const stop of branch.routeStops) {
      const station = stop.station;
      const coordinate = getStationCoordinate(station);
      if (!station || !coordinate || reportedStationIds.has(station.id))
        continue;
      const distance = distanceToCoordinatePolyline(coordinate, coordinates);
      if (distance <= STATION_GEOMETRY_ANCHOR_TOLERANCE) continue;
      reportedStationIds.add(station.id);
      issues.push({
        id: `${branch.id}:${station.id}:detached-station`,
        message: `역 위치와 본선 선형이 떨어져 있음: ${formatStationDisplayName(station)} · ${formatBranchDisplayName(branch)}`,
      });
    }
  }

  for (const override of lineBranchOverrides) {
    if (override.enabled === false) continue;
    const coordinates = buildLineBranchCoordinates(
      override,
      null,
      null,
      stationById,
    );
    if (coordinates.length < 2) continue;

    const stationIds = [
      override.anchorStationId,
      override.mode === "add-station"
        ? override.branchStationId
        : override.connectedEndpointStationId,
    ].filter((stationId): stationId is string => Boolean(stationId));

    for (const stationId of stationIds) {
      const stationCoordinate = getStationCoordinate(
        stationById.get(stationId),
      );
      if (!stationCoordinate) continue;
      const distance = distanceToCoordinatePolyline(
        stationCoordinate,
        coordinates,
      );
      if (distance <= STATION_GEOMETRY_ANCHOR_TOLERANCE) continue;
      issues.push({
        id: `${override.id}:${stationId}:detached-line-branch-station`,
        message: `역 위치와 지선 선형이 떨어져 있음: ${formatStationDisplayName(stationById.get(stationId))}`,
      });
    }
  }

  return issues;
}

function validateGeometryConsistency(
  branches: EditorMapBranch[],
  lineBranchOverrides: ManualLineBranchOverride[],
  geometryOverrides: ManualGeometryOverride[],
  storedLineBranchOverrides: ManualLineBranchOverride[],
  stationById: Map<string, EditorStation>,
): LineBranchValidationIssue[] {
  return [
    ...validateSavedGeometryStationAnchors(
      geometryOverrides,
      storedLineBranchOverrides,
      stationById,
    ),
    ...validateStationGeometryAlignment(
      branches,
      lineBranchOverrides,
      stationById,
    ),
  ];
}

function formatBranchDisplayName(branch: EditorMapBranch | null | undefined) {
  if (!branch) return "알 수 없는 노선";
  const sourceName =
    branch.sourceLineName &&
    branch.sourceLineName !== branch.canonicalLineNameKo
      ? ` · ${branch.sourceLineName}`
      : "";
  return `${branch.canonicalLineNameKo}${sourceName}`;
}

function formatStationDisplayName(station: EditorStation | null | undefined) {
  if (!station) return "알 수 없는 역";
  const lineName = station.lineNameKo ? ` · ${station.lineNameKo}` : "";
  return `${station.nameKo}${lineName}`;
}

function getLineBranchDisplay(
  override: ManualLineBranchOverride,
  branchById: Map<string, EditorMapBranch>,
  stationById: Map<string, EditorStation>,
) {
  const parentBranch = branchById.get(override.parentBranchId) ?? null;
  const anchorStation = stationById.get(override.anchorStationId) ?? null;

  if (override.mode === "add-station") {
    const branchStation = override.branchStationId
      ? (stationById.get(override.branchStationId) ?? null)
      : null;
    return {
      title: "지선 역 추가",
      summary: `${formatBranchDisplayName(parentBranch)} ${formatStationDisplayName(anchorStation)} <-> ${formatStationDisplayName(branchStation)}`,
      detail: "미소속 역을 선택한 노선의 특정 역에 연결합니다.",
    };
  }

  const connectedBranch = override.connectedBranchId
    ? (branchById.get(override.connectedBranchId) ?? null)
    : null;
  const connectedStation = override.connectedEndpointStationId
    ? (stationById.get(override.connectedEndpointStationId) ?? null)
    : null;
  const directionLabel = formatLineBranchDirectionSummary(
    connectedBranch,
    override.connectedEndpointStationId,
    override.connectedDirection ?? "toward-end",
  );

  return {
    title: "지선 노선 결합",
    summary: `${formatBranchDisplayName(parentBranch)} ${formatStationDisplayName(anchorStation)} <-> ${formatBranchDisplayName(connectedBranch)} ${formatStationDisplayName(connectedStation)}${directionLabel ? ` (${directionLabel})` : ""}`,
    detail: "선택한 노선의 특정 역과 다른 노선의 특정 역을 연결합니다.",
  };
}

function getBranchStopCoordinatePoints(branch: EditorMapBranch) {
  return branch.routeStops
    .map((stop) => {
      const station = stop.station;
      const coordinate = getStationCoordinate(station);
      if (!station || !coordinate) return null;

      return {
        stationId: station.id,
        coordinate,
      };
    })
    .filter(
      (point): point is { stationId: string; coordinate: LngLatTuple } =>
        point !== null,
    );
}

function getLineBranchExplicitGeometry(override: ManualLineBranchOverride) {
  const points = (override.geometry ?? [])
    .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat))
    .map((point) => [point.lng, point.lat] as LngLatTuple);

  const hasEditableShape =
    points.length >= 3 ||
    (override.geometry ?? []).some((point) => point.kind === "control");

  return hasEditableShape ? smoothCoordinates(points) : [];
}

function buildAddStationLineBranchCoordinates(
  override: ManualLineBranchOverride,
  parentBranch: EditorMapBranch | null,
  stationById: Map<string, EditorStation>,
) {
  if (!parentBranch || !override.branchStationId) return [];

  const parentPoints = getBranchStopCoordinatePoints(parentBranch);
  const anchorIndex = parentPoints.findIndex(
    (point) => point.stationId === override.anchorStationId,
  );
  const branchStation = stationById.get(override.branchStationId) ?? null;
  const branchCoordinate = getStationCoordinate(branchStation);
  if (anchorIndex < 0 || !branchCoordinate) return [];

  const context = [
    ...parentPoints.slice(0, anchorIndex + 1).map((point) => point.coordinate),
    branchCoordinate,
  ];

  return smoothCoordinateRange(context, anchorIndex, context.length - 1);
}

function getBranchStationCoordinatePoint(
  branch: EditorMapBranch,
  stationId: string,
) {
  const points = getBranchStopCoordinatePoints(branch);
  const index = points.findIndex((point) => point.stationId === stationId);
  if (index < 0) return null;
  const point = points[index];
  if (!point) return null;
  return { point, points, index };
}

function getParentBranchTangentCoordinate(
  branch: EditorMapBranch,
  stationId: string,
) {
  const context = getBranchStationCoordinatePoint(branch, stationId);
  if (!context) return null;

  return (
    context.points[context.index - 1]?.coordinate ??
    context.points[context.index + 1]?.coordinate ??
    null
  );
}

function getBranchDirectionOptions(
  branch: EditorMapBranch | null,
  stationId: string,
): LineBranchDirectionOption[] {
  if (!branch || !stationId) return [];

  const stations = getBranchStopStations(branch);
  const index = stations.findIndex((station) => station.id === stationId);
  if (index < 0) return [];

  const options: LineBranchDirectionOption[] = [];
  const start = stations[0];
  const end = stations.at(-1);
  const previous = stations[index - 1];
  const next = stations[index + 1];

  if (next && end) {
    options.push({
      value: "toward-end",
      label: `${end.nameKo}행 (${next.nameKo} 방향)`,
    });
  }

  if (previous && start) {
    options.push({
      value: "toward-start",
      label: `${start.nameKo}행 (${previous.nameKo} 방향)`,
    });
  }

  return options;
}

function getConnectedBranchTangentCoordinate(
  branch: EditorMapBranch,
  stationId: string,
  direction: LineBranchDirection,
) {
  const context = getBranchStationCoordinatePoint(branch, stationId);
  if (!context) return null;

  const nextIndex =
    direction === "toward-start" ? context.index - 1 : context.index + 1;
  return context.points[nextIndex]?.coordinate ?? null;
}

function buildConnectLineBranchCoordinates(
  override: ManualLineBranchOverride,
  parentBranch: EditorMapBranch | null,
  connectedBranch: EditorMapBranch | null,
) {
  if (!parentBranch || !connectedBranch || !override.connectedEndpointStationId)
    return [];

  const anchor = getBranchStationCoordinatePoint(
    parentBranch,
    override.anchorStationId,
  );
  const target = getBranchStationCoordinatePoint(
    connectedBranch,
    override.connectedEndpointStationId,
  );
  if (!anchor || !target) return [];

  const direction = override.connectedDirection ?? "toward-end";
  const parentTangent = getParentBranchTangentCoordinate(
    parentBranch,
    override.anchorStationId,
  );
  const connectedTangent = getConnectedBranchTangentCoordinate(
    connectedBranch,
    override.connectedEndpointStationId,
    direction,
  );

  return buildSmoothConnectionCurve(
    anchor.point.coordinate,
    target.point.coordinate,
    parentTangent,
    connectedTangent,
  );
}

function buildLineBranchCoordinates(
  override: ManualLineBranchOverride,
  parentBranch: EditorMapBranch | null,
  connectedBranch: EditorMapBranch | null,
  stationById: Map<string, EditorStation>,
) {
  const explicitGeometry = getLineBranchExplicitGeometry(override);
  if (explicitGeometry.length >= 2) return explicitGeometry;

  if (override.mode === "add-station") {
    return buildAddStationLineBranchCoordinates(
      override,
      parentBranch,
      stationById,
    );
  }

  return buildConnectLineBranchCoordinates(
    override,
    parentBranch,
    connectedBranch,
  );
}

async function buildLineBranchFeaturesChunked(
  overrides: ManualLineBranchOverride[],
  branchById: Map<string, EditorMapBranch>,
  stationById: Map<string, EditorStation>,
  visible: boolean,
  isCancelled: () => boolean,
): Promise<RailFeatureCollection | null> {
  if (!visible) return EMPTY_FEATURE_COLLECTION;

  const features: RailFeatureCollection["features"] = [];
  const batchSize = 80;

  for (let start = 0; start < overrides.length; start += batchSize) {
    if (isCancelled()) return null;

    for (const override of overrides.slice(start, start + batchSize)) {
      if (override.enabled === false) continue;

      const parentBranch = branchById.get(override.parentBranchId) ?? null;
      const connectedBranch = override.connectedBranchId
        ? (branchById.get(override.connectedBranchId) ?? null)
        : null;
      const display = getLineBranchDisplay(override, branchById, stationById);
      const coordinates = buildLineBranchCoordinates(
        override,
        parentBranch,
        connectedBranch,
        stationById,
      );

      if (coordinates.length < 2) continue;

      features.push({
        type: "Feature",
        properties: {
          id: override.id,
          mode: override.mode,
          colorHex: parentBranch?.colorHex ?? "#0f766e",
          title: display.title,
          summary: display.summary,
        },
        geometry: {
          type: "LineString",
          coordinates: optimizeCoordinates(coordinates),
        },
      });
    }

    await yieldToMainThread();
  }

  return { type: "FeatureCollection", features };
}

function getStationCoordinate(
  station: EditorStation | null | undefined,
): LngLatTuple | null {
  if (!station || station.lng === null || station.lat === null) return null;
  if (!Number.isFinite(station.lng) || !Number.isFinite(station.lat))
    return null;
  return [station.lng, station.lat];
}

function getUnassignedStations(
  stations: EditorStation[],
  branches: EditorMapBranch[],
): EditorStation[] {
  const assignedStationIds = new Set(branches.flatMap(getBranchStationIds));
  return stations.filter((station) => !assignedStationIds.has(station.id));
}

function getBranchStopStations(branch: EditorMapBranch): EditorStation[] {
  return branch.routeStops
    .map((stop) => stop.station)
    .filter((station): station is EditorStation => Boolean(station));
}

function getBranchesServingStation(
  branches: EditorMapBranch[],
  stationId: string,
) {
  return branches.filter((branch) =>
    getBranchStopStations(branch).some((station) => station.id === stationId),
  );
}

function formatLineBranchDirectionSummary(
  branch: EditorMapBranch | null,
  stationId: string | undefined,
  direction: LineBranchDirection | undefined,
) {
  if (!branch || !stationId || !direction) return null;
  const options = getBranchDirectionOptions(branch, stationId);
  const label = options.find((option) => option.value === direction)?.label;
  if (!label) return null;
  return label.replace("행 (", "행 / ").replace(/\)$/u, "");
}

function getBranchEndpointStations(branch: EditorMapBranch): EditorStation[] {
  const stations = getBranchStopStations(branch);
  return [stations[0], stations.at(-1)].filter(
    (station, index, values): station is EditorStation =>
      Boolean(station) &&
      values.findIndex((candidate) => candidate?.id === station?.id) === index,
  );
}

function makeLineBranchGeometry(anchor: EditorStation, target: EditorStation) {
  const anchorCoordinate = getStationCoordinate(anchor);
  const targetCoordinate = getStationCoordinate(target);
  if (!anchorCoordinate || !targetCoordinate) return undefined;

  return [
    {
      lng: anchorCoordinate[0],
      lat: anchorCoordinate[1],
      kind: "station" as const,
      stationId: anchor.id,
    },
    {
      lng: targetCoordinate[0],
      lat: targetCoordinate[1],
      kind: "station" as const,
      stationId: target.id,
    },
  ];
}

function getGeometryTargetKey(type: GeometryTargetType, id: string) {
  return `${type}:${id}`;
}

function getGeometryDraftTargetKey(draft: GeometryDraft | null) {
  return draft ? getGeometryTargetKey(draft.targetType, draft.targetId) : null;
}

function cloneGeometryDraft(draft: GeometryDraft | null): GeometryDraft | null {
  if (!draft) return null;
  return {
    ...draft,
    points: draft.points.map((point) => ({ ...point })),
  };
}

function getGeometryDraftsFromMap(map: GeometryDraftMap): GeometryDraft[] {
  return Object.values(map).map((draft) => cloneGeometryDraft(draft) ?? draft);
}

function getGeometryDraftSignature(draft: GeometryDraft | null) {
  if (!draft) return "";
  return JSON.stringify({
    targetType: draft.targetType,
    targetId: draft.targetId,
    branchId: draft.branchId,
    note: draft.note,
    points: draft.points.map((point) => ({
      kind: point.kind,
      stationId: point.stationId ?? "",
      lng: Number(point.lng.toFixed(8)),
      lat: Number(point.lat.toFixed(8)),
    })),
  });
}

function areGeometryDraftsEqual(
  left: GeometryDraft | null,
  right: GeometryDraft | null,
) {
  return getGeometryDraftSignature(left) === getGeometryDraftSignature(right);
}

function getControlPointCount(draft: GeometryDraft | null) {
  return draft?.points.filter((point) => point.kind === "control").length ?? 0;
}

function getStationGeometryPoint(
  stationId: string | undefined,
  stationById: Map<string, EditorStation>,
): ManualGeometryOverridePoint | null {
  if (!stationId) return null;
  const station = stationById.get(stationId);
  const coordinate = getStationCoordinate(station);
  if (!station || !coordinate) return null;

  return {
    lng: coordinate[0],
    lat: coordinate[1],
    kind: "station",
    stationId: station.id,
  };
}

function getGeometryDraftStationPositionChangeLabels(
  draft: GeometryDraft | null,
  stationById: Map<string, EditorStation>,
) {
  if (!draft) return [];

  return draft.points
    .filter(
      (point): point is ManualGeometryOverridePoint & { stationId: string } =>
        point.kind === "station" && Boolean(point.stationId),
    )
    .filter((point) => {
      const current = getStationCoordinate(stationById.get(point.stationId));
      return !coordinatesEqual(current, point);
    })
    .map((point) => formatStationDisplayName(stationById.get(point.stationId)))
    .filter((label, index, labels) => labels.indexOf(label) === index);
}

function branchCoordinates(branch: EditorMapBranch): LngLatTuple[] {
  const override = (branch.geometryOverrideCoordinates ?? []).filter(
    ([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat),
  ) as LngLatTuple[];
  if (override.length >= 2) return smoothCoordinates(override);

  const coordinates = (branch.geometryCoordinates ?? []).filter(
    ([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat),
  ) as LngLatTuple[];

  if (coordinates.length < 2) return [];

  const smoothed = smoothCoordinates(coordinates);
  return smoothed.length >= 2 ? smoothed : coordinates;
}

function formatStationSubLabel(station: EditorStation) {
  return `${station.lineNameKo} · ${station.stationNumber}`;
}

function stationSearchRank(station: EditorStation, normalizedQuery: string) {
  if (!normalizedQuery) return 0;
  const name = normalizeSearchText(station.nameKo);
  const lineName = normalizeSearchText(station.lineNameKo);
  const stationNumber = normalizeSearchText(station.stationNumber);

  if (name.startsWith(normalizedQuery)) return 0;
  if (name.includes(normalizedQuery)) return 1;
  if (lineName.includes(normalizedQuery)) return 2;
  if (stationNumber.includes(normalizedQuery)) return 3;
  return Number.POSITIVE_INFINITY;
}

function searchStations(
  stations: EditorStation[],
  query: string,
  limit: number,
) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return stations.slice(0, limit);

  return stations
    .map((station) => ({
      station,
      rank: stationSearchRank(station, normalized),
    }))
    .filter((entry) => Number.isFinite(entry.rank))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const nameCompare = a.station.nameKo.localeCompare(
        b.station.nameKo,
        "ko-KR",
      );
      if (nameCompare !== 0) return nameCompare;
      return a.station.lineNameKo.localeCompare(b.station.lineNameKo, "ko-KR");
    })
    .slice(0, limit)
    .map((entry) => entry.station);
}

function firstFeatureId(
  features: Array<{
    layer: { id: string };
    properties?: Record<string, unknown> | null;
  }>,
  layerIds: string[],
) {
  const feature = features.find((candidate) =>
    layerIds.includes(candidate.layer.id),
  );
  const id = feature?.properties?.id;
  return typeof id === "string" ? id : undefined;
}

function isTransferDetailVisible(zoom: number) {
  return zoom >= TRANSFER_DETAIL_ZOOM_THRESHOLD;
}

function isCollapsedTransferZoom(zoom: number) {
  return !isTransferDetailVisible(zoom);
}

function clampTransferGroupRadius(radius: number) {
  if (!Number.isFinite(radius)) return TRANSFER_GROUP_AREA_MIN_RADIUS;
  return Math.min(
    TRANSFER_GROUP_AREA_MAX_RADIUS,
    Math.max(TRANSFER_GROUP_AREA_MIN_RADIUS, radius),
  );
}

function featureStringProperty(
  feature:
    | { properties?: Record<string, unknown> | null }
    | undefined,
  key: string,
) {
  const value = feature?.properties?.[key];
  return typeof value === "string" ? value : undefined;
}

function firstVisibleStationFeatureId(
  features: Array<{
    layer: { id: string };
    properties?: Record<string, unknown> | null;
  }>,
  layerIds: string[],
  zoom: number,
) {
  const collapsed = isCollapsedTransferZoom(zoom);
  const feature = features.find((candidate) => {
    if (!layerIds.includes(candidate.layer.id)) return false;
    if (!collapsed) return true;
    return candidate.properties?.isTransferChild !== true;
  });
  return featureStringProperty(feature, "id");
}

function visibleStationFeatureIds(
  features: Array<{
    layer: { id: string };
    properties?: Record<string, unknown> | null;
  }>,
  layerIds: string[],
  zoom: number,
) {
  const collapsed = isCollapsedTransferZoom(zoom);
  return features
    .filter((candidate) => {
      if (!layerIds.includes(candidate.layer.id)) return false;
      if (!collapsed) return true;
      return candidate.properties?.isTransferChild !== true;
    })
    .map((feature) => featureStringProperty(feature, "id"))
    .filter((id): id is string => Boolean(id));
}

function getTransferGroupStationIds(
  groupId: string,
  groupById: Map<string, ManualTransferGroup>,
) {
  const group = groupById.get(groupId);
  return [...new Set(group?.stationIds ?? [])];
}

function getSelectedTransferGroupIds(
  selection: Selection,
  groups: ManualTransferGroup[],
) {
  if (selection.type === "transferGroup") return new Set([selection.id]);

  const selectedStationIds =
    selection.type === "station"
      ? new Set([selection.id])
      : selection.type === "multiStation"
        ? new Set(selection.ids)
        : new Set<string>();

  if (selectedStationIds.size === 0) return new Set<string>();

  return new Set(
    groups
      .filter((group) => {
        if (group.enabled === false || group.stationIds.length < 2) return false;
        return group.stationIds.every((stationId) =>
          selectedStationIds.has(stationId),
        );
      })
      .map((group) => group.id),
  );
}

function getPrimarySelectedTransferGroup(
  selection: Selection,
  groups: ManualTransferGroup[],
) {
  const selectedGroupIds = getSelectedTransferGroupIds(selection, groups);
  const firstGroupId = selectedGroupIds.values().next().value;
  if (typeof firstGroupId !== "string") return null;
  return groups.find((group) => group.id === firstGroupId) ?? null;
}

function selectionLabel(selection: Selection) {
  if (selection.type === "none") return "선택 없음";
  if (selection.type === "multiStation")
    return `${selection.ids.length}개 역 선택`;
  if (selection.type === "station") return "역";
  if (selection.type === "branch") return "노선/분기";
  return "환승 그룹";
}

function emptyStationOverride(
  station: EditorStation,
  previous?: ManualStationOverride,
): ManualStationOverride {
  return {
    stationId: station.id,
    nameKo: previous?.nameKo ?? station.nameKo,
    lat: previous?.lat ?? station.lat,
    lng: previous?.lng ?? station.lng,
    enabled: previous?.enabled ?? true,
    note: previous?.note ?? null,
  };
}

function hasStationPositionOverride(
  station: EditorStation,
  override?: ManualStationOverride,
) {
  if (!override) return false;
  const stationLng = station.lng;
  const stationLat = station.lat;
  if (typeof stationLng !== "number" || typeof stationLat !== "number") {
    return false;
  }
  const overrideLng = override.lng ?? stationLng;
  const overrideLat = override.lat ?? stationLat;
  if (typeof overrideLng !== "number" || typeof overrideLat !== "number") {
    return false;
  }
  return (
    Math.abs(overrideLng - stationLng) > SAVED_STATION_ANCHOR_TOLERANCE ||
    Math.abs(overrideLat - stationLat) > SAVED_STATION_ANCHOR_TOLERANCE
  );
}

function shouldKeepStationOverride(
  station: EditorStation,
  override: ManualStationOverride,
) {
  if ((override.nameKo ?? station.nameKo) !== station.nameKo) return true;
  if ((override.enabled ?? true) !== true) return true;
  if (override.note) return true;
  return hasStationPositionOverride(station, override);
}

function rollbackStationOverridePosition(
  station: EditorStation,
  override?: ManualStationOverride,
) {
  if (!override) return null;
  const stationLng = station.lng;
  const stationLat = station.lat;
  if (typeof stationLng !== "number" || typeof stationLat !== "number") {
    return null;
  }
  const next: ManualStationOverride = {
    ...override,
    lng: stationLng,
    lat: stationLat,
  };
  return shouldKeepStationOverride(station, next) ? next : null;
}

function defaultTransferGroupName(
  stationIds: string[],
  stationById: Map<string, EditorStation>,
) {
  const names = stationIds
    .map((stationId) => stationById.get(stationId)?.nameKo)
    .filter((name): name is string => Boolean(name));

  if (names.length === 0) return "새 환승 그룹";

  const normalized = names.map((name) => name.replace(/역$/u, ""));
  const first = normalized[0] ?? names[0] ?? "새 환승 그룹";
  const allSame = normalized.every((name) => name === first);

  if (allSame) return first.endsWith("역") ? first : `${first}역`;
  return `${first} 외 ${names.length - 1}개역 환승`;
}

function normalizeTransferGroupDraftPairs(
  stationIds: string[],
  previous: Record<string, number | null> = {},
) {
  const result: Record<string, number | null> = {};

  for (let i = 0; i < stationIds.length - 1; i += 1) {
    for (let j = i + 1; j < stationIds.length; j += 1) {
      const pairKey = makeTransferPairKey(
        stationIds[i] ?? "",
        stationIds[j] ?? "",
      );
      result[pairKey] = previous[pairKey] ?? null;
    }
  }

  return result;
}

function makeTransferDraftFromStations(
  stationIds: string[],
  stationById: Map<string, EditorStation>,
): TransferGroupDraft {
  const uniqueStationIds = [...new Set(stationIds)].filter(Boolean);

  return {
    nameKo: defaultTransferGroupName(uniqueStationIds, stationById),
    stationIds: uniqueStationIds,
    transferMinutesByPair: normalizeTransferGroupDraftPairs(uniqueStationIds),
    note: "",
  };
}

function makeTransferDraftFromGroup(
  group: ManualTransferGroup,
): TransferGroupDraft {
  return {
    id: group.id,
    nameKo: group.nameKo,
    stationIds: [...group.stationIds],
    transferMinutesByPair: normalizeTransferGroupDraftPairs(
      group.stationIds,
      group.transferMinutesByPair,
    ),
    note: group.note ?? "",
  };
}

function toTransferGroup(draft: TransferGroupDraft): ManualTransferGroup {
  const stationIds = [...new Set(draft.stationIds)].filter(Boolean);
  const nameKo = draft.nameKo.trim() || "수동 환승 그룹";

  return {
    id: draft.id ?? makeTransferGroupId(nameKo, stationIds),
    nameKo,
    stationIds,
    transferMinutesByPair: normalizeTransferGroupDraftPairs(
      stationIds,
      draft.transferMinutesByPair,
    ),
    enabled: true,
    source: "editor",
    note: draft.note.trim() ? draft.note.trim() : null,
  };
}

function getBranchAnchorGeometryPoints(
  branch: EditorMapBranch,
): ManualGeometryOverridePoint[] {
  return branch.routeStops
    .map((stop): ManualGeometryOverridePoint | null => {
      const station = stop.station;
      const coordinate = getStationCoordinate(station);
      if (!station || !coordinate) return null;

      return {
        lng: coordinate[0],
        lat: coordinate[1],
        kind: "station",
        stationId: station.id,
      };
    })
    .filter((point): point is ManualGeometryOverridePoint => point !== null);
}

function distanceToCoordinateSegmentSquared(
  point: ManualGeometryOverridePoint,
  start: ManualGeometryOverridePoint,
  end: ManualGeometryOverridePoint,
) {
  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    const px = point.lng - start.lng;
    const py = point.lat - start.lat;
    return px * px + py * py;
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.lng - start.lng) * dx + (point.lat - start.lat) * dy) /
        lengthSquared,
    ),
  );
  const projectedLng = start.lng + t * dx;
  const projectedLat = start.lat + t * dy;
  const px = point.lng - projectedLng;
  const py = point.lat - projectedLat;
  return px * px + py * py;
}

function findNearestAnchorSegmentIndex(
  point: ManualGeometryOverridePoint,
  anchors: ManualGeometryOverridePoint[],
) {
  if (anchors.length < 2) return 0;

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const start = anchors[index];
    const end = anchors[index + 1];
    if (!start || !end) continue;

    const distance = distanceToCoordinateSegmentSquared(point, start, end);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function coordinateSegmentProgress(
  point: ManualGeometryOverridePoint,
  start: ManualGeometryOverridePoint,
  end: ManualGeometryOverridePoint,
) {
  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return 0;
  return Math.max(
    0,
    Math.min(
      1,
      ((point.lng - start.lng) * dx + (point.lat - start.lat) * dy) /
        lengthSquared,
    ),
  );
}

function getReusableManualControlPoints(
  previous: ManualGeometryOverride | undefined,
  anchors: ManualGeometryOverridePoint[],
) {
  if (!previous?.points.length || anchors.length < 2) return [];

  const stationPointIds = new Set(
    previous.points
      .filter((point) => point.kind === "station" && point.stationId)
      .map((point) => point.stationId),
  );
  const anchorIds = new Set(
    anchors
      .map((point) => point.stationId)
      .filter((stationId): stationId is string => Boolean(stationId)),
  );
  const hasRecognizableStationAnchors = [...anchorIds].some((stationId) =>
    stationPointIds.has(stationId),
  );

  // 13.11 initially converted auto-smoothed render samples into editable
  // control points. Those legacy overrides have no stationId-backed anchors,
  // so they are intentionally reset to route-stop station anchors here.
  if (!hasRecognizableStationAnchors) return [];

  return previous.points.filter(
    (point) =>
      point.kind === "control" &&
      Number.isFinite(point.lng) &&
      Number.isFinite(point.lat),
  );
}

function insertManualControlsBetweenAnchors(
  anchors: ManualGeometryOverridePoint[],
  controls: ManualGeometryOverridePoint[],
) {
  if (anchors.length < 2 || controls.length < 1) return anchors;

  const controlsBySegment = new Map<number, ManualGeometryOverridePoint[]>();

  for (const control of controls) {
    const segmentIndex = findNearestAnchorSegmentIndex(control, anchors);
    const segmentControls = controlsBySegment.get(segmentIndex) ?? [];
    segmentControls.push(control);
    controlsBySegment.set(segmentIndex, segmentControls);
  }

  const result: ManualGeometryOverridePoint[] = [];

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (!anchor) continue;
    result.push(anchor);

    const nextAnchor = anchors[index + 1];
    const segmentControls = controlsBySegment.get(index);
    if (!nextAnchor || !segmentControls?.length) continue;

    segmentControls.sort(
      (left, right) =>
        coordinateSegmentProgress(left, anchor, nextAnchor) -
        coordinateSegmentProgress(right, anchor, nextAnchor),
    );
    result.push(...segmentControls);
  }

  return result;
}

function makeGeometryDraftFromBranch(
  branch: EditorMapBranch,
  previous?: ManualGeometryOverride,
): GeometryDraft {
  const anchors = getBranchAnchorGeometryPoints(branch);
  const controls = getReusableManualControlPoints(previous, anchors);
  const points = insertManualControlsBetweenAnchors(anchors, controls);

  return {
    targetType: "branch",
    targetId: branch.id,
    branchId: branch.id,
    points: points.length >= 2 ? points : anchors,
    note: previous?.note ?? "",
  };
}

function getLineBranchAnchorGeometryPoints(
  override: ManualLineBranchOverride,
  stationById: Map<string, EditorStation>,
): ManualGeometryOverridePoint[] {
  const anchor = getStationGeometryPoint(override.anchorStationId, stationById);
  const target = getStationGeometryPoint(
    override.mode === "add-station"
      ? override.branchStationId
      : override.connectedEndpointStationId,
    stationById,
  );

  return [anchor, target].filter(
    (point): point is ManualGeometryOverridePoint => point !== null,
  );
}

function makeGeometryDraftFromLineBranchOverride(
  override: ManualLineBranchOverride,
  stationById: Map<string, EditorStation>,
): GeometryDraft | null {
  const anchors = getLineBranchAnchorGeometryPoints(override, stationById);
  if (anchors.length < 2) return null;

  const previous = override.geometry?.length
    ? ({
        branchId: override.id,
        points: override.geometry,
        enabled: true,
        note: override.note ?? null,
      } satisfies ManualGeometryOverride)
    : undefined;
  const controls = getReusableManualControlPoints(previous, anchors);
  const points = insertManualControlsBetweenAnchors(anchors, controls);

  return {
    targetType: "lineBranch",
    targetId: override.id,
    branchId: override.parentBranchId,
    points: points.length >= 2 ? points : anchors,
    note: override.note ?? "",
  };
}

function toGeometryOverride(draft: GeometryDraft): ManualGeometryOverride {
  return {
    branchId: draft.branchId,
    points: draft.points.filter(
      (point) => Number.isFinite(point.lng) && Number.isFinite(point.lat),
    ),
    enabled: true,
    note: draft.note.trim() ? draft.note.trim() : null,
  };
}

function toLineBranchGeometryPoints(draft: GeometryDraft) {
  return draft.points.filter(
    (point) => Number.isFinite(point.lng) && Number.isFinite(point.lat),
  );
}

function coordinatesEqual(
  left: LngLatTuple | null,
  right: { lng: number; lat: number } | null | undefined,
) {
  if (!left || !right) return false;
  return (
    Math.abs(left[0] - right.lng) < 0.0000001 &&
    Math.abs(left[1] - right.lat) < 0.0000001
  );
}

function replaceCoordinateIfStationMatch(
  coordinate: ReadonlyArray<number>,
  previous: LngLatTuple | null,
  next: { lng: number; lat: number },
): LngLatTuple {
  const lng = coordinate[0];
  const lat = coordinate[1];

  if (typeof lng !== "number" || typeof lat !== "number") {
    return previous ?? [next.lng, next.lat];
  }

  if (
    previous &&
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng - previous[0]) < 0.0000001 &&
    Math.abs(lat - previous[1]) < 0.0000001
  ) {
    return [next.lng, next.lat];
  }

  return [lng, lat];
}

function applyStationCoordinateToBranches(
  branches: EditorMapBranch[],
  stationId: string,
  lng: number,
  lat: number,
): EditorMapBranch[] {
  return branches.map((branch) => {
    const stopWithStation = branch.routeStops.find(
      (stop) => stop.station?.id === stationId,
    );
    if (!stopWithStation?.station) return branch;

    const previousCoordinate = getStationCoordinate(stopWithStation.station);
    const routeStops = branch.routeStops.map((stop) =>
      stop.station?.id === stationId
        ? {
            ...stop,
            station: {
              ...stop.station,
              lng,
              lat,
            },
          }
        : stop,
    );

    return {
      ...branch,
      routeStops,
      geometryCoordinates: branch.geometryCoordinates?.map((coordinate) =>
        replaceCoordinateIfStationMatch(coordinate, previousCoordinate, {
          lng,
          lat,
        }),
      ),
      geometryOverrideCoordinates: branch.geometryOverrideCoordinates?.map(
        (coordinate) =>
          replaceCoordinateIfStationMatch(coordinate, previousCoordinate, {
            lng,
            lat,
          }),
      ),
    };
  });
}

function applyStationCoordinateToStations(
  stations: EditorStation[],
  stationId: string,
  lng: number,
  lat: number,
): EditorStation[] {
  return stations.map((station) =>
    station.id === stationId
      ? {
          ...station,
          lng,
          lat,
        }
      : station,
  );
}

function applyStationOverridesToStations(
  stations: EditorStation[],
  overrides: ManualStationOverride[],
): EditorStation[] {
  return overrides.reduce((current, override) => {
    const lng = override.lng;
    const lat = override.lat;
    if (override.enabled === false) return current;
    if (typeof lng !== "number" || typeof lat !== "number") return current;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return current;
    return applyStationCoordinateToStations(
      current,
      override.stationId,
      lng,
      lat,
    );
  }, stations);
}

function applyStationOverridesToBranches(
  branches: EditorMapBranch[],
  overrides: ManualStationOverride[],
): EditorMapBranch[] {
  return overrides.reduce((current, override) => {
    const lng = override.lng;
    const lat = override.lat;
    if (override.enabled === false) return current;
    if (typeof lng !== "number" || typeof lat !== "number") return current;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return current;

    return current.map((branch) => {
      const hasStation = branch.routeStops.some(
        (stop) => stop.station?.id === override.stationId,
      );
      if (!hasStation) return branch;

      const updated = applyStationCoordinateToBranches(
        [branch],
        override.stationId,
        lng,
        lat,
      )[0];
      if (!updated) return branch;

      const hasSavedGeometry = Boolean(
        updated.geometryOverrideCoordinates &&
        updated.geometryOverrideCoordinates.length >= 2,
      );
      if (hasSavedGeometry) return updated;

      // When a station position override exists, stale generated line coordinates can
      // leave the station detached from its branch. In the editor preview, rebuild the
      // default branch path from current route-stop anchors so the line always passes
      // through the edited station.
      const routeStopCoordinates = updated.routeStops
        .map((stop) => getStationCoordinate(stop.station))
        .filter((coordinate): coordinate is LngLatTuple => coordinate !== null);

      return routeStopCoordinates.length >= 2
        ? {
            ...updated,
            geometryCoordinates: routeStopCoordinates,
          }
        : updated;
    });
  }, branches);
}

function applyGeometryDraftStationPointsToStations(
  stations: EditorStation[],
  draft: GeometryDraft | null,
): EditorStation[] {
  if (!draft) return stations;

  return draft.points.reduce((current, point) => {
    if (point.kind !== "station" || !point.stationId) return current;
    if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat))
      return current;
    return applyStationCoordinateToStations(
      current,
      point.stationId,
      point.lng,
      point.lat,
    );
  }, stations);
}

function applyGeometryDraftStationPointsToBranches(
  branches: EditorMapBranch[],
  draft: GeometryDraft | null,
): EditorMapBranch[] {
  if (!draft) return branches;

  return draft.points.reduce((current, point) => {
    if (point.kind !== "station" || !point.stationId) return current;
    if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat))
      return current;
    return applyStationCoordinateToBranches(
      current,
      point.stationId,
      point.lng,
      point.lat,
    );
  }, branches);
}

function applyGeometryDraftsStationPointsToStations(
  stations: EditorStation[],
  drafts: GeometryDraft[],
): EditorStation[] {
  return drafts.reduce(
    (current, draft) =>
      applyGeometryDraftStationPointsToStations(current, draft),
    stations,
  );
}

function applyGeometryDraftsStationPointsToBranches(
  branches: EditorMapBranch[],
  drafts: GeometryDraft[],
): EditorMapBranch[] {
  return drafts.reduce(
    (current, draft) =>
      applyGeometryDraftStationPointsToBranches(current, draft),
    branches,
  );
}

function resolveGeometryPointStationAnchors(
  points: ManualGeometryOverridePoint[],
  stationById: Map<string, EditorStation>,
): ManualGeometryOverridePoint[] {
  return points.map((point) => {
    if (point.kind !== "station" || !point.stationId) return point;
    const coordinate = getStationCoordinate(stationById.get(point.stationId));
    if (!coordinate) return point;
    return {
      ...point,
      lng: coordinate[0],
      lat: coordinate[1],
    };
  });
}

function applySavedGeometryOverridesToBranches(
  branches: EditorMapBranch[],
  overrides: ManualGeometryOverride[],
  stationById: Map<string, EditorStation>,
): EditorMapBranch[] {
  if (overrides.length < 1) return branches;
  const overrideByBranchId = new Map(
    overrides
      .filter(
        (override) => override.enabled !== false && override.points.length >= 2,
      )
      .map((override) => [override.branchId, override]),
  );

  return branches.map((branch) => {
    const override = overrideByBranchId.get(branch.id);
    if (!override) return branch;
    const coordinates = resolveGeometryPointStationAnchors(
      override.points,
      stationById,
    )
      .filter(
        (point) => Number.isFinite(point.lng) && Number.isFinite(point.lat),
      )
      .map((point) => [point.lng, point.lat] as LngLatTuple);
    if (coordinates.length < 2) return branch;
    return {
      ...branch,
      geometryOverrideCoordinates: coordinates,
      geometryCoordinates: coordinates,
    };
  });
}

function applyDisplayStationAnchorsToLineBranchOverrides(
  overrides: ManualLineBranchOverride[],
  stationById: Map<string, EditorStation>,
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

function mergeStationOverrides(
  current: ManualStationOverride[],
  updates: ManualStationOverride[],
) {
  if (updates.length < 1) return current;
  const updateIds = new Set(updates.map((override) => override.stationId));
  return [
    ...current.filter((override) => !updateIds.has(override.stationId)),
    ...updates,
  ];
}

function getMovedStationOverridesFromGeometryDraft(
  draft: GeometryDraft,
  stationById: Map<string, EditorStation>,
  currentOverrides: ManualStationOverride[],
): ManualStationOverride[] {
  const updates = new Map<string, ManualStationOverride>();

  for (const point of draft.points) {
    if (point.kind !== "station" || !point.stationId) continue;
    if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) continue;

    const station = stationById.get(point.stationId);
    if (!station) continue;
    const current = getStationCoordinate(station);
    if (coordinatesEqual(current, point)) continue;

    const previous = currentOverrides.find(
      (override) => override.stationId === point.stationId,
    );
    updates.set(point.stationId, {
      stationId: point.stationId,
      nameKo: previous?.nameKo ?? station.nameKo,
      lng: point.lng,
      lat: point.lat,
      enabled: previous?.enabled ?? true,
      note: previous?.note ?? null,
    });
  }

  return [...updates.values()];
}

function applyGeometryDraftToBranches(
  branches: EditorMapBranch[],
  draft: GeometryDraft | null,
): EditorMapBranch[] {
  if (!draft || draft.targetType !== "branch") return branches;

  const coordinates = draft.points
    .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat))
    .map((point) => [point.lng, point.lat] as LngLatTuple);

  if (coordinates.length < 2) return branches;

  return branches.map((branch) =>
    branch.id === draft.branchId
      ? {
          ...branch,
          geometryOverrideCoordinates: coordinates,
          geometryCoordinates: coordinates,
        }
      : branch,
  );
}

function applyGeometryDraftToLineBranchOverrides(
  overrides: ManualLineBranchOverride[],
  draft: GeometryDraft | null,
): ManualLineBranchOverride[] {
  if (!draft || draft.targetType !== "lineBranch") return overrides;

  const points = toLineBranchGeometryPoints(draft);
  if (points.length < 2) return overrides;

  return overrides.map((override) =>
    override.id === draft.targetId
      ? {
          ...override,
          geometry: points,
          note: draft.note.trim() ? draft.note.trim() : (override.note ?? null),
        }
      : override,
  );
}

function applyGeometryDraftsToBranches(
  branches: EditorMapBranch[],
  drafts: GeometryDraft[],
): EditorMapBranch[] {
  return drafts.reduce(
    (current, draft) => applyGeometryDraftToBranches(current, draft),
    branches,
  );
}

function applyGeometryDraftsToLineBranchOverrides(
  overrides: ManualLineBranchOverride[],
  drafts: GeometryDraft[],
): ManualLineBranchOverride[] {
  return drafts.reduce(
    (current, draft) => applyGeometryDraftToLineBranchOverrides(current, draft),
    overrides,
  );
}

function buildGeometryEditPointFeatures(
  drafts: GeometryDraft[],
  visible: boolean,
): RailFeatureCollection {
  if (!visible || drafts.length < 1) return EMPTY_FEATURE_COLLECTION;

  return {
    type: "FeatureCollection",
    features: drafts.flatMap((draft) =>
      draft.points
        .map((point, index) => {
          if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat))
            return null;
          return {
            type: "Feature" as const,
            properties: {
              id: `${draft.targetType}:${draft.targetId}:geometry-point:${index}`,
              targetType: draft.targetType,
              targetId: draft.targetId,
              branchId: draft.branchId,
              pointIndex: index,
              kind: point.kind,
              draggable: true,
            },
            geometry: {
              type: "Point" as const,
              coordinates: [point.lng, point.lat] as LngLatTuple,
            },
          };
        })
        .filter(
          (feature): feature is NonNullable<typeof feature> => feature !== null,
        ),
    ),
  };
}

function distanceToSegmentSquared(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    const px = point.x - start.x;
    const py = point.y - start.y;
    return px * px + py * py;
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    ),
  );
  const projectedX = start.x + t * dx;
  const projectedY = start.y + t * dy;
  const px = point.x - projectedX;
  const py = point.y - projectedY;
  return px * px + py * py;
}

function nearestGeometrySegmentIndex(
  draft: GeometryDraft,
  map: MapLibreMap,
  point: { x: number; y: number },
) {
  if (draft.points.length < 2) return 0;

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < draft.points.length - 1; index += 1) {
    const startPoint = draft.points[index];
    const endPoint = draft.points[index + 1];
    if (!startPoint || !endPoint) continue;

    const start = map.project([startPoint.lng, startPoint.lat]);
    const end = map.project([endPoint.lng, endPoint.lat]);
    const distance = distanceToSegmentSquared(point, start, end);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function makeCommandRecord(
  label: string,
  before: ManualOverlayBundle,
  after: ManualOverlayBundle,
): OverlayCommandRecord {
  return {
    id: `command:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    label,
    before,
    after,
    createdAt: Date.now(),
  };
}

async function saveOverlays(nextOverlays: ManualOverlayBundle) {
  const response = await fetch("/api/manual-overlays", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nextOverlays),
  });

  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as ManualOverlayBundle;
}

export default function UnifiedMapEditor({
  data: initialData,
}: {
  data?: UnifiedEditorData;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const cursorFrameRef = useRef<number | null>(null);
  const pendingCursorLngLatRef = useRef<{ lng: number; lat: number } | null>(
    null,
  );
  const selectionBoxStartRef = useRef<{ x: number; y: number } | null>(null);
  const mapPointerDownPointRef = useRef<{ x: number; y: number } | null>(null);
  const geometryPointDragRef = useRef<GeometryPointDragState>(null);
  const selectStationFromMapRef = useRef<(stationId: string) => void>(
    () => undefined,
  );
  const selectMultipleStationsFromMapRef = useRef<(ids: string[]) => void>(
    () => undefined,
  );
  const selectBranchFromMapRef = useRef<(branchId: string) => void>(
    () => undefined,
  );
  const selectTransferGroupFromMapRef = useRef<(groupId: string) => void>(
    () => undefined,
  );
  const selectTransferGroupChildrenFromMapRef = useRef<(groupId: string) => void>(
    () => undefined,
  );
  const toolModeRef = useRef<ToolMode>("select");
  const geometryDraftRef = useRef<GeometryDraft | null>(null);
  const geometryDraftsByKeyRef = useRef<GeometryDraftMap>({});
  const geometryUndoStackRef = useRef<GeometryDraftHistoryRecord[]>([]);
  const geometryRedoStackRef = useRef<GeometryDraftHistoryRecord[]>([]);
  const geometryDragStartDraftRef = useRef<GeometryDraft | null>(null);
  const branchByIdRef = useRef<Map<string, EditorMapBranch>>(new Map());
  const stationByIdRef = useRef<Map<string, EditorStation>>(new Map());
  const overlaysRef = useRef<ManualOverlayBundle>(
    (initialData ?? EMPTY_UNIFIED_EDITOR_DATA).overlays,
  );
  const groupByIdRef = useRef<Map<string, ManualTransferGroup>>(new Map());
  const stationLocationPickModeRef = useRef(false);
  const showToastRef = useRef<(message: string, tone?: ToastTone) => void>(
    () => undefined,
  );
  const setStationDraftFromMapRef = useRef<(lng: number, lat: number) => void>(
    () => undefined,
  );
  const stationDraftRef = useRef<ManualStationOverride | null>(null);
  const undoStackRef = useRef<OverlayCommandRecord[]>([]);
  const redoStackRef = useRef<OverlayCommandRecord[]>([]);
  const [data, setData] = useState<UnifiedEditorData>(
    initialData ?? EMPTY_UNIFIED_EDITOR_DATA,
  );
  const [dataLoading, setDataLoading] = useState(!initialData);
  const [overlays, setOverlays] = useState(
    (initialData ?? EMPTY_UNIFIED_EDITOR_DATA).overlays,
  );
  const [selection, setSelection] = useState<Selection>({ type: "none" });
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("search");
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [query, setQuery] = useState("");
  const [geometryTargetQuery, setGeometryTargetQuery] = useState("");
  const [geometryTargetFilter, setGeometryTargetFilter] =
    useState<GeometryTargetFilter>("all");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [toast, setToast] = useState<{
    message: string | null;
    tone: ToastTone;
  }>({ message: null, tone: "info" });
  const [stationDraft, setStationDraft] =
    useState<ManualStationOverride | null>(null);
  const [selectionBox, setSelectionBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [layers, setLayers] = useState(defaultLayers);
  const [zoom, setZoom] = useState(7);
  const [cursorLngLat, setCursorLngLat] = useState<{
    lng: number;
    lat: number;
  } | null>(null);
  const [cursorPoint, setCursorPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [geometryHistoryVersion, setGeometryHistoryVersion] = useState(0);
  const [stationLocationPickMode, setStationLocationPickMode] = useState(false);
  const [transferDraft, setTransferDraft] = useState<TransferGroupDraft | null>(
    null,
  );
  const [geometryDraft, setGeometryDraft] = useState<GeometryDraft | null>(
    null,
  );
  const [geometryDraftsByKey, setGeometryDraftsByKey] =
    useState<GeometryDraftMap>({});
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [pendingTransferSelection, setPendingTransferSelection] =
    useState<PendingTransferSelection | null>(null);

  const geometryWorkspaceDrafts = useMemo(
    () => getGeometryDraftsFromMap(geometryDraftsByKey),
    [geometryDraftsByKey],
  );

  const stationById = useMemo(
    () => new Map(data.stations.map((station) => [station.id, station])),
    [data.stations],
  );
  const displayStations = useMemo(
    () =>
      toolMode === "geometry"
        ? applyGeometryDraftsStationPointsToStations(
            applyStationOverridesToStations(
              data.stations,
              overlays.stationOverrides,
            ),
            geometryWorkspaceDrafts,
          )
        : applyStationOverridesToStations(
            data.stations,
            overlays.stationOverrides,
          ),
    [
      data.stations,
      geometryWorkspaceDrafts,
      overlays.stationOverrides,
      toolMode,
    ],
  );
  const displayStationById = useMemo(
    () => new Map(displayStations.map((station) => [station.id, station])),
    [displayStations],
  );
  const branchById = useMemo(
    () => new Map(data.branches.map((branch) => [branch.id, branch])),
    [data.branches],
  );

  useEffect(() => {
    stationByIdRef.current = displayStationById;
  }, [displayStationById]);

  const displayBranches = useMemo(() => {
    const branchesWithStationOverrides = applyStationOverridesToBranches(
      data.branches,
      overlays.stationOverrides,
    );
    const branchesWithSavedGeometry = applySavedGeometryOverridesToBranches(
      branchesWithStationOverrides,
      overlays.geometryOverrides,
      displayStationById,
    );
    const branchesWithGeometryStationPreview =
      toolMode === "geometry"
        ? applyGeometryDraftsStationPointsToBranches(
            branchesWithSavedGeometry,
            geometryWorkspaceDrafts,
          )
        : branchesWithSavedGeometry;

    return toolMode === "geometry"
      ? applyGeometryDraftsToBranches(
          branchesWithGeometryStationPreview,
          geometryWorkspaceDrafts,
        )
      : branchesWithGeometryStationPreview;
  }, [
    data.branches,
    displayStationById,
    geometryWorkspaceDrafts,
    overlays.geometryOverrides,
    overlays.stationOverrides,
    toolMode,
  ]);
  const displayLineBranchOverrides = useMemo(
    () =>
      applyDisplayStationAnchorsToLineBranchOverrides(
        toolMode === "geometry"
          ? applyGeometryDraftsToLineBranchOverrides(
              overlays.lineBranchOverrides ?? [],
              geometryWorkspaceDrafts,
            )
          : (overlays.lineBranchOverrides ?? []),
        displayStationById,
      ),
    [
      displayStationById,
      geometryWorkspaceDrafts,
      overlays.lineBranchOverrides,
      toolMode,
    ],
  );
  const geometryEditPointFeatures = useMemo(
    () =>
      buildGeometryEditPointFeatures(
        geometryWorkspaceDrafts,
        toolMode === "geometry",
      ),
    [geometryWorkspaceDrafts, toolMode],
  );
  const lineBranchIssues = useMemo(
    () => [
      ...validateLineBranchOverrides(overlays, data.branches, stationById),
      ...validateBranchStationExclusions(overlays, data.branches, stationById),
      ...validateGeometryConsistency(
        displayBranches,
        displayLineBranchOverrides,
        overlays.geometryOverrides,
        overlays.lineBranchOverrides ?? [],
        displayStationById,
      ),
    ],
    [
      data.branches,
      displayBranches,
      displayLineBranchOverrides,
      displayStationById,
      overlays,
      stationById,
    ],
  );
  const geometryTargets = useMemo<GeometryEditTarget[]>(() => {
    const geometryOverrideByBranchId = new Map(
      overlays.geometryOverrides.map((override) => [
        override.branchId,
        override,
      ]),
    );
    const branchTargets: GeometryEditTarget[] = data.branches.map((branch) => {
      const savedGeometry = geometryOverrideByBranchId.get(branch.id);
      const savedPointCount = savedGeometry?.points.length ?? 0;
      return {
        type: "branch",
        id: branch.id,
        branchId: branch.id,
        title: branch.canonicalLineNameKo,
        subtitle: branch.sourceLineName,
        colorHex: branch.colorHex ?? "#64748b",
        meta: `${branch.routeStopCount.toLocaleString("ko-KR")} stops`,
        kind: "branch",
        hasSavedGeometry: savedPointCount >= 2,
        savedPointCount,
      };
    });

    const lineBranchTargets: GeometryEditTarget[] = (
      overlays.lineBranchOverrides ?? []
    )
      .filter((override) => override.enabled !== false)
      .map((override) => {
        const parentBranch = branchById.get(override.parentBranchId) ?? null;
        const display = getLineBranchDisplay(override, branchById, stationById);
        const savedPointCount = override.geometry?.length ?? 0;
        return {
          type: "lineBranch",
          id: override.id,
          branchId: override.parentBranchId,
          title: display.title,
          subtitle: display.summary,
          colorHex: parentBranch?.colorHex ?? "#0f766e",
          meta:
            override.mode === "add-station" ? "지선 역 추가" : "지선 노선 결합",
          kind: override.mode,
          hasSavedGeometry: savedPointCount >= 2,
          savedPointCount,
        };
      });

    return [...branchTargets, ...lineBranchTargets];
  }, [
    branchById,
    data.branches,
    overlays.geometryOverrides,
    overlays.lineBranchOverrides,
    displayStationById,
  ]);
  const filteredGeometryTargets = useMemo(() => {
    const normalizedQuery = normalizeSearchText(geometryTargetQuery);

    return geometryTargets.filter((target) => {
      if (
        geometryTargetFilter !== "all" &&
        target.kind !== geometryTargetFilter
      ) {
        return false;
      }

      if (!normalizedQuery) return true;

      return normalizeSearchText(
        `${target.title} ${target.subtitle} ${target.meta}`,
      ).includes(normalizedQuery);
    });
  }, [geometryTargetFilter, geometryTargetQuery, geometryTargets]);
  const groupById = useMemo(
    () =>
      new Map(overlays.manualTransferGroups.map((group) => [group.id, group])),
    [overlays.manualTransferGroups],
  );

  useEffect(() => {
    groupByIdRef.current = groupById;
  }, [groupById]);
  const selectedTransferGroupIds = useMemo(
    () => getSelectedTransferGroupIds(selection, overlays.manualTransferGroups),
    [overlays.manualTransferGroups, selection],
  );
  const selectedTransferGroupId =
    selection.type === "transferGroup" ? selection.id : null;
  const stationTransferGroupIndex = useMemo(
    () => buildStationTransferGroupIndex(overlays.manualTransferGroups),
    [overlays.manualTransferGroups],
  );
  const selectedStationIds = useMemo(() => {
    if (selection.type === "station") return new Set([selection.id]);
    if (selection.type === "multiStation") return new Set(selection.ids);
    if (selection.type === "transferGroup")
      return new Set(groupById.get(selection.id)?.stationIds ?? []);
    return new Set<string>();
  }, [groupById, selection]);
  const selectedBranchId = selection.type === "branch" ? selection.id : null;
  const nonTransferIds = useMemo(
    () => new Set(overlays.nonTransferStationIds),
    [overlays.nonTransferStationIds],
  );
  const unassignedStations = useMemo(
    () => getUnassignedStations(data.stations, data.branches),
    [data.branches, data.stations],
  );
  const filteredStations = useMemo(
    () => searchStations(data.stations, query, query.trim() ? 80 : 60),
    [data.stations, query],
  );

  const commandResults = useMemo(() => {
    const normalized = normalizeSearchText(commandQuery);
    const stations = searchStations(
      data.stations,
      commandQuery,
      normalized ? 12 : 8,
    ).map((station) => ({
      type: "station" as const,
      id: station.id,
      title: station.nameKo,
      subtitle: formatStationSubLabel(station),
    }));
    const branches = data.branches
      .filter(
        (branch) =>
          !normalized ||
          normalizeSearchText(
            `${branch.canonicalLineNameKo} ${branch.sourceLineName} ${branch.sourceLineNumber}`,
          ).includes(normalized),
      )
      .slice(0, 6)
      .map((branch) => ({
        type: "branch" as const,
        id: branch.id,
        title: branch.canonicalLineNameKo,
        subtitle: branch.sourceLineName,
      }));
    const groups = overlays.manualTransferGroups
      .filter(
        (group) =>
          !normalized || normalizeSearchText(group.nameKo).includes(normalized),
      )
      .slice(0, 6)
      .map((group) => ({
        type: "transferGroup" as const,
        id: group.id,
        title: group.nameKo,
        subtitle: `${group.stationIds.length}개 역`,
      }));
    return [...stations, ...branches, ...groups];
  }, [
    commandQuery,
    data.branches,
    data.stations,
    overlays.manualTransferGroups,
  ]);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast({ message: null, tone: "info" }), 1800);
  }, []);

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  useEffect(() => {
    stationLocationPickModeRef.current = stationLocationPickMode;
    const canvas = mapRef.current?.getCanvas();
    if (canvas)
      canvas.style.cursor = stationLocationPickMode ? "crosshair" : "grab";
  }, [stationLocationPickMode]);

  useEffect(() => {
    stationDraftRef.current = stationDraft;
  }, [stationDraft]);

  useEffect(() => {
    setStationDraftFromMapRef.current = (lng, lat) => {
      void saveSelectedStationLocationFromMap(lng, lat);
    };
  });

  const focusStation = useCallback(
    (stationId: string) => {
      const station = stationById.get(stationId);
      if (!station || !isValidStation(station)) return;
      mapRef.current?.flyTo({
        center: [station.lng, station.lat],
        zoom: Math.max(mapRef.current.getZoom(), 13),
        duration: 500,
      });
    },
    [stationById],
  );

  const applyStationSelection = useCallback(
    (stationId: string, shouldFocus = true) => {
      setSelection({ type: "station", id: stationId });
      const station = stationById.get(stationId);
      const previous = overlays.stationOverrides.find(
        (override) => override.stationId === stationId,
      );
      if (station) setStationDraft(emptyStationOverride(station, previous));
      setGeometryDraft(null);
      setStationLocationPickMode(false);
      if (shouldFocus) focusStation(stationId);
    },
    [focusStation, overlays.stationOverrides, stationById],
  );

  const applyMultiStationSelection = useCallback((ids: string[]) => {
    setSelection({ type: "multiStation", ids });
    setStationDraft(null);
    setGeometryDraft(null);
    setStationLocationPickMode(false);
  }, []);

  const selectStation = useCallback(
    (stationId: string, shouldFocus = true) => {
      if (transferDraft) {
        setPendingTransferSelection({
          type: "station",
          stationId,
          shouldFocus,
        });
        return;
      }
      applyStationSelection(stationId, shouldFocus);
      setTransferDraft(null);
    },
    [applyStationSelection, transferDraft],
  );

  const selectMultipleStations = useCallback(
    (ids: string[]) => {
      if (transferDraft) {
        setPendingTransferSelection({ type: "multiStation", ids });
        return;
      }
      applyMultiStationSelection(ids);
      setTransferDraft(null);
    },
    [applyMultiStationSelection, transferDraft],
  );

  function keepTransferDraftSelection() {
    setPendingTransferSelection(null);
    showToast("기존 환승 그룹 등록 상태를 유지했습니다", "info");
  }

  function applyPendingSelectionAfterTransferDraftCancel() {
    const pending = pendingTransferSelection;
    if (!pending) return;
    setPendingTransferSelection(null);
    setTransferDraft(null);
    setSidebarTab("search");
    if (pending.type === "station") {
      applyStationSelection(pending.stationId, pending.shouldFocus);
      return;
    }
    applyMultiStationSelection(pending.ids);
  }

  const selectBranch = useCallback(
    (branchId: string) => {
      setSelection({ type: "branch", id: branchId });
      setStationDraft(null);
      setTransferDraft(null);
      const branch = branchById.get(branchId);
      const previous = overlays.geometryOverrides.find(
        (override) => override.branchId === branchId,
      );
      setGeometryDraft(
        branch ? makeGeometryDraftFromBranch(branch, previous) : null,
      );
    },
    [branchById, overlays.geometryOverrides],
  );

  const selectGeometryTarget = useCallback(
    (target: GeometryEditTarget) => {
      setSelection({ type: "none" });
      setStationDraft(null);
      setTransferDraft(null);
      setStationLocationPickMode(false);
      geometryUndoStackRef.current = [];
      geometryRedoStackRef.current = [];
      geometryDragStartDraftRef.current = null;
      setGeometryHistoryVersion((value) => value + 1);

      if (target.type === "branch") {
        const branch = branchById.get(target.id);
        const previous = overlays.geometryOverrides.find(
          (override) => override.branchId === target.id,
        );
        setGeometryDraft(
          branch ? makeGeometryDraftFromBranch(branch, previous) : null,
        );
        return;
      }

      const override = (overlays.lineBranchOverrides ?? []).find(
        (candidate) => candidate.id === target.id,
      );
      setGeometryDraft(
        override
          ? makeGeometryDraftFromLineBranchOverride(override, stationById)
          : null,
      );
    },
    [
      branchById,
      overlays.geometryOverrides,
      overlays.lineBranchOverrides,
      stationById,
    ],
  );

  const selectTransferGroup = useCallback(
    (groupId: string) => {
      const group = groupById.get(groupId);
      setSelection({ type: "transferGroup", id: groupId });
      setStationDraft(null);
      setGeometryDraft(null);
      setTransferDraft(group ? makeTransferDraftFromGroup(group) : null);
      const firstStationId = group?.stationIds[0];
      if (firstStationId) focusStation(firstStationId);
    },
    [focusStation, groupById],
  );

  useEffect(() => {
    selectStationFromMapRef.current = (stationId) =>
      selectStation(stationId, false);
  }, [selectStation]);

  useEffect(() => {
    selectMultipleStationsFromMapRef.current = selectMultipleStations;
  }, [selectMultipleStations]);

  useEffect(() => {
    selectBranchFromMapRef.current = selectBranch;
  }, [selectBranch]);

  useEffect(() => {
    selectTransferGroupFromMapRef.current = selectTransferGroup;
  }, [selectTransferGroup]);

  useEffect(() => {
    selectTransferGroupChildrenFromMapRef.current = (groupId) => {
      const stationIds = getTransferGroupStationIds(groupId, groupById);
      if (stationIds.length === 1) {
        selectStation(stationIds[0] ?? "", false);
        return;
      }
      if (stationIds.length > 1) selectMultipleStations(stationIds);
    };
  }, [groupById, selectMultipleStations, selectStation]);

  useEffect(() => {
    toolModeRef.current = toolMode;
  }, [toolMode]);

  useEffect(() => {
    geometryDraftRef.current = geometryDraft;
    if (!geometryDraft) return;
    const key = getGeometryDraftTargetKey(geometryDraft);
    if (!key) return;
    setGeometryDraftsByKey((previous) => {
      const previousDraft = previous[key] ?? null;
      if (areGeometryDraftsEqual(previousDraft, geometryDraft)) return previous;
      return {
        ...previous,
        [key]: cloneGeometryDraft(geometryDraft) ?? geometryDraft,
      };
    });
  }, [geometryDraft]);

  useEffect(() => {
    geometryDraftsByKeyRef.current = geometryDraftsByKey;
  }, [geometryDraftsByKey]);

  function pushGeometryDraftHistory(
    before: GeometryDraft | null,
    after: GeometryDraft | null,
  ) {
    if (areGeometryDraftsEqual(before, after)) return;
    geometryUndoStackRef.current = [
      ...geometryUndoStackRef.current,
      { before: cloneGeometryDraft(before), after: cloneGeometryDraft(after) },
    ].slice(-80);
    geometryRedoStackRef.current = [];
    setGeometryHistoryVersion((value) => value + 1);
  }

  function clearGeometryDraftHistory() {
    geometryUndoStackRef.current = [];
    geometryRedoStackRef.current = [];
    geometryDragStartDraftRef.current = null;
    setGeometryHistoryVersion((value) => value + 1);
  }

  function undoGeometryDraftEdit() {
    const record = geometryUndoStackRef.current.at(-1);
    if (!record) return;
    geometryUndoStackRef.current = geometryUndoStackRef.current.slice(0, -1);
    geometryRedoStackRef.current = [
      ...geometryRedoStackRef.current,
      record,
    ].slice(-80);
    const nextDraft = cloneGeometryDraft(record.before);
    setGeometryDraft(nextDraft);
    const key = getGeometryDraftTargetKey(record.after ?? record.before);
    if (key) {
      setGeometryDraftsByKey((previous) => {
        const next = { ...previous };
        if (nextDraft) next[key] = nextDraft;
        else delete next[key];
        return next;
      });
    }
    setGeometryHistoryVersion((value) => value + 1);
  }

  function redoGeometryDraftEdit() {
    const record = geometryRedoStackRef.current.at(-1);
    if (!record) return;
    geometryRedoStackRef.current = geometryRedoStackRef.current.slice(0, -1);
    geometryUndoStackRef.current = [
      ...geometryUndoStackRef.current,
      record,
    ].slice(-80);
    const nextDraft = cloneGeometryDraft(record.after);
    setGeometryDraft(nextDraft);
    const key = getGeometryDraftTargetKey(record.after ?? record.before);
    if (key) {
      setGeometryDraftsByKey((previous) => {
        const next = { ...previous };
        if (nextDraft) next[key] = nextDraft;
        else delete next[key];
        return next;
      });
    }
    setGeometryHistoryVersion((value) => value + 1);
  }

  function getSavedGeometryDraftForDraft(draft: GeometryDraft | null) {
    if (!draft) return null;

    if (draft.targetType === "branch") {
      const branch = branchByIdRef.current.get(draft.branchId);
      const previous = overlaysRef.current.geometryOverrides.find(
        (override) => override.branchId === draft.branchId,
      );
      return branch ? makeGeometryDraftFromBranch(branch, previous) : null;
    }

    const override = (overlaysRef.current.lineBranchOverrides ?? []).find(
      (candidate) => candidate.id === draft.targetId,
    );
    return override
      ? makeGeometryDraftFromLineBranchOverride(
          override,
          stationByIdRef.current,
        )
      : null;
  }

  function resetGeometryWorkspaceToSaved() {
    setGeometryDraft(null);
    setGeometryDraftsByKey({});
    clearGeometryDraftHistory();
    showToastRef.current("선형 편집 변경을 되돌렸습니다", "info");
  }

  useEffect(() => {
    branchByIdRef.current = branchById;
  }, [branchById]);

  useEffect(() => {
    overlaysRef.current = overlays;
  }, [overlays]);

  useEffect(() => {
    if (toolMode !== "geometry") return;

    setSelection({ type: "none" });
    setStationDraft(null);
    setTransferDraft(null);
    setStationLocationPickMode(false);
    stationLocationPickModeRef.current = false;
    setContextMenu(null);
    setSidebarTab("search");
    if (toolMode !== "geometry") {
      setGeometryDraft(null);
      setGeometryDraftsByKey({});
    }
    clearGeometryDraftHistory();
  }, [toolMode]);

  useEffect(() => {
    if (initialData) return;

    let cancelled = false;

    async function loadEditorData() {
      try {
        const response = await fetch("/api/editor-data", { cache: "no-store" });
        if (!response.ok) throw new Error(await response.text());
        const nextData = (await response.json()) as UnifiedEditorData;
        if (cancelled) return;
        setData(nextData);
        setOverlays(nextData.overlays);
      } catch (error) {
        if (!cancelled)
          showToast(
            error instanceof Error ? error.message : "에디터 데이터 로드 실패",
            "error",
          );
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    }

    void loadEditorData();

    return () => {
      cancelled = true;
    };
  }, [initialData, showToast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isCommand = event.metaKey || event.ctrlKey;

      if (isCommand && key === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }

      if (toolModeRef.current === "geometry" && isCommand && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redoGeometryDraftEdit();
        else undoGeometryDraftEdit();
      }

      if (event.key === "Escape") {
        setContextMenu(null);
        setCommandOpen(false);
        setSelectionBox(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: baseMapStyle as unknown as StyleSpecification,
      center: [127.3, 36.35],
      zoom: 7,
      minZoom: 5,
      maxZoom: 18,
      maxBounds: KOREA_MAX_BOUNDS,
      attributionControl: false,
    });

    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: false }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-left",
    );

    map.on("load", () => {
      setMapLoaded(true);
      const resize = () => map.resize();
      window.requestAnimationFrame(resize);
      window.setTimeout(resize, 80);
      window.setTimeout(resize, 240);
      const center = map.getCenter();
      if (
        center.lng < KOREA_MAX_BOUNDS[0][0] ||
        center.lng > KOREA_MAX_BOUNDS[1][0] ||
        center.lat < KOREA_MAX_BOUNDS[0][1] ||
        center.lat > KOREA_MAX_BOUNDS[1][1]
      ) {
        map.jumpTo({ center: [127.3, 36.35], zoom: 7 });
      }

      const transferIconImage = new Image();
      transferIconImage.onload = () => {
        if (!map.hasImage("transfer-icon")) {
          map.addImage("transfer-icon", transferIconImage, { pixelRatio: 2 });
          map.triggerRepaint();
        }
      };
      transferIconImage.src = "/transfer.svg";

      map.addSource("railmap-branches", {
        type: "geojson",
        data: EMPTY_FEATURE_COLLECTION,
      });
      map.addSource("railmap-line-branches", {
        type: "geojson",
        data: EMPTY_FEATURE_COLLECTION,
      });
      map.addSource("railmap-transfer-group-areas", {
        type: "geojson",
        data: EMPTY_FEATURE_COLLECTION,
      });
      map.addSource("railmap-transfer-group-icons", {
        type: "geojson",
        data: EMPTY_FEATURE_COLLECTION,
      });
      map.addSource("railmap-stations", {
        type: "geojson",
        data: EMPTY_FEATURE_COLLECTION,
      });
      map.addSource("railmap-geometry-edit-points", {
        type: "geojson",
        data: EMPTY_FEATURE_COLLECTION,
      });

      map.addLayer({
        id: "railmap-branches-line",
        type: "line",
        source: "railmap-branches",
        paint: {
          "line-color": ["get", "colorHex"],
          "line-width": 3,
          "line-opacity": 0.72,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });

      map.addLayer({
        id: "railmap-selected-branches-line",
        type: "line",
        source: "railmap-branches",
        filter: ["==", ["get", "id"], "__none__"],
        paint: {
          "line-color": ["get", "colorHex"],
          "line-width": 7,
          "line-opacity": 0.95,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });

      map.addLayer({
        id: "railmap-geometry-points",
        type: "circle",
        source: "railmap-geometry-edit-points",
        paint: {
          "circle-color": [
            "case",
            ["==", ["get", "kind"], "station"],
            "#f59e0b",
            "#64748b",
          ],
          "circle-radius": [
            "case",
            ["==", ["get", "kind"], "station"],
            6.4,
            5.4,
          ],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "kind"], "station"],
            "#111827",
            "#ffffff",
          ],
          "circle-stroke-width": [
            "case",
            ["==", ["get", "kind"], "station"],
            2.4,
            2,
          ],
          "circle-opacity": 0.98,
        },
      });

      map.addLayer({
        id: "railmap-geometry-points-hit",
        type: "circle",
        source: "railmap-geometry-edit-points",
        paint: {
          "circle-color": "rgba(0,0,0,0)",
          "circle-radius": 13,
          "circle-opacity": 0,
          "circle-stroke-width": 0,
        },
      });

      map.addLayer({
        id: "railmap-line-branches-casing",
        type: "line",
        source: "railmap-line-branches",
        paint: {
          "line-color": "#ffffff",
          "line-width": 4.8,
          "line-opacity": 0.88,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });

      map.addLayer({
        id: "railmap-line-branches-line",
        type: "line",
        source: "railmap-line-branches",
        paint: {
          "line-color": ["get", "colorHex"],
          "line-width": 3,
          "line-opacity": 0.78,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });

      map.addLayer({
        id: "railmap-transfer-group-area-fill",
        type: "fill",
        source: "railmap-transfer-group-areas",
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "selected"], true],
            "#2563eb",
            "#0f172a",
          ],
          "fill-opacity": [
            "step",
            ["zoom"],
            0,
            TRANSFER_DETAIL_ZOOM_THRESHOLD,
            [
              "case",
              ["==", ["get", "selected"], true],
              0.34,
              0.22,
            ],
          ],
        },
      });

      map.addLayer({
        id: "railmap-transfer-group-area-outline",
        type: "line",
        source: "railmap-transfer-group-areas",
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "selected"], true],
            "#2563eb",
            "#64748b",
          ],
          "line-width": [
            "step",
            ["zoom"],
            0,
            TRANSFER_DETAIL_ZOOM_THRESHOLD,
            ["case", ["==", ["get", "selected"], true], 3.4, 2.2],
          ],
          "line-opacity": [
            "step",
            ["zoom"],
            0,
            TRANSFER_DETAIL_ZOOM_THRESHOLD,
            0.9,
          ],
        },
      });

      map.addLayer({
        id: "railmap-transfer-group-hit",
        type: "circle",
        source: "railmap-transfer-group-icons",
        paint: {
          "circle-radius": [
            "step",
            ["zoom"],
            22,
            TRANSFER_DETAIL_ZOOM_THRESHOLD,
            0,
          ],
          "circle-color": "rgba(0,0,0,0)",
          "circle-opacity": 0,
          "circle-stroke-opacity": 0,
        },
      });

      map.addLayer({
        id: "railmap-transfer-group-casing",
        type: "circle",
        source: "railmap-transfer-group-icons",
        paint: {
          "circle-color": "rgba(255,255,255,0)",
          "circle-radius": 0,
          "circle-stroke-width": 0,
          "circle-opacity": 0,
          "circle-stroke-opacity": 0,
        },
      });

      map.addLayer({
        id: "railmap-transfer-group-icon",
        type: "symbol",
        source: "railmap-transfer-group-icons",
        layout: {
          "icon-image": "transfer-icon",
          "icon-size": [
            "case",
            ["==", ["get", "selected"], true],
            0.038,
            0.034,
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-opacity": [
            "step",
            ["zoom"],
            1,
            TRANSFER_DETAIL_ZOOM_THRESHOLD,
            0,
          ],
        },
      });

      map.addLayer({
        id: "railmap-transfer-group-label",
        type: "symbol",
        source: "railmap-transfer-group-icons",
        minzoom: 11,
        layout: {
          "text-field": ["get", "nameKo"],
          "text-size": 11,
          "text-font": ["Open Sans Regular"],
          "text-offset": [0, 1.45],
          "text-anchor": "top",
          "text-allow-overlap": false,
          "text-ignore-placement": false,
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": [
            "step",
            ["zoom"],
            1.5,
            TRANSFER_DETAIL_ZOOM_THRESHOLD,
            0,
          ],
          "text-opacity": [
            "step",
            ["zoom"],
            1,
            TRANSFER_DETAIL_ZOOM_THRESHOLD,
            0,
          ],
        },
      });

      map.addLayer({
        id: "railmap-stations-circle",
        type: "circle",
        source: "railmap-stations",
        paint: {
          "circle-color": ["get", "colorHex"],
          "circle-radius": [
            "step",
            ["zoom"],
            [
              "case",
              ["==", ["get", "isTransferChild"], true],
              0,
              ["case", ["boolean", ["get", "selected"], false], 7, 4.5],
            ],
            TRANSFER_DETAIL_ZOOM_THRESHOLD,
            ["case", ["boolean", ["get", "selected"], false], 7, 4.5],
          ],
          "circle-stroke-color": [
            "case",
            ["boolean", ["get", "selected"], false],
            "#111827",
            "#ffffff",
          ],
          "circle-stroke-width": [
            "case",
            ["boolean", ["get", "selected"], false],
            3,
            1.5,
          ],
          "circle-stroke-opacity": [
            "step",
            ["zoom"],
            ["case", ["==", ["get", "isTransferChild"], true], 0, 1],
            TRANSFER_DETAIL_ZOOM_THRESHOLD,
            1,
          ],
          "circle-opacity": [
            "step",
            ["zoom"],
            ["case", ["==", ["get", "isTransferChild"], true], 0, 0.96],
            TRANSFER_DETAIL_ZOOM_THRESHOLD,
            0.96,
          ],
        },
      });

      map.addLayer({
        id: "railmap-stations-hit",
        type: "circle",
        source: "railmap-stations",
        paint: {
          "circle-radius": [
            "step",
            ["zoom"],
            ["case", ["==", ["get", "isTransferChild"], true], 0, 12],
            TRANSFER_DETAIL_ZOOM_THRESHOLD,
            12,
          ],
          "circle-color": "rgba(0,0,0,0)",
          "circle-opacity": 0,
          "circle-stroke-width": 0,
        },
      });

      map.addLayer({
        id: "railmap-non-transfer-x",
        type: "symbol",
        source: "railmap-stations",
        filter: ["==", ["get", "nonTransfer"], true],
        layout: {
          "text-field": "×",
          "text-size": 12,
          "text-font": ["Open Sans Regular"],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#0f172a",
          "text-halo-width": 0.7,
          "text-opacity": [
            "step",
            ["zoom"],
            ["case", ["==", ["get", "isTransferChild"], true], 0, 1],
            TRANSFER_DETAIL_ZOOM_THRESHOLD,
            1,
          ],
        },
      });

      map.addLayer({
        id: "railmap-stations-label",
        type: "symbol",
        source: "railmap-stations",
        minzoom: 11,
        filter: ["!=", ["get", "selected"], true],
        layout: {
          "text-field": ["get", "labelNameKo"],
          "text-size": 12,
          "text-font": ["Open Sans Regular"],
          "text-offset": [0, 1.05],
          "text-anchor": "top",
          "text-allow-overlap": false,
          "text-ignore-placement": false,
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
          "text-opacity": [
            "step",
            ["zoom"],
            ["case", ["==", ["get", "isTransferChild"], true], 0, 0.92],
            TRANSFER_DETAIL_ZOOM_THRESHOLD,
            0.92,
          ],
        },
      });

      map.addLayer({
        id: "railmap-selected-stations-label",
        type: "symbol",
        source: "railmap-stations",
        minzoom: 11,
        filter: ["==", ["get", "selected"], true],
        layout: {
          "text-field": ["get", "labelNameKo"],
          "text-size": 13,
          "text-font": ["Open Sans Regular"],
          "text-offset": [0, -1.2],
          "text-anchor": "bottom",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#111827",
          "text-halo-color": "#ffffff",
          "text-halo-width": 2,
          "text-opacity": [
            "step",
            ["zoom"],
            ["case", ["==", ["get", "isTransferChild"], true], 0, 1],
            TRANSFER_DETAIL_ZOOM_THRESHOLD,
            1,
          ],
        },
      });

      for (const layerId of [
        "railmap-transfer-group-hit",
        "railmap-transfer-group-casing",
        "railmap-transfer-group-icon",
        "railmap-transfer-group-label",
      ]) {
        if (map.getLayer(layerId)) map.moveLayer(layerId);
      }

      for (const layerId of [
        "railmap-geometry-points",
        "railmap-geometry-points-hit",
      ]) {
        if (map.getLayer(layerId)) map.moveLayer(layerId);
      }

      window.requestAnimationFrame(() => setMapLoaded(true));
    });

    const isClickAfterDrag = (point: { x: number; y: number }) => {
      const start = mapPointerDownPointRef.current;
      if (!start) return false;
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      return Math.sqrt(dx * dx + dy * dy) > 4;
    };

    const clearMapSelection = () => {
      setSelection({ type: "none" });
      setStationDraft(null);
      setTransferDraft(null);
      setGeometryDraft(null);
      setStationLocationPickMode(false);
      stationLocationPickModeRef.current = false;
      setContextMenu(null);
    };

    const beginGeometryPointDrag = (
      targetType: GeometryTargetType,
      targetId: string,
      pointIndex: number,
      historyBefore?: GeometryDraft | null,
    ) => {
      geometryDragStartDraftRef.current = cloneGeometryDraft(
        historyBefore ?? geometryDraftRef.current,
      );
      geometryPointDragRef.current = { targetType, targetId, pointIndex };
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grabbing";

      const point = (historyBefore ?? geometryDraftRef.current)?.points[
        pointIndex
      ];
      if (point?.kind === "station") {
        showToastRef.current(
          "역 위치 anchor를 이동합니다. 저장하면 역 위치가 변경됩니다.",
          "info",
        );
      }
    };

    const handleGeometryMouseDown = (event: maplibregl.MapMouseEvent) => {
      const original = event.originalEvent as MouseEvent;
      const pointFeatures = map.queryRenderedFeatures(event.point, {
        layers: [
          "railmap-geometry-points-hit",
          "railmap-geometry-points",
        ].filter((layerId) => map.getLayer(layerId)),
      });
      const pointFeature = pointFeatures.find((feature) => {
        const index = Number(feature.properties?.pointIndex);
        return Number.isInteger(index);
      });

      if (pointFeature) {
        const targetType = String(
          pointFeature.properties?.targetType ?? "",
        ) as GeometryTargetType;
        const targetId = String(pointFeature.properties?.targetId ?? "");
        const pointIndex = Number(pointFeature.properties?.pointIndex);

        if (
          (targetType !== "branch" && targetType !== "lineBranch") ||
          !targetId ||
          !Number.isInteger(pointIndex)
        )
          return;

        original.preventDefault();
        event.preventDefault();

        if (original.ctrlKey || original.metaKey) {
          const targetKey = getGeometryTargetKey(targetType, targetId);
          const before = cloneGeometryDraft(
            geometryDraftsByKeyRef.current[targetKey] ??
              geometryDraftRef.current,
          );
          if (
            !before ||
            before.targetType !== targetType ||
            before.targetId !== targetId
          )
            return;
          const target = before.points[pointIndex];
          if (!target) return;
          if (target.kind === "station") {
            showToastRef.current(
              "역 anchor는 삭제할 수 없습니다. 위치 변경은 드래그로만 처리됩니다.",
              "info",
            );
            return;
          }
          if (before.points.length <= 2) return;

          const after: GeometryDraft = {
            ...before,
            points: before.points.filter((_, index) => index !== pointIndex),
          };
          setGeometryDraft(after);
          setGeometryDraftsByKey((previous) => ({
            ...previous,
            [targetKey]: after,
          }));
          pushGeometryDraftHistory(before, after);
          showToastRef.current("선형 정점을 제거했습니다", "success");
          return;
        }

        beginGeometryPointDrag(
          targetType,
          targetId,
          pointIndex,
          geometryDraftsByKeyRef.current[
            getGeometryTargetKey(targetType, targetId)
          ] ?? geometryDraftRef.current,
        );
        return;
      }

      const stationFeatures = map.queryRenderedFeatures(event.point, {
        layers: ["railmap-stations-hit", "railmap-stations-circle"].filter(
          (layerId) => map.getLayer(layerId),
        ),
      });
      if (stationFeatures.length > 0) return;

      const lineBranchFeatures = map.queryRenderedFeatures(event.point, {
        layers: [
          "railmap-line-branches-line",
          "railmap-line-branches-casing",
        ].filter((layerId) => map.getLayer(layerId)),
      });
      const lineBranchId = firstFeatureId(lineBranchFeatures, [
        "railmap-line-branches-line",
        "railmap-line-branches-casing",
      ]);

      const branchFeatures = lineBranchId
        ? []
        : map.queryRenderedFeatures(event.point, {
            layers: [
              "railmap-selected-branches-line",
              "railmap-branches-line",
            ].filter((layerId) => map.getLayer(layerId)),
          });
      const branchId = lineBranchId
        ? undefined
        : firstFeatureId(branchFeatures, [
            "railmap-selected-branches-line",
            "railmap-branches-line",
          ]);

      let baseDraft: GeometryDraft | null = null;
      if (lineBranchId) {
        const override = overlaysRef.current.lineBranchOverrides.find(
          (candidate) => candidate.id === lineBranchId,
        );
        baseDraft = override
          ? makeGeometryDraftFromLineBranchOverride(
              override,
              stationByIdRef.current,
            )
          : null;
      } else if (branchId) {
        const branch = branchByIdRef.current.get(branchId);
        baseDraft = branch
          ? makeGeometryDraftFromBranch(
              branch,
              overlaysRef.current.geometryOverrides.find(
                (override) => override.branchId === branchId,
              ),
            )
          : null;
      }

      if (!baseDraft) return;

      original.preventDefault();
      event.preventDefault();

      const baseTargetKey = getGeometryDraftTargetKey(baseDraft);
      const existingDraft = baseTargetKey
        ? (geometryDraftsByKeyRef.current[baseTargetKey] ??
          geometryDraftRef.current)
        : geometryDraftRef.current;
      const existingTargetKey = getGeometryDraftTargetKey(existingDraft);
      if (existingDraft && existingTargetKey === baseTargetKey)
        baseDraft = existingDraft;

      const insertAfterIndex = nearestGeometrySegmentIndex(
        baseDraft,
        map,
        event.point,
      );
      const insertIndex = insertAfterIndex + 1;
      const nextDraft: GeometryDraft = {
        ...baseDraft,
        points: [
          ...baseDraft.points.slice(0, insertIndex),
          {
            lng: event.lngLat.lng,
            lat: event.lngLat.lat,
            kind: "control" as const,
          },
          ...baseDraft.points.slice(insertIndex),
        ],
      };

      setGeometryDraft(nextDraft);
      if (baseTargetKey) {
        setGeometryDraftsByKey((previous) => ({
          ...previous,
          [baseTargetKey]: nextDraft,
        }));
      }
      setSidebarTab("search");
      beginGeometryPointDrag(
        nextDraft.targetType,
        nextDraft.targetId,
        insertIndex,
        baseDraft,
      );
    };

    map.on("mousemove", (event) => {
      pendingCursorLngLatRef.current = {
        lng: event.lngLat.lng,
        lat: event.lngLat.lat,
      };
      setCursorPoint({ x: event.point.x, y: event.point.y });

      const geometryDrag = geometryPointDragRef.current;
      if (geometryDrag) {
        const targetKey = getGeometryTargetKey(
          geometryDrag.targetType,
          geometryDrag.targetId,
        );
        const currentDraft =
          geometryDraftsByKeyRef.current[targetKey] ?? geometryDraftRef.current;
        if (
          currentDraft &&
          currentDraft.targetType === geometryDrag.targetType &&
          currentDraft.targetId === geometryDrag.targetId
        ) {
          const target = currentDraft.points[geometryDrag.pointIndex];
          if (target) {
            const nextDraft: GeometryDraft = {
              ...currentDraft,
              points: currentDraft.points.map((point, index) =>
                index === geometryDrag.pointIndex
                  ? { ...point, lng: event.lngLat.lng, lat: event.lngLat.lat }
                  : point,
              ),
            };
            setGeometryDraft(nextDraft);
            setGeometryDraftsByKey((previous) => ({
              ...previous,
              [targetKey]: nextDraft,
            }));
          }
        }
        map.getCanvas().style.cursor = "grabbing";
      } else if (stationLocationPickModeRef.current) {
        map.getCanvas().style.cursor = "crosshair";
      } else if (!selectionBoxStartRef.current) {
        const queryLayers =
          toolModeRef.current === "geometry"
            ? [
                "railmap-geometry-points-hit",
                "railmap-geometry-points",
                "railmap-line-branches-line",
                "railmap-line-branches-casing",
                "railmap-branches-line",
              ].filter((layerId) => map.getLayer(layerId))
            : [
                "railmap-transfer-group-hit",
                ...(isCollapsedTransferZoom(map.getZoom())
                  ? []
                  : ["railmap-transfer-group-area-fill"]),
                ...(isCollapsedTransferZoom(map.getZoom())
                  ? []
                  : ["railmap-stations-hit", "railmap-stations-circle"]),
                "railmap-selected-branches-line",
                "railmap-branches-line",
              ].filter((layerId) => map.getLayer(layerId));
        const features =
          queryLayers.length > 0
            ? map.queryRenderedFeatures(event.point, { layers: queryLayers })
            : [];

        if (toolModeRef.current === "geometry") {
          const hasGeometryPoint = Boolean(
            firstFeatureId(features, [
              "railmap-geometry-points-hit",
              "railmap-geometry-points",
            ]),
          );
          const hasBranch = Boolean(
            firstFeatureId(features, [
              "railmap-line-branches-line",
              "railmap-line-branches-casing",
              "railmap-branches-line",
            ]),
          );
          map.getCanvas().style.cursor = hasGeometryPoint
            ? "grab"
            : hasBranch
              ? "crosshair"
              : "grab";
        } else {
          const hasTransferGroup = Boolean(
            firstFeatureId(features, [
              "railmap-transfer-group-hit",
              "railmap-transfer-group-area-fill",
            ]),
          );
          const hasStation = Boolean(
            firstFeatureId(features, [
              "railmap-stations-hit",
              "railmap-stations-circle",
            ]),
          );
          const hasBranch = Boolean(
            firstFeatureId(features, [
              "railmap-selected-branches-line",
              "railmap-branches-line",
            ]),
          );
          map.getCanvas().style.cursor =
            hasTransferGroup || hasStation
              ? "pointer"
              : hasBranch
                ? "crosshair"
                : "grab";
        }
      }

      if (cursorFrameRef.current !== null) return;
      cursorFrameRef.current = window.requestAnimationFrame(() => {
        cursorFrameRef.current = null;
        if (pendingCursorLngLatRef.current)
          setCursorLngLat(pendingCursorLngLatRef.current);
      });
    });
    map.on("zoomend", () => setZoom(map.getZoom()));

    map.on("click", (event) => {
      if (isClickAfterDrag(event.point)) return;
      if (toolModeRef.current === "geometry") return;

      if (stationLocationPickModeRef.current) {
        const original = event.originalEvent as MouseEvent;
        if (original.shiftKey) return;
        setStationDraftFromMapRef.current(event.lngLat.lng, event.lngLat.lat);
        stationLocationPickModeRef.current = false;
        setStationLocationPickMode(false);
        showToastRef.current("역 위치를 즉시 저장했습니다", "success");
        return;
      }

      const collapsedTransferZoom = isCollapsedTransferZoom(map.getZoom());
      const queryLayers = [
        ...(collapsedTransferZoom
          ? ["railmap-transfer-group-hit"]
          : [
              "railmap-stations-hit",
              "railmap-stations-circle",
              "railmap-transfer-group-area-fill",
            ]),
        "railmap-selected-branches-line",
        "railmap-branches-line",
      ].filter((layerId) => map.getLayer(layerId));
      const features =
        queryLayers.length > 0
          ? map.queryRenderedFeatures(event.point, { layers: queryLayers })
          : [];

      if (collapsedTransferZoom) {
        const transferGroupId = firstFeatureId(features, [
          "railmap-transfer-group-hit",
        ]);
        if (transferGroupId) {
          selectTransferGroupChildrenFromMapRef.current(transferGroupId);
          return;
        }
      } else {
        const stationId = firstVisibleStationFeatureId(
          features,
          ["railmap-stations-hit", "railmap-stations-circle"],
          map.getZoom(),
        );
        if (stationId) {
          selectStationFromMapRef.current(stationId);
          return;
        }

        const transferGroupId = firstFeatureId(features, [
          "railmap-transfer-group-area-fill",
        ]);
        if (transferGroupId) {
          selectTransferGroupFromMapRef.current(transferGroupId);
          return;
        }
      }

      const branchId = firstFeatureId(features, [
        "railmap-selected-branches-line",
        "railmap-branches-line",
      ]);
      if (branchId) {
        selectBranchFromMapRef.current(branchId);
        return;
      }

      clearMapSelection();
    });

    map.on("contextmenu", (event) => {
      event.preventDefault();
      if (toolModeRef.current === "geometry") return;
      const collapsedTransferZoom = isCollapsedTransferZoom(map.getZoom());
      const queryLayers = [
        ...(collapsedTransferZoom
          ? ["railmap-transfer-group-hit"]
          : [
              "railmap-transfer-group-area-fill",
              "railmap-stations-hit",
              "railmap-stations-circle",
            ]),
        "railmap-selected-branches-line",
        "railmap-branches-line",
      ].filter((layerId) => map.getLayer(layerId));
      const features =
        queryLayers.length > 0
          ? map.queryRenderedFeatures(event.point, { layers: queryLayers })
          : [];
      setContextMenu({
        x: event.point.x,
        y: event.point.y,
        stationId: collapsedTransferZoom
          ? undefined
          : firstVisibleStationFeatureId(
              features,
              ["railmap-stations-hit", "railmap-stations-circle"],
              map.getZoom(),
            ),
        branchId: firstFeatureId(features, [
          "railmap-selected-branches-line",
          "railmap-branches-line",
        ]),
      });
    });

    map.on("mousedown", (event) => {
      mapPointerDownPointRef.current = { x: event.point.x, y: event.point.y };
      if (toolModeRef.current === "geometry") {
        handleGeometryMouseDown(event);
        return;
      }
      const original = event.originalEvent as MouseEvent;
      if (
        !(original.metaKey || original.ctrlKey) &&
        toolModeRef.current !== "box"
      )
        return;
      original.preventDefault();
      map.getCanvas().style.cursor = "crosshair";
      map.dragPan.disable();
      selectionBoxStartRef.current = { x: event.point.x, y: event.point.y };
      setSelectionBox({
        left: event.point.x,
        top: event.point.y,
        width: 0,
        height: 0,
      });
    });

    map.on("mousemove", (event) => {
      const start = selectionBoxStartRef.current;
      if (!start) return;
      const left = Math.min(start.x, event.point.x);
      const top = Math.min(start.y, event.point.y);
      setSelectionBox({
        left,
        top,
        width: Math.abs(event.point.x - start.x),
        height: Math.abs(event.point.y - start.y),
      });
    });

    map.on("mouseup", (event) => {
      if (geometryPointDragRef.current) {
        const geometryDrag = geometryPointDragRef.current;
        const targetKey = getGeometryTargetKey(
          geometryDrag.targetType,
          geometryDrag.targetId,
        );
        const before = cloneGeometryDraft(geometryDragStartDraftRef.current);
        const after = cloneGeometryDraft(
          geometryDraftsByKeyRef.current[targetKey] ?? geometryDraftRef.current,
        );
        geometryPointDragRef.current = null;
        geometryDragStartDraftRef.current = null;
        pushGeometryDraftHistory(before, after);
        map.dragPan.enable();
        map.getCanvas().style.cursor =
          toolModeRef.current === "geometry" ? "grab" : "grab";
        return;
      }

      const start = selectionBoxStartRef.current;
      if (!start) return;
      const box = [
        [Math.min(start.x, event.point.x), Math.min(start.y, event.point.y)],
        [Math.max(start.x, event.point.x), Math.max(start.y, event.point.y)],
      ] as [[number, number], [number, number]];
      const collapsedTransferZoom = isCollapsedTransferZoom(map.getZoom());
      const rangeLayers = (collapsedTransferZoom
        ? ["railmap-transfer-group-hit"]
        : ["railmap-stations-hit", "railmap-stations-circle"]
      ).filter((layerId) => map.getLayer(layerId));
      const rangeFeatures =
        rangeLayers.length > 0
          ? map.queryRenderedFeatures(box, { layers: rangeLayers })
          : [];
      const selected = collapsedTransferZoom
        ? rangeFeatures.flatMap((feature) => {
            const groupId = featureStringProperty(feature, "id");
            return groupId
              ? getTransferGroupStationIds(groupId, groupByIdRef.current)
              : [];
          })
        : visibleStationFeatureIds(
            rangeFeatures,
            ["railmap-stations-hit", "railmap-stations-circle"],
            map.getZoom(),
          );
      const ids = [...new Set(selected)];
      if (ids.length === 1) selectStationFromMapRef.current(ids[0] ?? "");
      if (ids.length > 1) selectMultipleStationsFromMapRef.current(ids);
      selectionBoxStartRef.current = null;
      setSelectionBox(null);
      map.dragPan.enable();
      map.getCanvas().style.cursor = "grab";
    });

    return () => {
      if (cursorFrameRef.current !== null)
        window.cancelAnimationFrame(cursorFrameRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mapLoaded || dataLoading) return;

    let cancelled = false;
    const idleId = scheduleIdle(() => {
      void (async () => {
        const features = await buildStationFeaturesChunked(
          displayStations,
          selectedStationIds,
          nonTransferIds,
          stationTransferGroupIndex,
          layers.stations,
          layers.nonTransfer,
          () => cancelled,
        );
        if (cancelled || !features) return;
        const source = mapRef.current?.getSource("railmap-stations") as
          GeoJSONSource | undefined;
        source?.setData(features);
      })();
    });

    return () => {
      cancelled = true;
      cancelIdle(idleId);
    };
  }, [
    dataLoading,
    displayStations,
    layers.nonTransfer,
    layers.stations,
    mapLoaded,
    nonTransferIds,
    selectedStationIds,
    stationTransferGroupIndex,
  ]);

  useEffect(() => {
    if (!mapLoaded || dataLoading) return;

    let cancelled = false;
    const idleId = scheduleIdle(() => {
      void (async () => {
        const features = await buildBranchFeaturesChunked(
          displayBranches,
          layers.lines,
          () => cancelled,
        );
        if (cancelled || !features) return;
        const source = mapRef.current?.getSource("railmap-branches") as
          GeoJSONSource | undefined;
        source?.setData(features);
      })();
    });

    return () => {
      cancelled = true;
      cancelIdle(idleId);
    };
  }, [dataLoading, displayBranches, layers.lines, mapLoaded]);

  useEffect(() => {
    if (!mapLoaded || dataLoading) return;

    const source = mapRef.current?.getSource("railmap-geometry-edit-points") as
      GeoJSONSource | undefined;
    source?.setData(geometryEditPointFeatures);
  }, [dataLoading, geometryEditPointFeatures, mapLoaded]);

  useEffect(() => {
    if (!mapLoaded || dataLoading) return;

    let cancelled = false;
    const idleId = scheduleIdle(() => {
      void (async () => {
        const features = await buildLineBranchFeaturesChunked(
          displayLineBranchOverrides,
          branchById,
          displayStationById,
          layers.lines,
          () => cancelled,
        );
        if (cancelled || !features) return;
        const source = mapRef.current?.getSource("railmap-line-branches") as
          GeoJSONSource | undefined;
        source?.setData(features);
      })();
    });

    return () => {
      cancelled = true;
      cancelIdle(idleId);
    };
  }, [
    branchById,
    dataLoading,
    layers.lines,
    mapLoaded,
    displayLineBranchOverrides,
    displayStationById,
  ]);

  useEffect(() => {
    if (!mapLoaded || dataLoading) return;

    let cancelled = false;
    const idleId = scheduleIdle(() => {
      void (async () => {
        const [areaFeatures, iconFeatures] = await Promise.all([
          buildTransferGroupAreaFeaturesChunked(
            overlays.manualTransferGroups,
            displayStationById,
            selectedTransferGroupIds,
            () => cancelled,
          ),
          buildTransferGroupIconFeaturesChunked(
            overlays.manualTransferGroups,
            displayStationById,
            selectedTransferGroupIds,
            () => cancelled,
          ),
        ]);
        if (cancelled || !areaFeatures || !iconFeatures) return;
        const areaSource = mapRef.current?.getSource(
          "railmap-transfer-group-areas",
        ) as GeoJSONSource | undefined;
        const iconSource = mapRef.current?.getSource(
          "railmap-transfer-group-icons",
        ) as GeoJSONSource | undefined;
        areaSource?.setData(areaFeatures);
        iconSource?.setData(iconFeatures);
      })();
    });

    return () => {
      cancelled = true;
      cancelIdle(idleId);
    };
  }, [
    dataLoading,
    mapLoaded,
    overlays.manualTransferGroups,
    selectedTransferGroupIds,
    displayStationById,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map?.getLayer("railmap-selected-branches-line")) return;
    map.setFilter("railmap-selected-branches-line", [
      "==",
      ["get", "id"],
      selectedBranchId ?? "__none__",
    ]);
  }, [mapLoaded, selectedBranchId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visibility = layers.labels ? "visible" : "none";
    if (map.getLayer("railmap-stations-label"))
      map.setLayoutProperty("railmap-stations-label", "visibility", visibility);
    if (map.getLayer("railmap-selected-stations-label"))
      map.setLayoutProperty(
        "railmap-selected-stations-label",
        "visibility",
        visibility,
      );
  }, [layers.labels]);

  async function persist(next: ManualOverlayBundle, message: string) {
    try {
      const saved = await saveOverlays(next);
      setOverlays(saved);
      showToast(message, "success");
      return saved;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "저장 실패", "error");
      return null;
    }
  }

  async function executeOverlayCommand(
    label: string,
    next: ManualOverlayBundle,
    message: string,
  ) {
    const command = makeCommandRecord(label, overlays, next);
    undoStackRef.current = [...undoStackRef.current, command].slice(-80);
    redoStackRef.current = [];
    setHistoryVersion((value) => value + 1);
    return await persist(next, message);
  }

  async function undoOverlayCommand() {
    const command = undoStackRef.current.at(-1);
    if (!command) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, command].slice(-80);
    setHistoryVersion((value) => value + 1);
    await persist(command.before, `되돌림: ${command.label}`);
  }

  async function redoOverlayCommand() {
    const command = redoStackRef.current.at(-1);
    if (!command) return;
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, command].slice(-80);
    setHistoryVersion((value) => value + 1);
    await persist(command.after, `다시 실행: ${command.label}`);
  }

  async function reloadEditorData() {
    try {
      const response = await fetch("/api/editor-data", { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      const nextData = (await response.json()) as UnifiedEditorData;
      setData(nextData);
      setOverlays(nextData.overlays);
      return nextData;
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "에디터 데이터 갱신 실패",
        "error",
      );
      return null;
    }
  }

  async function saveStationOverrideAndSyncAnchors(
    nextOverride: ManualStationOverride,
    label: string,
    message: string,
  ) {
    const baseOverlays = overlaysRef.current;
    const next: ManualOverlayBundle = {
      ...baseOverlays,
      stationOverrides: [
        ...baseOverlays.stationOverrides.filter(
          (override) => override.stationId !== nextOverride.stationId,
        ),
        nextOverride,
      ],
    };

    const saved = await executeOverlayCommand(label, next, message);
    if (!saved) return null;

    let nextData = await reloadEditorData();
    if (!nextData) return null;

    const nextStationById = new Map(
      nextData.stations.map((station) => [station.id, station]),
    );
    const syncResult = syncSavedGeometryAnchorsForStation(
      nextData.overlays,
      nextOverride.stationId,
      nextStationById,
    );

    if (syncResult.changedCount > 0) {
      const synced = await persist(
        syncResult.overlays,
        `저장 선형 anchor ${syncResult.changedCount}개를 현재 역 위치로 맞췄습니다`,
      );
      if (synced) {
        nextData = await reloadEditorData();
      }
    }

    const nextStation = nextData?.stations.find(
      (station) => station.id === nextOverride.stationId,
    );
    if (nextStation) {
      const nextStationOverride = nextData?.overlays.stationOverrides.find(
        (override) => override.stationId === nextStation.id,
      );
      setStationDraft(emptyStationOverride(nextStation, nextStationOverride));
    }

    return nextData;
  }

  async function saveSelectedStationLocationFromMap(lng: number, lat: number) {
    const draft = stationDraftRef.current;
    if (!draft) {
      showToast("위치를 지정할 역을 먼저 선택하세요", "error");
      return;
    }

    const nextDraft = { ...draft, lng, lat };
    setStationDraft(nextDraft);
    await saveStationOverrideAndSyncAnchors(
      nextDraft,
      "역 위치 지정",
      "역 위치를 즉시 저장했습니다",
    );
  }

  async function saveStationDraft() {
    if (!stationDraft) return;
    await saveStationOverrideAndSyncAnchors(
      stationDraft,
      "역 보정",
      "역 보정 저장 완료",
    );
  }

  async function rollbackSelectedStationPosition() {
    if (!selectedStation) return;

    const previous = overlays.stationOverrides.find(
      (override) => override.stationId === selectedStation.id,
    );
    if (!hasStationPositionOverride(selectedStation, previous)) {
      showToast("원래 데이터와 같은 위치입니다", "info");
      return;
    }

    const rolledBack = rollbackStationOverridePosition(
      selectedStation,
      previous,
    );
    const next: ManualOverlayBundle = {
      ...overlays,
      stationOverrides: [
        ...overlays.stationOverrides.filter(
          (override) => override.stationId !== selectedStation.id,
        ),
        ...(rolledBack ? [rolledBack] : []),
      ],
    };

    const saved = await executeOverlayCommand(
      "역 위치 롤백",
      next,
      "역 위치를 원래 데이터로 되돌렸습니다",
    );
    if (!saved) return;

    const nextData = await reloadEditorData();
    const nextStation = nextData?.stations.find(
      (station) => station.id === selectedStation.id,
    );
    if (nextStation) {
      const nextOverride = nextData?.overlays.stationOverrides.find(
        (override) => override.stationId === nextStation.id,
      );
      setStationDraft(emptyStationOverride(nextStation, nextOverride));
    }
    setStationLocationPickMode(false);
  }

  async function syncSelectedStationSavedGeometryAnchors() {
    if (!selectedStation) return;

    const result = syncSavedGeometryAnchorsForStation(
      overlays,
      selectedStation.id,
      displayStationById,
    );
    if (result.changedCount < 1) {
      showToast("동기화할 저장 선형 anchor가 없습니다", "info");
      return;
    }

    const saved = await executeOverlayCommand(
      "역 선형 anchor 동기화",
      result.overlays,
      `${formatStationDisplayName(selectedStation)}의 저장 선형 anchor ${result.changedCount}개를 현재 역 위치로 맞췄습니다`,
    );
    if (!saved) return;

    const nextData = await reloadEditorData();
    const nextStation = nextData?.stations.find(
      (station) => station.id === selectedStation.id,
    );
    if (nextStation) {
      const nextOverride = nextData?.overlays.stationOverrides.find(
        (override) => override.stationId === nextStation.id,
      );
      setStationDraft(emptyStationOverride(nextStation, nextOverride));
    }
  }

  async function saveTransferDraft() {
    if (!transferDraft) return;
    const group = toTransferGroup(transferDraft);
    if (group.stationIds.length < 2) {
      showToast("환승 그룹은 역이 2개 이상 필요합니다", "error");
      return;
    }

    const next: ManualOverlayBundle = {
      ...overlays,
      manualTransferGroups: [
        ...overlays.manualTransferGroups.filter(
          (candidate) => candidate.id !== group.id,
        ),
        group,
      ],
    };

    await executeOverlayCommand(
      transferDraft.id ? "환승 그룹 수정" : "환승 그룹 생성",
      next,
      "환승 그룹 저장 완료",
    );
    setSelection({ type: "transferGroup", id: group.id });
    setTransferDraft(makeTransferDraftFromGroup(group));
  }

  async function deleteTransferGroup(groupId: string) {
    const next: ManualOverlayBundle = {
      ...overlays,
      manualTransferGroups: overlays.manualTransferGroups.filter(
        (group) => group.id !== groupId,
      ),
    };
    await executeOverlayCommand("환승 그룹 삭제", next, "환승 그룹 삭제 완료");
    setTransferDraft(null);
    setSelection({ type: "none" });
  }

  async function saveGeometryWorkspaceDrafts() {
    const drafts = getGeometryDraftsFromMap(geometryDraftsByKeyRef.current);
    const dirtyDrafts = drafts.filter(
      (draft) =>
        !areGeometryDraftsEqual(draft, getSavedGeometryDraftForDraft(draft)),
    );

    if (dirtyDrafts.length < 1) {
      showToast("저장할 선형 편집 변경이 없습니다", "info");
      return;
    }

    let nextStationOverrides = overlays.stationOverrides;
    let nextGeometryOverrides = overlays.geometryOverrides;
    let nextLineBranchOverrides = overlays.lineBranchOverrides ?? [];

    for (const draft of dirtyDrafts) {
      const stationPositionOverrides =
        getMovedStationOverridesFromGeometryDraft(
          draft,
          stationById,
          nextStationOverrides,
        );
      nextStationOverrides = mergeStationOverrides(
        nextStationOverrides,
        stationPositionOverrides,
      );

      if (draft.targetType === "branch") {
        const override = toGeometryOverride(draft);
        if (override.points.length < 2) {
          showToast("선형은 좌표가 2개 이상 필요합니다", "error");
          return;
        }
        nextGeometryOverrides = [
          ...nextGeometryOverrides.filter(
            (candidate) => candidate.branchId !== override.branchId,
          ),
          override,
        ];
        continue;
      }

      const geometry = toLineBranchGeometryPoints(draft);
      if (geometry.length < 2) {
        showToast("선형은 좌표가 2개 이상 필요합니다", "error");
        return;
      }
      nextLineBranchOverrides = nextLineBranchOverrides.map((override) =>
        override.id === draft.targetId
          ? {
              ...override,
              geometry,
              note: draft.note.trim()
                ? draft.note.trim()
                : (override.note ?? null),
            }
          : override,
      );
    }

    const next: ManualOverlayBundle = {
      ...overlays,
      stationOverrides: nextStationOverrides,
      geometryOverrides: nextGeometryOverrides,
      lineBranchOverrides: nextLineBranchOverrides,
    };

    const saved = await executeOverlayCommand(
      "선형 전체 보정",
      next,
      `선형 편집 ${dirtyDrafts.length.toLocaleString("ko-KR")}개 저장 완료`,
    );
    if (!saved) return;

    setGeometryDraft(null);
    setGeometryDraftsByKey({});
    clearGeometryDraftHistory();
    await reloadEditorData();
  }

  function createTransferGroupFromSelection(ids: string[]) {
    const uniqueIds = [...new Set(ids)].filter((id) => !nonTransferIds.has(id));
    if (uniqueIds.length < 2) {
      showToast("환승 가능역 2개 이상을 선택해야 합니다", "error");
      return;
    }
    setTransferDraft(makeTransferDraftFromStations(uniqueIds, stationById));
    applyMultiStationSelection(uniqueIds);
    setSidebarTab("transfers");
  }

  async function setStationsNonTransfer(ids: string[], enabled: boolean) {
    const nextSet = new Set(overlays.nonTransferStationIds);
    for (const id of ids) {
      if (enabled) nextSet.add(id);
      else nextSet.delete(id);
    }
    await executeOverlayCommand(
      enabled ? "미환승역 설정" : "환승 가능역 설정",
      { ...overlays, nonTransferStationIds: [...nextSet] },
      enabled ? "미환승역 설정 완료" : "환승 가능역 설정 완료",
    );
    if (selection.type === "multiStation") setSelection({ type: "none" });
  }

  async function createAddStationLineBranch(
    parentBranchId: string,
    anchorStationId: string,
    branchStationId: string,
  ) {
    const parentBranch = branchById.get(parentBranchId);
    const anchorStation = stationById.get(anchorStationId);
    const branchStation = stationById.get(branchStationId);

    if (!parentBranch || !anchorStation || !branchStation) {
      showToast("지선 추가에 필요한 역/branch를 찾지 못했습니다", "error");
      return;
    }

    const assignedStationIds = new Set(
      data.branches.flatMap(getBranchStationIds),
    );
    if (assignedStationIds.has(branchStationId)) {
      showToast("이미 노선에 소속된 역은 지선으로 추가할 수 없습니다", "error");
      return;
    }

    const parentStationIds = new Set(getBranchStationIds(parentBranch));
    if (!parentStationIds.has(anchorStationId)) {
      showToast("anchor 역이 선택한 branch에 없습니다", "error");
      return;
    }

    const override: ManualLineBranchOverride = {
      id: makeLineBranchOverrideId(
        "add-station",
        parentBranchId,
        anchorStationId,
        branchStationId,
      ),
      mode: "add-station",
      parentBranchId,
      anchorStationId,
      branchStationId,
      geometry: makeLineBranchGeometry(anchorStation, branchStation),
      enabled: true,
      source: "editor",
      note: null,
    };

    const next: ManualOverlayBundle = {
      ...overlays,
      lineBranchOverrides: [
        ...overlays.lineBranchOverrides.filter(
          (candidate) => candidate.id !== override.id,
        ),
        override,
      ],
    };

    await executeOverlayCommand("지선 역 추가", next, "지선 역 추가 완료");
    setSidebarTab("validation");
  }

  async function createConnectLineBranch(
    parentBranchId: string,
    anchorStationId: string,
    connectedBranchId: string,
    connectedEndpointStationId: string,
    connectedDirection: LineBranchDirection,
  ) {
    const parentBranch = branchById.get(parentBranchId);
    const connectedBranch = branchById.get(connectedBranchId);
    const anchorStation = stationById.get(anchorStationId);
    const connectedEndpointStation = stationById.get(
      connectedEndpointStationId,
    );

    if (
      !parentBranch ||
      !connectedBranch ||
      !anchorStation ||
      !connectedEndpointStation
    ) {
      showToast("지선 결합에 필요한 역/branch를 찾지 못했습니다", "error");
      return;
    }

    if (parentBranch.id === connectedBranch.id) {
      showToast("같은 branch끼리는 결합할 수 없습니다", "error");
      return;
    }
    const parentStationIds = new Set(getBranchStationIds(parentBranch));
    if (!parentStationIds.has(anchorStationId)) {
      showToast("선택한 연결 기준 역이 현재 노선에 없습니다", "error");
      return;
    }

    const connectedStationIds = new Set(getBranchStationIds(connectedBranch));
    if (!connectedStationIds.has(connectedEndpointStationId)) {
      showToast("선택한 연결 대상 역이 연결 노선에 없습니다", "error");
      return;
    }

    const override: ManualLineBranchOverride = {
      id: makeLineBranchOverrideId(
        "connect-line",
        parentBranchId,
        anchorStationId,
        `${connectedBranchId}:${connectedEndpointStationId}:${connectedDirection}`,
      ),
      mode: "connect-line",
      parentBranchId,
      anchorStationId,
      connectedBranchId,
      connectedEndpointStationId,
      connectedDirection,
      geometry: makeLineBranchGeometry(anchorStation, connectedEndpointStation),
      enabled: true,
      source: "editor",
      note: null,
    };

    const next: ManualOverlayBundle = {
      ...overlays,
      lineBranchOverrides: [
        ...overlays.lineBranchOverrides.filter(
          (candidate) => candidate.id !== override.id,
        ),
        override,
      ],
    };

    await executeOverlayCommand("지선 노선 결합", next, "지선 노선 결합 완료");
    setSidebarTab("validation");
  }

  async function deleteLineBranchOverride(id: string) {
    const next: ManualOverlayBundle = {
      ...overlays,
      lineBranchOverrides: overlays.lineBranchOverrides.filter(
        (override) => override.id !== id,
      ),
    };

    await executeOverlayCommand("지선 제거", next, "지선 제거 완료");
    setSidebarTab("validation");
  }

  async function createBranchStationExclusion(
    branchId: string,
    stationId: string,
  ) {
    const branch = branchById.get(branchId);
    const station = stationById.get(stationId);

    if (!branch || !station) {
      showToast("역 제거에 필요한 노선/역을 찾지 못했습니다", "error");
      return;
    }

    if (!getBranchStationIds(branch).includes(stationId)) {
      showToast("선택한 역이 이 노선에 없습니다", "error");
      return;
    }

    const override: ManualBranchStationExclusion = {
      id: makeBranchStationExclusionId(branchId, stationId),
      branchId,
      stationId,
      enabled: true,
      source: "editor",
      note: null,
    };

    const next: ManualOverlayBundle = {
      ...overlays,
      branchStationExclusions: [
        ...overlays.branchStationExclusions.filter(
          (candidate) => candidate.id !== override.id,
        ),
        override,
      ],
    };

    const saved = await executeOverlayCommand(
      "노선 역 제거",
      next,
      "노선에서 역 제거 완료",
    );
    if (!saved) return;
    await reloadEditorData();
    setSelection({ type: "branch", id: branchId });
    setSidebarTab("validation");
  }

  async function deleteBranchStationExclusion(id: string) {
    const next: ManualOverlayBundle = {
      ...overlays,
      branchStationExclusions: overlays.branchStationExclusions.filter(
        (override) => override.id !== id,
      ),
    };

    const saved = await executeOverlayCommand(
      "노선 역 제거 해제",
      next,
      "노선 역 제거 해제 완료",
    );
    if (!saved) return;
    await reloadEditorData();
    setSidebarTab("validation");
  }

  const selectedStation =
    selection.type === "station"
      ? (stationById.get(selection.id) ?? null)
      : null;
  const selectedStationOverride = selectedStation
    ? overlays.stationOverrides.find(
        (override) => override.stationId === selectedStation.id,
      )
    : undefined;
  const selectedStationHasPositionOverride = selectedStation
    ? hasStationPositionOverride(selectedStation, selectedStationOverride)
    : false;
  const selectedStationStaleSavedAnchorCount = selectedStation
    ? countStaleSavedGeometryAnchorsForStation(
        overlays,
        selectedStation.id,
        displayStationById,
      )
    : 0;
  const selectedStationBranches = selectedStation
    ? getBranchesServingStation(data.branches, selectedStation.id)
    : [];
  const selectedBranch =
    selection.type === "branch" ? (branchById.get(selection.id) ?? null) : null;
  const geometryWorkspaceDirtyDrafts = geometryWorkspaceDrafts.filter(
    (draft) =>
      !areGeometryDraftsEqual(draft, getSavedGeometryDraftForDraft(draft)),
  );
  const geometryWorkspaceSummary: GeometryWorkspaceSummary =
    geometryWorkspaceDirtyDrafts.reduce<GeometryWorkspaceSummary>(
      (summary, draft) => {
        const savedDraft = getSavedGeometryDraftForDraft(draft);
        const movedStationLabels = getGeometryDraftStationPositionChangeLabels(
          draft,
          stationById,
        );
        const addedControlPointCount = Math.max(
          0,
          getControlPointCount(draft) - getControlPointCount(savedDraft),
        );
        const removedControlPointCount = Math.max(
          0,
          getControlPointCount(savedDraft) - getControlPointCount(draft),
        );

        return {
          changedTargetCount: summary.changedTargetCount + 1,
          addedControlPointCount:
            summary.addedControlPointCount + addedControlPointCount,
          removedControlPointCount:
            summary.removedControlPointCount + removedControlPointCount,
          movedStationCount:
            summary.movedStationCount + movedStationLabels.length,
          movedStationLabels: [
            ...summary.movedStationLabels,
            ...movedStationLabels,
          ],
        };
      },
      {
        changedTargetCount: 0,
        addedControlPointCount: 0,
        removedControlPointCount: 0,
        movedStationCount: 0,
        movedStationLabels: [],
      },
    );
  const activeGeometryTargetKey = getGeometryDraftTargetKey(geometryDraft);
  const activeGeometryTarget = activeGeometryTargetKey
    ? (geometryTargets.find(
        (target) =>
          getGeometryTargetKey(target.type, target.id) ===
          activeGeometryTargetKey,
      ) ?? null)
    : null;
  const activeGeometryBranch = geometryDraft
    ? (branchById.get(geometryDraft.branchId) ?? null)
    : selectedBranch;
  const selectedGroup =
    selection.type === "transferGroup"
      ? (groupById.get(selection.id) ?? null)
      : getPrimarySelectedTransferGroup(selection, overlays.manualTransferGroups);
  const multiStationIds =
    selection.type === "multiStation" ? selection.ids : [];
  const geometryDraftDirty = geometryWorkspaceDirtyDrafts.length > 0;
  const isGeometryMode = toolMode === "geometry";
  const canUndo = isGeometryMode
    ? geometryHistoryVersion >= 0 && geometryUndoStackRef.current.length > 0
    : historyVersion >= 0 && undoStackRef.current.length > 0;
  const canRedo = isGeometryMode
    ? geometryHistoryVersion >= 0 && geometryRedoStackRef.current.length > 0
    : historyVersion >= 0 && redoStackRef.current.length > 0;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const resize = () => map.resize();
    const frame = window.requestAnimationFrame(resize);
    const timers = [60, 180, 360].map((delay) =>
      window.setTimeout(resize, delay),
    );

    return () => {
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [isGeometryMode, sidebarTab, dataLoading, selection.type]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  return (
    <AppShell>
      <InspectorGrid>
        <Panel className="flex min-h-0 flex-col overflow-hidden">
            <PanelHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    {isGeometryMode ? "Geometry" : "Railmap"}
                  </p>
                  <h1 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                    {isGeometryMode ? "선형 편집" : "통합 맵 에디터"}
                  </h1>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      if (isGeometryMode) undoGeometryDraftEdit();
                      else void undoOverlayCommand();
                    }}
                    disabled={!canUndo}
                    aria-label="되돌리기"
                  >
                    <Undo2 className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      if (isGeometryMode) redoGeometryDraftEdit();
                      else void redoOverlayCommand();
                    }}
                    disabled={!canRedo}
                    aria-label="다시 실행"
                  >
                    <Redo2 className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => setCommandOpen(true)}
                    aria-label="명령 팔레트 열기"
                  >
                    <Command className="size-4" />
                  </Button>
                </div>
              </div>
              {!isGeometryMode ? (
                <>
                  <TabList className="mt-4 grid grid-cols-3">
                    <TabButton
                      active={sidebarTab === "search"}
                      onClick={() => setSidebarTab("search")}
                    >
                      검색
                    </TabButton>
                    <TabButton
                      active={sidebarTab === "layers"}
                      onClick={() => setSidebarTab("layers")}
                    >
                      레이어
                    </TabButton>
                    <TabButton
                      active={sidebarTab === "transfers"}
                      onClick={() => setSidebarTab("transfers")}
                    >
                      환승
                    </TabButton>
                  </TabList>
                  <TabList className="mt-2 grid grid-cols-2">
                    <TabButton
                      active={sidebarTab === "validation"}
                      onClick={() => setSidebarTab("validation")}
                    >
                      검증
                    </TabButton>
                    <TabButton
                      active={sidebarTab === "history"}
                      onClick={() => setSidebarTab("history")}
                    >
                      기록
                    </TabButton>
                  </TabList>
                </>
              ) : null}
            </PanelHeader>

            <PanelBody className="min-h-0 flex-1 overflow-y-auto">
              {isGeometryMode ? (
                <GeometryModeSidebar
                  targets={filteredGeometryTargets}
                  totalTargetCount={geometryTargets.length}
                  activeTargetKey={getGeometryDraftTargetKey(geometryDraft)}
                  dirtyTargetKey={
                    geometryDraftDirty
                      ? getGeometryDraftTargetKey(geometryDraft)
                      : null
                  }
                  query={geometryTargetQuery}
                  filter={geometryTargetFilter}
                  shortcutsOpen={shortcutHelpOpen}
                  onQueryChange={setGeometryTargetQuery}
                  onFilterChange={setGeometryTargetFilter}
                  onToggleShortcuts={() => setShortcutHelpOpen((open) => !open)}
                  onSelectTarget={selectGeometryTarget}
                />
              ) : null}

              {!isGeometryMode && sidebarTab === "search" ? (
                <div className="grid gap-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      className="pl-9"
                      placeholder="역명, 노선명, 역번호 검색"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    {filteredStations.map((station) => (
                      <button
                        key={station.id}
                        type="button"
                        className={cn(
                          "rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-blue-200 hover:bg-blue-50",
                          selectedStationIds.has(station.id)
                            ? "border-blue-300 bg-blue-50"
                            : null,
                        )}
                        onClick={() => selectStation(station.id)}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2.5 rounded-full"
                            style={{
                              backgroundColor: station.colorHex ?? "#64748b",
                            }}
                          />
                          <strong className="truncate text-sm font-semibold">
                            {station.nameKo}
                          </strong>
                        </div>
                        <p className="mt-1 truncate text-xs font-medium text-slate-500">
                          {formatStationSubLabel(station)}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {!isGeometryMode && sidebarTab === "layers" ? (
                <div className="grid gap-2">
                  {layerOptions.map(({ key, label, Icon }) => (
                    <label
                      key={String(key)}
                      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm font-semibold"
                    >
                      <input
                        type="checkbox"
                        checked={layers[key]}
                        onChange={(event) =>
                          setLayers((previous) => ({
                            ...previous,
                            [key]: event.target.checked,
                          }))
                        }
                      />
                      <Icon className="size-4 text-slate-400" />
                      {label}
                    </label>
                  ))}
                </div>
              ) : null}

              {!isGeometryMode && sidebarTab === "transfers" ? (
                <div className="grid gap-2">
                  {selectedGroup && selection.type === "multiStation" ? (
                    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                      <p className="font-semibold">환승 그룹 아이콘으로 선택됨</p>
                      <p className="mt-1 font-medium">
                        {selectedGroup.nameKo} · {selectedGroup.stationIds.length}개 하위 역 선택
                      </p>
                    </div>
                  ) : null}
                  {multiStationIds.length >= 2 ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        createTransferGroupFromSelection(multiStationIds)
                      }
                    >
                      선택한 역으로 환승 그룹 생성
                    </Button>
                  ) : null}
                  {overlays.manualTransferGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className="rounded-2xl border border-slate-200 bg-white p-3 text-left hover:bg-blue-50"
                      onClick={() => selectTransferGroup(group.id)}
                    >
                      <strong className="text-sm font-semibold">
                        {group.nameKo}
                      </strong>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        {group.stationIds.length}개 역 ·{" "}
                        {group.note || "메모 없음"}
                      </p>
                    </button>
                  ))}
                </div>
              ) : null}

              {!isGeometryMode && sidebarTab === "validation" ? (
                <LineBranchValidationPanel
                  count={
                    (overlays.lineBranchOverrides?.length ?? 0) +
                    (overlays.branchStationExclusions?.length ?? 0)
                  }
                  issues={lineBranchIssues}
                  overlays={overlays}
                />
              ) : null}
              {!isGeometryMode && sidebarTab === "history" ? (
                <CommandHistoryPanel
                  undoCount={undoStackRef.current.length}
                  redoCount={redoStackRef.current.length}
                  latest={undoStackRef.current.at(-1)}
                />
              ) : null}
            </PanelBody>
        </Panel>

        <main className="relative min-h-0 overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-xl">
          <div ref={mapContainerRef} className="absolute inset-0 size-full" />
          <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-2">
            <Badge className="bg-white/90 text-slate-700">
              {selectedGroup ? `환승 그룹 · ${selectedGroup.nameKo}` : selectionLabel(selection)}
            </Badge>
            <Badge className="bg-white/90 text-slate-700">
              Zoom {zoom.toFixed(1)}
            </Badge>
            {dataLoading ? (
              <Badge className="bg-white/90 text-slate-700">
                데이터 로딩 중
              </Badge>
            ) : null}
          </div>
          <div className="absolute left-1/2 top-4 flex -translate-x-1/2 gap-2 rounded-2xl border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur">
            {toolOptions.map(({ mode, label, description, Icon }) => (
              <button
                key={mode}
                type="button"
                className={cn(
                  "flex items-center gap-1 rounded-xl px-3 py-1.5 text-[11px] font-medium text-slate-500",
                  toolMode === mode
                    ? "bg-blue-600 text-white"
                    : "hover:bg-slate-100",
                )}
                onClick={() => setToolMode(mode)}
                title={description}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
          {selectionBox ? (
            <div
              className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/15"
              style={selectionBox}
            />
          ) : null}
          {stationLocationPickMode && cursorPoint ? (
            <div className="pointer-events-none absolute inset-0 z-20">
              <div
                className="absolute bottom-0 top-0 w-px bg-blue-500/70 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
                style={{ left: cursorPoint.x }}
              />
              <div
                className="absolute left-0 right-0 h-px bg-blue-500/70 shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
                style={{ top: cursorPoint.y }}
              />
            </div>
          ) : null}
          <div className="absolute bottom-3 right-3 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 text-xs font-medium text-slate-600 shadow-lg backdrop-blur">
            {cursorLngLat
              ? `${cursorLngLat.lng.toFixed(6)}, ${cursorLngLat.lat.toFixed(6)}`
              : "좌표 없음"}
          </div>
          {contextMenu ? (
            <ContextMenu
              state={contextMenu}
              stationById={stationById}
              branchById={branchById}
              onClose={() => setContextMenu(null)}
              onSelectStation={(id) => {
                selectStation(id, false);
                setContextMenu(null);
              }}
              onSelectBranch={(id) => {
                selectBranch(id);
                setContextMenu(null);
              }}
              onSetNonTransfer={(id, enabled) => {
                void setStationsNonTransfer([id], enabled);
                setContextMenu(null);
              }}
            />
          ) : null}
        </main>

        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <PanelHeader>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {isGeometryMode ? "Geometry Tools" : "Inspector"}
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
              {isGeometryMode ? "전체 선형 편집" : selectedGroup ? `환승 그룹 · ${selectedGroup.nameKo}` : selectionLabel(selection)}
            </h2>
          </PanelHeader>
          <PanelBody className="min-h-0 flex-1 overflow-y-auto">
            {isGeometryMode ? (
              <GeometryModeInspector
                summary={geometryWorkspaceSummary}
                isDirty={geometryDraftDirty}
                canUndo={canUndo}
                canRedo={canRedo}
                activeTargetTitle={activeGeometryTarget?.title ?? null}
                onSave={() => void saveGeometryWorkspaceDrafts()}
                onReset={resetGeometryWorkspaceToSaved}
                onUndo={undoGeometryDraftEdit}
                onRedo={redoGeometryDraftEdit}
              />
            ) : null}

            {!isGeometryMode && selectedStation && stationDraft ? (
              <StationInspector
                station={selectedStation}
                draft={stationDraft}
                nonTransfer={nonTransferIds.has(selectedStation.id)}
                onChange={setStationDraft}
                onSave={() => void saveStationDraft()}
                onRollbackPosition={() =>
                  void rollbackSelectedStationPosition()
                }
                canRollbackPosition={selectedStationHasPositionOverride}
                staleSavedAnchorCount={selectedStationStaleSavedAnchorCount}
                onSyncSavedAnchors={() =>
                  void syncSelectedStationSavedGeometryAnchors()
                }
                onSetNonTransfer={(enabled) =>
                  void setStationsNonTransfer([selectedStation.id], enabled)
                }
                onStartMapPick={() => setStationLocationPickMode(true)}
                onFocus={() => focusStation(selectedStation.id)}
                pickMode={stationLocationPickMode}
                branchRemovalOptions={selectedStationBranches}
                branchAddOptions={data.branches}
                onExcludeFromBranch={(branchId) =>
                  void createBranchStationExclusion(
                    branchId,
                    selectedStation.id,
                  )
                }
                onCreateAddStationBranch={(branchId, anchorStationId) =>
                  void createAddStationLineBranch(
                    branchId,
                    anchorStationId,
                    selectedStation.id,
                  )
                }
                onCreateConnectLineBranch={(
                  parentBranchId,
                  connectedBranchId,
                  connectedEndpointStationId,
                  connectedDirection,
                ) =>
                  void createConnectLineBranch(
                    parentBranchId,
                    selectedStation.id,
                    connectedBranchId,
                    connectedEndpointStationId,
                    connectedDirection,
                  )
                }
              />
            ) : null}
            {!isGeometryMode && activeGeometryBranch ? (
              <BranchInspector
                branch={activeGeometryBranch}
                branches={data.branches}
                lineBranchOverrides={overlays.lineBranchOverrides}
                branchStationExclusions={overlays.branchStationExclusions}
                unassignedStations={unassignedStations}
                onDeleteLineBranch={(id) => void deleteLineBranchOverride(id)}
                onRestoreBranchStation={(id) =>
                  void deleteBranchStationExclusion(id)
                }
              />
            ) : null}
            {!isGeometryMode && selectedGroup && transferDraft ? (
              <TransferGroupInspector
                group={selectedGroup}
                draft={transferDraft}
                stationById={stationById}
                onChange={setTransferDraft}
                onSave={() => void saveTransferDraft()}
                onDelete={() => void deleteTransferGroup(selectedGroup.id)}
              />
            ) : null}
            {!isGeometryMode && !selectedGroup && transferDraft ? (
              <NewTransferGroupInspector
                draft={transferDraft}
                stationById={stationById}
                onChange={setTransferDraft}
                onSave={() => void saveTransferDraft()}
                onCancel={() => setTransferDraft(null)}
              />
            ) : null}
            {!isGeometryMode && multiStationIds.length > 0 && !transferDraft ? (
              <MultiStationInspector
                ids={multiStationIds}
                stationById={stationById}
                nonTransferIds={nonTransferIds}
                onSetNonTransfer={(enabled) =>
                  void setStationsNonTransfer(multiStationIds, enabled)
                }
                onCreateTransferGroup={() =>
                  createTransferGroupFromSelection(multiStationIds)
                }
              />
            ) : null}
            {!isGeometryMode && selection.type === "none" ? (
              <Placeholder
                title="객체를 선택하세요"
                description="지도에서 역/노선선을 클릭하거나 Cmd/Ctrl+K로 검색하세요."
              />
            ) : null}
          </PanelBody>
        </Panel>
      </InspectorGrid>

      <Dialog
        open={Boolean(pendingTransferSelection)}
        className="max-w-md overflow-hidden"
      >
        <div className="border-b border-slate-200 px-4 py-3">
          <strong className="block text-sm font-semibold text-slate-950">
            진행 중인 환승 그룹 등록이 있습니다
          </strong>
          <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
            새 역 선택을 적용하면 현재 환승 그룹 등록/수정 화면이 닫힙니다.
          </p>
        </div>
        <div className="grid gap-2 p-3">
          <Button variant="ghost" onClick={keepTransferDraftSelection}>
            이어서 하기
          </Button>
          <Button onClick={applyPendingSelectionAfterTransferDraftCancel}>
            새로 선택하기
          </Button>
        </div>
      </Dialog>

      <Dialog open={commandOpen} className="flex h-[520px] max-w-xl flex-col">
        <div className="shrink-0 border-b border-slate-200 p-3">
          <div className="flex items-center gap-3">
            <Command className="size-5 text-slate-400" />
            <Input
              autoFocus
              placeholder="역, 노선, 환승 그룹 검색"
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCommandOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {commandResults.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs font-normal text-slate-400">
              검색 결과가 없습니다.
            </p>
          ) : null}
          {commandResults.map((item) => (
            <button
              key={`${item.type}:${item.id}`}
              type="button"
              className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left hover:bg-blue-50"
              onClick={() => {
                if (item.type === "station") selectStation(item.id);
                if (item.type === "branch") selectBranch(item.id);
                if (item.type === "transferGroup") selectTransferGroup(item.id);
                setCommandOpen(false);
              }}
            >
              <span>
                <strong className="block text-sm font-semibold">
                  {item.title}
                </strong>
                <span className="text-xs font-medium text-slate-500">
                  {item.subtitle}
                </span>
              </span>
              <ChevronRight className="size-4 text-slate-400" />
            </button>
          ))}
        </div>
      </Dialog>

      <Toast message={toast.message} tone={toast.tone} />
    </AppShell>
  );
}

function CommandHistoryPanel({
  undoCount,
  redoCount,
  latest,
}: {
  undoCount: number;
  redoCount: number;
  latest?: OverlayCommandRecord;
}) {
  return (
    <div className="grid gap-3">
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
        <strong className="text-sm font-semibold text-slate-700">
          Command History
        </strong>
        <p className="mt-2 text-xs font-medium text-slate-500">
          Undo {undoCount} · Redo {redoCount}
        </p>
      </div>
      {latest ? (
        <InfoRow label="최근 작업" value={latest.label} />
      ) : (
        <Placeholder
          title="작업 기록 없음"
          description="저장 작업을 실행하면 command history에 기록됩니다."
        />
      )}
    </div>
  );
}

function GeometryModeSidebar({
  targets,
  totalTargetCount,
  activeTargetKey,
  dirtyTargetKey,
  query,
  filter,
  shortcutsOpen,
  onQueryChange,
  onFilterChange,
  onToggleShortcuts,
  onSelectTarget,
}: {
  targets: GeometryEditTarget[];
  totalTargetCount: number;
  activeTargetKey: string | null;
  dirtyTargetKey: string | null;
  query: string;
  filter: GeometryTargetFilter;
  shortcutsOpen: boolean;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: GeometryTargetFilter) => void;
  onToggleShortcuts: () => void;
  onSelectTarget: (target: GeometryEditTarget) => void;
}) {
  const filters: Array<{ value: GeometryTargetFilter; label: string }> = [
    { value: "all", label: "전체" },
    { value: "branch", label: "일반" },
    { value: "add-station", label: "역 추가" },
    { value: "connect-line", label: "노선 결합" },
  ];

  return (
    <div className="flex min-h-0 h-full flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <strong className="text-xs font-semibold text-slate-700">
          선형 편집 대상
        </strong>
        <span className="text-[11px] font-semibold text-slate-400">
          {targets.length.toLocaleString("ko-KR")} /{" "}
          {totalTargetCount.toLocaleString("ko-KR")}
        </span>
      </div>
      <div className="relative px-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
        <Input
          className="h-8 pl-8 text-xs"
          placeholder="노선명, 지선명 검색"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-1 px-1">
        {filters.map((option) => (
          <button
            key={option.value}
            type="button"
            className={cn(
              "rounded-full px-2 py-1 text-[10px] font-semibold transition",
              filter === option.value
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200",
            )}
            onClick={() => onFilterChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {query || filter !== "all" ? (
        <button
          type="button"
          className="mx-1 rounded-xl border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-500 transition hover:bg-slate-50"
          onClick={() => {
            onQueryChange("");
            onFilterChange("all");
          }}
        >
          검색/필터 초기화
        </button>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {targets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-xs font-medium text-slate-400">
            조건에 맞는 선형이 없습니다.
          </div>
        ) : (
          <div className="grid gap-1.5">
            {targets.map((target) => {
              const targetKey = getGeometryTargetKey(target.type, target.id);
              const active = activeTargetKey === targetKey;
              const dirty = dirtyTargetKey === targetKey;
              return (
                <button
                  key={targetKey}
                  type="button"
                  className={cn(
                    "rounded-2xl border px-2.5 py-2 text-left transition",
                    active
                      ? "border-blue-300 bg-blue-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50",
                  )}
                  onClick={() => onSelectTarget(target)}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-1.5 w-8 shrink-0 rounded-full"
                      style={{ backgroundColor: target.colorHex }}
                    />
                    <strong className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">
                      {target.title}
                    </strong>
                    {dirty ? (
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                        수정중
                      </span>
                    ) : target.hasSavedGeometry ? (
                      <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                        보정됨
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-[11px] font-medium text-slate-500">
                    {target.subtitle}
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-400">
                    <span className="truncate">{target.meta}</span>
                    {target.hasSavedGeometry ? (
                      <span className="shrink-0">
                        {target.savedPointCount}점
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="shrink-0 rounded-2xl border border-slate-200 bg-white">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-semibold text-slate-600"
          onClick={onToggleShortcuts}
        >
          단축키
          <ChevronRight
            className={cn(
              "size-3 transition",
              shortcutsOpen ? "rotate-90" : null,
            )}
          />
        </button>
        {shortcutsOpen ? (
          <div className="grid gap-1 border-t border-slate-100 px-3 py-2 text-[11px] font-medium text-slate-500">
            <div className="flex justify-between gap-3">
              <span>검색</span>
              <kbd>Cmd/Ctrl+K</kbd>
            </div>
            <div className="flex justify-between gap-3">
              <span>되돌리기</span>
              <kbd>Cmd/Ctrl+Z</kbd>
            </div>
            <div className="flex justify-between gap-3">
              <span>다시 실행</span>
              <kbd>Cmd/Ctrl+Shift+Z</kbd>
            </div>
            <div className="flex justify-between gap-3">
              <span>보정점 제거</span>
              <kbd>Cmd/Ctrl+Click</kbd>
            </div>
            <div className="flex justify-between gap-3">
              <span>역 위치 변경</span>
              <kbd>주황점 Drag</kbd>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GeometryModeInspector({
  summary,
  isDirty,
  canUndo,
  canRedo,
  activeTargetTitle,
  onSave,
  onReset,
  onUndo,
  onRedo,
}: {
  summary: GeometryWorkspaceSummary;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  activeTargetTitle: string | null;
  onSave: () => void;
  onReset: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const movedStationPreview = [...new Set(summary.movedStationLabels)].slice(
    0,
    4,
  );

  return (
    <div className="grid gap-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          Geometry Workspace
        </p>
        <strong className="mt-1 block text-sm font-semibold text-slate-900">
          전체 선형 편집
        </strong>
        <p className="mt-1 text-[11px] font-medium leading-4 text-slate-500">
          지도 위 본선/지선을 직접 드래그해 여러 노선을 동시에 수정합니다. 저장
          전까지 변경 draft는 유지됩니다.
        </p>
        {activeTargetTitle ? (
          <p className="mt-2 truncate rounded-xl bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
            최근 편집: {activeTargetTitle}
          </p>
        ) : null}
      </div>

      <div
        className={cn(
          "rounded-2xl border p-3 text-xs font-medium",
          isDirty
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-slate-200 bg-slate-50 text-slate-500",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <strong className={isDirty ? "text-amber-900" : "text-slate-700"}>
            이번 편집 요약
          </strong>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold",
              isDirty
                ? "bg-amber-100 text-amber-700"
                : "bg-slate-100 text-slate-400",
            )}
          >
            {isDirty ? `${summary.changedTargetCount}개 노선` : "변경 없음"}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-white/70 px-2 py-2">
            <p className="text-[10px] font-semibold text-slate-400">
              변경 노선
            </p>
            <p className="mt-1 text-lg font-bold text-slate-900">
              {summary.changedTargetCount}
            </p>
          </div>
          <div className="rounded-xl bg-white/70 px-2 py-2">
            <p className="text-[10px] font-semibold text-slate-400">이동 역</p>
            <p className="mt-1 text-lg font-bold text-slate-900">
              {summary.movedStationCount}
            </p>
          </div>
          <div className="rounded-xl bg-white/70 px-2 py-2">
            <p className="text-[10px] font-semibold text-slate-400">
              추가 정점
            </p>
            <p className="mt-1 text-lg font-bold text-slate-900">
              {summary.addedControlPointCount}
            </p>
          </div>
          <div className="rounded-xl bg-white/70 px-2 py-2">
            <p className="text-[10px] font-semibold text-slate-400">
              삭제 정점
            </p>
            <p className="mt-1 text-lg font-bold text-slate-900">
              {summary.removedControlPointCount}
            </p>
          </div>
        </div>
        {movedStationPreview.length > 0 ? (
          <p className="mt-2 truncate text-[11px] font-semibold text-amber-700">
            이동 역: {movedStationPreview.join(", ")}
            {summary.movedStationLabels.length > movedStationPreview.length
              ? ` 외 ${summary.movedStationLabels.length - movedStationPreview.length}개`
              : ""}
          </p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold">
          <span className={isDirty ? "text-amber-600" : "text-slate-400"}>
            {isDirty ? "저장되지 않은 변경 있음" : "저장된 상태"}
          </span>
          <span className="text-slate-400">Cmd/Ctrl+Z</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onUndo} disabled={!canUndo}>
            <Undo2 className="mr-1 size-4" />
            Undo
          </Button>
          <Button variant="outline" onClick={onRedo} disabled={!canRedo}>
            <Redo2 className="mr-1 size-4" />
            Redo
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onReset} disabled={!isDirty}>
            전체 되돌리기
          </Button>
          <Button onClick={onSave} disabled={!isDirty}>
            <Save className="mr-1 size-4" />
            전체 저장
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 text-[11px] font-medium leading-5 text-slate-500">
        <div className="flex justify-between gap-3">
          <span>선형 구간 드래그</span>
          <kbd>보정점 추가</kbd>
        </div>
        <div className="flex justify-between gap-3">
          <span>회색점 Drag</span>
          <kbd>보정점 이동</kbd>
        </div>
        <div className="flex justify-between gap-3">
          <span>주황점 Drag</span>
          <kbd>역 위치 변경</kbd>
        </div>
        <div className="flex justify-between gap-3">
          <span>Cmd/Ctrl+Click</span>
          <kbd>회색점 삭제</kbd>
        </div>
      </div>
    </div>
  );
}

function Placeholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3 text-center">
      <strong className="text-sm font-semibold text-slate-700">{title}</strong>
      <p className="mt-1 text-[11px] font-medium leading-4 text-slate-500">
        {description}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function StationInspector({
  station,
  draft,
  nonTransfer,
  pickMode,
  onChange,
  onSave,
  onRollbackPosition,
  canRollbackPosition,
  staleSavedAnchorCount,
  onSyncSavedAnchors,
  onSetNonTransfer,
  onStartMapPick,
  onFocus,
  branchRemovalOptions,
  branchAddOptions,
  onExcludeFromBranch,
  onCreateAddStationBranch,
  onCreateConnectLineBranch,
}: {
  station: EditorStation;
  draft: ManualStationOverride;
  nonTransfer: boolean;
  pickMode: boolean;
  onChange: (next: ManualStationOverride) => void;
  onSave: () => void;
  onRollbackPosition: () => void;
  canRollbackPosition: boolean;
  staleSavedAnchorCount: number;
  onSyncSavedAnchors: () => void;
  onSetNonTransfer: (enabled: boolean) => void;
  onStartMapPick: () => void;
  onFocus: () => void;
  branchRemovalOptions: EditorMapBranch[];
  branchAddOptions: EditorMapBranch[];
  onExcludeFromBranch: (branchId: string) => void;
  onCreateAddStationBranch: (branchId: string, anchorStationId: string) => void;
  onCreateConnectLineBranch: (
    parentBranchId: string,
    connectedBranchId: string,
    connectedEndpointStationId: string,
    connectedDirection: LineBranchDirection,
  ) => void;
}) {
  const [removeBranchId, setRemoveBranchId] = useState(
    branchRemovalOptions[0]?.id ?? "",
  );
  const [addParentBranchId, setAddParentBranchId] = useState(
    branchAddOptions[0]?.id ?? "",
  );

  const addParentBranch =
    branchAddOptions.find((branch) => branch.id === addParentBranchId) ?? null;
  const addAnchorStations = addParentBranch
    ? getBranchStopStations(addParentBranch)
    : [];
  const [addAnchorStationId, setAddAnchorStationId] = useState(
    addAnchorStations[0]?.id ?? "",
  );
  const canAddToBranch = branchRemovalOptions.length === 0;
  const endpointConnectOptions = branchRemovalOptions.filter((branch) =>
    getBranchEndpointStations(branch).some(
      (candidate) => candidate.id === station.id,
    ),
  );
  const [connectParentBranchId, setConnectParentBranchId] = useState(
    endpointConnectOptions[0]?.id ?? "",
  );
  const connectParentBranch =
    endpointConnectOptions.find(
      (branch) => branch.id === connectParentBranchId,
    ) ?? null;
  const connectOtherBranches = branchAddOptions.filter(
    (branch) => branch.id !== connectParentBranchId,
  );
  const [connectBranchId, setConnectBranchId] = useState(
    connectOtherBranches[0]?.id ?? "",
  );
  const selectedConnectBranch =
    branchAddOptions.find((branch) => branch.id === connectBranchId) ?? null;
  const connectEndpointStations = selectedConnectBranch
    ? getBranchStopStations(selectedConnectBranch)
    : [];
  const [connectEndpointStationId, setConnectEndpointStationId] = useState(
    connectEndpointStations[0]?.id ?? "",
  );
  const [connectDirection, setConnectDirection] =
    useState<LineBranchDirection>("toward-end");
  const connectDirectionOptions = getBranchDirectionOptions(
    selectedConnectBranch,
    connectEndpointStationId,
  );

  useEffect(() => {
    if (!branchRemovalOptions.some((branch) => branch.id === removeBranchId)) {
      setRemoveBranchId(branchRemovalOptions[0]?.id ?? "");
    }
  }, [branchRemovalOptions, removeBranchId]);

  useEffect(() => {
    if (!branchAddOptions.some((branch) => branch.id === addParentBranchId)) {
      setAddParentBranchId(branchAddOptions[0]?.id ?? "");
    }
  }, [addParentBranchId, branchAddOptions]);

  useEffect(() => {
    if (
      !addAnchorStations.some(
        (candidate) => candidate.id === addAnchorStationId,
      )
    ) {
      setAddAnchorStationId(addAnchorStations[0]?.id ?? "");
    }
  }, [addAnchorStationId, addAnchorStations]);

  useEffect(() => {
    if (
      !endpointConnectOptions.some(
        (branch) => branch.id === connectParentBranchId,
      )
    ) {
      setConnectParentBranchId(endpointConnectOptions[0]?.id ?? "");
    }
  }, [connectParentBranchId, endpointConnectOptions]);

  useEffect(() => {
    if (!connectOtherBranches.some((branch) => branch.id === connectBranchId)) {
      setConnectBranchId(connectOtherBranches[0]?.id ?? "");
    }
  }, [connectBranchId, connectOtherBranches]);

  useEffect(() => {
    if (
      !connectEndpointStations.some(
        (candidate) => candidate.id === connectEndpointStationId,
      )
    ) {
      setConnectEndpointStationId(connectEndpointStations[0]?.id ?? "");
    }
  }, [connectEndpointStationId, connectEndpointStations]);

  useEffect(() => {
    if (
      !connectDirectionOptions.some(
        (option) => option.value === connectDirection,
      )
    ) {
      setConnectDirection(connectDirectionOptions[0]?.value ?? "toward-end");
    }
  }, [connectDirection, connectDirectionOptions]);

  return (
    <div className="grid gap-3">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-2">
          <span
            className="size-3 rounded-full"
            style={{ backgroundColor: station.colorHex ?? "#64748b" }}
          />
          <strong className="text-base font-semibold">{station.nameKo}</strong>
        </div>
        <p className="mt-1 text-xs font-medium text-slate-500">
          {formatStationSubLabel(station)}
        </p>
        <p className="mt-1 truncate text-[10px] font-medium text-slate-400">
          {station.id}
        </p>
      </div>
      <Field label="표시명 보정">
        <Input
          value={draft.nameKo ?? ""}
          onChange={(event) =>
            onChange({ ...draft, nameKo: event.target.value })
          }
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="위도">
          <Input
            value={draft.lat ?? ""}
            onChange={(event) =>
              onChange({ ...draft, lat: Number(event.target.value) })
            }
          />
        </Field>
        <Field label="경도">
          <Input
            value={draft.lng ?? ""}
            onChange={(event) =>
              onChange({ ...draft, lng: Number(event.target.value) })
            }
          />
        </Field>
      </div>
      <Field label="메모">
        <Textarea
          value={draft.note ?? ""}
          onChange={(event) =>
            onChange({ ...draft, note: event.target.value || null })
          }
        />
      </Field>
      {staleSavedAnchorCount > 0 ? (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <strong className="font-semibold">저장 선형 anchor 불일치</strong>
              <p className="mt-1 leading-5 text-orange-800">
                역 위치 override가 아니라 저장된 선형 보정 안의 역 anchor 좌표가
                현재 역 위치와 다릅니다. 위치 롤백 대신 anchor 동기화를
                실행하세요.
              </p>
            </div>
            <Badge>{staleSavedAnchorCount}개</Badge>
          </div>
          <Button
            className="mt-3 w-full"
            variant="outline"
            onClick={onSyncSavedAnchors}
          >
            <Waypoints className="mr-1 size-4" />
            저장 선형 anchor 현재 위치로 맞추기
          </Button>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={onFocus}>
          <LocateFixed className="mr-1 size-4" />
          이동
        </Button>
        <Button
          variant={pickMode ? "secondary" : "outline"}
          onClick={onStartMapPick}
        >
          지도에서 위치 지정
        </Button>
        <Button
          variant="outline"
          disabled={!canRollbackPosition}
          onClick={onRollbackPosition}
        >
          <Undo2 className="mr-1 size-4" />
          위치 롤백
        </Button>
        <Button
          variant={nonTransfer ? "secondary" : "outline"}
          onClick={() => onSetNonTransfer(!nonTransfer)}
        >
          {nonTransfer ? "환승 가능역" : "미환승역"}
        </Button>
        <Button onClick={onSave}>
          <Save className="mr-1 size-4" />
          저장
        </Button>
      </div>
      {branchRemovalOptions.length > 0 ? (
        <div className="grid gap-2 rounded-2xl border border-amber-100 bg-amber-50/70 p-3">
          <div className="flex items-center justify-between">
            <strong className="text-xs font-semibold text-amber-800">
              특정 노선에서 제거
            </strong>
            <span className="text-[10px] font-semibold text-amber-700">
              제외
            </span>
          </div>
          <Field label="제거할 노선">
            <select
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium"
              value={removeBranchId}
              onChange={(event) => setRemoveBranchId(event.target.value)}
            >
              {branchRemovalOptions.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {formatBranchDisplayName(branch)}
                </option>
              ))}
            </select>
          </Field>
          <Button
            disabled={!removeBranchId}
            variant="outline"
            onClick={() => onExcludeFromBranch(removeBranchId)}
          >
            <Trash2 className="mr-1 size-4" />이 노선에서 역 제거
          </Button>
        </div>
      ) : (
        <div className="grid gap-2 rounded-2xl border border-blue-100 bg-blue-50/70 p-3">
          <div className="flex items-center justify-between">
            <strong className="text-xs font-semibold text-blue-800">
              지선 역으로 추가
            </strong>
            <span className="text-[10px] font-semibold text-blue-700">
              미소속 역
            </span>
          </div>
          <Field label="연결할 노선">
            <select
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium"
              value={addParentBranchId}
              onChange={(event) => setAddParentBranchId(event.target.value)}
              disabled={!canAddToBranch || branchAddOptions.length === 0}
            >
              {branchAddOptions.length === 0 ? (
                <option value="">연결 가능한 노선 없음</option>
              ) : (
                branchAddOptions.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {formatBranchDisplayName(branch)}
                  </option>
                ))
              )}
            </select>
          </Field>
          <Field label="기준 역">
            <select
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium"
              value={addAnchorStationId}
              onChange={(event) => setAddAnchorStationId(event.target.value)}
              disabled={!canAddToBranch || addAnchorStations.length === 0}
            >
              {addAnchorStations.length === 0 ? (
                <option value="">기준 역 없음</option>
              ) : (
                addAnchorStations.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.nameKo} · {candidate.lineNameKo}
                  </option>
                ))
              )}
            </select>
          </Field>
          <Button
            disabled={!addParentBranchId || !addAnchorStationId}
            onClick={() =>
              onCreateAddStationBranch(addParentBranchId, addAnchorStationId)
            }
          >
            <Plus className="mr-1 size-4" />이 역을 지선으로 추가
          </Button>
        </div>
      )}
      {endpointConnectOptions.length > 0 ? (
        <div className="grid gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3">
          <div className="flex items-center justify-between">
            <strong className="text-xs font-semibold text-emerald-800">
              이 역에서 노선 결합
            </strong>
            <span className="text-[10px] font-semibold text-emerald-700">
              시작/끝 역
            </span>
          </div>
          <Field label="기준 노선">
            <select
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium"
              value={connectParentBranchId}
              onChange={(event) => setConnectParentBranchId(event.target.value)}
            >
              {endpointConnectOptions.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {formatBranchDisplayName(branch)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="연결할 노선">
            <select
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium"
              value={connectBranchId}
              onChange={(event) => setConnectBranchId(event.target.value)}
              disabled={
                !connectParentBranch || connectOtherBranches.length === 0
              }
            >
              {connectOtherBranches.length === 0 ? (
                <option value="">연결 가능한 노선 없음</option>
              ) : (
                connectOtherBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {formatBranchDisplayName(branch)}
                  </option>
                ))
              )}
            </select>
          </Field>
          <Field label="연결 노선 연결 역">
            <select
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium"
              value={connectEndpointStationId}
              onChange={(event) =>
                setConnectEndpointStationId(event.target.value)
              }
              disabled={connectEndpointStations.length === 0}
            >
              {connectEndpointStations.length === 0 ? (
                <option value="">연결 역 없음</option>
              ) : (
                connectEndpointStations.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.nameKo} · {candidate.lineNameKo}
                  </option>
                ))
              )}
            </select>
          </Field>
          <Field label="연결 방향">
            <select
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium"
              value={connectDirection}
              onChange={(event) =>
                setConnectDirection(event.target.value as LineBranchDirection)
              }
              disabled={connectDirectionOptions.length === 0}
            >
              {connectDirectionOptions.length === 0 ? (
                <option value="toward-end">선택 가능한 방향 없음</option>
              ) : (
                connectDirectionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))
              )}
            </select>
          </Field>
          <Button
            disabled={
              !connectParentBranchId ||
              !connectBranchId ||
              !connectEndpointStationId ||
              connectDirectionOptions.length === 0
            }
            onClick={() =>
              onCreateConnectLineBranch(
                connectParentBranchId,
                connectBranchId,
                connectEndpointStationId,
                connectDirection,
              )
            }
          >
            <Route className="mr-1 size-4" />이 역에서 노선 결합
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function LineBranchValidationPanel({
  count,
  issues,
  overlays,
}: {
  count: number;
  issues: LineBranchValidationIssue[];
  overlays: ManualOverlayBundle;
}) {
  const webRows = getPublicWebManualChangeRows(overlays);
  const webChangeTotal = getPublicWebManualChangeTotal(overlays);

  return (
    <div className="grid gap-3">
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
        <strong className="text-sm font-semibold text-slate-700">
          오버레이/선형 검증
        </strong>
        <p className="mt-2 text-xs font-medium text-slate-500">
          지선 등록 {count}개 · 검증 항목 {issues.length}개
        </p>
      </div>
      <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <strong className="text-xs font-semibold text-blue-900">
              공개 Web 반영 대상
            </strong>
            <p className="mt-1 text-[11px] font-medium leading-4 text-blue-800">
              Editor override 중 공개 Web 렌더링과 데이터 계산에 반영되어야 하는
              항목입니다. 이 목록을 기준으로 Editor/Web 표시 차이를 줄입니다.
            </p>
          </div>
          <Badge className="shrink-0 bg-white/80 text-blue-700">
            {webChangeTotal}개
          </Badge>
        </div>
        <div className="mt-3 grid gap-1.5">
          {webRows.map((row) => (
            <div
              key={row.label}
              className="rounded-xl bg-white/75 px-3 py-2 text-[11px] font-medium text-slate-600"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">
                  {row.label}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                  {row.count.toLocaleString("ko-KR")}
                </span>
              </div>
              {row.count > 0 ? (
                <p className="mt-1 leading-4 text-slate-500">
                  {row.description}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-xl border border-blue-100 bg-white/70 px-3 py-2 text-[11px] font-semibold text-blue-800">
          {issues.length === 0
            ? "선형 검증 오류가 없어 공개 Web 반영 전제 조건이 충족되었습니다."
            : "선형/anchor 검증 오류가 남아 있으면 공개 Web에서도 같은 오류가 노출될 수 있습니다."}
        </div>
      </div>
      {issues.length === 0 ? (
        <Placeholder
          title="선형 검증 통과"
          description="역 위치, 본선/지선 선형, 저장된 anchor에서 감지된 불일치가 없습니다."
        />
      ) : (
        <div className="grid gap-2">
          {issues.map((issue) => (
            <div
              key={issue.id}
              className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
            >
              {issue.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BranchInspector({
  branch,
  branches,
  lineBranchOverrides,
  branchStationExclusions,
  unassignedStations,
  onDeleteLineBranch,
  onRestoreBranchStation,
}: {
  branch: EditorMapBranch;
  branches: EditorMapBranch[];
  lineBranchOverrides: ManualLineBranchOverride[];
  branchStationExclusions: ManualBranchStationExclusion[];
  unassignedStations: EditorStation[];
  onDeleteLineBranch: (id: string) => void;
  onRestoreBranchStation: (id: string) => void;
}) {
  const branchStations = getBranchStopStations(branch);
  const relatedLineBranches = lineBranchOverrides.filter(
    (override) =>
      override.parentBranchId === branch.id ||
      override.connectedBranchId === branch.id,
  );
  const branchStationExclusionsForBranch = branchStationExclusions.filter(
    (exclusion) =>
      exclusion.enabled !== false && exclusion.branchId === branch.id,
  );
  const stationIndex = new Map(
    [
      ...branchStations,
      ...unassignedStations,
      ...branches.flatMap(getBranchStopStations),
    ].map((station) => [station.id, station]),
  );
  const branchIndex = new Map(
    branches.map((candidate) => [candidate.id, candidate]),
  );

  return (
    <div className="grid gap-3">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <span
          className="block h-2 w-14 rounded-full"
          style={{ backgroundColor: branch.colorHex }}
        />
        <h3 className="mt-2 truncate text-base font-semibold">
          {branch.canonicalLineNameKo}
        </h3>
        <p className="mt-1 truncate text-xs font-medium text-slate-500">
          {branch.sourceLineName} · {branch.role}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white px-2 py-1.5">
            <p className="text-[10px] font-semibold text-slate-400">정차역</p>
            <p className="mt-1 text-sm font-bold text-slate-700">
              {branch.routeStopCount}
            </p>
          </div>
          <div className="rounded-xl bg-white px-2 py-1.5">
            <p className="text-[10px] font-semibold text-slate-400">기점</p>
            <p className="mt-1 truncate text-xs font-bold text-slate-700">
              {branch.origin ?? "-"}
            </p>
          </div>
          <div className="rounded-xl bg-white px-2 py-1.5">
            <p className="text-[10px] font-semibold text-slate-400">종점</p>
            <p className="mt-1 truncate text-xs font-bold text-slate-700">
              {branch.terminal ?? "-"}
            </p>
          </div>
        </div>
      </div>

      {branchStationExclusionsForBranch.length > 0 ? (
        <div className="grid gap-2 rounded-2xl border border-amber-100 bg-amber-50/70 p-3">
          <div className="flex items-center justify-between">
            <strong className="text-xs font-semibold text-amber-800">
              제거된 역
            </strong>
            <span className="text-[11px] font-semibold text-amber-700">
              {branchStationExclusionsForBranch.length}
            </span>
          </div>
          {branchStationExclusionsForBranch.map((exclusion) => {
            const station = stationIndex.get(exclusion.stationId);
            return (
              <div
                key={exclusion.id}
                className="flex items-center justify-between gap-2 rounded-2xl bg-white/75 px-3 py-2"
              >
                <span className="min-w-0 truncate text-xs font-semibold text-amber-800">
                  {formatStationDisplayName(station)}
                </span>
                <Button
                  variant="outline"
                  onClick={() => onRestoreBranchStation(exclusion.id)}
                >
                  복원
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="grid gap-2 rounded-2xl border border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <strong className="text-xs font-semibold text-slate-600">
            연결된 지선 오버레이
          </strong>
          <span className="text-[11px] font-semibold text-slate-400">
            {relatedLineBranches.length}
          </span>
        </div>
        {relatedLineBranches.length === 0 ? (
          <p className="text-xs font-medium text-slate-400">없음</p>
        ) : (
          relatedLineBranches.map((override) => {
            const display = getLineBranchDisplay(
              override,
              branchIndex,
              stationIndex,
            );
            return (
              <div
                key={override.id}
                className="grid gap-1.5 rounded-xl bg-slate-50 p-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-slate-700">
                    {display.title}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-5 text-slate-500">
                    {display.summary}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => onDeleteLineBranch(override.id)}
                >
                  <Trash2 className="mr-1 size-3" />
                  제거
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function TransferGroupInspector({
  group,
  draft,
  stationById,
  onChange,
  onSave,
  onDelete,
}: {
  group: ManualTransferGroup;
  draft: TransferGroupDraft;
  stationById: Map<string, EditorStation>;
  onChange: (draft: TransferGroupDraft) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  function updateMinute(pairKey: string, value: string) {
    const numberValue = value === "" ? null : Number(value);
    const nextValue =
      numberValue === null || !Number.isFinite(numberValue)
        ? null
        : Math.max(0, Math.round(numberValue));
    onChange({
      ...draft,
      transferMinutesByPair: {
        ...draft.transferMinutesByPair,
        [pairKey]: nextValue,
      },
    });
  }

  function removeStation(stationId: string) {
    const stationIds = draft.stationIds.filter((id) => id !== stationId);
    onChange({
      ...draft,
      stationIds,
      transferMinutesByPair: normalizeTransferGroupDraftPairs(
        stationIds,
        draft.transferMinutesByPair,
      ),
    });
  }

  return (
    <div className="grid gap-3">
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-base font-semibold">{group.nameKo}</h3>
        <p className="mt-1 text-xs font-medium text-slate-500">
          {group.stationIds.length}개 역 · {group.note || "메모 없음"}
        </p>
      </div>
      <Field label="그룹 이름">
        <Input
          value={draft.nameKo}
          onChange={(event) =>
            onChange({ ...draft, nameKo: event.target.value })
          }
        />
      </Field>
      <Field label="메모">
        <Textarea
          value={draft.note}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
        />
      </Field>
      <div className="grid gap-2 rounded-3xl border border-slate-200 p-2">
        <strong className="px-1 text-xs font-medium text-slate-600">
          환승 그룹 역 목록
        </strong>
        {draft.stationIds.map((stationId) => {
          const station = stationById.get(stationId);
          return (
            <div
              key={stationId}
              className="flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2"
            >
              <span className="min-w-0 text-xs font-medium text-slate-700">
                <span className="block truncate">
                  {station?.nameKo ?? stationId}
                </span>
                <span className="block truncate text-[11px] text-slate-400">
                  {station
                    ? formatStationSubLabel(station)
                    : "존재하지 않는 역"}
                </span>
              </span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removeStation(stationId)}
                disabled={draft.stationIds.length <= 2}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          );
        })}
      </div>
      <div className="grid gap-2 rounded-3xl border border-slate-200 p-2">
        <strong className="px-1 text-xs font-medium text-slate-600">
          역간 환승 시간표
        </strong>
        <div className="max-h-80 overflow-auto">
          <table className="w-full border-separate border-spacing-1 text-[11px]">
            <tbody>
              {draft.stationIds.map((rowId, rowIndex) => (
                <tr key={rowId}>
                  <th className="sticky left-0 max-w-24 truncate rounded-xl bg-white px-2 py-1 text-left font-medium text-slate-500">
                    {stationById.get(rowId)?.nameKo ?? rowId}
                  </th>
                  {draft.stationIds.map((colId, colIndex) => {
                    if (colIndex <= rowIndex)
                      return (
                        <td
                          key={colId}
                          className="rounded-xl bg-slate-50 px-2 py-1 text-center text-slate-300"
                        >
                          -
                        </td>
                      );
                    const pairKey = makeTransferPairKey(rowId, colId);
                    return (
                      <td key={colId} className="rounded-xl bg-slate-50 p-1">
                        <Input
                          className="h-7 px-2 text-[11px]"
                          value={draft.transferMinutesByPair[pairKey] ?? ""}
                          onChange={(event) =>
                            updateMinute(pairKey, event.target.value)
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={onDelete}>
          <Trash2 className="mr-1 size-4" />
          삭제
        </Button>
        <Button onClick={onSave}>
          <Save className="mr-1 size-4" />
          저장
        </Button>
      </div>
    </div>
  );
}

function NewTransferGroupInspector({
  draft,
  stationById,
  onChange,
  onSave,
  onCancel,
}: {
  draft: TransferGroupDraft;
  stationById: Map<string, EditorStation>;
  onChange: (draft: TransferGroupDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const previewGroup = toTransferGroup(draft);

  return (
    <div className="grid gap-3">
      <div className="rounded-3xl border border-blue-200 bg-blue-50 p-4">
        <h3 className="text-base font-semibold text-blue-950">새 환승 그룹</h3>
        <p className="mt-1 text-xs font-medium text-blue-700">
          선택한 환승 가능역으로 그룹을 생성합니다.
        </p>
      </div>
      <TransferGroupInspector
        group={previewGroup}
        draft={draft}
        stationById={stationById}
        onChange={onChange}
        onSave={onSave}
        onDelete={onCancel}
      />
    </div>
  );
}

function MultiStationInspector({
  ids,
  stationById,
  nonTransferIds,
  onSetNonTransfer,
  onCreateTransferGroup,
}: {
  ids: string[];
  stationById: Map<string, EditorStation>;
  nonTransferIds: Set<string>;
  onSetNonTransfer: (enabled: boolean) => void;
  onCreateTransferGroup: () => void;
}) {
  const allNonTransfer =
    ids.length > 0 && ids.every((id) => nonTransferIds.has(id));
  const allTransfer =
    ids.length > 0 && ids.every((id) => !nonTransferIds.has(id));

  return (
    <div className="grid gap-3">
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-base font-semibold">{ids.length}개 역 선택</h3>
        <p className="mt-1 text-xs font-normal text-slate-500">
          선택한 역에 일괄 작업을 적용합니다.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {!allNonTransfer ? (
          <Button variant="outline" onClick={() => onSetNonTransfer(true)}>
            미환승역
          </Button>
        ) : null}
        {!allTransfer ? (
          <Button variant="outline" onClick={() => onSetNonTransfer(false)}>
            환승 가능역
          </Button>
        ) : null}
        {ids.length >= 2 && !allNonTransfer ? (
          <Button className="col-span-2" onClick={onCreateTransferGroup}>
            환승 그룹 생성
          </Button>
        ) : null}
      </div>
      <div className="max-h-72 overflow-y-auto rounded-3xl border border-slate-200 p-2">
        {ids.map((id) => {
          const station = stationById.get(id);
          return (
            <p
              key={id}
              className="rounded-2xl px-3 py-2 text-xs font-medium text-slate-600"
            >
              {station ? `${station.nameKo} · ${station.lineNameKo}` : id}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-semibold text-slate-400">{label}</p>
      <p className="mt-1 break-all text-sm font-medium text-slate-700">
        {value}
      </p>
    </div>
  );
}

function ContextMenu({
  state,
  stationById,
  branchById,
  onClose,
  onSelectStation,
  onSelectBranch,
  onSetNonTransfer,
}: {
  state: NonNullable<ContextMenuState>;
  stationById: Map<string, EditorStation>;
  branchById: Map<string, EditorMapBranch>;
  onClose: () => void;
  onSelectStation: (id: string) => void;
  onSelectBranch: (id: string) => void;
  onSetNonTransfer: (id: string, enabled: boolean) => void;
}) {
  const station = state.stationId ? stationById.get(state.stationId) : null;
  const branch = state.branchId ? branchById.get(state.branchId) : null;

  return (
    <div
      className="absolute z-40 min-w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1 shadow-2xl"
      style={{ left: state.x, top: state.y }}
    >
      {station ? (
        <>
          <button
            type="button"
            className="block w-full rounded-xl px-3 py-2 text-left text-xs font-semibold hover:bg-blue-50"
            onClick={() => onSelectStation(station.id)}
          >
            역 선택: {station.nameKo}
          </button>
          <button
            type="button"
            className="block w-full rounded-xl px-3 py-2 text-left text-xs font-semibold hover:bg-blue-50"
            onClick={() => onSetNonTransfer(station.id, true)}
          >
            미환승역으로 설정
          </button>
          <button
            type="button"
            className="block w-full rounded-xl px-3 py-2 text-left text-xs font-semibold hover:bg-blue-50"
            onClick={() => onSetNonTransfer(station.id, false)}
          >
            환승 가능역으로 설정
          </button>
        </>
      ) : null}
      {branch ? (
        <button
          type="button"
          className="block w-full rounded-xl px-3 py-2 text-left text-xs font-semibold hover:bg-blue-50"
          onClick={() => onSelectBranch(branch.id)}
        >
          노선 선택: {branch.canonicalLineNameKo}
        </button>
      ) : null}
      {!station && !branch ? (
        <p className="px-3 py-2 text-xs font-medium text-slate-400">
          선택 가능한 객체 없음
        </p>
      ) : null}
      <button
        type="button"
        className="block w-full rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-500 hover:bg-slate-100"
        onClick={onClose}
      >
        닫기
      </button>
    </div>
  );
}
