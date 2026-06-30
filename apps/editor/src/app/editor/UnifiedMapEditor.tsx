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
  ManualGeometryOverride,
  ManualGeometryOverridePoint,
  ManualLineBranchOverride,
  ManualOverlayBundle,
  ManualStationOverride,
  ManualTransferGroup,
} from "../editorModel";
import {
  EMPTY_MANUAL_OVERLAY_BUNDLE,
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

type SidebarTab =
  "search" | "layers" | "transfers" | "geometry" | "validation" | "history";
type ToolMode = "select" | "box" | "geometry";
type IconComponent = ComponentType<{ className?: string }>;
type LngLatTuple = [number, number];

function addTransferIconImage(map: MapLibreMap) {
  if (map.hasImage("transfer-icon")) return;

  const commitCanvas = (draw: (context: CanvasRenderingContext2D, size: number) => void) => {
    if (map.hasImage("transfer-icon")) return;
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, size, size);
    draw(context, size);
    const imageData = context.getImageData(0, 0, size, size);
    if (!map.hasImage("transfer-icon")) {
      map.addImage("transfer-icon", imageData, { pixelRatio: 2 });
    }
  };

  const drawFallback = (context: CanvasRenderingContext2D, size: number) => {
    const center = size / 2;
    const radius = size * 0.43;
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.fillStyle = "#ffffff";
    context.fill();
    context.lineWidth = size * 0.08;
    context.strokeStyle = "#334155";
    context.stroke();
    context.beginPath();
    context.arc(center, center, radius * 0.76, -Math.PI / 2, Math.PI / 2);
    context.fillStyle = "#cd2e3a";
    context.fill();
    context.beginPath();
    context.arc(center, center, radius * 0.76, Math.PI / 2, Math.PI * 1.5);
    context.fillStyle = "#0047a0";
    context.fill();
    context.beginPath();
    context.arc(center, center - radius * 0.38, radius * 0.38, 0, Math.PI * 2);
    context.fillStyle = "#0047a0";
    context.fill();
    context.beginPath();
    context.arc(center, center + radius * 0.38, radius * 0.38, 0, Math.PI * 2);
    context.fillStyle = "#cd2e3a";
    context.fill();
  };

  const image = new Image();
  image.onload = () => {
    commitCanvas((context, size) => context.drawImage(image, 0, 0, size, size));
  };
  image.onerror = () => {
    commitCanvas(drawFallback);
  };
  image.src = "/transfer.svg";
}


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

type GeometryDraft = {
  branchId: string;
  points: ManualGeometryOverridePoint[];
  note: string;
};

type LineBranchValidationIssue = {
  id: string;
  message: string;
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
    mode: "box",
    label: "박스 선택",
    description: "드래그한 영역 안의 역을 여러 개 선택",
    Icon: Waypoints,
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

function buildTransferGroupCircleCoordinates(members: Array<EditorStation & { lat: number; lng: number }>) {
  const centerLng = members.reduce((sum, station) => sum + station.lng, 0) / members.length;
  const centerLat = members.reduce((sum, station) => sum + station.lat, 0) / members.length;
  const lngScale = Math.max(0.35, Math.cos((centerLat * Math.PI) / 180));
  const radius = Math.max(
    0.00075,
    ...members.map((station) => {
      const dx = (station.lng - centerLng) * lngScale;
      const dy = station.lat - centerLat;
      return Math.sqrt(dx * dx + dy * dy) * 1.18;
    }),
  );

  const coordinates: LngLatTuple[] = [];
  const segments = 48;
  for (let index = 0; index <= segments; index += 1) {
    const angle = (Math.PI * 2 * index) / segments;
    coordinates.push([
      centerLng + (Math.cos(angle) * radius) / lngScale,
      centerLat + Math.sin(angle) * radius,
    ]);
  }

  return coordinates;
}

async function buildTransferGroupAreaFeaturesChunked(
  groups: ManualTransferGroup[],
  stationById: Map<string, EditorStation>,
  selectedGroupId: string | null,
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

      const coordinates = buildTransferGroupCircleCoordinates(members);

      features.push({
        type: "Feature",
        properties: {
          id: group.id,
          nameKo: group.nameKo,
          stationCount: members.length,
          selected: selectedGroupId === group.id,
        },
        geometry: { type: "Polygon", coordinates: [coordinates] },
      });
    }

    await yieldToMainThread();
  }

  return { type: "FeatureCollection", features };
}

async function buildTransferGroupIconFeaturesChunked(
  groups: ManualTransferGroup[],
  stationById: Map<string, EditorStation>,
  selectedGroupId: string | null,
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

      const lng =
        members.reduce((sum, station) => sum + station.lng, 0) / members.length;
      const lat =
        members.reduce((sum, station) => sum + station.lat, 0) / members.length;

      features.push({
        type: "Feature",
        properties: {
          id: group.id,
          nameKo: group.nameKo,
          stationCount: members.length,
          selected: selectedGroupId === group.id,
        },
        geometry: { type: "Point", coordinates: [lng, lat] as LngLatTuple },
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

      if (!getBranchEndpointStationIds(parentBranch).has(override.anchorStationId)) {
        issues.push({
          id: `${override.id}:parent-endpoint`,
          message: `상위 노선 연결 역이 endpoint가 아님: ${formatStationDisplayName(stationById.get(override.anchorStationId))}`,
        });
      }

      const connectedEndpoint = override.connectedEndpointStationId;
      if (
        !connectedEndpoint ||
        !getBranchEndpointStationIds(connectedBranch).has(connectedEndpoint)
      ) {
        issues.push({
          id: `${override.id}:connected-endpoint`,
          message: `연결 노선의 선택 역이 endpoint가 아님: ${formatStationDisplayName(connectedEndpoint ? stationById.get(connectedEndpoint) : null)}`,
        });
      }
    }
  }

  return issues;
}


function formatBranchDisplayName(branch: EditorMapBranch | null | undefined) {
  if (!branch) return "알 수 없는 노선";
  const sourceName = branch.sourceLineName && branch.sourceLineName !== branch.canonicalLineNameKo ? ` · ${branch.sourceLineName}` : "";
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
    const branchStation = override.branchStationId ? stationById.get(override.branchStationId) ?? null : null;
    return {
      title: "지선 역 추가",
      summary: `${formatBranchDisplayName(parentBranch)} · ${formatStationDisplayName(anchorStation)} → ${formatStationDisplayName(branchStation)}`,
      detail: "미소속 역을 선택한 노선의 특정 역에 연결합니다.",
    };
  }

  const connectedBranch = override.connectedBranchId ? branchById.get(override.connectedBranchId) ?? null : null;
  const connectedStation = override.connectedEndpointStationId ? stationById.get(override.connectedEndpointStationId) ?? null : null;

  return {
    title: "지선 노선 결합",
    summary: `${formatBranchDisplayName(parentBranch)} · ${formatStationDisplayName(anchorStation)} ↔ ${formatBranchDisplayName(connectedBranch)} · ${formatStationDisplayName(connectedStation)}`,
    detail: "두 노선의 endpoint를 연결합니다.",
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
    points.length >= 3 || (override.geometry ?? []).some((point) => point.kind === "control");

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

function orientBranchCoordinatesFromEndpoint(
  branch: EditorMapBranch,
  endpointStationId: string,
  endpointRole: "start" | "end",
) {
  const points = getBranchStopCoordinatePoints(branch);
  if (points.length < 2) return [];

  const index = points.findIndex((point) => point.stationId === endpointStationId);
  if (index < 0) return [];

  const coordinates = points.map((point) => point.coordinate);
  if (endpointRole === "end") return index === 0 ? [...coordinates].reverse() : coordinates;
  return index === points.length - 1 ? [...coordinates].reverse() : coordinates;
}

function buildConnectLineBranchCoordinates(
  override: ManualLineBranchOverride,
  parentBranch: EditorMapBranch | null,
  connectedBranch: EditorMapBranch | null,
) {
  if (!parentBranch || !connectedBranch || !override.connectedEndpointStationId) return [];

  const parentCoordinates = orientBranchCoordinatesFromEndpoint(
    parentBranch,
    override.anchorStationId,
    "end",
  );
  const connectedCoordinates = orientBranchCoordinatesFromEndpoint(
    connectedBranch,
    override.connectedEndpointStationId,
    "start",
  );

  if (parentCoordinates.length < 2 || connectedCoordinates.length < 2) return [];

  return smoothCoordinates([...parentCoordinates, ...connectedCoordinates]);
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
    return buildAddStationLineBranchCoordinates(override, parentBranch, stationById);
  }

  return buildConnectLineBranchCoordinates(override, parentBranch, connectedBranch);
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
      const connectedBranch = override.connectedBranchId ? branchById.get(override.connectedBranchId) ?? null : null;
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


function getStationCoordinate(station: EditorStation | null | undefined): LngLatTuple | null {
  if (!station || station.lng === null || station.lat === null) return null;
  if (!Number.isFinite(station.lng) || !Number.isFinite(station.lat)) return null;
  return [station.lng, station.lat];
}

function getUnassignedStations(stations: EditorStation[], branches: EditorMapBranch[]): EditorStation[] {
  const assignedStationIds = new Set(branches.flatMap(getBranchStationIds));
  return stations.filter((station) => !assignedStationIds.has(station.id));
}

function getBranchStopStations(branch: EditorMapBranch): EditorStation[] {
  return branch.routeStops
    .map((stop) => stop.station)
    .filter((station): station is EditorStation => Boolean(station));
}

function getBranchEndpointStations(branch: EditorMapBranch): EditorStation[] {
  const stations = getBranchStopStations(branch);
  return [stations[0], stations.at(-1)].filter(
    (station, index, values): station is EditorStation =>
      Boolean(station) && values.findIndex((candidate) => candidate?.id === station?.id) === index,
  );
}

function makeLineBranchGeometry(anchor: EditorStation, target: EditorStation) {
  const anchorCoordinate = getStationCoordinate(anchor);
  const targetCoordinate = getStationCoordinate(target);
  if (!anchorCoordinate || !targetCoordinate) return undefined;

  return [
    { lng: anchorCoordinate[0], lat: anchorCoordinate[1], kind: "station" as const, stationId: anchor.id },
    { lng: targetCoordinate[0], lat: targetCoordinate[1], kind: "station" as const, stationId: target.id },
  ];
}


function branchCoordinates(branch: EditorMapBranch): LngLatTuple[] {
  const override = (branch.geometryOverrideCoordinates ?? []).filter(
    ([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat),
  ) as LngLatTuple[];
  if (override.length >= 2) return override;

  return (branch.geometryCoordinates ?? []).filter(
    ([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat),
  ) as LngLatTuple[];
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

function makeGeometryDraftFromBranch(
  branch: EditorMapBranch,
  previous?: ManualGeometryOverride,
): GeometryDraft {
  const points = previous?.points.length
    ? previous.points
    : branchCoordinates(branch).map((coordinates, index, array) => ({
        lng: coordinates[0],
        lat: coordinates[1],
        kind:
          index === 0 || index === array.length - 1
            ? ("station" as const)
            : ("control" as const),
      }));

  return {
    branchId: branch.id,
    points,
    note: previous?.note ?? "",
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
  const selectStationFromMapRef = useRef<(stationId: string) => void>(
    () => undefined,
  );
  const selectBranchFromMapRef = useRef<(branchId: string) => void>(
    () => undefined,
  );
  const selectTransferGroupFromMapRef = useRef<(groupId: string) => void>(
    () => undefined,
  );
  const toolModeRef = useRef<ToolMode>("select");
  const stationLocationPickModeRef = useRef(false);
  const showToastRef = useRef<(message: string, tone?: ToastTone) => void>(
    () => undefined,
  );
  const setStationDraftFromMapRef = useRef<(lng: number, lat: number) => void>(
    () => undefined,
  );
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
  const [mapLoaded, setMapLoaded] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [stationLocationPickMode, setStationLocationPickMode] = useState(false);
  const [transferDraft, setTransferDraft] = useState<TransferGroupDraft | null>(
    null,
  );
  const [geometryDraft, setGeometryDraft] = useState<GeometryDraft | null>(
    null,
  );

  const stationById = useMemo(
    () => new Map(data.stations.map((station) => [station.id, station])),
    [data.stations],
  );
  const branchById = useMemo(
    () => new Map(data.branches.map((branch) => [branch.id, branch])),
    [data.branches],
  );
  const lineBranchIssues = useMemo(
    () => validateLineBranchOverrides(overlays, data.branches, stationById),
    [data.branches, overlays, stationById],
  );
  const groupById = useMemo(
    () =>
      new Map(overlays.manualTransferGroups.map((group) => [group.id, group])),
    [overlays.manualTransferGroups],
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
  }, [stationLocationPickMode]);

  useEffect(() => {
    setStationDraftFromMapRef.current = (lng, lat) =>
      setStationDraft((previous) =>
        previous ? { ...previous, lng, lat } : previous,
      );
  }, []);

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

  const selectStation = useCallback(
    (stationId: string, shouldFocus = true) => {
      setSelection({ type: "station", id: stationId });
      const station = stationById.get(stationId);
      const previous = overlays.stationOverrides.find(
        (override) => override.stationId === stationId,
      );
      if (station) setStationDraft(emptyStationOverride(station, previous));
      setTransferDraft(null);
      setGeometryDraft(null);
      setStationLocationPickMode(false);
      if (shouldFocus) focusStation(stationId);
    },
    [focusStation, overlays.stationOverrides, stationById],
  );

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
    selectBranchFromMapRef.current = selectBranch;
  }, [selectBranch]);

  useEffect(() => {
    selectTransferGroupFromMapRef.current = selectTransferGroup;
  }, [selectTransferGroup]);

  useEffect(() => {
    toolModeRef.current = toolMode;
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
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
      addTransferIconImage(map);

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
        minzoom: 12,
        maxzoom: 15,
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "selected"], true],
            "#2563eb",
            "#0f172a",
          ],
          "fill-opacity": [
            "case",
            ["==", ["get", "selected"], true],
            0.34,
            0.22,
          ],
        },
      });

      map.addLayer({
        id: "railmap-transfer-group-area-outline",
        type: "line",
        source: "railmap-transfer-group-areas",
        minzoom: 12,
        maxzoom: 15,
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "selected"], true],
            "#2563eb",
            "#64748b",
          ],
          "line-width": ["case", ["==", ["get", "selected"], true], 3.4, 2.2],
          "line-opacity": 0.9,
        },
      });

      map.addLayer({
        id: "railmap-transfer-group-hit",
        type: "circle",
        source: "railmap-transfer-group-icons",
        maxzoom: 15,
        paint: {
          "circle-radius": 12,
          "circle-color": "#000000",
          "circle-opacity": 0.01,
        },
      });

      map.addLayer({
        id: "railmap-transfer-group-casing",
        type: "circle",
        source: "railmap-transfer-group-icons",
        maxzoom: 15,
        paint: {
          "circle-color": "#ffffff",
          "circle-radius": ["case", ["==", ["get", "selected"], true], 7.2, 5.8],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "selected"], true],
            "#2563eb",
            "#475569",
          ],
          "circle-stroke-width": [
            "case",
            ["==", ["get", "selected"], true],
            1.8,
            1.1,
          ],
          "circle-opacity": 0.96,
        },
      });

      map.addLayer({
        id: "railmap-transfer-group-icon",
        type: "symbol",
        source: "railmap-transfer-group-icons",
        maxzoom: 15,
        layout: {
          "icon-image": "transfer-icon",
          "icon-size": ["case", ["==", ["get", "selected"], true], 0.038, 0.032],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });

      map.addLayer({
        id: "railmap-transfer-group-label",
        type: "symbol",
        source: "railmap-transfer-group-icons",
        minzoom: 12,
        maxzoom: 15,
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
          "text-halo-width": 1.5,
        },
      });

      map.addLayer({
        id: "railmap-stations-circle",
        type: "circle",
        source: "railmap-stations",
        paint: {
          "circle-color": ["get", "colorHex"],
          "circle-radius": [
            "case",
            ["boolean", ["get", "selected"], false],
            7,
            4.5,
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
          "circle-opacity": [
            "step",
            ["zoom"],
            ["case", ["==", ["get", "isTransferChild"], true], 0, 0.96],
            15,
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
            15,
            12,
          ],
          "circle-color": "#000000",
          "circle-opacity": 0.01,
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
            15.6,
            0.92,
          ],
        },
      });

      map.addLayer({
        id: "railmap-selected-stations-label",
        type: "symbol",
        source: "railmap-stations",
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

      window.requestAnimationFrame(() => setMapLoaded(true));
    });

    map.on("mousemove", (event) => {
      pendingCursorLngLatRef.current = {
        lng: event.lngLat.lng,
        lat: event.lngLat.lat,
      };

      if (!selectionBoxStartRef.current) {
        const queryLayers = [
          "railmap-stations-hit",
          "railmap-stations-circle",
          "railmap-transfer-group-hit",
          "railmap-transfer-group-area-fill",
          "railmap-selected-branches-line",
          "railmap-branches-line",
        ].filter((layerId) => map.getLayer(layerId));
        const features =
          queryLayers.length > 0
            ? map.queryRenderedFeatures(event.point, { layers: queryLayers })
            : [];
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

      if (cursorFrameRef.current !== null) return;
      cursorFrameRef.current = window.requestAnimationFrame(() => {
        cursorFrameRef.current = null;
        if (pendingCursorLngLatRef.current)
          setCursorLngLat(pendingCursorLngLatRef.current);
      });
    });
    map.on("zoomend", () => setZoom(map.getZoom()));

    map.on("click", (event) => {
      if (stationLocationPickModeRef.current) {
        setStationDraftFromMapRef.current(event.lngLat.lng, event.lngLat.lat);
        stationLocationPickModeRef.current = false;
        setStationLocationPickMode(false);
        showToastRef.current("지도 좌표가 입력되었습니다", "success");
        return;
      }

      const queryLayers = [
        "railmap-stations-hit",
        "railmap-stations-circle",
        "railmap-transfer-group-hit",
        "railmap-transfer-group-area-fill",
        "railmap-selected-branches-line",
        "railmap-branches-line",
      ].filter((layerId) => map.getLayer(layerId));
      const features =
        queryLayers.length > 0
          ? map.queryRenderedFeatures(event.point, { layers: queryLayers })
          : [];
      const stationId = firstFeatureId(features, [
        "railmap-stations-hit",
        "railmap-stations-circle",
      ]);
      if (stationId) {
        selectStationFromMapRef.current(stationId);
        return;
      }

      const transferGroupId = firstFeatureId(features, [
        "railmap-transfer-group-hit",
        "railmap-transfer-group-area-fill",
      ]);
      if (transferGroupId) {
        selectTransferGroupFromMapRef.current(transferGroupId);
        return;
      }

      const branchId = firstFeatureId(features, [
        "railmap-selected-branches-line",
        "railmap-branches-line",
      ]);
      if (branchId) selectBranchFromMapRef.current(branchId);
    });

    map.on("contextmenu", (event) => {
      event.preventDefault();
      const queryLayers = [
        "railmap-stations-hit",
        "railmap-stations-circle",
        "railmap-transfer-group-hit",
        "railmap-transfer-group-area-fill",
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
        stationId: firstFeatureId(features, [
          "railmap-stations-hit",
          "railmap-stations-circle",
        ]),
        branchId: firstFeatureId(features, [
          "railmap-selected-branches-line",
          "railmap-branches-line",
        ]),
      });
    });

    map.on("mousedown", (event) => {
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
      const start = selectionBoxStartRef.current;
      if (!start) return;
      const box = [
        [Math.min(start.x, event.point.x), Math.min(start.y, event.point.y)],
        [Math.max(start.x, event.point.x), Math.max(start.y, event.point.y)],
      ] as [[number, number], [number, number]];
      const selected = map
        .queryRenderedFeatures(box, {
          layers: ["railmap-stations-hit", "railmap-stations-circle"],
        })
        .map((feature) => feature.properties?.id as string | undefined)
        .filter((id): id is string => Boolean(id));
      const ids = [...new Set(selected)];
      if (ids.length === 1) selectStationFromMapRef.current(ids[0] ?? "");
      if (ids.length > 1) setSelection({ type: "multiStation", ids });
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
          data.stations,
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
    data.stations,
    dataLoading,
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
          data.branches,
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
  }, [data.branches, dataLoading, layers.lines, mapLoaded]);

  useEffect(() => {
    if (!mapLoaded || dataLoading) return;

    let cancelled = false;
    const idleId = scheduleIdle(() => {
      void (async () => {
        const features = await buildLineBranchFeaturesChunked(
          overlays.lineBranchOverrides ?? [],
          branchById,
          stationById,
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
  }, [branchById, dataLoading, layers.lines, mapLoaded, overlays.lineBranchOverrides, stationById]);

  useEffect(() => {
    if (!mapLoaded || dataLoading) return;

    let cancelled = false;
    const idleId = scheduleIdle(() => {
      void (async () => {
        const [areaFeatures, iconFeatures] = await Promise.all([
          buildTransferGroupAreaFeaturesChunked(
            overlays.manualTransferGroups,
            stationById,
            selectedTransferGroupId,
            () => cancelled,
          ),
          buildTransferGroupIconFeaturesChunked(
            overlays.manualTransferGroups,
            stationById,
            selectedTransferGroupId,
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
    selectedTransferGroupId,
    stationById,
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

  async function saveStationDraft() {
    if (!stationDraft) return;
    const next: ManualOverlayBundle = {
      ...overlays,
      stationOverrides: [
        ...overlays.stationOverrides.filter(
          (override) => override.stationId !== stationDraft.stationId,
        ),
        stationDraft,
      ],
    };
    const saved = await executeOverlayCommand(
      "역 보정",
      next,
      "역 보정 저장 완료",
    );
    if (!saved) return;

    setData((previous) => ({
      ...previous,
      stations: previous.stations.map((station) =>
        station.id === stationDraft.stationId
          ? {
              ...station,
              nameKo: stationDraft.nameKo?.trim() || station.nameKo,
              lat:
                typeof stationDraft.lat === "number" &&
                Number.isFinite(stationDraft.lat)
                  ? stationDraft.lat
                  : station.lat,
              lng:
                typeof stationDraft.lng === "number" &&
                Number.isFinite(stationDraft.lng)
                  ? stationDraft.lng
                  : station.lng,
            }
          : station,
      ),
    }));
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

  async function saveGeometryDraft() {
    if (!geometryDraft) return;
    const override = toGeometryOverride(geometryDraft);
    if (override.points.length < 2) {
      showToast("선형은 좌표가 2개 이상 필요합니다", "error");
      return;
    }

    const next: ManualOverlayBundle = {
      ...overlays,
      geometryOverrides: [
        ...overlays.geometryOverrides.filter(
          (candidate) => candidate.branchId !== override.branchId,
        ),
        override,
      ],
    };

    const saved = await executeOverlayCommand(
      "선형 보정",
      next,
      "선형 보정 저장 완료",
    );
    if (!saved) return;

    setData((previous) => ({
      ...previous,
      branches: previous.branches.map((branch) =>
        branch.id === override.branchId
          ? {
              ...branch,
              geometryOverrideCoordinates: override.points.map(
                (point) => [point.lng, point.lat] as [number, number],
              ),
              geometryCoordinates: override.points.map(
                (point) => [point.lng, point.lat] as [number, number],
              ),
            }
          : branch,
      ),
    }));
  }

  async function clearGeometryOverride(branchId: string) {
    const next: ManualOverlayBundle = {
      ...overlays,
      geometryOverrides: overlays.geometryOverrides.filter(
        (override) => override.branchId !== branchId,
      ),
    };
    await executeOverlayCommand("선형 보정 제거", next, "선형 보정 제거 완료");
    const branch = branchById.get(branchId);
    setGeometryDraft(branch ? makeGeometryDraftFromBranch(branch) : null);
  }

  function createTransferGroupFromSelection(ids: string[]) {
    const uniqueIds = [...new Set(ids)].filter((id) => !nonTransferIds.has(id));
    if (uniqueIds.length < 2) {
      showToast("환승 가능역 2개 이상을 선택해야 합니다", "error");
      return;
    }
    setTransferDraft(makeTransferDraftFromStations(uniqueIds, stationById));
    setSelection({ type: "multiStation", ids: uniqueIds });
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


  async function createAddStationLineBranch(parentBranchId: string, anchorStationId: string, branchStationId: string) {
    const parentBranch = branchById.get(parentBranchId);
    const anchorStation = stationById.get(anchorStationId);
    const branchStation = stationById.get(branchStationId);

    if (!parentBranch || !anchorStation || !branchStation) {
      showToast("지선 추가에 필요한 역/branch를 찾지 못했습니다", "error");
      return;
    }

    const assignedStationIds = new Set(data.branches.flatMap(getBranchStationIds));
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
      id: makeLineBranchOverrideId("add-station", parentBranchId, anchorStationId, branchStationId),
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
        ...overlays.lineBranchOverrides.filter((candidate) => candidate.id !== override.id),
        override,
      ],
    };

    await executeOverlayCommand("지선 역 추가", next, "지선 역 추가 완료");
    setSidebarTab("validation");
  }

  async function createConnectLineBranch(parentBranchId: string, anchorStationId: string, connectedBranchId: string, connectedEndpointStationId: string) {
    const parentBranch = branchById.get(parentBranchId);
    const connectedBranch = branchById.get(connectedBranchId);
    const anchorStation = stationById.get(anchorStationId);
    const connectedEndpointStation = stationById.get(connectedEndpointStationId);

    if (!parentBranch || !connectedBranch || !anchorStation || !connectedEndpointStation) {
      showToast("지선 결합에 필요한 역/branch를 찾지 못했습니다", "error");
      return;
    }

    if (parentBranch.id === connectedBranch.id) {
      showToast("같은 branch끼리는 결합할 수 없습니다", "error");
      return;
    }

    if (!getBranchEndpointStationIds(parentBranch).has(anchorStationId)) {
      showToast("상위 branch의 첫 번째/마지막 역만 결합 anchor로 사용할 수 있습니다", "error");
      return;
    }

    if (!getBranchEndpointStationIds(connectedBranch).has(connectedEndpointStationId)) {
      showToast("연결 branch의 첫 번째/마지막 역만 결합할 수 있습니다", "error");
      return;
    }

    const override: ManualLineBranchOverride = {
      id: makeLineBranchOverrideId("connect-line", parentBranchId, anchorStationId, `${connectedBranchId}:${connectedEndpointStationId}`),
      mode: "connect-line",
      parentBranchId,
      anchorStationId,
      connectedBranchId,
      connectedEndpointStationId,
      geometry: makeLineBranchGeometry(anchorStation, connectedEndpointStation),
      enabled: true,
      source: "editor",
      note: null,
    };

    const next: ManualOverlayBundle = {
      ...overlays,
      lineBranchOverrides: [
        ...overlays.lineBranchOverrides.filter((candidate) => candidate.id !== override.id),
        override,
      ],
    };

    await executeOverlayCommand("지선 노선 결합", next, "지선 노선 결합 완료");
    setSidebarTab("validation");
  }

  async function deleteLineBranchOverride(id: string) {
    const next: ManualOverlayBundle = {
      ...overlays,
      lineBranchOverrides: overlays.lineBranchOverrides.filter((override) => override.id !== id),
    };

    await executeOverlayCommand("지선 제거", next, "지선 제거 완료");
    setSidebarTab("validation");
  }

  const selectedStation =
    selection.type === "station"
      ? (stationById.get(selection.id) ?? null)
      : null;
  const selectedBranch =
    selection.type === "branch" ? (branchById.get(selection.id) ?? null) : null;
  const selectedGroup =
    selection.type === "transferGroup"
      ? (groupById.get(selection.id) ?? null)
      : null;
  const multiStationIds =
    selection.type === "multiStation" ? selection.ids : [];
  const canUndo = historyVersion >= 0 && undoStackRef.current.length > 0;
  const canRedo = historyVersion >= 0 && redoStackRef.current.length > 0;

  return (
    <AppShell>
      <InspectorGrid>
        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <PanelHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  Railmap
                </p>
                <h1 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                  통합 맵 에디터
                </h1>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => void undoOverlayCommand()}
                  disabled={!canUndo}
                  aria-label="되돌리기"
                >
                  <Undo2 className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => void redoOverlayCommand()}
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
            <TabList className="mt-2 grid grid-cols-3">
              <TabButton
                active={sidebarTab === "geometry"}
                onClick={() => setSidebarTab("geometry")}
              >
                선형
              </TabButton>
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
          </PanelHeader>

          <PanelBody className="min-h-0 flex-1 overflow-y-auto">
            {sidebarTab === "search" ? (
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

            {sidebarTab === "layers" ? (
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

            {sidebarTab === "transfers" ? (
              <div className="grid gap-2">
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

            {sidebarTab === "geometry" ? (
              <div className="grid gap-2">
                {data.branches.slice(0, 200).map((branch) => (
                  <button
                    key={branch.id}
                    type="button"
                    className="rounded-2xl border border-slate-200 bg-white p-3 text-left hover:bg-blue-50"
                    onClick={() => selectBranch(branch.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-1.5 w-8 rounded-full"
                        style={{ backgroundColor: branch.colorHex }}
                      />
                      <strong className="truncate text-sm font-semibold">
                        {branch.canonicalLineNameKo}
                      </strong>
                    </div>
                    <p className="mt-1 truncate text-xs font-medium text-slate-500">
                      {branch.sourceLineName} · {branch.routeStopCount} stops
                    </p>
                  </button>
                ))}
              </div>
            ) : null}

            {sidebarTab === "validation" ? (
              <LineBranchValidationPanel
                count={overlays.lineBranchOverrides?.length ?? 0}
                issues={lineBranchIssues}
              />
            ) : null}
            {sidebarTab === "history" ? (
              <CommandHistoryPanel
                undoCount={undoStackRef.current.length}
                redoCount={redoStackRef.current.length}
                latest={undoStackRef.current.at(-1)}
              />
            ) : null}
          </PanelBody>
        </Panel>

        <main className="relative min-h-0 overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-xl">
          <div ref={mapContainerRef} className="absolute inset-0" />
          <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-2">
            <Badge className="bg-white/90 text-slate-700">
              {selectionLabel(selection)}
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
              Inspector
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
              {selectionLabel(selection)}
            </h2>
          </PanelHeader>
          <PanelBody className="min-h-0 flex-1 overflow-y-auto">
            {selectedStation && stationDraft ? (
              <StationInspector
                station={selectedStation}
                draft={stationDraft}
                nonTransfer={nonTransferIds.has(selectedStation.id)}
                onChange={setStationDraft}
                onSave={() => void saveStationDraft()}
                onSetNonTransfer={(enabled) =>
                  void setStationsNonTransfer([selectedStation.id], enabled)
                }
                onStartMapPick={() => setStationLocationPickMode(true)}
                onFocus={() => focusStation(selectedStation.id)}
                pickMode={stationLocationPickMode}
              />
            ) : null}
            {selectedBranch && geometryDraft ? (
              <BranchInspector
                branch={selectedBranch}
                draft={geometryDraft}
                branches={data.branches}
                lineBranchOverrides={overlays.lineBranchOverrides}
                unassignedStations={unassignedStations}
                onChange={setGeometryDraft}
                onSave={() => void saveGeometryDraft()}
                onClear={() => void clearGeometryOverride(selectedBranch.id)}
                onCreateAddStation={(anchorStationId, branchStationId) =>
                  void createAddStationLineBranch(
                    selectedBranch.id,
                    anchorStationId,
                    branchStationId,
                  )
                }
                onCreateConnectLine={(
                  anchorStationId,
                  connectedBranchId,
                  connectedEndpointStationId,
                ) =>
                  void createConnectLineBranch(
                    selectedBranch.id,
                    anchorStationId,
                    connectedBranchId,
                    connectedEndpointStationId,
                  )
                }
                onDeleteLineBranch={(id) => void deleteLineBranchOverride(id)}
              />
            ) : null}
            {selectedGroup && transferDraft ? (
              <TransferGroupInspector
                group={selectedGroup}
                draft={transferDraft}
                stationById={stationById}
                onChange={setTransferDraft}
                onSave={() => void saveTransferDraft()}
                onDelete={() => void deleteTransferGroup(selectedGroup.id)}
              />
            ) : null}
            {!selectedGroup && transferDraft ? (
              <NewTransferGroupInspector
                draft={transferDraft}
                stationById={stationById}
                onChange={setTransferDraft}
                onSave={() => void saveTransferDraft()}
                onCancel={() => setTransferDraft(null)}
              />
            ) : null}
            {multiStationIds.length > 0 && !transferDraft ? (
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
            {selection.type === "none" ? (
              <Placeholder
                title="객체를 선택하세요"
                description="지도에서 역/노선선을 클릭하거나 Cmd/Ctrl+K로 검색하세요."
              />
            ) : null}
          </PanelBody>
        </Panel>
      </InspectorGrid>

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

function Placeholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
      <strong className="text-sm font-semibold text-slate-700">{title}</strong>
      <p className="mt-2 text-xs font-medium leading-5 text-slate-500">
        {description}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
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
  onSetNonTransfer,
  onStartMapPick,
  onFocus,
}: {
  station: EditorStation;
  draft: ManualStationOverride;
  nonTransfer: boolean;
  pickMode: boolean;
  onChange: (next: ManualStationOverride) => void;
  onSave: () => void;
  onSetNonTransfer: (enabled: boolean) => void;
  onStartMapPick: () => void;
  onFocus: () => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
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
        <p className="mt-2 break-all text-[11px] font-medium text-slate-400">
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
    </div>
  );
}

function LineBranchValidationPanel({
  count,
  issues,
}: {
  count: number;
  issues: LineBranchValidationIssue[];
}) {
  return (
    <div className="grid gap-3">
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
        <strong className="text-sm font-semibold text-slate-700">
          지선 오버레이
        </strong>
        <p className="mt-2 text-xs font-medium text-slate-500">
          등록 {count}개 · 오류 {issues.length}개
        </p>
      </div>
      {issues.length === 0 ? (
        <Placeholder
          title="지선 검증 통과"
          description="현재 저장된 지선 오버레이에서 기본 검증 오류가 없습니다."
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
  draft,
  branches,
  lineBranchOverrides,
  unassignedStations,
  onChange,
  onSave,
  onClear,
  onCreateAddStation,
  onCreateConnectLine,
  onDeleteLineBranch,
}: {
  branch: EditorMapBranch;
  draft: GeometryDraft;
  branches: EditorMapBranch[];
  lineBranchOverrides: ManualLineBranchOverride[];
  unassignedStations: EditorStation[];
  onChange: (draft: GeometryDraft) => void;
  onSave: () => void;
  onClear: () => void;
  onCreateAddStation: (anchorStationId: string, branchStationId: string) => void;
  onCreateConnectLine: (
    anchorStationId: string,
    connectedBranchId: string,
    connectedEndpointStationId: string,
  ) => void;
  onDeleteLineBranch: (id: string) => void;
}) {
  const branchStations = getBranchStopStations(branch);
  const branchEndpoints = getBranchEndpointStations(branch);
  const otherBranches = branches.filter((candidate) => candidate.id !== branch.id);
  const relatedLineBranches = lineBranchOverrides.filter(
    (override) =>
      override.parentBranchId === branch.id ||
      override.connectedBranchId === branch.id,
  );

  const [addAnchorStationId, setAddAnchorStationId] = useState(
    branchStations[0]?.id ?? "",
  );
  const [addBranchStationId, setAddBranchStationId] = useState(
    unassignedStations[0]?.id ?? "",
  );
  const [connectAnchorStationId, setConnectAnchorStationId] = useState(
    branchEndpoints[0]?.id ?? "",
  );
  const [connectBranchId, setConnectBranchId] = useState(
    otherBranches[0]?.id ?? "",
  );

  const selectedConnectBranch =
    branches.find((candidate) => candidate.id === connectBranchId) ?? null;
  const connectEndpointStations = selectedConnectBranch
    ? getBranchEndpointStations(selectedConnectBranch)
    : [];
  const [connectEndpointStationId, setConnectEndpointStationId] = useState(
    connectEndpointStations[0]?.id ?? "",
  );

  useEffect(() => {
    if (!branchStations.some((station) => station.id === addAnchorStationId))
      setAddAnchorStationId(branchStations[0]?.id ?? "");
  }, [addAnchorStationId, branchStations]);

  useEffect(() => {
    if (!unassignedStations.some((station) => station.id === addBranchStationId))
      setAddBranchStationId(unassignedStations[0]?.id ?? "");
  }, [addBranchStationId, unassignedStations]);

  useEffect(() => {
    if (!branchEndpoints.some((station) => station.id === connectAnchorStationId))
      setConnectAnchorStationId(branchEndpoints[0]?.id ?? "");
  }, [branchEndpoints, connectAnchorStationId]);

  useEffect(() => {
    if (!otherBranches.some((candidate) => candidate.id === connectBranchId))
      setConnectBranchId(otherBranches[0]?.id ?? "");
  }, [connectBranchId, otherBranches]);

  useEffect(() => {
    if (
      !connectEndpointStations.some(
        (station) => station.id === connectEndpointStationId,
      )
    )
      setConnectEndpointStationId(connectEndpointStations[0]?.id ?? "");
  }, [connectEndpointStationId, connectEndpointStations]);

  function updatePoint(
    index: number,
    patch: Partial<ManualGeometryOverridePoint>,
  ) {
    onChange({
      ...draft,
      points: draft.points.map((point, pointIndex) =>
        pointIndex === index ? { ...point, ...patch } : point,
      ),
    });
  }

  function removePoint(index: number) {
    onChange({
      ...draft,
      points: draft.points.filter((_, pointIndex) => pointIndex !== index),
    });
  }

  function addControlPoint() {
    const last = draft.points.at(-1) ?? {
      lng: 127.3,
      lat: 36.35,
      kind: "control" as const,
    };
    onChange({
      ...draft,
      points: [
        ...draft.points,
        { lng: last.lng, lat: last.lat, kind: "control" },
      ],
    });
  }

  return (
    <div className="grid gap-3">
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
        <span
          className="block h-2 w-16 rounded-full"
          style={{ backgroundColor: branch.colorHex }}
        />
        <h3 className="mt-3 text-base font-semibold">
          {branch.canonicalLineNameKo}
        </h3>
        <p className="mt-1 text-xs font-medium text-slate-500">
          {branch.sourceLineName} · {branch.role}
        </p>
      </div>
      <InfoRow label="Branch" value={formatBranchDisplayName(branch)} />
      <InfoRow label="기점" value={branch.origin ?? "-"} />
      <InfoRow label="종점" value={branch.terminal ?? "-"} />
      <InfoRow label="Route stops" value={`${branch.routeStopCount}개`} />

      <div className="grid gap-3 rounded-3xl border border-blue-100 bg-blue-50/60 p-3">
        <div>
          <strong className="text-xs font-semibold text-blue-800">
            지선 역 추가
          </strong>
          <p className="mt-1 text-[11px] font-medium text-blue-600">
            노선에 소속되지 않은 역을 선택한 branch의 특정 역에 붙입니다.
          </p>
        </div>
        <Field label="Anchor 역">
          <select
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium"
            value={addAnchorStationId}
            onChange={(event) => setAddAnchorStationId(event.target.value)}
          >
            {branchStations.map((station) => (
              <option key={station.id} value={station.id}>
                {station.nameKo} · {station.lineNameKo}
              </option>
            ))}
          </select>
        </Field>
        <Field label="추가할 미소속 역">
          <select
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium"
            value={addBranchStationId}
            onChange={(event) => setAddBranchStationId(event.target.value)}
            disabled={unassignedStations.length === 0}
          >
            {unassignedStations.length === 0 ? (
              <option value="">미소속 역 없음</option>
            ) : (
              unassignedStations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.nameKo} · {station.lineNameKo}
                </option>
              ))
            )}
          </select>
        </Field>
        <Button
          disabled={!addAnchorStationId || !addBranchStationId}
          onClick={() => onCreateAddStation(addAnchorStationId, addBranchStationId)}
        >
          <Plus className="mr-1 size-4" />
          지선 역 추가
        </Button>
      </div>

      <div className="grid gap-3 rounded-3xl border border-emerald-100 bg-emerald-50/60 p-3">
        <div>
          <strong className="text-xs font-semibold text-emerald-800">
            지선 노선 결합
          </strong>
          <p className="mt-1 text-[11px] font-medium text-emerald-600">
            현재 노선의 endpoint와 다른 노선의 endpoint를 연결합니다.
          </p>
        </div>
        <Field label="현재 노선 endpoint">
          <select
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium"
            value={connectAnchorStationId}
            onChange={(event) => setConnectAnchorStationId(event.target.value)}
            disabled={branchEndpoints.length === 0}
          >
            {branchEndpoints.map((station) => (
              <option key={station.id} value={station.id}>
                {station.nameKo} · {station.lineNameKo}
              </option>
            ))}
          </select>
        </Field>
        <Field label="연결할 노선">
          <select
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium"
            value={connectBranchId}
            onChange={(event) => setConnectBranchId(event.target.value)}
            disabled={otherBranches.length === 0}
          >
            {otherBranches.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.canonicalLineNameKo} · {candidate.sourceLineName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="연결 노선 endpoint">
          <select
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium"
            value={connectEndpointStationId}
            onChange={(event) => setConnectEndpointStationId(event.target.value)}
            disabled={connectEndpointStations.length === 0}
          >
            {connectEndpointStations.map((station) => (
              <option key={station.id} value={station.id}>
                {station.nameKo} · {station.lineNameKo}
              </option>
            ))}
          </select>
        </Field>
        <Button
          disabled={
            !connectAnchorStationId ||
            !connectBranchId ||
            !connectEndpointStationId
          }
          onClick={() =>
            onCreateConnectLine(
              connectAnchorStationId,
              connectBranchId,
              connectEndpointStationId,
            )
          }
        >
          <Route className="mr-1 size-4" />
          지선 노선 결합
        </Button>
      </div>

      <div className="grid gap-2 rounded-3xl border border-slate-200 p-3">
        <strong className="text-xs font-semibold text-slate-600">
          등록된 지선 오버레이
        </strong>
        {relatedLineBranches.length === 0 ? (
          <p className="text-xs font-medium text-slate-400">
            이 노선에 연결된 지선 오버레이가 없습니다.
          </p>
        ) : (
          relatedLineBranches.map((override) => {
            const display = getLineBranchDisplay(override, new Map(branches.map((candidate) => [candidate.id, candidate])), new Map([...branchStations, ...unassignedStations, ...branches.flatMap(getBranchStopStations)].map((station) => [station.id, station])));
            return (
              <div key={override.id} className="grid gap-2 rounded-2xl bg-slate-50 p-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-700">{display.title}</p>
                  <p className="mt-1 text-[11px] font-medium leading-5 text-slate-500">{display.summary}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => onDeleteLineBranch(override.id)}>
                  <Trash2 className="mr-1 size-3" />
                  제거
                </Button>
              </div>
            );
          })
        )}
      </div>

      <Field label="선형 메모">
        <Textarea
          value={draft.note}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
        />
      </Field>
      <div className="grid gap-2 rounded-3xl border border-slate-200 p-2">
        <div className="flex items-center justify-between px-1">
          <strong className="text-xs font-medium text-slate-600">
            Geometry Points
          </strong>
          <Button size="sm" variant="outline" onClick={addControlPoint}>
            <Plus className="mr-1 size-3" />
            추가
          </Button>
        </div>
        <div className="grid max-h-80 gap-2 overflow-y-auto">
          {draft.points.map((point, index) => (
            <div
              key={`${index}:${point.lng}:${point.lat}`}
              className="grid gap-2 rounded-2xl bg-slate-50 p-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-500">
                  #{index + 1} · {point.kind}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removePoint(index)}
                  disabled={draft.points.length <= 2}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={point.lng}
                  onChange={(event) =>
                    updatePoint(index, { lng: Number(event.target.value) })
                  }
                />
                <Input
                  value={point.lat}
                  onChange={(event) =>
                    updatePoint(index, { lat: Number(event.target.value) })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={onClear}>
          보정 제거
        </Button>
        <Button onClick={onSave}>
          <Save className="mr-1 size-4" />
          선형 저장
        </Button>
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
