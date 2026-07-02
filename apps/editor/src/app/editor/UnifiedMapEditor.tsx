"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { Badge } from "@repo/ui/badge";
import {
  buildSmoothConnectionCurve,
  buildTransferGroupCircleGeometry,
  getCoordinateDistance,
  isCollapsedTransferZoom,
  isTransferDetailVisible,
  optimizeCoordinates,
  smoothCoordinateRange,
  smoothCoordinates,
} from "@repo/ui/map/renderPolicy";
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
  History,
  Layers3,
  ListChecks,
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
  ManualBranchRouteOverride,
  ManualGeometryOverride,
  ManualGeometryOverridePoint,
  ManualLineBranchOverride,
  ManualOverlayBundle,
  ManualStationOverride,
  ManualTransferGroup,
} from "../editorModel";
import {
  EMPTY_MANUAL_OVERLAY_BUNDLE,
  makeBranchRouteOverrideId,
  makeBranchStationExclusionId,
  makeLineBranchOverrideId,
  makeTransferGroupId,
  makeTransferPairKey,
  normalizeSearchText,
} from "../editorModel";
import type { EditorMapBranch, UnifiedEditorData } from "../editorData";
import { getLineBranchConnectionBlockReason, isBranchCircular } from "./branchRules";
import { AddStationInsertionDialog, type PendingAddStationInsertion } from "./stationInsertion";
import { BranchInspector } from "./branchInspector";
import {
  LineBranchValidationPanel,
  type LineBranchValidationAutoFix,
  type LineBranchValidationIssue,
  type LineBranchValidationIssueCategory,
  type LineBranchValidationIssueSeverity,
  type StaleSavedStationAnchorSummary,
} from "./validationPanel";
import {
  AddStationBranchPreview,
  ConnectLineBranchPreview,
  LineBranchVisualCard,
  formatLineBranchDirectionSummary,
  getLineBranchDisplay,
} from "./stationInspector";

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

const STATION_GEOMETRY_ANCHOR_TOLERANCE = 0.00015;
const SAVED_STATION_ANCHOR_TOLERANCE = 0.0000001;
const GEOMETRY_NEAR_ZERO_SEGMENT_DISTANCE = 0.000001;
const KOREA_GEOMETRY_LNG_RANGE = [124, 132] as const;
const KOREA_GEOMETRY_LAT_RANGE = [33, 39.5] as const;

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

type GeometryDraftValidationSeverity = "error" | "warning";

type GeometryDraftValidationIssue = {
  targetKey: string;
  targetTitle: string;
  severity: GeometryDraftValidationSeverity;
  code: string;
  message: string;
};

type GeometryWorkspaceSummary = {
  changedTargetCount: number;
  changedTargetLabels: string[];
  validationIssueCount: number;
  validationErrorCount: number;
  validationWarningCount: number;
  validationIssueTargetLabels: string[];
  validationWarningTargetLabels: string[];
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
          coordinates: optimizeCoordinates(coordinates, 360),
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
  transferDetailVisible: boolean,
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
      if (transferGroup && !transferDetailVisible) continue;

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

function isValidStation(
  station: EditorStation,
): station is EditorStation & { lat: number; lng: number } {
  return Number.isFinite(station.lat) && Number.isFinite(station.lng);
}

function getBranchStationIds(branch: EditorMapBranch): string[] {
  return branch.routeStops
    .map((stop) => stop.station?.id ?? null)
    .filter((stationId): stationId is string => Boolean(stationId));
}

function makeValidationIssue(input: {
  id: string;
  title: string;
  message: string;
  category: LineBranchValidationIssueCategory;
  severity?: LineBranchValidationIssueSeverity;
  cause: string;
  solution: string;
  autoFix?: LineBranchValidationAutoFix;
  includeInBulkFix?: boolean;
}): LineBranchValidationIssue {
  return {
    severity: input.severity ?? "error",
    includeInBulkFix: input.includeInBulkFix ?? Boolean(input.autoFix),
    ...input,
  };
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
      issues.push(makeValidationIssue({
        id: `${override.id}:parent`,
        title: "상위 노선을 찾을 수 없음",
        message: `상위 노선을 찾을 수 없음: ${override.parentBranchId}`,
        category: "missing-reference",
        cause: "지선 보정이 삭제되었거나 이름이 바뀐 branch를 가리킵니다.",
        solution: "이 보정은 더 이상 적용할 수 없으므로 지선 보정을 삭제해야 합니다.",
        autoFix: { kind: "delete-line-branch", id: override.id },
      }));
      continue;
    }

    const parentStationIds = new Set(getBranchStationIds(parentBranch));
    if (!parentStationIds.has(override.anchorStationId)) {
      issues.push(makeValidationIssue({
        id: `${override.id}:anchor`,
        title: "연결 기준 역이 상위 노선에 없음",
        message: `연결 기준 역이 상위 노선에 없음: ${formatStationDisplayName(stationById.get(override.anchorStationId))}`,
        category: "invalid-connection",
        cause: "지선의 시작점으로 지정한 역이 상위 branch의 정차역 목록에 없습니다.",
        solution: "상위 branch에 있는 다른 역으로 다시 연결하거나, 이 지선 보정을 삭제해야 합니다.",
        autoFix: { kind: "delete-line-branch", id: override.id },
      }));
    }

    if (override.mode === "add-station") {
      const branchStationId = override.branchStationId;
      if (!branchStationId || !stationById.has(branchStationId)) {
        issues.push(makeValidationIssue({
          id: `${override.id}:branch-station`,
          title: "추가할 지선 역을 찾을 수 없음",
          message: `추가할 지선 역을 찾을 수 없음: ${branchStationId ?? "-"}`,
          category: "missing-reference",
          cause: "지선에 추가하려던 역 ID가 현재 데이터에 없습니다.",
          solution: "존재하지 않는 역을 참조하는 보정이므로 삭제한 뒤 새 역 생성 기능으로 다시 만들어야 합니다.",
          autoFix: { kind: "delete-line-branch", id: override.id },
        }));
      } else if (assignedStationIds.has(branchStationId)) {
        issues.push(makeValidationIssue({
          id: `${override.id}:branch-station-assigned`,
          title: "이미 다른 노선에 소속된 역을 지선에 추가함",
          message: `추가할 지선 역이 이미 다른 노선에 소속됨: ${formatStationDisplayName(stationById.get(branchStationId))}`,
          category: "station-line-identity",
          cause: "기존 역 아이콘을 다른 노선의 역처럼 재사용했습니다.",
          solution: "기존 역 연결이 아니라 새 역 생성 기능으로 노선 전용 역을 새로 만들어야 합니다.",
          autoFix: { kind: "delete-line-branch", id: override.id },
        }));
      }
    }

    if (override.mode === "connect-line") {
      const connectedBranch = override.connectedBranchId
        ? branchById.get(override.connectedBranchId)
        : null;
      if (!connectedBranch) {
        issues.push(makeValidationIssue({
          id: `${override.id}:connected`,
          title: "연결할 노선을 찾을 수 없음",
          message: `연결할 노선을 찾을 수 없음: ${override.connectedBranchId ?? "-"}`,
          category: "missing-reference",
          cause: "결합 대상으로 지정한 branch가 현재 데이터에 없습니다.",
          solution: "이 결합 보정은 더 이상 적용할 수 없으므로 삭제해야 합니다.",
          autoFix: { kind: "delete-line-branch", id: override.id },
        }));
        continue;
      }

      const connectionBlockReason = getLineBranchConnectionBlockReason(parentBranch, connectedBranch);
      if (connectionBlockReason) {
        const parentIsCircular = isBranchCircular(parentBranch);
        issues.push(makeValidationIssue({
          id: `${override.id}:connection-rule`,
          title: parentIsCircular
            ? "순환 노선에서 외부 노선으로 결합할 수 없음"
            : "같은 branch끼리 결합됨",
          message: connectionBlockReason,
          category: "invalid-connection",
          cause: parentIsCircular
            ? "순환 노선은 닫힌 구조라 자체 시작/끝 역이 없습니다. 따라서 순환 노선을 기준으로 외부 노선 방향 결합을 만들 수 없습니다."
            : "상위 branch와 연결 대상 branch가 같습니다.",
          solution: parentIsCircular
            ? "순환 노선 안에 새 지선을 추가하거나, 일반 노선의 시작/끝 역을 순환 노선의 특정 역에 연결하는 방식으로 설정하세요."
            : "같은 노선을 다시 연결하는 보정은 의미가 없으므로 삭제해야 합니다.",
          autoFix: { kind: "delete-line-branch", id: override.id },
        }));
      }
      const connectedStationId = override.connectedEndpointStationId;
      const connectedStationIds = new Set(getBranchStationIds(connectedBranch));
      if (!connectedStationId || !connectedStationIds.has(connectedStationId)) {
        issues.push(makeValidationIssue({
          id: `${override.id}:connected-station`,
          title: "연결 대상 역이 연결 노선에 없음",
          message: `연결 노선의 선택 역이 노선에 없음: ${formatStationDisplayName(connectedStationId ? stationById.get(connectedStationId) : null)}`,
          category: "invalid-connection",
          cause: "연결 대상으로 고른 역이 연결 branch의 정차역이 아닙니다.",
          solution: "연결 대상을 다시 고르거나 이 결합 보정을 삭제해야 합니다.",
          autoFix: { kind: "delete-line-branch", id: override.id },
        }));
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
      issues.push(makeValidationIssue({
        id: `${exclusion.id}:branch`,
        title: "역 제거 대상 노선을 찾을 수 없음",
        message: `역 제거 대상 노선을 찾을 수 없음: ${exclusion.branchId}`,
        category: "missing-reference",
        cause: "역 제거 보정이 더 이상 존재하지 않는 branch를 가리킵니다.",
        solution: "이 역 제거 보정은 적용할 수 없으므로 삭제해야 합니다.",
        autoFix: { kind: "delete-branch-station-exclusion", id: exclusion.id },
      }));
      continue;
    }

    if (!stationById.has(exclusion.stationId)) {
      issues.push(makeValidationIssue({
        id: `${exclusion.id}:station`,
        title: "제거 대상 역을 찾을 수 없음",
        message: `제거 대상 역을 찾을 수 없음: ${exclusion.stationId}`,
        category: "missing-reference",
        cause: "삭제하려던 역 ID가 현재 데이터에 없습니다.",
        solution: "존재하지 않는 역을 제거하는 보정이므로 삭제해야 합니다.",
        autoFix: { kind: "delete-branch-station-exclusion", id: exclusion.id },
      }));
    }
  }

  return issues;
}

function validateMissingBranchGeometry(
  branches: EditorMapBranch[],
  overlays: ManualOverlayBundle,
): LineBranchValidationIssue[] {
  const existingGeometryBranchIds = new Set(
    overlays.geometryOverrides
      .filter((override) => override.enabled !== false)
      .map((override) => override.branchId),
  );

  return branches
    .filter((branch) => {
      if (existingGeometryBranchIds.has(branch.id)) return false;
      if (branchCoordinates(branch).length >= 2) return false;
      const validStopCount = getBranchStopStations(branch).filter(isValidStation).length;
      return validStopCount >= 2;
    })
    .map((branch) =>
      makeValidationIssue({
        id: `${branch.id}:missing-geometry`,
        title: "정차역은 있지만 선형이 없음",
        message: `정차역은 있지만 선형 좌표가 없어 지도에서 선이 빠질 수 있음: ${formatBranchDisplayName(branch)}`,
        category: "missing-geometry",
        severity: "warning",
        cause: "collector 또는 수기 보정에 이 branch의 geometry가 없습니다. 정차역 아이콘만 있고 노선 선이 빠질 수 있습니다.",
        solution: "정확한 선형이 있으면 geometry 편집으로 보정하고, 임시로 보이게 하려면 역 좌표 순서로 선형을 생성합니다.",
        autoFix: { kind: "create-geometry-from-branch-stops", branchId: branch.id },
        includeInBulkFix: false,
      }),
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
      issues.push(makeValidationIssue({
        id: `${override.branchId}:${point.stationId}:stale-anchor`,
        title: "저장된 선형 anchor가 예전 위치임",
        message: `저장된 선형 보정의 역 anchor가 현재 역 위치와 다름: ${formatStationDisplayName(stationById.get(point.stationId))}`,
        category: "stale-anchor",
        severity: "warning",
        cause: "역 위치를 옮긴 뒤 저장된 선형 좌표가 아직 예전 역 위치를 가지고 있습니다.",
        solution: "해당 역 anchor를 현재 역 위치로 다시 맞추면 됩니다.",
        includeInBulkFix: false,
      }));
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
      issues.push(makeValidationIssue({
        id: `${override.id}:${point.stationId}:stale-line-branch-anchor`,
        title: "저장된 지선 anchor가 예전 위치임",
        message: `저장된 지선 선형의 역 anchor가 현재 역 위치와 다름: ${formatStationDisplayName(stationById.get(point.stationId))}`,
        category: "stale-anchor",
        severity: "warning",
        cause: "역 위치를 옮긴 뒤 저장된 지선 좌표가 아직 예전 역 위치를 가지고 있습니다.",
        solution: "검증 탭 상단의 anchor 일괄 수정 버튼으로 현재 위치에 맞출 수 있습니다.",
        includeInBulkFix: false,
      }));
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

function isStaleSavedStationAnchorPoint(
  point: ManualGeometryOverridePoint,
  coordinate: LngLatTuple,
) {
  return (
    Math.abs(point.lng - coordinate[0]) > SAVED_STATION_ANCHOR_TOLERANCE ||
    Math.abs(point.lat - coordinate[1]) > SAVED_STATION_ANCHOR_TOLERANCE
  );
}

function getStaleSavedStationAnchorSummaries(
  overlays: ManualOverlayBundle,
  stationById: Map<string, EditorStation>,
): StaleSavedStationAnchorSummary[] {
  const summaries = new Map<string, StaleSavedStationAnchorSummary>();

  const addStalePoint = (
    stationId: string,
    source: "geometry" | "lineBranch",
  ) => {
    const station = stationById.get(stationId);
    const existing = summaries.get(stationId) ?? {
      stationId,
      stationLabel: formatStationDisplayName(station),
      changedCount: 0,
      geometryCount: 0,
      lineBranchCount: 0,
    };
    existing.changedCount += 1;
    if (source === "geometry") existing.geometryCount += 1;
    if (source === "lineBranch") existing.lineBranchCount += 1;
    summaries.set(stationId, existing);
  };

  for (const override of overlays.geometryOverrides) {
    if (override.enabled === false) continue;
    for (const point of override.points) {
      if (point.kind !== "station" || !point.stationId) continue;
      const coordinate = getStationCoordinate(stationById.get(point.stationId));
      if (!coordinate || !isStaleSavedStationAnchorPoint(point, coordinate)) {
        continue;
      }
      addStalePoint(point.stationId, "geometry");
    }
  }

  for (const override of overlays.lineBranchOverrides ?? []) {
    if (override.enabled === false || !override.geometry?.length) continue;
    for (const point of override.geometry) {
      if (point.kind !== "station" || !point.stationId) continue;
      const coordinate = getStationCoordinate(stationById.get(point.stationId));
      if (!coordinate || !isStaleSavedStationAnchorPoint(point, coordinate)) {
        continue;
      }
      addStalePoint(point.stationId, "lineBranch");
    }
  }

  return [...summaries.values()].sort((left, right) =>
    left.stationLabel.localeCompare(right.stationLabel, "ko-KR"),
  );
}

function syncAllSavedGeometryAnchors(
  overlays: ManualOverlayBundle,
  stationById: Map<string, EditorStation>,
) {
  const changedStationIds = new Set<string>();
  let changedCount = 0;

  const replacePoint = (point: ManualGeometryOverridePoint) => {
    if (point.kind !== "station" || !point.stationId) return point;
    const coordinate = getStationCoordinate(stationById.get(point.stationId));
    if (!coordinate || !isStaleSavedStationAnchorPoint(point, coordinate)) {
      return point;
    }
    changedCount += 1;
    changedStationIds.add(point.stationId);
    return {
      ...point,
      lng: coordinate[0],
      lat: coordinate[1],
    };
  };

  const geometryOverrides = overlays.geometryOverrides.map((override) => {
    if (override.enabled === false) return override;
    const points = override.points.map(replacePoint);
    return points === override.points ? override : { ...override, points };
  });

  const lineBranchOverrides = (overlays.lineBranchOverrides ?? []).map(
    (override) => {
      if (override.enabled === false || !override.geometry?.length) {
        return override;
      }
      const geometry = override.geometry.map(replacePoint);
      return geometry === override.geometry ? override : { ...override, geometry };
    },
  );

  if (changedCount === 0) {
    return { overlays, changedCount, stationCount: 0 };
  }

  return {
    overlays: {
      ...overlays,
      geometryOverrides,
      lineBranchOverrides,
    },
    changedCount,
    stationCount: changedStationIds.size,
  };
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
      issues.push(makeValidationIssue({
        id: `${branch.id}:${station.id}:detached-station`,
        title: "역과 본선 선형이 떨어져 있음",
        message: `역 위치와 본선 선형이 떨어져 있음: ${formatStationDisplayName(station)} · ${formatBranchDisplayName(branch)}`,
        category: "detached-geometry",
        severity: "warning",
        cause: "역 위치와 현재 선형 좌표가 서로 떨어져 있어 지도에서 역이 선 밖에 떠 보일 수 있습니다.",
        solution: "역 위치를 다시 맞추거나 geometry 편집에서 선형을 역 위치에 맞게 보정해야 합니다.",
        includeInBulkFix: false,
      }));
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
      issues.push(makeValidationIssue({
        id: `${override.id}:${stationId}:detached-line-branch-station`,
        title: "역과 지선 선형이 떨어져 있음",
        message: `역 위치와 지선 선형이 떨어져 있음: ${formatStationDisplayName(stationById.get(stationId))}`,
        category: "detached-geometry",
        severity: "warning",
        cause: "지선 선형이 역 위치를 지나지 않아 연결선이 어색하게 보일 수 있습니다.",
        solution: "지선 선형을 다시 편집하거나 저장된 anchor를 현재 역 위치로 맞춰야 합니다.",
        includeInBulkFix: false,
      }));
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

function normalizeIdentityKey(value: string | null | undefined) {
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

function getBranchIdentityKeys(branch: EditorMapBranch | null | undefined) {
  if (!branch) return new Set<string>();
  return new Set(
    [
      branch.canonicalLineId,
      branch.canonicalLineNameKo,
      branch.sourceLineNumber,
      branch.sourceLineName,
    ]
      .map(normalizeIdentityKey)
      .filter(Boolean),
  );
}

function isStationCompatibleWithBranch(
  stationId: string | null | undefined,
  branch: EditorMapBranch | null | undefined,
  stationById: Map<string, EditorStation>,
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

function makeStationLineIdentityIssue(
  id: string,
  stationId: string,
  branch: EditorMapBranch | null | undefined,
  stationById: Map<string, EditorStation>,
  context: string,
  autoFix?: LineBranchValidationAutoFix,
): LineBranchValidationIssue {
  return makeValidationIssue({
    id,
    title: `${context}에서 다른 노선 역을 직접 사용함`,
    message: `${context}: 다른 노선의 역 아이콘을 직접 참조함 - ${formatStationDisplayName(stationById.get(stationId))} → ${formatBranchDisplayName(branch)}`,
    category: "station-line-identity",
    cause: "같은 물리 위치라도 노선이 다르면 별도 역 아이콘/역사로 관리해야 하는데, 기존 다른 노선의 stationId를 직접 재사용했습니다.",
    solution: "새 역 생성 기능으로 해당 노선 전용 역을 만들거나, 선형 모양만 필요하면 station anchor가 아니라 control point로 바꿔야 합니다.",
    autoFix,
  });
}

function validateStationLineIdentity(
  overlays: ManualOverlayBundle,
  branches: EditorMapBranch[],
  stationById: Map<string, EditorStation>,
): LineBranchValidationIssue[] {
  const issues: LineBranchValidationIssue[] = [];
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));

  for (const override of overlays.branchRouteOverrides ?? []) {
    if (override.enabled === false) continue;
    const branch = branchById.get(override.branchId);
    if (!branch) continue;
    for (const stationId of override.stationIds ?? []) {
      if (isStationCompatibleWithBranch(stationId, branch, stationById)) continue;
      issues.push(
        makeStationLineIdentityIssue(
          `${override.id}:${stationId}:station-line-identity`,
          stationId,
          branch,
          stationById,
          "노선 정차 순서 보정",
          { kind: "remove-branch-route-station", overrideId: override.id, stationId },
        ),
      );
    }
  }

  for (const override of overlays.geometryOverrides ?? []) {
    if (override.enabled === false) continue;
    const branch = branchById.get(override.branchId);
    if (!branch) continue;
    for (const [index, point] of (override.points ?? []).entries()) {
      if (point.kind !== "station" || !point.stationId) continue;
      if (isStationCompatibleWithBranch(point.stationId, branch, stationById)) continue;
      issues.push(
        makeStationLineIdentityIssue(
          `${override.branchId}:${index}:station-line-identity`,
          point.stationId,
          branch,
          stationById,
          "선형 보정",
          { kind: "convert-geometry-station-to-control", branchId: override.branchId, pointIndex: index },
        ),
      );
    }
  }

  for (const override of overlays.lineBranchOverrides ?? []) {
    if (override.enabled === false) continue;
    const parentBranch = branchById.get(override.parentBranchId);
    const connectedBranch = override.connectedBranchId
      ? branchById.get(override.connectedBranchId)
      : null;

    if (override.anchorStationId && !isStationCompatibleWithBranch(override.anchorStationId, parentBranch, stationById)) {
      issues.push(
        makeStationLineIdentityIssue(
          `${override.id}:anchor-station-line-identity`,
          override.anchorStationId,
          parentBranch,
          stationById,
          "지선 시작 역",
          { kind: "delete-line-branch", id: override.id },
        ),
      );
    }

    if (
      override.mode === "add-station" &&
      override.branchStationId &&
      !isStationCompatibleWithBranch(override.branchStationId, parentBranch, stationById)
    ) {
      issues.push(
        makeStationLineIdentityIssue(
          `${override.id}:branch-station-line-identity`,
          override.branchStationId,
          parentBranch,
          stationById,
          "기존 역 연결",
          { kind: "delete-line-branch", id: override.id },
        ),
      );
    }

    if (
      override.mode === "connect-line" &&
      override.connectedEndpointStationId &&
      !isStationCompatibleWithBranch(
        override.connectedEndpointStationId,
        connectedBranch,
        stationById,
      )
    ) {
      issues.push(
        makeStationLineIdentityIssue(
          `${override.id}:connected-station-line-identity`,
          override.connectedEndpointStationId,
          connectedBranch,
          stationById,
          "결합 대상 역",
          { kind: "delete-line-branch", id: override.id },
        ),
      );
    }

    for (const [index, point] of (override.geometry ?? []).entries()) {
      if (point.kind !== "station" || !point.stationId) continue;
      const allowed =
        isStationCompatibleWithBranch(point.stationId, parentBranch, stationById) ||
        isStationCompatibleWithBranch(point.stationId, connectedBranch, stationById);
      if (allowed) continue;
      issues.push(
        makeStationLineIdentityIssue(
          `${override.id}:${index}:geometry-station-line-identity`,
          point.stationId,
          parentBranch,
          stationById,
          "지선 선형",
          { kind: "convert-line-branch-station-to-control", overrideId: override.id, pointIndex: index },
        ),
      );
    }
  }

  return issues;
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
          coordinates: optimizeCoordinates(coordinates, 360),
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

function getBranchEndpointStations(branch: EditorMapBranch): EditorStation[] {
  if (isBranchCircular(branch)) return [];
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

function makeGeometryOverrideFromBranchStops(
  branch: EditorMapBranch,
): ManualGeometryOverride | null {
  const points: ManualGeometryOverridePoint[] = [];

  for (const station of getBranchStopStations(branch)) {
    const coordinate = getStationCoordinate(station);
    if (!coordinate) continue;
    points.push({
      lng: coordinate[0],
      lat: coordinate[1],
      kind: "station",
      stationId: station.id,
    });
  }

  if (points.length < 2) return null;
  return {
    branchId: branch.id,
    points,
    enabled: true,
    note: "정차역 좌표 순서로 자동 생성한 임시 선형입니다. 정확한 선형은 geometry 편집에서 보정하세요.",
  };
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

function featureStringProperty(
  feature: { properties?: Record<string, unknown> | null } | undefined,
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
        if (group.enabled === false || group.stationIds.length < 2)
          return false;
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


function makeManualStationId(branch: EditorMapBranch, nameKo: string) {
  const slug = normalizeSearchText(nameKo || "new-station") || "new-station";
  const branchSlug = branch.id.replace(/[^\w가-힣:.-]+/g, "_");
  return `manual:station:${branchSlug}:${slug}:${Date.now().toString(36)}`;
}

function makeManualStationOverride(
  branch: EditorMapBranch,
  stationId: string,
  nameKo: string,
): ManualStationOverride {
  return {
    stationId,
    nameKo: nameKo.trim(),
    stationNumber: "MANUAL",
    lineNameKo: branch.canonicalLineNameKo || branch.sourceLineName,
    lineNumber: branch.sourceLineNumber,
    colorHex: branch.colorHex ?? null,
    lat: null,
    lng: null,
    enabled: true,
    note: `수동 추가 역 · ${formatBranchDisplayName(branch)}`,
  };
}

function emptyStationOverride(
  station: EditorStation,
  previous?: ManualStationOverride,
): ManualStationOverride {
  return {
    stationId: station.id,
    nameKo: previous?.nameKo ?? station.nameKo,
    stationNumber: previous?.stationNumber ?? station.stationNumber,
    lineNameKo: previous?.lineNameKo ?? station.lineNameKo,
    lineNumber: previous?.lineNumber ?? station.lineNumber,
    colorHex: previous?.colorHex ?? station.colorHex ?? null,
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

function validateStationOverrideDraft(
  draft: ManualStationOverride,
  stationById: Map<string, EditorStation>,
) {
  const station = stationById.get(draft.stationId);
  if (!station && !draft.nameKo?.trim()) return "새 역 이름을 입력하세요.";

  const lng = draft.lng;
  const lat = draft.lat;
  if (typeof lng !== "number" || typeof lat !== "number") {
    return "위도와 경도를 숫자로 입력하세요.";
  }
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return "위도와 경도에 올바른 숫자를 입력하세요.";
  }
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    return "위도/경도 범위를 벗어났습니다.";
  }
  return null;
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

function getTransferPairKeys(stationIds: string[]) {
  const keys: string[] = [];
  for (let i = 0; i < stationIds.length - 1; i += 1) {
    for (let j = i + 1; j < stationIds.length; j += 1) {
      keys.push(makeTransferPairKey(stationIds[i] ?? "", stationIds[j] ?? ""));
    }
  }
  return keys;
}

function getMissingTransferMinutePairLabels(
  draft: TransferGroupDraft,
  stationById: Map<string, EditorStation>,
) {
  const labels: string[] = [];
  for (let i = 0; i < draft.stationIds.length - 1; i += 1) {
    for (let j = i + 1; j < draft.stationIds.length; j += 1) {
      const leftId = draft.stationIds[i] ?? "";
      const rightId = draft.stationIds[j] ?? "";
      const pairKey = makeTransferPairKey(leftId, rightId);
      if (draft.transferMinutesByPair[pairKey] != null) continue;
      labels.push(
        `${stationById.get(leftId)?.nameKo ?? leftId} ↔ ${
          stationById.get(rightId)?.nameKo ?? rightId
        }`,
      );
    }
  }
  return labels;
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

function getGeometryDraftTargetTitle(
  draft: GeometryDraft,
  targetByKey: Map<string, GeometryEditTarget>,
) {
  const key = getGeometryDraftTargetKey(draft);
  return key ? (targetByKey.get(key)?.title ?? draft.targetId) : draft.targetId;
}

function getGeometryDraftValidationIssues(
  draft: GeometryDraft,
  targetByKey: Map<string, GeometryEditTarget>,
  stationById: Map<string, EditorStation>,
): GeometryDraftValidationIssue[] {
  const targetKey = getGeometryDraftTargetKey(draft) ?? draft.targetId;
  const targetTitle = getGeometryDraftTargetTitle(draft, targetByKey);
  const issues: GeometryDraftValidationIssue[] = [];

  function addIssue(
    severity: GeometryDraftValidationSeverity,
    code: string,
    message: string,
  ) {
    issues.push({ targetKey, targetTitle, severity, code, message });
  }

  const target = targetByKey.get(targetKey);
  if (!target) {
    addIssue(
      "error",
      "missing-target",
      `${targetTitle}: 편집 대상 노선/지선을 찾을 수 없습니다.`,
    );
  }

  const usablePoints = draft.points.filter(
    (point) => Number.isFinite(point.lng) && Number.isFinite(point.lat),
  );

  if (usablePoints.length < 2) {
    addIssue(
      "error",
      "too-few-points",
      `${targetTitle}: 선형은 유효 좌표가 2개 이상 필요합니다.`,
    );
  }

  if (draft.points.length !== usablePoints.length) {
    addIssue(
      "error",
      "invalid-coordinate-count",
      `${targetTitle}: 유효하지 않은 좌표가 ${draft.points.length - usablePoints.length}개 있습니다.`,
    );
  }

  draft.points.forEach((point, index) => {
    const label = `${targetTitle}: ${index + 1}번째 점`;

    if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) {
      addIssue(
        "error",
        "invalid-coordinate",
        `${label}의 좌표가 유효하지 않습니다.`,
      );
      return;
    }

    if (
      point.lng < -180 ||
      point.lng > 180 ||
      point.lat < -90 ||
      point.lat > 90
    ) {
      addIssue(
        "error",
        "coordinate-out-of-world",
        `${label}의 좌표가 위경도 허용 범위를 벗어났습니다.`,
      );
    }

    if (
      point.lng < KOREA_GEOMETRY_LNG_RANGE[0] ||
      point.lng > KOREA_GEOMETRY_LNG_RANGE[1] ||
      point.lat < KOREA_GEOMETRY_LAT_RANGE[0] ||
      point.lat > KOREA_GEOMETRY_LAT_RANGE[1]
    ) {
      addIssue(
        "warning",
        "coordinate-outside-korea-range",
        `${label}의 좌표가 한국 철도 작업 범위 밖에 있습니다.`,
      );
    }

    if (point.kind === "station") {
      if (!point.stationId) {
        addIssue(
          "error",
          "station-anchor-missing-id",
          `${label} station anchor에 stationId가 없습니다.`,
        );
      } else if (!stationById.has(point.stationId)) {
        addIssue(
          "error",
          "station-anchor-not-found",
          `${label} station anchor 역을 찾을 수 없습니다.`,
        );
      }
    }
  });

  for (let index = 0; index < usablePoints.length - 1; index += 1) {
    const start = usablePoints[index];
    const end = usablePoints[index + 1];
    if (!start || !end) continue;

    const distance = Math.hypot(end.lng - start.lng, end.lat - start.lat);
    if (distance === 0) {
      addIssue(
        "error",
        "zero-length-segment",
        `${targetTitle}: ${index + 1}-${index + 2}번째 점이 완전히 같은 좌표입니다.`,
      );
    } else if (distance < GEOMETRY_NEAR_ZERO_SEGMENT_DISTANCE) {
      addIssue(
        "warning",
        "near-zero-length-segment",
        `${targetTitle}: ${index + 1}-${index + 2}번째 선형 구간이 너무 짧습니다.`,
      );
    }
  }

  const stationAnchorPoints = draft.points.filter(
    (point) => point.kind === "station" && point.stationId,
  );
  if (draft.targetType === "branch" && stationAnchorPoints.length < 2) {
    addIssue(
      "warning",
      "branch-has-few-station-anchors",
      `${targetTitle}: 본선 선형에 station anchor가 2개 미만입니다. 저장은 가능하지만 Web 반영 전 확인이 필요합니다.`,
    );
  }
  if (draft.targetType === "lineBranch" && stationAnchorPoints.length < 1) {
    addIssue(
      "error",
      "line-branch-has-no-station-anchor",
      `${targetTitle}: 지선 선형에는 최소 1개의 station anchor가 필요합니다.`,
    );
  }

  const duplicateStationAnchors = new Set<string>();
  const seenStationAnchors = new Set<string>();
  stationAnchorPoints.forEach((point) => {
    if (!point.stationId) return;
    if (seenStationAnchors.has(point.stationId)) {
      duplicateStationAnchors.add(point.stationId);
    }
    seenStationAnchors.add(point.stationId);
  });
  duplicateStationAnchors.forEach((stationId) => {
    addIssue(
      "warning",
      "duplicate-station-anchor",
      `${targetTitle}: 같은 station anchor가 반복됩니다: ${formatStationDisplayName(stationById.get(stationId))}`,
    );
  });

  return issues;
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

function makeDisplayStationFromManualOverride(
  override: ManualStationOverride,
): EditorStation | null {
  const lng = override.lng;
  const lat = override.lat;
  if (override.enabled === false) return null;
  if (!override.nameKo?.trim()) return null;
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  return {
    id: override.stationId,
    stationNumber: override.stationNumber?.trim() || "MANUAL",
    nameKo: override.nameKo.trim(),
    lineNameKo: override.lineNameKo?.trim() || "수동 추가 역",
    lineNumber: override.lineNumber?.trim() || "manual",
    colorHex: override.colorHex ?? null,
    lat,
    lng,
  };
}

function applyStationOverridesToStations(
  stations: EditorStation[],
  overrides: ManualStationOverride[],
): EditorStation[] {
  const baseStationIds = new Set(stations.map((station) => station.id));
  const updatedStations = overrides.reduce((current, override) => {
    const lng = override.lng;
    const lat = override.lat;
    if (override.enabled === false) return current;
    if (typeof lng !== "number" || typeof lat !== "number") return current;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return current;
    if (!baseStationIds.has(override.stationId)) return current;
    return applyStationCoordinateToStations(
      current,
      override.stationId,
      lng,
      lat,
    );
  }, stations);

  const manualStations = overrides
    .filter((override) => !baseStationIds.has(override.stationId))
    .map(makeDisplayStationFromManualOverride)
    .filter((station): station is EditorStation => station !== null);

  return [...updatedStations, ...manualStations];
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
  const selectTransferGroupChildrenFromMapRef = useRef<
    (groupId: string) => void
  >(() => undefined);
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
  const pendingAddStationInsertionRef =
    useRef<PendingAddStationInsertion | null>(null);
  const stationSaveBusyRef = useRef(false);
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
  const [transferDetailVisible, setTransferDetailVisible] = useState(false);
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
  const [addStationModalOpen, setAddStationModalOpen] = useState(false);
  const [pendingAddStationInsertion, setPendingAddStationInsertion] =
    useState<PendingAddStationInsertion | null>(null);
  const [stationSaveBusy, setStationSaveBusy] = useState(false);
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
  const branchRouteOverrideById = useMemo(
    () => new Map(overlays.branchRouteOverrides.map((override) => [override.branchId, override])),
    [overlays.branchRouteOverrides],
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
      ...validateStationLineIdentity(overlays, data.branches, stationById),
      ...validateMissingBranchGeometry(data.branches, overlays),
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
  const staleSavedAnchorSummaries = useMemo(
    () => getStaleSavedStationAnchorSummaries(overlays, displayStationById),
    [displayStationById, overlays],
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
    stationById,
  ]);
  const geometryTargetByKey = useMemo(
    () =>
      new Map(
        geometryTargets.map((target) => [
          getGeometryTargetKey(target.type, target.id),
          target,
        ]),
      ),
    [geometryTargets],
  );

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
    pendingAddStationInsertionRef.current = pendingAddStationInsertion;
  }, [pendingAddStationInsertion]);

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
      setPendingAddStationInsertion(null);
      setAddStationModalOpen(false);
      if (shouldFocus) focusStation(stationId);
    },
    [focusStation, overlays.stationOverrides, stationById],
  );

  const applyMultiStationSelection = useCallback((ids: string[]) => {
    setSelection({ type: "multiStation", ids });
    setStationDraft(null);
    setGeometryDraft(null);
    setStationLocationPickMode(false);
    setPendingAddStationInsertion(null);
    setAddStationModalOpen(false);
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
      setPendingAddStationInsertion(null);
      setAddStationModalOpen(false);
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
      setPendingAddStationInsertion(null);
      setAddStationModalOpen(false);
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
      setPendingAddStationInsertion(null);
      setAddStationModalOpen(false);
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
        paint: {
          "circle-radius": 22,
          "circle-color": "rgba(0,0,0,0)",
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
            0.0524,
            0.0469,
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-opacity": 1,
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
          "text-halo-width": 1.5,
          "text-opacity": 1,
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
          "circle-stroke-opacity": 1,
          "circle-opacity": 0.96,
        },
      });

      map.addLayer({
        id: "railmap-stations-hit",
        type: "circle",
        source: "railmap-stations",
        paint: {
          "circle-radius": 12,
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
          "text-opacity": 1,
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
          "text-opacity": 0.92,
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
          "text-opacity": 1,
        },
      });

      for (const layerId of [
        "railmap-transfer-group-hit",
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
    const syncTransferVisibilityMode = () => {
      const nextZoom = map.getZoom();
      setZoom(nextZoom);
      setTransferDetailVisible(isTransferDetailVisible(nextZoom));
    };
    syncTransferVisibilityMode();
    map.on("zoom", syncTransferVisibilityMode);
    map.on("zoomend", syncTransferVisibilityMode);

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
          selectTransferGroupFromMapRef.current(transferGroupId);
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
      const rangeLayers = (
        collapsedTransferZoom
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
  }, []);

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
          transferDetailVisible,
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
    transferDetailVisible,
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
        areaSource?.setData(
          transferDetailVisible ? areaFeatures : EMPTY_FEATURE_COLLECTION,
        );
        iconSource?.setData(
          transferDetailVisible ? EMPTY_FEATURE_COLLECTION : iconFeatures,
        );
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
    transferDetailVisible,
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

  async function reloadStationDraftFromData(
    nextData: UnifiedEditorData | null,
    stationId: string,
  ) {
    const nextStation = nextData?.stations.find(
      (station) => station.id === stationId,
    );
    if (!nextStation) return;

    const nextOverride = nextData?.overlays.stationOverrides.find(
      (override) => override.stationId === nextStation.id,
    );
    setStationDraft(emptyStationOverride(nextStation, nextOverride));
  }

  async function syncSavedGeometryAnchorsAndReload(stationId: string) {
    let nextData = await reloadEditorData();
    if (!nextData) return null;

    const nextStationById = new Map(
      nextData.stations.map((station) => [station.id, station]),
    );
    const syncResult = syncSavedGeometryAnchorsForStation(
      nextData.overlays,
      stationId,
      nextStationById,
    );

    if (syncResult.changedCount > 0) {
      const synced = await persist(
        syncResult.overlays,
        `저장 선형 anchor ${syncResult.changedCount}개를 현재 역 위치로 맞췄습니다`,
      );
      if (synced) nextData = await reloadEditorData();
    }

    await reloadStationDraftFromData(nextData, stationId);
    return nextData;
  }

  async function saveStationOverrideAndSyncAnchors(
    nextOverride: ManualStationOverride,
    label: string,
    message: string,
  ) {
    if (stationSaveBusyRef.current) {
      showToast("역 위치 저장이 진행 중입니다", "info");
      return null;
    }

    const validationMessage = validateStationOverrideDraft(
      nextOverride,
      stationByIdRef.current,
    );
    if (validationMessage) {
      showToast(validationMessage, "error");
      return null;
    }

    stationSaveBusyRef.current = true;
    setStationSaveBusy(true);
    try {
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

      return await syncSavedGeometryAnchorsAndReload(nextOverride.stationId);
    } finally {
      stationSaveBusyRef.current = false;
      setStationSaveBusy(false);
    }
  }

  async function saveStationLocationAndAddToBranch(
    nextOverride: ManualStationOverride,
    insertion: PendingAddStationInsertion,
  ) {
    if (stationSaveBusyRef.current) {
      showToast("역 위치 저장이 진행 중입니다", "info");
      return null;
    }

    const validationMessage = validateStationOverrideDraft(
      nextOverride,
      stationByIdRef.current,
    );
    if (validationMessage) {
      showToast(validationMessage, "error");
      return null;
    }

    const baseOverlays = overlaysRef.current;
    const parentBranch = branchByIdRef.current.get(insertion.parentBranchId);
    const beforeStation = stationByIdRef.current.get(insertion.beforeStationId);
    const afterStation = stationByIdRef.current.get(insertion.afterStationId);
    const branchStation =
      stationByIdRef.current.get(nextOverride.stationId) ??
      makeDisplayStationFromManualOverride(nextOverride);
    const beforeCoordinate = getStationCoordinate(beforeStation);
    const afterCoordinate = getStationCoordinate(afterStation);

    if (
      !parentBranch ||
      !beforeStation ||
      !afterStation ||
      !branchStation ||
      !beforeCoordinate ||
      !afterCoordinate ||
      typeof nextOverride.lng !== "number" ||
      typeof nextOverride.lat !== "number"
    ) {
      showToast("새 역 추가에 필요한 노선/역 좌표를 찾지 못했습니다", "error");
      return null;
    }

    const assignedStationIds = new Set(data.branches.flatMap(getBranchStationIds));
    const isManualNewStation = !data.stations.some(
      (station) => station.id === nextOverride.stationId,
    );
    if (!isManualNewStation && assignedStationIds.has(nextOverride.stationId)) {
      showToast("이미 노선에 소속된 기존 역은 새 역으로 추가할 수 없습니다", "error");
      return null;
    }

    const parentStationIds = getBranchStopStations(parentBranch).map(
      (station) => station.id,
    );
    const beforeIndex = parentStationIds.indexOf(insertion.beforeStationId);
    const afterIndex = parentStationIds.indexOf(insertion.afterStationId);
    if (beforeIndex < 0 || afterIndex !== beforeIndex + 1) {
      showToast("선택한 두 역이 같은 노선에서 인접해 있지 않습니다", "error");
      return null;
    }

    const currentRouteStationIds = getBranchStopStations(parentBranch).map(
      (station) => station.id,
    );
    const nextRouteStationIds = [
      ...currentRouteStationIds.slice(0, beforeIndex + 1),
      nextOverride.stationId,
      ...currentRouteStationIds.slice(afterIndex),
    ];
    const routeOverride: ManualBranchRouteOverride = {
      id: makeBranchRouteOverrideId(insertion.parentBranchId),
      branchId: insertion.parentBranchId,
      stationIds: nextRouteStationIds,
      enabled: true,
      source: "editor",
      note: `${formatStationDisplayName(beforeStation)} - ${formatStationDisplayName(branchStation)} - ${formatStationDisplayName(afterStation)}`,
    };

    stationSaveBusyRef.current = true;
    setStationSaveBusy(true);
    try {
      const next: ManualOverlayBundle = {
        ...baseOverlays,
        stationOverrides: [
          ...baseOverlays.stationOverrides.filter(
            (candidate) => candidate.stationId !== nextOverride.stationId,
          ),
          nextOverride,
        ],
        branchRouteOverrides: [
          ...baseOverlays.branchRouteOverrides.filter(
            (candidate) => candidate.branchId !== routeOverride.branchId,
          ),
          routeOverride,
        ],
      };

      const saved = await executeOverlayCommand(
        "새 역 추가",
        next,
        "새 역 위치와 노선 추가를 저장했습니다",
      );
      if (!saved) return null;

      setPendingAddStationInsertion(null);
      setStationLocationPickMode(false);
      const nextData = await reloadEditorData();
      if (nextData?.stations.some((station) => station.id === nextOverride.stationId)) {
        setSelection({ type: "station", id: nextOverride.stationId });
      }
      await reloadStationDraftFromData(nextData, nextOverride.stationId);
      return nextData;
    } finally {
      stationSaveBusyRef.current = false;
      setStationSaveBusy(false);
    }
  }

  async function saveSelectedStationLocationFromMap(lng: number, lat: number) {
    const draft = stationDraftRef.current;
    if (!draft) {
      showToast("위치를 지정할 역을 먼저 선택하세요", "error");
      return;
    }

    const nextDraft = { ...draft, lng, lat };
    setStationDraft(nextDraft);
    const insertion = pendingAddStationInsertionRef.current;
    if (insertion) {
      await saveStationLocationAndAddToBranch(nextDraft, insertion);
      return;
    }

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

    await syncSavedGeometryAnchorsAndReload(selectedStation.id);
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

  async function syncAllStaleSavedGeometryAnchors() {
    const result = syncAllSavedGeometryAnchors(overlays, displayStationById);
    if (result.changedCount < 1) {
      showToast("동기화할 저장 선형 anchor가 없습니다", "info");
      return;
    }

    const saved = await executeOverlayCommand(
      "저장 선형 anchor 일괄 동기화",
      result.overlays,
      `저장 선형 anchor ${result.changedCount}개를 ${result.stationCount}개 역의 현재 위치로 맞췄습니다`,
    );
    if (!saved) return;

    const nextData = await reloadEditorData();
    if (selectedStation) {
      await reloadStationDraftFromData(nextData, selectedStation.id);
    }
  }

  async function saveTransferDraft() {
    if (!transferDraft) return;
    const group = toTransferGroup(transferDraft);
    if (group.stationIds.length < 2) {
      showToast("환승 그룹은 역이 2개 이상 필요합니다", "error");
      return;
    }
    const missingPairs = getMissingTransferMinutePairLabels(
      transferDraft,
      stationById,
    );
    if (missingPairs.length > 0) {
      showToast(
        `환승 시간표 ${missingPairs.length.toLocaleString("ko-KR")}개를 모두 입력해야 저장할 수 있습니다`,
        "error",
      );
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

  async function removeStationFromTransferGroup(
    groupId: string,
    stationId: string,
  ) {
    const group = groupById.get(groupId);
    if (!group) return;
    const stationIds = group.stationIds.filter((id) => id !== stationId);
    const nextGroups =
      stationIds.length < 2
        ? overlays.manualTransferGroups.filter((candidate) => candidate.id !== groupId)
        : overlays.manualTransferGroups.map((candidate) =>
            candidate.id === groupId
              ? {
                  ...candidate,
                  stationIds,
                  transferMinutesByPair: normalizeTransferGroupDraftPairs(
                    stationIds,
                    candidate.transferMinutesByPair,
                  ),
                }
              : candidate,
          );
    const saved = await executeOverlayCommand(
      stationIds.length < 2
        ? "환승 그룹 역 제거 및 그룹 삭제"
        : "환승 그룹 역 제거",
      { ...overlays, manualTransferGroups: nextGroups },
      stationIds.length < 2
        ? "역 제거 후 환승 그룹을 삭제했습니다"
        : "환승 그룹에서 역을 제거했습니다",
    );
    if (!saved) return;
    setTransferDraft(null);
    setSelection({ type: "station", id: stationId });
    await reloadEditorData();
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

    const validationIssues = dirtyDrafts.flatMap((draft) =>
      getGeometryDraftValidationIssues(draft, geometryTargetByKey, stationById),
    );
    const blockingIssues = validationIssues.filter(
      (issue) => issue.severity === "error",
    );
    if (blockingIssues.length > 0) {
      showToast(
        `선형 편집 검증 오류 ${blockingIssues.length.toLocaleString("ko-KR")}개를 먼저 해결해야 합니다`,
        "error",
      );
      setSidebarTab("validation");
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

    const connectionBlockReason = getLineBranchConnectionBlockReason(parentBranch, connectedBranch);
    if (connectionBlockReason) {
      showToast(connectionBlockReason, "error");
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

  function applyValidationFixToOverlays(
    current: ManualOverlayBundle,
    fix: LineBranchValidationAutoFix,
  ): ManualOverlayBundle {
    if (fix.kind === "delete-line-branch") {
      return {
        ...current,
        lineBranchOverrides: current.lineBranchOverrides.filter(
          (override) => override.id !== fix.id,
        ),
      };
    }

    if (fix.kind === "delete-branch-station-exclusion") {
      return {
        ...current,
        branchStationExclusions: current.branchStationExclusions.filter(
          (override) => override.id !== fix.id,
        ),
      };
    }

    if (fix.kind === "remove-branch-route-station") {
      return {
        ...current,
        branchRouteOverrides: current.branchRouteOverrides.flatMap((override) => {
          if (override.id !== fix.overrideId) return [override];
          const stationIds = override.stationIds.filter(
            (stationId) => stationId !== fix.stationId,
          );
          return stationIds.length >= 2 ? [{ ...override, stationIds }] : [];
        }),
      };
    }

    if (fix.kind === "convert-geometry-station-to-control") {
      return {
        ...current,
        geometryOverrides: current.geometryOverrides.map((override) => {
          if (override.branchId !== fix.branchId) return override;
          const points = override.points.map((point, index) => {
            if (index !== fix.pointIndex || point.kind !== "station") return point;
            return { lng: point.lng, lat: point.lat, kind: "control" as const };
          });
          return { ...override, points };
        }),
      };
    }

    if (fix.kind === "convert-line-branch-station-to-control") {
      return {
        ...current,
        lineBranchOverrides: current.lineBranchOverrides.map((override) => {
          if (override.id !== fix.overrideId || !override.geometry) return override;
          const geometry = override.geometry.map((point, index) => {
            if (index !== fix.pointIndex || point.kind !== "station") return point;
            return { lng: point.lng, lat: point.lat, kind: "control" as const };
          });
          return { ...override, geometry };
        }),
      };
    }

    if (fix.kind === "create-geometry-from-branch-stops") {
      const branch = branchById.get(fix.branchId);
      const override = branch ? makeGeometryOverrideFromBranchStops(branch) : null;
      if (!override) return current;
      return {
        ...current,
        geometryOverrides: [
          ...current.geometryOverrides.filter(
            (candidate) => candidate.branchId !== override.branchId,
          ),
          override,
        ],
      };
    }

    return current;
  }

  async function applyValidationAutoFix(
    fix: LineBranchValidationAutoFix,
    label = "검증 문제 자동 해결",
  ) {
    const next = applyValidationFixToOverlays(overlays, fix);
    if (next === overlays) {
      showToast("자동 해결할 수 있는 변경이 없습니다", "info");
      return;
    }
    const saved = await executeOverlayCommand(label, next, "검증 문제 자동 해결 완료");
    if (!saved) return;
    await reloadEditorData();
    setSidebarTab("validation");
  }

  async function applyAllSafeValidationFixes() {
    const fixes = lineBranchIssues
      .filter((issue) => issue.autoFix && issue.includeInBulkFix !== false)
      .map((issue) => issue.autoFix)
      .filter((fix): fix is LineBranchValidationAutoFix => Boolean(fix));

    if (fixes.length === 0) {
      showToast("일괄 자동 해결할 항목이 없습니다", "info");
      return;
    }

    const next = fixes.reduce(
      (current, fix) => applyValidationFixToOverlays(current, fix),
      overlays,
    );
    const saved = await executeOverlayCommand(
      "검증 문제 일괄 자동 해결",
      next,
      `${fixes.length.toLocaleString("ko-KR")}개 검증 문제 자동 해결 완료`,
    );
    if (!saved) return;
    await reloadEditorData();
    setSidebarTab("validation");
  }

  async function saveBranchRouteOverride(
    branchId: string,
    stationIds: string[],
    commandLabel: string,
    message: string,
    circular = branchRouteOverrideById.get(branchId)?.circular === true,
  ) {
    const branch = branchById.get(branchId);
    if (!branch) {
      showToast("노선을 찾지 못했습니다", "error");
      return;
    }

    const uniqueStationIds = [...new Set(stationIds)].filter((stationId) =>
      stationById.has(stationId),
    );
    if (uniqueStationIds.length < 2) {
      showToast("노선에는 역이 2개 이상 필요합니다", "error");
      return;
    }

    const baseStationIds = getBranchStopStations(branch).map(
      (station) => station.id,
    );
    const currentCircular = branchRouteOverrideById.get(branchId)?.circular === true;
    const isSameAsCurrent =
      baseStationIds.length === uniqueStationIds.length &&
      baseStationIds.every(
        (stationId, index) => stationId === uniqueStationIds[index],
      ) &&
      currentCircular === circular;
    if (isSameAsCurrent) {
      showToast("변경된 정차 순서가 없습니다", "info");
      return;
    }

    const override: ManualBranchRouteOverride = {
      id: makeBranchRouteOverrideId(branchId),
      branchId,
      stationIds: uniqueStationIds,
      circular,
      enabled: true,
      source: "editor",
      note: null,
    };
    const next: ManualOverlayBundle = {
      ...overlays,
      branchRouteOverrides: [
        ...overlays.branchRouteOverrides.filter(
          (candidate) => candidate.branchId !== branchId,
        ),
        override,
      ],
    };

    const saved = await executeOverlayCommand(commandLabel, next, message);
    if (!saved) return;
    await reloadEditorData();
  }

  async function resetBranchRouteOverride(branchId: string) {
    const next: ManualOverlayBundle = {
      ...overlays,
      branchRouteOverrides: overlays.branchRouteOverrides.filter(
        (override) => override.branchId !== branchId,
      ),
    };

    const saved = await executeOverlayCommand(
      "노선 정차 순서 초기화",
      next,
      "노선 정차 순서를 원본으로 되돌렸습니다",
    );
    if (!saved) return;
    await reloadEditorData();
  }

  async function setBranchCircular(branchId: string, circular: boolean) {
    const branch = branchById.get(branchId);
    if (!branch) {
      showToast("노선을 찾지 못했습니다", "error");
      return;
    }

    const stationIds = getBranchStopStations(branch).map((station) => station.id);
    await saveBranchRouteOverride(
      branchId,
      stationIds,
      circular ? "순환 노선 설정" : "순환 노선 해제",
      circular ? "순환 노선으로 표시합니다" : "일반 노선으로 표시합니다",
      circular,
    );
  }

  async function startAddStationInsertion(insertion: PendingAddStationInsertion) {
    const branch = branchById.get(insertion.parentBranchId);
    const beforeStation = stationById.get(insertion.beforeStationId);
    const afterStation = stationById.get(insertion.afterStationId);
    const beforeCoordinate = getStationCoordinate(beforeStation);
    const afterCoordinate = getStationCoordinate(afterStation);

    if (!branch || !beforeCoordinate || !afterCoordinate) {
      showToast("선택한 추가 위치의 좌표를 찾지 못했습니다", "error");
      return;
    }

    const manualStationName = insertion.newStationNameKo?.trim();
    if (manualStationName) {
      const manualStationId = makeManualStationId(branch, manualStationName);
      setSelection({ type: "none" });
      setStationDraft(makeManualStationOverride(branch, manualStationId, manualStationName));
      setAddStationModalOpen(false);
      setPendingAddStationInsertion(insertion);
      setStationLocationPickMode(true);
      setSidebarTab("search");

      const map = mapRef.current;
      if (!map) return;

      const bounds = new maplibregl.LngLatBounds(
        beforeCoordinate,
        beforeCoordinate,
      ).extend(afterCoordinate);
      map.fitBounds(bounds, {
        padding: { top: 160, right: 420, bottom: 160, left: 80 },
        maxZoom: 15,
        duration: 500,
      });
      return;
    }

    const currentDraft = stationDraftRef.current;
    if (!currentDraft) {
      showToast("노선에 연결할 기존 역을 먼저 선택하세요", "error");
      return;
    }

    const stationCoordinate = getStationCoordinate(selectedStation);
    const nextDraft: ManualStationOverride = {
      ...currentDraft,
      lng:
        typeof currentDraft.lng === "number"
          ? currentDraft.lng
          : stationCoordinate?.[0] ?? null,
      lat:
        typeof currentDraft.lat === "number"
          ? currentDraft.lat
          : stationCoordinate?.[1] ?? null,
    };

    setAddStationModalOpen(false);
    setPendingAddStationInsertion(null);
    setStationLocationPickMode(false);
    await saveStationLocationAndAddToBranch(nextDraft, insertion);
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
  const selectedStationTransferGroup = selectedStation
    ? (stationTransferGroupIndex.get(selectedStation.id) ?? null)
    : null;
  const selectedBranch =
    selection.type === "branch" ? (branchById.get(selection.id) ?? null) : null;
  const geometryWorkspaceDirtyDrafts = geometryWorkspaceDrafts.filter(
    (draft) =>
      !areGeometryDraftsEqual(draft, getSavedGeometryDraftForDraft(draft)),
  );
  const geometryWorkspaceValidationIssues =
    geometryWorkspaceDirtyDrafts.flatMap((draft) =>
      getGeometryDraftValidationIssues(draft, geometryTargetByKey, stationById),
    );
  const geometryWorkspaceValidationErrors =
    geometryWorkspaceValidationIssues.filter(
      (issue) => issue.severity === "error",
    );
  const geometryWorkspaceValidationWarnings =
    geometryWorkspaceValidationIssues.filter(
      (issue) => issue.severity === "warning",
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
        const targetTitle = getGeometryDraftTargetTitle(
          draft,
          geometryTargetByKey,
        );

        return {
          changedTargetCount: summary.changedTargetCount + 1,
          changedTargetLabels: [...summary.changedTargetLabels, targetTitle],
          validationIssueCount: geometryWorkspaceValidationIssues.length,
          validationErrorCount: geometryWorkspaceValidationErrors.length,
          validationWarningCount: geometryWorkspaceValidationWarnings.length,
          validationIssueTargetLabels: [
            ...new Set(
              geometryWorkspaceValidationErrors.map(
                (issue) => issue.targetTitle,
              ),
            ),
          ],
          validationWarningTargetLabels: [
            ...new Set(
              geometryWorkspaceValidationWarnings.map(
                (issue) => issue.targetTitle,
              ),
            ),
          ],
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
        changedTargetLabels: [],
        validationIssueCount: geometryWorkspaceValidationIssues.length,
        validationErrorCount: geometryWorkspaceValidationErrors.length,
        validationWarningCount: geometryWorkspaceValidationWarnings.length,
        validationIssueTargetLabels: [
          ...new Set(
            geometryWorkspaceValidationErrors.map((issue) => issue.targetTitle),
          ),
        ],
        validationWarningTargetLabels: [
          ...new Set(
            geometryWorkspaceValidationWarnings.map(
              (issue) => issue.targetTitle,
            ),
          ),
        ],
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
      : getPrimarySelectedTransferGroup(
          selection,
          overlays.manualTransferGroups,
        );
  const multiStationIds =
    selection.type === "multiStation" ? selection.ids : [];
  const geometryDraftDirty = geometryWorkspaceDirtyDrafts.length > 0;
  const geometryDirtyTargetKeys = new Set(
    geometryWorkspaceDirtyDrafts
      .map(getGeometryDraftTargetKey)
      .filter((key): key is string => Boolean(key)),
  );
  const isGeometryMode = toolMode === "geometry";
  const canUndo = isGeometryMode
    ? geometryHistoryVersion >= 0 && geometryUndoStackRef.current.length > 0
    : historyVersion >= 0 && undoStackRef.current.length > 0;
  const canRedo = isGeometryMode
    ? geometryHistoryVersion >= 0 && geometryRedoStackRef.current.length > 0
    : historyVersion >= 0 && redoStackRef.current.length > 0;
  const validationBadgeCount =
    lineBranchIssues.length + staleSavedAnchorSummaries.length;
  const sidebarTabOptions: Array<{
    value: SidebarTab;
    label: string;
    Icon: IconComponent;
    badge?: number;
  }> = [
    { value: "search", label: "검색", Icon: Search },
    { value: "layers", label: "레이어", Icon: Layers3 },
    {
      value: "transfers",
      label: "환승",
      Icon: Waypoints,
      badge: overlays.manualTransferGroups.length,
    },
    {
      value: "validation",
      label: "검증",
      Icon: ListChecks,
      badge: validationBadgeCount,
    },
    { value: "history", label: "기록", Icon: History },
  ];

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
    <AppShell className="editor-app-shell">
      <InspectorGrid className="editor-inspector-grid">
        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <PanelHeader className="editor-panel-header">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase text-slate-400">
                  {isGeometryMode ? "Geometry" : "Railmap"}
                </p>
                <h1 className="mt-1 truncate text-lg font-semibold">
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
              <TabList className="mt-3 flex snap-x snap-mandatory gap-1 overflow-x-auto scroll-smooth rounded-2xl bg-slate-100 p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {sidebarTabOptions.map(({ value, label, Icon, badge }) => (
                  <TabButton
                    key={value}
                    className="relative grid h-10 min-w-10 snap-center place-items-center px-0"
                    active={sidebarTab === value}
                    onClick={() => setSidebarTab(value)}
                    title={label}
                    aria-label={label}
                  >
                    <Icon className="size-4 shrink-0" />
                    {badge && badge > 0 ? (
                      <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-slate-900 px-1 text-[9px] font-bold leading-4 text-white">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    ) : null}
                  </TabButton>
                ))}
              </TabList>
            ) : null}
          </PanelHeader>

          <PanelBody className="min-h-0 flex-1 overflow-y-auto">
            {isGeometryMode ? (
              <GeometryModeSidebar
                targets={filteredGeometryTargets}
                totalTargetCount={geometryTargets.length}
                activeTargetKey={getGeometryDraftTargetKey(geometryDraft)}
                dirtyTargetKeys={geometryDirtyTargetKeys}
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
                <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-slate-400">
                  <span>
                    {filteredStations.length.toLocaleString("ko-KR")}개 결과
                  </span>
                  <span>전체 {data.stations.length.toLocaleString("ko-KR")}개</span>
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
                  {filteredStations.length === 0 ? (
                    <Placeholder
                      title="검색 결과 없음"
                      description="역명, 노선명, 역번호를 다른 방식으로 입력하세요."
                    />
                  ) : null}
                </div>
              </div>
            ) : null}

            {!isGeometryMode && sidebarTab === "layers" ? (
              <div className="grid gap-2">
                {layerOptions.map(({ key, label, Icon }) => (
                  <label
                    key={String(key)}
                    className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm font-semibold transition hover:border-blue-200 hover:bg-blue-50"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-blue-600"
                      checked={layers[key]}
                      onChange={(event) =>
                        setLayers((previous) => ({
                          ...previous,
                          [key]: event.target.checked,
                        }))
                      }
                    />
                    <Icon className="size-4 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
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
                      {selectedGroup.nameKo} · {selectedGroup.stationIds.length}
                      개 하위 역 선택
                    </p>
                  </div>
                ) : null}
                {multiStationIds.length >= 2 && !selectedGroup ? (
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
                    className={cn(
                      "rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-blue-200 hover:bg-blue-50",
                      selectedGroup?.id === group.id
                        ? "border-blue-300 bg-blue-50"
                        : null,
                    )}
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
                {overlays.manualTransferGroups.length === 0 ? (
                  <Placeholder
                    title="환승 그룹 없음"
                    description="지도에서 여러 역을 선택한 뒤 환승 그룹을 만들 수 있습니다."
                  />
                ) : null}
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
                staleSavedAnchorSummaries={staleSavedAnchorSummaries}
                onSyncStaleSavedAnchors={() =>
                  void syncAllStaleSavedGeometryAnchors()
                }
                onApplyIssueFix={(fix) => void applyValidationAutoFix(fix)}
                onApplyAllSafeFixes={() => void applyAllSafeValidationFixes()}
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

        <main className="relative min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div ref={mapContainerRef} className="absolute inset-0 size-full" />
          <div className="pointer-events-none absolute left-4 top-4 flex max-w-[calc(100%-2rem)] flex-wrap gap-2">
            <Badge className="bg-white/90 text-slate-700">
              {selectedGroup
                ? `환승 그룹 · ${selectedGroup.nameKo}`
                : selectionLabel(selection)}
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
          <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur">
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
            {!isGeometryMode ? (
              <button
                type="button"
                className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100"
                onClick={() => {
                  setSelection({ type: "none" });
                  setStationDraft(null);
                  setAddStationModalOpen(true);
                }}
                title="새 역 생성"
              >
                <Plus className="size-4" />
                새 역
              </button>
            ) : null}
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
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-[min(420px,calc(100%-1.5rem))] rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 text-xs font-medium leading-5 text-slate-600 shadow-lg backdrop-blur">
            {isGeometryMode
              ? "선형을 선택하고 지도 위 점/구간을 드래그해 보정합니다."
              : "지도 객체 선택, 드래그 박스 다중 선택, Cmd/Ctrl+K 검색을 사용할 수 있습니다."}
          </div>
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
          <PanelHeader className="editor-panel-header">
            <p className="text-[11px] font-semibold uppercase text-slate-400">
              {isGeometryMode ? "Geometry Tools" : "Inspector"}
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold">
              {isGeometryMode
                ? "전체 선형 편집"
                : selectedGroup
                  ? `환승 그룹 · ${selectedGroup.nameKo}`
                  : selectionLabel(selection)}
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
                transferGroup={selectedStationTransferGroup}
                onChange={setStationDraft}
                onSave={() => void saveStationDraft()}
                onRollbackPosition={() =>
                  void rollbackSelectedStationPosition()
                }
                canRollbackPosition={selectedStationHasPositionOverride}
                staleSavedAnchorCount={selectedStationStaleSavedAnchorCount}
                saving={stationSaveBusy}
                onSyncSavedAnchors={() =>
                  void syncSelectedStationSavedGeometryAnchors()
                }
                onSetNonTransfer={(enabled) =>
                  void setStationsNonTransfer([selectedStation.id], enabled)
                }
                onOpenTransferGroup={(groupId) => selectTransferGroup(groupId)}
                onRemoveFromTransferGroup={(groupId) =>
                  void removeStationFromTransferGroup(
                    groupId,
                    selectedStation.id,
                  )
                }
                onStartMapPick={() => setStationLocationPickMode(true)}
                onOpenAddStationModal={() => setAddStationModalOpen(true)}
                onFocus={() => focusStation(selectedStation.id)}
                pickMode={stationLocationPickMode}
                pendingAddStationInsertion={pendingAddStationInsertion}
                branchRemovalOptions={selectedStationBranches}
                branchAddOptions={data.branches}
                lineBranchOverrides={overlays.lineBranchOverrides}
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
                onDeleteLineBranch={(id) => void deleteLineBranchOverride(id)}
              />
            ) : null}
            {!isGeometryMode && activeGeometryBranch ? (
              <BranchInspector
                branch={activeGeometryBranch}
                branches={data.branches}
                lineBranchOverrides={overlays.lineBranchOverrides}
                branchStationExclusions={overlays.branchStationExclusions}
                branchRouteOverride={
                  overlays.branchRouteOverrides.find(
                    (override) => override.branchId === activeGeometryBranch.id,
                  ) ?? null
                }
                unassignedStations={unassignedStations}
                onDeleteLineBranch={(id) => void deleteLineBranchOverride(id)}
                onRestoreBranchStation={(id) =>
                  void deleteBranchStationExclusion(id)
                }
                onUpdateRoute={(stationIds, label, circular) =>
                  void saveBranchRouteOverride(
                    activeGeometryBranch.id,
                    stationIds,
                    label,
                    "노선 정차 순서를 저장했습니다",
                    circular,
                  )
                }
                onResetRoute={() =>
                  void resetBranchRouteOverride(activeGeometryBranch.id)
                }
                onSetCircular={(circular) =>
                  void setBranchCircular(activeGeometryBranch.id, circular)
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
                transferGroup={selectedGroup}
                onSetNonTransfer={(enabled) =>
                  void setStationsNonTransfer(multiStationIds, enabled)
                }
                onOpenTransferGroup={(groupId) => selectTransferGroup(groupId)}
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

      <AddStationInsertionDialog
        open={addStationModalOpen}
        station={selectedStation}
        branches={data.branches}
        onClose={() => setAddStationModalOpen(false)}
        onSelect={startAddStationInsertion}
      />

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
  dirtyTargetKeys,
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
  dirtyTargetKeys: Set<string>;
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
              const dirty = dirtyTargetKeys.has(targetKey);
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
  const changedTargetPreview = [...new Set(summary.changedTargetLabels)].slice(
    0,
    5,
  );
  const validationTargetPreview = [
    ...new Set(summary.validationIssueTargetLabels),
  ].slice(0, 4);
  const validationWarningTargetPreview = [
    ...new Set(summary.validationWarningTargetLabels),
  ].slice(0, 4);

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
        {changedTargetPreview.length > 0 ? (
          <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50/70 px-2 py-2 text-[11px] font-semibold text-amber-800">
            <p>미저장 대상</p>
            <p className="mt-1 truncate text-amber-700">
              {changedTargetPreview.join(", ")}
              {summary.changedTargetLabels.length > changedTargetPreview.length
                ? ` 외 ${summary.changedTargetLabels.length - changedTargetPreview.length}개`
                : ""}
            </p>
          </div>
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

      {summary.validationErrorCount > 0 ? (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-semibold leading-4 text-red-700">
          <p>
            저장 차단 오류{" "}
            {summary.validationErrorCount.toLocaleString("ko-KR")}개
          </p>
          {validationTargetPreview.length > 0 ? (
            <p className="mt-1 truncate text-red-600">
              대상: {validationTargetPreview.join(", ")}
              {summary.validationIssueTargetLabels.length >
              validationTargetPreview.length
                ? ` 외 ${summary.validationIssueTargetLabels.length - validationTargetPreview.length}개`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}
      {summary.validationWarningCount > 0 ? (
        <div className="rounded-2xl border border-yellow-100 bg-yellow-50 px-3 py-2 text-[11px] font-semibold leading-4 text-yellow-700">
          <p>
            저장 가능 경고{" "}
            {summary.validationWarningCount.toLocaleString("ko-KR")}개
          </p>
          {validationWarningTargetPreview.length > 0 ? (
            <p className="mt-1 truncate text-yellow-600">
              대상: {validationWarningTargetPreview.join(", ")}
              {summary.validationWarningTargetLabels.length >
              validationWarningTargetPreview.length
                ? ` 외 ${summary.validationWarningTargetLabels.length - validationWarningTargetPreview.length}개`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}

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

function CollapsibleSection({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className="group rounded-2xl border border-slate-200 bg-white"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-left">
        <span className="min-w-0">
          <strong className="block truncate text-xs font-semibold text-slate-700">
            {title}
          </strong>
          {meta ? (
            <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-400">
              {meta}
            </span>
          ) : null}
        </span>
        <ChevronRight className="size-4 shrink-0 text-slate-400 transition group-open:rotate-90" />
      </summary>
      <div className="grid gap-2 border-t border-slate-100 p-2">{children}</div>
    </details>
  );
}

function StationInspector({
  station,
  draft,
  nonTransfer,
  transferGroup,
  pickMode,
  onChange,
  onSave,
  onRollbackPosition,
  canRollbackPosition,
  staleSavedAnchorCount,
  saving,
  onSyncSavedAnchors,
  onSetNonTransfer,
  onOpenTransferGroup,
  onRemoveFromTransferGroup,
  onStartMapPick,
  onOpenAddStationModal,
  onFocus,
  branchRemovalOptions,
  pendingAddStationInsertion,
  branchAddOptions,
  lineBranchOverrides,
  onExcludeFromBranch,
  onCreateAddStationBranch,
  onCreateConnectLineBranch,
  onDeleteLineBranch,
}: {
  station: EditorStation;
  draft: ManualStationOverride;
  nonTransfer: boolean;
  transferGroup: TransferGroupMapInfo | null;
  pickMode: boolean;
  onChange: (next: ManualStationOverride) => void;
  onSave: () => void;
  onRollbackPosition: () => void;
  canRollbackPosition: boolean;
  staleSavedAnchorCount: number;
  saving: boolean;
  onSyncSavedAnchors: () => void;
  onSetNonTransfer: (enabled: boolean) => void;
  onOpenTransferGroup: (groupId: string) => void;
  onRemoveFromTransferGroup: (groupId: string) => void;
  onStartMapPick: () => void;
  onOpenAddStationModal: () => void;
  onFocus: () => void;
  pendingAddStationInsertion: PendingAddStationInsertion | null;
  branchRemovalOptions: EditorMapBranch[];
  branchAddOptions: EditorMapBranch[];
  lineBranchOverrides: ManualLineBranchOverride[];
  onExcludeFromBranch: (branchId: string) => void;
  onCreateAddStationBranch: (branchId: string, anchorStationId: string) => void;
  onCreateConnectLineBranch: (
    parentBranchId: string,
    connectedBranchId: string,
    connectedEndpointStationId: string,
    connectedDirection: LineBranchDirection,
  ) => void;
  onDeleteLineBranch: (id: string) => void;
}) {
  const [removeBranchId, setRemoveBranchId] = useState(
    branchRemovalOptions[0]?.id ?? "",
  );
  const [addParentBranchId, setAddParentBranchId] = useState(
    branchAddOptions[0]?.id ?? "",
  );

  const addParentBranch =
    branchAddOptions.find((branch) => branch.id === addParentBranchId) ?? null;
  const addAnchorStations = useMemo(
    () => (addParentBranch ? getBranchStopStations(addParentBranch) : []),
    [addParentBranch],
  );
  const [addAnchorStationId, setAddAnchorStationId] = useState(
    addAnchorStations[0]?.id ?? "",
  );
  const canAddToBranch = branchRemovalOptions.length === 0;
  const endpointConnectOptions = useMemo(
    () =>
      branchRemovalOptions.filter((branch) =>
        !isBranchCircular(branch) &&
        getBranchEndpointStations(branch).some(
          (candidate) => candidate.id === station.id,
        ),
      ),
    [branchRemovalOptions, station.id],
  );
  const [connectParentBranchId, setConnectParentBranchId] = useState(
    endpointConnectOptions[0]?.id ?? "",
  );
  const connectParentBranch =
    endpointConnectOptions.find(
      (branch) => branch.id === connectParentBranchId,
    ) ?? null;
  const connectOtherBranches = useMemo(
    () =>
      branchAddOptions.filter(
        (branch) => branch.id !== connectParentBranchId,
      ),
    [branchAddOptions, connectParentBranchId],
  );
  const [connectBranchId, setConnectBranchId] = useState(
    connectOtherBranches[0]?.id ?? "",
  );
  const selectedConnectBranch =
    branchAddOptions.find((branch) => branch.id === connectBranchId) ?? null;
  const connectEndpointStations = useMemo(
    () =>
      selectedConnectBranch ? getBranchStopStations(selectedConnectBranch) : [],
    [selectedConnectBranch],
  );
  const [connectEndpointStationId, setConnectEndpointStationId] = useState(
    connectEndpointStations[0]?.id ?? "",
  );
  const [connectDirection, setConnectDirection] =
    useState<LineBranchDirection>("toward-end");
  const connectDirectionOptions = getBranchDirectionOptions(
    selectedConnectBranch,
    connectEndpointStationId,
  );
  const stationIndex = new Map(
    [
      station,
      ...branchAddOptions.flatMap(getBranchStopStations),
      ...branchRemovalOptions.flatMap(getBranchStopStations),
    ].map((candidate) => [candidate.id, candidate]),
  );
  const branchIndex = new Map(
    branchAddOptions.map((branch) => [branch.id, branch]),
  );
  const relatedLineBranches = lineBranchOverrides.filter(
    (override) =>
      override.anchorStationId === station.id ||
      override.branchStationId === station.id ||
      override.connectedEndpointStationId === station.id ||
      (override.geometry ?? []).some(
        (point) => point.kind === "station" && point.stationId === station.id,
      ),
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
          <strong className="min-w-0 flex-1 truncate text-base font-semibold">
            {station.nameKo}
          </strong>
          {nonTransfer ? (
            <Badge className="bg-amber-50 text-amber-700">미환승</Badge>
          ) : null}
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
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-medium leading-5 text-slate-600">
        역 위치는 숫자를 직접 입력하지 않고 지도에서 지정합니다. 현재 위치로
        지도를 이동한 뒤, 필요한 경우 지도 클릭으로 새 위치를 저장하세요.
      </div>
      {pendingAddStationInsertion ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-xs font-medium leading-5 text-blue-900">
          <strong className="block font-semibold">새 역 추가 위치 선택 중</strong>
          <span>
            {formatBranchDisplayName(
              branchIndex.get(pendingAddStationInsertion.parentBranchId),
            )}{" "}
            ·{" "}
            {formatStationDisplayName(
              stationIndex.get(pendingAddStationInsertion.beforeStationId),
            )}{" "}
            - {station.nameKo} -{" "}
            {formatStationDisplayName(
              stationIndex.get(pendingAddStationInsertion.afterStationId),
            )}
          </span>
        </div>
      ) : null}
      <Field label="메모">
        <Textarea
          value={draft.note ?? ""}
          onChange={(event) =>
            onChange({ ...draft, note: event.target.value || null })
          }
        />
      </Field>
      {saving ? (
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs font-medium text-blue-800">
          저장 중입니다. 지도 클릭을 여러 번 반복하지 않아도 됩니다.
        </div>
      ) : null}
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
      {transferGroup ? (
        <div className="grid gap-2 rounded-2xl border border-blue-100 bg-blue-50/80 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <strong className="text-xs font-semibold text-blue-900">
                환승 그룹에 속한 역
              </strong>
              <p className="mt-1 text-xs font-medium leading-5 text-blue-800">
                {transferGroup.nameKo} 그룹에 포함되어 있습니다. 이 역을
                미환승역으로 바꾸려면 먼저 그룹에서 제거해야 합니다.
              </p>
            </div>
            <Badge className="shrink-0 bg-white/80 text-blue-700">
              {transferGroup.stationIds.length}개 역
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenTransferGroup(transferGroup.id)}
            >
              환승 그룹 설정 열기
            </Button>
            <Button
              variant="outline"
              onClick={() => onRemoveFromTransferGroup(transferGroup.id)}
            >
              그룹에서 제거
            </Button>
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-2">
        <Button
          className="h-auto min-h-10 whitespace-normal px-2 py-2 text-center leading-4"
          variant="outline"
          onClick={onFocus}
        >
          <LocateFixed className="mr-1 size-4 shrink-0" />
          현재 위치로 지도 이동
        </Button>
        <Button
          className="h-auto min-h-10 whitespace-normal px-2 py-2 text-center leading-4"
          variant={pickMode ? "secondary" : "outline"}
          disabled={saving}
          onClick={onStartMapPick}
        >
          {pickMode ? "새 위치를 지도에서 클릭" : "지도 클릭으로 위치 저장"}
        </Button>
        <Button
          variant="outline"
          disabled={!canRollbackPosition || saving}
          onClick={onRollbackPosition}
        >
          <Undo2 className="mr-1 size-4" />
          위치 되돌리기
        </Button>
        {!transferGroup ? (
          <Button
            variant={nonTransfer ? "secondary" : "outline"}
            onClick={() => onSetNonTransfer(!nonTransfer)}
          >
            {nonTransfer ? "환승 가능역으로 변경" : "미환승역으로 설정"}
          </Button>
        ) : null}
        <Button
          className={transferGroup ? "" : "col-span-2"}
          disabled={saving}
          onClick={onSave}
        >
          <Save className="mr-1 size-4" />
          {saving ? "저장 중" : "저장"}
        </Button>
      </div>
      <CollapsibleSection
        title="노선 소속 관리"
        meta={
          branchRemovalOptions.length > 0
            ? `${branchRemovalOptions.length}개 소속 노선`
            : "미소속 역"
        }
        defaultOpen={branchRemovalOptions.length === 0}
      >
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
              기존 노선에 편입
            </strong>
            <span className="text-[10px] font-semibold text-blue-700">
              미소속 역
            </span>
          </div>
            <Button
              disabled={!canAddToBranch || branchAddOptions.length === 0}
              onClick={onOpenAddStationModal}
          >
            <Plus className="mr-1 size-4" />
            노선 사이 위치 선택
          </Button>
          <div className="mt-2 border-t border-blue-100 pt-2">
            <strong className="text-[11px] font-semibold text-blue-800">
              지선으로 추가
            </strong>
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
            <AddStationBranchPreview
              parentBranch={addParentBranch}
              anchorStation={stationIndex.get(addAnchorStationId)}
              branchStation={station}
            />
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
      </CollapsibleSection>
      <CollapsibleSection
        title="지선 연결 관리"
        meta={`${relatedLineBranches.length + endpointConnectOptions.length}개 관련 작업`}
        defaultOpen={relatedLineBranches.length > 0}
      >
        {relatedLineBranches.length > 0 ? (
          <div className="grid gap-2 rounded-2xl border border-rose-100 bg-rose-50/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-xs font-semibold text-rose-800">
                결합된 지선 제거
              </strong>
              <span className="text-[10px] font-semibold text-rose-700">
                {relatedLineBranches.length}개
              </span>
            </div>
            <p className="text-xs font-medium leading-5 text-rose-800">
              이 역을 기준으로 만든 지선 추가/노선 결합을 제거할 수 있습니다.
            </p>
            {relatedLineBranches.map((override) => {
              const display = getLineBranchDisplay(
                override,
                branchIndex,
                stationIndex,
              );
              return (
                <div
                  key={override.id}
                  className="grid gap-2 rounded-xl bg-white/80 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-bold text-rose-800">
                      {display.title}
                    </p>
                    <Badge className="bg-rose-100 text-rose-700">
                      {override.mode === "add-station" ? "지선" : "결합"}
                    </Badge>
                  </div>
                  <LineBranchVisualCard
                    override={override}
                    branchById={branchIndex}
                    stationById={stationIndex}
                  />
                  <Button
                    variant="outline"
                    onClick={() => onDeleteLineBranch(override.id)}
                  >
                    <Trash2 className="mr-1 size-3" />
                    이 결합 제거
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}
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
                onChange={(event) =>
                  setConnectParentBranchId(event.target.value)
                }
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
            <ConnectLineBranchPreview
              parentBranch={connectParentBranch}
              anchorStation={station}
              connectedBranch={selectedConnectBranch}
              connectedStation={stationIndex.get(connectEndpointStationId)}
              directionLabel={formatLineBranchDirectionSummary(
                selectedConnectBranch,
                connectEndpointStationId,
                connectDirection,
              )}
            />
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
        ) : (
          <Placeholder
            title="연결 작업 없음"
            description="이 역이 순환 노선이 아닌 노선의 시작/끝 역일 때만 노선 결합 작업이 표시됩니다. 순환 노선에서는 내부 지선 추가만 가능합니다."
          />
        )}
      </CollapsibleSection>
    </div>
  );
}

function TransferGroupInspector({
  group,
  draft,
  stationById,
  mode = "edit",
  onChange,
  onSave,
  onDelete,
}: {
  group: ManualTransferGroup;
  draft: TransferGroupDraft;
  stationById: Map<string, EditorStation>;
  mode?: "edit" | "create";
  onChange: (draft: TransferGroupDraft) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const [timeModalOpen, setTimeModalOpen] = useState(false);
  const pairKeys = getTransferPairKeys(draft.stationIds);
  const missingPairs = getMissingTransferMinutePairLabels(draft, stationById);
  const title = mode === "create" ? "새 환승 그룹 만들기" : group.nameKo;
  const description =
    mode === "create"
      ? `${draft.stationIds.length}개 역을 하나의 환승 그룹으로 묶습니다.`
      : `${group.stationIds.length}개 역 · ${group.note || "메모 없음"}`;

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
      <div
        className={cn(
          "rounded-3xl border p-4",
          mode === "create"
            ? "border-blue-200 bg-blue-50 text-blue-950"
            : "border-slate-200 bg-slate-50",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{title}</h3>
            <p
              className={cn(
                "mt-1 text-xs font-medium leading-5",
                mode === "create" ? "text-blue-700" : "text-slate-500",
              )}
            >
              {description}
            </p>
          </div>
          <Badge className={mode === "create" ? "bg-white/80 text-blue-700" : ""}>
            {draft.stationIds.length}개 역
          </Badge>
        </div>
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
        <div className="flex items-center justify-between px-1">
          <strong className="text-xs font-medium text-slate-600">
            환승 그룹 역 목록
          </strong>
          <span className="text-[11px] font-semibold text-slate-400">
            최소 2개 필요
          </span>
        </div>
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
                title="환승 그룹에서 제거"
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          );
        })}
      </div>
      <div
        className={cn(
          "grid gap-2 rounded-3xl border p-3",
          missingPairs.length > 0
            ? "border-amber-200 bg-amber-50/80"
            : "border-emerald-200 bg-emerald-50/70",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <strong
              className={cn(
                "text-xs font-semibold",
                missingPairs.length > 0 ? "text-amber-900" : "text-emerald-900",
              )}
            >
              역간 환승 시간표
            </strong>
            <p
              className={cn(
                "mt-1 text-xs font-medium leading-5",
                missingPairs.length > 0 ? "text-amber-800" : "text-emerald-800",
              )}
            >
              {missingPairs.length > 0
                ? `${missingPairs.length.toLocaleString("ko-KR")}개 구간을 더 입력해야 저장할 수 있습니다.`
                : `모든 ${pairKeys.length.toLocaleString("ko-KR")}개 구간 시간이 입력됐습니다.`}
            </p>
          </div>
          <Button variant="outline" onClick={() => setTimeModalOpen(true)}>
            시간표 크게 편집
          </Button>
        </div>
        {missingPairs.length > 0 ? (
          <p className="line-clamp-2 text-[11px] font-medium leading-5 text-amber-700">
            누락: {missingPairs.slice(0, 4).join(", ")}
            {missingPairs.length > 4 ? ` 외 ${missingPairs.length - 4}개` : ""}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={onDelete}>
          <Trash2 className="mr-1 size-4" />
          {mode === "create" ? "취소" : "삭제"}
        </Button>
        <Button onClick={onSave} disabled={missingPairs.length > 0}>
          <Save className="mr-1 size-4" />
          {mode === "create" ? "환승 그룹 저장" : "저장"}
        </Button>
      </div>
      <Dialog
        open={timeModalOpen}
        className="flex h-[min(860px,calc(100dvh-24px))] max-w-[min(1180px,calc(100vw-24px))] flex-col"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-3">
          <div>
            <strong className="block text-sm font-semibold text-slate-950">
              역간 환승 시간표 편집
            </strong>
            <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
              행과 열의 모든 역 조합을 확인하세요. 같은 조합은 양방향 동일 값으로 저장됩니다.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setTimeModalOpen(false)}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <table className="min-w-max border-separate border-spacing-1 text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 min-w-36 rounded-xl bg-white px-2 py-2 text-left font-semibold text-slate-500 shadow-sm">
                  행 / 열
                </th>
                {draft.stationIds.map((colId) => {
                  const station = stationById.get(colId);
                  return (
                    <th
                      key={colId}
                      className="sticky top-0 z-10 min-w-32 max-w-40 rounded-xl bg-white px-2 py-2 text-left font-semibold text-slate-600 shadow-sm"
                    >
                      <span className="block truncate">
                        {station?.nameKo ?? colId}
                      </span>
                      <span className="block truncate text-[10px] font-medium text-slate-400">
                        {station?.lineNameKo ?? "-"}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {draft.stationIds.map((rowId, rowIndex) => {
                const rowStation = stationById.get(rowId);
                return (
                  <tr key={rowId}>
                    <th className="sticky left-0 z-10 min-w-36 max-w-44 rounded-xl bg-white px-2 py-2 text-left font-semibold text-slate-600 shadow-sm">
                      <span className="block truncate">
                        {rowStation?.nameKo ?? rowId}
                      </span>
                      <span className="block truncate text-[10px] font-medium text-slate-400">
                        {rowStation?.lineNameKo ?? "-"}
                      </span>
                    </th>
                    {draft.stationIds.map((colId, colIndex) => {
                      if (colIndex === rowIndex) {
                        return (
                          <td
                            key={colId}
                            className="rounded-xl bg-slate-100 px-3 py-2 text-center font-semibold text-slate-300"
                          >
                            같은 역
                          </td>
                        );
                      }
                      const pairKey = makeTransferPairKey(rowId, colId);
                      const value = draft.transferMinutesByPair[pairKey];
                      return (
                        <td
                          key={colId}
                          className={cn(
                            "rounded-xl p-1",
                            value == null ? "bg-amber-50" : "bg-slate-50",
                          )}
                        >
                          <Input
                            type="number"
                            min={0}
                            className="h-8 min-w-24 px-2 text-[11px]"
                            value={value ?? ""}
                            placeholder="분"
                            onChange={(event) =>
                              updateMinute(pairKey, event.target.value)
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <p className="text-xs font-medium text-slate-500">
            {missingPairs.length > 0
              ? `아직 ${missingPairs.length.toLocaleString("ko-KR")}개 구간이 비어 있습니다.`
              : "모든 구간이 입력되었습니다."}
          </p>
          <Button onClick={() => setTimeModalOpen(false)}>닫기</Button>
        </div>
      </Dialog>
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
    <TransferGroupInspector
      group={previewGroup}
      draft={draft}
      stationById={stationById}
      mode="create"
      onChange={onChange}
      onSave={onSave}
      onDelete={onCancel}
    />
  );
}

function MultiStationInspector({
  ids,
  stationById,
  nonTransferIds,
  transferGroup,
  onSetNonTransfer,
  onOpenTransferGroup,
  onCreateTransferGroup,
}: {
  ids: string[];
  stationById: Map<string, EditorStation>;
  nonTransferIds: Set<string>;
  transferGroup: ManualTransferGroup | null;
  onSetNonTransfer: (enabled: boolean) => void;
  onOpenTransferGroup: (groupId: string) => void;
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
        {transferGroup ? (
          <Button
            className="col-span-2"
            onClick={() => onOpenTransferGroup(transferGroup.id)}
          >
            환승 그룹 편집
          </Button>
        ) : (
          <>
            {!allNonTransfer ? (
              <Button variant="outline" onClick={() => onSetNonTransfer(true)}>
                미환승역으로 설정
              </Button>
            ) : null}
            {!allTransfer ? (
              <Button variant="outline" onClick={() => onSetNonTransfer(false)}>
                환승 가능역으로 변경
              </Button>
            ) : null}
            {ids.length >= 2 && !allNonTransfer ? (
              <Button className="col-span-2" onClick={onCreateTransferGroup}>
                선택한 역으로 환승 그룹 생성
              </Button>
            ) : null}
          </>
        )}
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
