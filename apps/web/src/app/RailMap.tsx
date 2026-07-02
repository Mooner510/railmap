"use client";

import {
  buildSmoothConnectionCurve,
  buildTransferGroupCircleGeometry,
  isTransferDetailVisible,
  optimizeCoordinates,
  smoothCoordinateRange,
  smoothCoordinates,
  TRANSFER_DETAIL_ZOOM_THRESHOLD,
  type RailMapLngLatTuple,
} from "@repo/ui/map/renderPolicy";
import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

export interface RailMapStation {
  id: string;
  nameKo: string;
  lineNameKo?: string | null;
  lat: number | null;
  lng: number | null;
}

export interface RailMapTransferGroup {
  id: string;
  nameKo: string;
  stationIds: string[];
  enabled: boolean;
  note?: string | null;
}

export interface RailMapBranch {
  id: string;
  canonicalLineId: string;
  canonicalLineNameKo: string;
  colorHex: string;
  role: string;
  sourceLineNumber: string;
  sourceLineName: string;
  geometryOverrideCoordinates?: Array<[number, number]>;
  routeStops: Array<{
    id: string;
    sequence: number;
    displayNameKo: string;
    station: RailMapStation | null;
    confidence: string;
  }>;
}

type RailMapLineBranchDirection = "toward-start" | "toward-end";

export interface RailMapLineBranchGeometryPoint {
  lng: number;
  lat: number;
  kind: "station" | "control";
  stationId?: string;
}

export interface RailMapLineBranchOverride {
  id: string;
  mode: "add-station" | "connect-line";
  parentBranchId: string;
  anchorStationId: string;
  branchStationId?: string;
  connectedBranchId?: string;
  connectedEndpointStationId?: string;
  connectedDirection?: RailMapLineBranchDirection;
  geometry?: RailMapLineBranchGeometryPoint[];
  enabled: boolean;
}

type ValidRailMapStation = RailMapStation & {
  lat: number;
  lng: number;
};

function isValidCoordinate(
  station: RailMapStation | null | undefined,
): station is ValidRailMapStation {
  return (
    station !== null &&
    station !== undefined &&
    typeof station.lat === "number" &&
    typeof station.lng === "number" &&
    Number.isFinite(station.lat) &&
    Number.isFinite(station.lng)
  );
}

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

function getBranchCoordinates(branch: RailMapBranch): LngLatTuple[] {
  if (
    branch.geometryOverrideCoordinates &&
    branch.geometryOverrideCoordinates.length >= 2
  ) {
    const overrideCoordinates = branch.geometryOverrideCoordinates
      .map((coordinate): LngLatTuple | null => {
        const [lng, lat] = coordinate;
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        return [lng, lat];
      })
      .filter((coordinate): coordinate is LngLatTuple => coordinate !== null);

    if (overrideCoordinates.length >= 2)
      return smoothCoordinates(overrideCoordinates);
  }

  const coordinates = branch.routeStops
    .map((stop) => stop.station)
    .filter(isValidCoordinate)
    .map((station): LngLatTuple => [station.lng, station.lat]);

  if (coordinates.length < 2) return [];

  const smoothed = smoothCoordinates(coordinates);

  return smoothed.length >= 2 ? smoothed : coordinates;
}

function getStationDisplayName(station: RailMapStation | null | undefined) {
  if (!station) return "알 수 없는 역";
  return station.lineNameKo ? `${station.nameKo} · ${station.lineNameKo}` : station.nameKo;
}

function getBranchDisplayName(branch: RailMapBranch | null | undefined) {
  if (!branch) return "알 수 없는 노선";
  const sourceName = branch.sourceLineName && branch.sourceLineName !== branch.canonicalLineNameKo ? ` · ${branch.sourceLineName}` : "";
  return `${branch.canonicalLineNameKo}${sourceName}`;
}

function getBranchStopCoordinatePoints(branch: RailMapBranch) {
  return branch.routeStops
    .map((stop) => {
      const station = stop.station;
      if (!isValidCoordinate(station)) return null;

      return {
        stationId: station.id,
        coordinate: [station.lng, station.lat] as LngLatTuple,
      };
    })
    .filter(
      (point): point is { stationId: string; coordinate: LngLatTuple } =>
        point !== null,
    );
}

function getLineBranchExplicitGeometry(
  override: RailMapLineBranchOverride,
): LngLatTuple[] {
  const points = (override.geometry ?? [])
    .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat))
    .map((point) => [point.lng, point.lat] as LngLatTuple);

  const hasEditableShape =
    points.length >= 3 || (override.geometry ?? []).some((point) => point.kind === "control");

  return hasEditableShape ? smoothCoordinates(points) : [];
}

function buildAddStationLineBranchCoordinates(
  override: RailMapLineBranchOverride,
  parentBranch: RailMapBranch | null,
  stationById: Map<string, RailMapStation>,
) {
  if (!parentBranch || !override.branchStationId) return [];

  const parentPoints = getBranchStopCoordinatePoints(parentBranch);
  const anchorIndex = parentPoints.findIndex(
    (point) => point.stationId === override.anchorStationId,
  );
  const branchStation = stationById.get(override.branchStationId) ?? null;
  if (anchorIndex < 0 || !isValidCoordinate(branchStation)) return [];

  const context = [
    ...parentPoints.slice(0, anchorIndex + 1).map((point) => point.coordinate),
    [branchStation.lng, branchStation.lat] as LngLatTuple,
  ];

  return smoothCoordinateRange(context, anchorIndex, context.length - 1);
}

function getBranchStationCoordinatePoint(
  branch: RailMapBranch,
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
  branch: RailMapBranch,
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

function getConnectedBranchTangentCoordinate(
  branch: RailMapBranch,
  stationId: string,
  direction: RailMapLineBranchDirection,
) {
  const context = getBranchStationCoordinatePoint(branch, stationId);
  if (!context) return null;

  const nextIndex = direction === "toward-start" ? context.index - 1 : context.index + 1;
  return context.points[nextIndex]?.coordinate ?? null;
}

function buildConnectLineBranchCoordinates(
  override: RailMapLineBranchOverride,
  parentBranch: RailMapBranch | null,
  connectedBranch: RailMapBranch | null,
) {
  if (!parentBranch || !connectedBranch || !override.connectedEndpointStationId) return [];

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
  override: RailMapLineBranchOverride,
  parentBranch: RailMapBranch | null,
  connectedBranch: RailMapBranch | null,
  stationById: Map<string, RailMapStation>,
) {
  const explicitGeometry = getLineBranchExplicitGeometry(override);
  if (explicitGeometry.length >= 2) return explicitGeometry;

  if (override.mode === "add-station") {
    return buildAddStationLineBranchCoordinates(override, parentBranch, stationById);
  }

  return buildConnectLineBranchCoordinates(override, parentBranch, connectedBranch);
}

function buildLineBranchFeatures(
  overrides: RailMapLineBranchOverride[],
  branches: RailMapBranch[],
  stations: RailMapStation[],
) {
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));
  const stationById = new Map(stations.map((station) => [station.id, station]));

  return {
    type: "FeatureCollection" as const,
    features: overrides
      .map((override) => {
        if (override.enabled === false) return null;

        const parentBranch = branchById.get(override.parentBranchId) ?? null;
        const anchorStation = stationById.get(override.anchorStationId) ?? null;
        const targetStationId = override.mode === "add-station" ? override.branchStationId : override.connectedEndpointStationId;
        const targetStation = targetStationId ? stationById.get(targetStationId) ?? null : null;
        const connectedBranch = override.connectedBranchId ? branchById.get(override.connectedBranchId) ?? null : null;
        const coordinates = buildLineBranchCoordinates(
          override,
          parentBranch,
          connectedBranch,
          stationById,
        );
        if (coordinates.length < 2) return null;

        const title = override.mode === "add-station" ? "지선 역 추가" : "지선 노선 결합";
        const summary = override.mode === "add-station"
          ? `${getBranchDisplayName(parentBranch)} · ${getStationDisplayName(anchorStation)} → ${getStationDisplayName(targetStation)}`
          : `${getBranchDisplayName(parentBranch)} · ${getStationDisplayName(anchorStation)} ↔ ${getBranchDisplayName(connectedBranch)} · ${getStationDisplayName(targetStation)}`;

        return {
          type: "Feature" as const,
          properties: {
            id: override.id,
            colorHex: parentBranch?.colorHex ?? "#0f766e",
            title,
            summary,
          },
          geometry: {
            type: "LineString" as const,
            coordinates: optimizeCoordinates(coordinates),
          },
        };
      })
      .filter((feature): feature is NonNullable<typeof feature> => feature !== null),
  };
}

function buildBranchFeatures(branches: RailMapBranch[]) {
  return {
    type: "FeatureCollection" as const,
    features: branches
      .map((branch) => {
        const coordinates = getBranchCoordinates(branch);

        if (coordinates.length < 2) return null;

        return {
          type: "Feature" as const,
          properties: {
            id: branch.id,
            branchId: branch.id,
            canonicalLineId: branch.canonicalLineId,
            colorHex: branch.colorHex,
          },
          geometry: {
            type: "LineString" as const,
            coordinates: optimizeCoordinates(coordinates),
          },
        };
      })
      .filter(
        (feature): feature is NonNullable<typeof feature> => feature !== null,
      ),
  };
}

function getBranchRouteSegmentCoordinates(
  branch: RailMapBranch,
  fromStationId: string,
  toStationId: string,
) {
  const points = branch.routeStops
    .map((stop) => {
      const station = stop.station;
      if (!isValidCoordinate(station)) return null;

      return {
        stationId: station.id,
        coordinate: [station.lng, station.lat] as LngLatTuple,
      };
    })
    .filter(
      (point): point is { stationId: string; coordinate: LngLatTuple } =>
        point !== null,
    );

  const fromIndex = points.findIndex(
    (point) => point.stationId === fromStationId,
  );
  const toIndex = points.findIndex((point) => point.stationId === toStationId);

  if (fromIndex < 0 || toIndex < 0) return [];

  return smoothCoordinateRange(
    points.map((point) => point.coordinate),
    fromIndex,
    toIndex,
  );
}

function buildHighlightedRouteFeature(
  branches: RailMapBranch[],
  stationIds: string[],
  branchIds: string[],
) {
  if (stationIds.length < 2 || branchIds.length < 1) {
    return {
      type: "FeatureCollection" as const,
      features: [],
    };
  }

  const branchIndex = new Map(branches.map((branch) => [branch.id, branch]));
  const features: Array<{
    type: "Feature";
    properties: {
      id: string;
      branchId: string;
      colorHex: string;
    };
    geometry: {
      type: "LineString";
      coordinates: LngLatTuple[];
    };
  }> = [];
  let segmentStartIndex = 0;

  for (let edgeIndex = 1; edgeIndex <= branchIds.length; edgeIndex += 1) {
    const currentBranchId = branchIds[segmentStartIndex];
    const nextBranchId = branchIds[edgeIndex];
    const shouldCloseSegment =
      edgeIndex === branchIds.length || nextBranchId !== currentBranchId;

    if (!shouldCloseSegment || !currentBranchId) continue;

    const branch = branchIndex.get(currentBranchId);
    const fromStationId = stationIds[segmentStartIndex];
    const toStationId = stationIds[edgeIndex];

    if (branch && fromStationId && toStationId) {
      const coordinates = getBranchRouteSegmentCoordinates(
        branch,
        fromStationId,
        toStationId,
      );

      if (coordinates.length >= 2) {
        features.push({
          type: "Feature" as const,
          properties: {
            id: `route-result-${features.length + 1}`,
            branchId: branch.id,
            colorHex: branch.colorHex,
          },
          geometry: {
            type: "LineString" as const,
            coordinates: optimizeCoordinates(coordinates),
          },
        });
      }
    }

    segmentStartIndex = edgeIndex;
  }

  return {
    type: "FeatureCollection" as const,
    features,
  };
}

function buildStationFeatures(
  stations: ValidRailMapStation[],
  selectedStationId: string | null,
  highlightedRouteStationIdSet: Set<string>,
  stationColorIndex: Map<string, string>,
  stationTransferGroupIndex: Map<string, RailMapTransferGroup>,
  transferDetailVisible: boolean,
) {
  return {
    type: "FeatureCollection" as const,
    features: stations.flatMap((station) => {
      const transferGroup = stationTransferGroupIndex.get(station.id) ?? null;
      if (transferGroup && !transferDetailVisible) return [];
      const lineNameKo = station.lineNameKo ?? "";
      const isSelected = selectedStationId === station.id;
      const isRouteStation = highlightedRouteStationIdSet.has(station.id);
      return [{
        type: "Feature" as const,
        properties: {
          id: station.id,
          nameKo: station.nameKo ?? "역",
          labelNameKo: transferGroup
            ? `${transferGroup.nameKo}(${lineNameKo || "노선"})`
            : (station.nameKo ?? "역"),
          lineNameKo,
          colorHex: stationColorIndex.get(station.id) ?? "#64748b",
          isSelected,
          isRouteStation,
          isEmphasized: isSelected || isRouteStation,
          isTransferChild: Boolean(transferGroup),
          transferGroupId: transferGroup?.id ?? "",
          transferGroupNameKo: transferGroup?.nameKo ?? "",
        },
        geometry: {
          type: "Point" as const,
          coordinates: [station.lng, station.lat] as LngLatTuple,
        },
      }];
    }),
  };
}

function buildStationTransferGroupIndex(
  transferGroups: RailMapTransferGroup[],
) {
  const index = new Map<string, RailMapTransferGroup>();

  for (const group of transferGroups) {
    if (group.enabled === false) continue;
    for (const stationId of group.stationIds) {
      if (!index.has(stationId)) index.set(stationId, group);
    }
  }

  return index;
}




function buildTransferGroupFeatures(
  transferGroups: RailMapTransferGroup[],
  stationIndex: Map<string, ValidRailMapStation>,
  selectedTransferGroupIds: ReadonlySet<string>,
) {
  const areaFeatures: RailFeatureCollection["features"] = [];
  const iconFeatures: RailFeatureCollection["features"] = [];

  for (const group of transferGroups) {
    if (group.enabled === false) continue;
    const members = group.stationIds
      .map((stationId) => stationIndex.get(stationId))
      .filter((station): station is ValidRailMapStation => Boolean(station));
    if (members.length < 2) continue;

    const circle = buildTransferGroupCircleGeometry(members);
    const properties = {
      id: group.id,
      nameKo: group.nameKo,
      stationCount: members.length,
      isSelected: selectedTransferGroupIds.has(group.id),
      radius: circle.radius,
    };

    areaFeatures.push({
      type: "Feature",
      properties,
      geometry: {
        type: "Polygon",
        coordinates: [circle.coordinates],
      },
    });

    iconFeatures.push({
      type: "Feature",
      properties,
      geometry: {
        type: "Point",
        coordinates: circle.center,
      },
    });
  }

  return {
    areas: {
      type: "FeatureCollection" as const,
      features: areaFeatures,
    },
    icons: {
      type: "FeatureCollection" as const,
      features: iconFeatures,
    },
  };
}

function getMapErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "지도를 불러오지 못했습니다.";
}

function getFitPadding() {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  if (isMobile) {
    return {
      top: 56,
      right: 24,
      bottom: 260,
      left: 24,
    };
  }

  return {
    top: 48,
    right: 320,
    bottom: 48,
    left: 320,
  };
}

interface RailMapProps {
  stations: RailMapStation[];
  branches: RailMapBranch[];
  selectedBranchId?: string | null;
  selectedStationId?: string | null;
  highlightedRouteStationIds?: string[];
  highlightedRouteBranchIds?: string[];
  transferGroups?: RailMapTransferGroup[];
  lineBranchOverrides?: RailMapLineBranchOverride[];
  selectedTransferGroupId?: string | null;
  focusVersion?: number;
  showBranches?: boolean;
  showStations?: boolean;
  onSelectBranch?: (branch: RailMapBranch) => void;
  onSelectStation?: (station: RailMapStation) => void;
  onSelectTransferGroup?: (group: RailMapTransferGroup) => void;
  onClearStation?: () => void;
  className?: string;
}


const MAP_RENDER_POLICY = {
  branchLineWidth: 3,
  branchLineCasingWidth: 5.2,
  selectedBranchLineWidth: 7,
  lineBranchLineWidth: 3,
  lineBranchCasingWidth: 4.8,
  transferGroupHitRadius: 22,
  transferGroupIconSize: 0.0391,
  transferGroupSelectedIconSize: 0.0437,
  stationRadius: 4.5,
  selectedStationRadius: 7,
  stationCasingRadius: 6,
  selectedStationCasingRadius: 10,
  stationStrokeWidth: 1.5,
  selectedStationStrokeWidth: 3,
} as const;

const KOREA_MAX_BOUNDS: [[number, number], [number, number]] = [
  [121.4, 30.9],
  [134.3, 43.1],
];

type LngLatTuple = RailMapLngLatTuple;

export default function RailMap({
  stations,
  branches,
  selectedBranchId = null,
  selectedStationId = null,
  highlightedRouteStationIds = [],
  highlightedRouteBranchIds = [],
  transferGroups = [],
  lineBranchOverrides = [],
  selectedTransferGroupId = null,
  focusVersion = 0,
  showBranches = true,
  showStations = true,
  onSelectBranch,
  onSelectStation,
  onSelectTransferGroup,
  onClearStation,
  className = "",
}: RailMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [transferDetailVisible, setTransferDetailVisible] = useState(false);
  const transferDetailVisibleRef = useRef(false);
  const branchByIdRef = useRef(
    new Map(branches.map((branch) => [branch.id, branch])),
  );
  const stationByIdRef = useRef(
    new Map(stations.map((station) => [station.id, station])),
  );
  const onSelectBranchRef = useRef(onSelectBranch);
  const onSelectStationRef = useRef(onSelectStation);
  const onSelectTransferGroupRef = useRef(onSelectTransferGroup);
  const onClearStationRef = useRef(onClearStation);

  useEffect(() => {
    branchByIdRef.current = new Map(
      branches.map((branch) => [branch.id, branch]),
    );
  }, [branches]);

  useEffect(() => {
    stationByIdRef.current = new Map(
      stations.map((station) => [station.id, station]),
    );
  }, [stations]);

  useEffect(() => {
    onSelectBranchRef.current = onSelectBranch;
  }, [onSelectBranch]);

  useEffect(() => {
    onSelectStationRef.current = onSelectStation;
  }, [onSelectStation]);

  useEffect(() => {
    onSelectTransferGroupRef.current = onSelectTransferGroup;
  }, [onSelectTransferGroup]);

  useEffect(() => {
    onClearStationRef.current = onClearStation;
  }, [onClearStation]);

  const validStations = useMemo(
    () => stations.filter(isValidCoordinate),
    [stations],
  );
  const validStationIndex = useMemo(
    () => new Map(validStations.map((station) => [station.id, station])),
    [validStations],
  );
  const stationTransferGroupIndex = useMemo(
    () => buildStationTransferGroupIndex(transferGroups),
    [transferGroups],
  );
  const selectedTransferGroupIds = useMemo(() => {
    const ids = new Set<string>();
    if (selectedTransferGroupId) ids.add(selectedTransferGroupId);

    if (selectedStationId) {
      const group = stationTransferGroupIndex.get(selectedStationId);
      if (group) ids.add(group.id);
    }

    return ids;
  }, [selectedStationId, selectedTransferGroupId, stationTransferGroupIndex]);
  const transferGroupIndex = useMemo(
    () => new Map(transferGroups.map((group) => [group.id, group])),
    [transferGroups],
  );
  const transferGroupFeatures = useMemo(
    () =>
      buildTransferGroupFeatures(
        transferGroups,
        validStationIndex,
        selectedTransferGroupIds,
      ),
    [selectedTransferGroupIds, transferGroups, validStationIndex],
  );
  const transferGroupAreaFeatures = transferGroupFeatures.areas;
  const transferGroupIconFeatures = transferGroupFeatures.icons;
  const branchFeatures = useMemo(
    () => buildBranchFeatures(showBranches ? branches : []),
    [branches, showBranches],
  );
  const lineBranchFeatures = useMemo(
    () => buildLineBranchFeatures(showBranches ? lineBranchOverrides : [], branches, stations),
    [branches, lineBranchOverrides, showBranches, stations],
  );
  const highlightedRouteFeatures = useMemo(
    () =>
      buildHighlightedRouteFeature(
        branches,
        highlightedRouteStationIds,
        highlightedRouteBranchIds,
      ),
    [branches, highlightedRouteStationIds, highlightedRouteBranchIds],
  );
  const branchFeaturesRef = useRef(branchFeatures);
  const lineBranchFeaturesRef = useRef(lineBranchFeatures);
  const highlightedRouteFeaturesRef = useRef(highlightedRouteFeatures);
  const transferGroupAreaFeaturesRef = useRef(transferGroupAreaFeatures);
  const transferGroupIconFeaturesRef = useRef(transferGroupIconFeatures);
  const stationTransferGroupIndexRef = useRef(stationTransferGroupIndex);
  const transferGroupIndexRef = useRef(transferGroupIndex);
  const highlightedRouteStationIdSet = useMemo(
    () => new Set(highlightedRouteStationIds),
    [highlightedRouteStationIds],
  );

  useEffect(() => {
    branchFeaturesRef.current = branchFeatures;
  }, [branchFeatures]);

  useEffect(() => {
    lineBranchFeaturesRef.current = lineBranchFeatures;
  }, [lineBranchFeatures]);

  useEffect(() => {
    highlightedRouteFeaturesRef.current = highlightedRouteFeatures;
  }, [highlightedRouteFeatures]);

  useEffect(() => {
    transferGroupAreaFeaturesRef.current = transferGroupAreaFeatures;
  }, [transferGroupAreaFeatures]);

  useEffect(() => {
    transferGroupIconFeaturesRef.current = transferGroupIconFeatures;
  }, [transferGroupIconFeatures]);

  useEffect(() => {
    stationTransferGroupIndexRef.current = stationTransferGroupIndex;
  }, [stationTransferGroupIndex]);

  useEffect(() => {
    transferGroupIndexRef.current = transferGroupIndex;
  }, [transferGroupIndex]);
  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId) ?? null,
    [branches, selectedBranchId],
  );

  const selectedBranchStationIds = useMemo(() => {
    if (!selectedBranch) return new Set<string>();

    return new Set(
      selectedBranch.routeStops
        .map((stop) => stop.station?.id)
        .filter((id): id is string => typeof id === "string"),
    );
  }, [selectedBranch]);

  const stationColorIndex = useMemo(() => {
    const index = new Map<string, string>();

    if (selectedBranch) {
      for (const stop of selectedBranch.routeStops) {
        const stationId = stop.station?.id;
        if (stationId) index.set(stationId, selectedBranch.colorHex);
      }
    }

    for (const branch of branches) {
      for (const stop of branch.routeStops) {
        const stationId = stop.station?.id;
        if (stationId && !index.has(stationId))
          index.set(stationId, branch.colorHex);
      }
    }

    return index;
  }, [branches, selectedBranch]);

  const visibleBranchStations = useMemo(() => {
    const stationsInBranches = branches.flatMap((branch) =>
      branch.routeStops.map((stop) => stop.station).filter(isValidCoordinate),
    );

    const unique = new Map<
      string,
      RailMapStation & { lat: number; lng: number }
    >();

    for (const station of stationsInBranches) {
      unique.set(station.id, station);
    }

    return [...unique.values()];
  }, [branches]);

  const markerStations = useMemo(() => {
    if (!showStations) return [];
    if (selectedBranchStationIds.size > 0)
      return validStations.filter((station) =>
        selectedBranchStationIds.has(station.id),
      );
    if (visibleBranchStations.length > 0) return visibleBranchStations;
    return validStations;
  }, [
    showStations,
    selectedBranchStationIds,
    validStations,
    visibleBranchStations,
  ]);

  const stationFeatures = useMemo(
    () =>
      buildStationFeatures(
        markerStations,
        selectedStationId,
        highlightedRouteStationIdSet,
        stationColorIndex,
        stationTransferGroupIndex,
        transferDetailVisible,
      ),
    [
      highlightedRouteStationIdSet,
      markerStations,
      selectedStationId,
      stationColorIndex,
      stationTransferGroupIndex,
      transferDetailVisible,
    ],
  );
  const stationFeaturesRef = useRef(stationFeatures);

  useEffect(() => {
    stationFeaturesRef.current = stationFeatures;
  }, [stationFeatures]);

  useEffect(() => {
    if (mapRef.current) return;

    let frame = 0;
    let resizeTimer: number | null = null;
    let disposed = false;

    const initialize = () => {
      if (disposed || mapRef.current) return;

      const container = containerRef.current;
      const rect = container?.getBoundingClientRect();

      if (!container || !rect || rect.width < 32 || rect.height < 32) {
        frame = window.requestAnimationFrame(initialize);
        return;
      }

      try {
        const map = new maplibregl.Map({
          container,
          center: [127.8, 36.4],
          zoom: 6.3,
          minZoom: 5.7,
          maxZoom: 17,
          maxBounds: KOREA_MAX_BOUNDS,
          renderWorldCopies: false,
          attributionControl: false,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "© OpenStreetMap contributors",
              },
            },
            layers: [
              {
                id: "background",
                type: "background",
                paint: {
                  "background-color": "#eef3f8",
                },
              },
              {
                id: "osm",
                type: "raster",
                source: "osm",
                paint: {
                  "raster-opacity": 0.82,
                },
              },
            ],
          },
        });

        mapRef.current = map;

        map.dragRotate.disable();
        map.touchZoomRotate.disableRotation();
        map.addControl(
          new maplibregl.NavigationControl({ visualizePitch: false }),
          "top-right",
        );
        map.addControl(
          new maplibregl.AttributionControl({ compact: true }),
          "bottom-right",
        );

        map.on("error", (event) => {
          const error = (event as { error?: unknown }).error;
          if (error) setMapError(getMapErrorMessage(error));
        });

        map.on("load", () => {
          setMapReady(true);
          setMapError(null);
          const syncTransferVisibilityMode = () => {
            const nextVisible = isTransferDetailVisible(map.getZoom());
            if (transferDetailVisibleRef.current === nextVisible) return;
            transferDetailVisibleRef.current = nextVisible;
            setTransferDetailVisible(nextVisible);
          };
          syncTransferVisibilityMode();
          map.on("zoom", syncTransferVisibilityMode);
          map.on("zoomend", syncTransferVisibilityMode);

          const transferIconImage = new Image();
          transferIconImage.onload = () => {
            if (!map.hasImage("transfer-icon")) {
              map.addImage("transfer-icon", transferIconImage, { pixelRatio: 2 });
              map.triggerRepaint();
            }
          };
          transferIconImage.src = "/transfer.svg";

          map.addSource("branch-preview-lines", {
            type: "geojson",
            data: branchFeaturesRef.current,
          });

          map.addSource("line-branch-lines", {
            type: "geojson",
            data: lineBranchFeaturesRef.current,
          });

          map.addSource("route-result-lines", {
            type: "geojson",
            data: highlightedRouteFeaturesRef.current,
          });

          map.addLayer({
            id: "branch-preview-lines-casing",
            type: "line",
            source: "branch-preview-lines",
            paint: {
              "line-color": "#ffffff",
              "line-width": MAP_RENDER_POLICY.branchLineCasingWidth,
              "line-opacity": 0.88,
            },
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
          });

          map.addLayer({
            id: "branch-preview-lines",
            type: "line",
            source: "branch-preview-lines",
            paint: {
              "line-color": ["coalesce", ["get", "colorHex"], "#0284c7"],
              "line-width": MAP_RENDER_POLICY.branchLineWidth,
              "line-opacity": 0.76,
            },
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
          });

          map.addLayer({
            id: "branch-preview-lines-selected",
            type: "line",
            source: "branch-preview-lines",
            filter: ["==", ["get", "id"], ""],
            paint: {
              "line-color": ["coalesce", ["get", "colorHex"], "#0369a1"],
              "line-width": MAP_RENDER_POLICY.selectedBranchLineWidth,
              "line-opacity": 0.96,
            },
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
          });

          map.addLayer({
            id: "line-branch-lines-casing",
            type: "line",
            source: "line-branch-lines",
            paint: {
              "line-color": "#ffffff",
              "line-width": MAP_RENDER_POLICY.lineBranchCasingWidth,
              "line-opacity": 0.88,
            },
            layout: { "line-cap": "round", "line-join": "round" },
          });

          map.addLayer({
            id: "line-branch-lines",
            type: "line",
            source: "line-branch-lines",
            paint: {
              "line-color": ["get", "colorHex"],
              "line-width": MAP_RENDER_POLICY.lineBranchLineWidth,
              "line-opacity": 0.78,
            },
            layout: { "line-cap": "round", "line-join": "round" },
          });

          map.addLayer({
            id: "route-result-lines-casing",
            type: "line",
            source: "route-result-lines",
            paint: {
              "line-color": "#ffffff",
              "line-width": 7.2,
              "line-opacity": 0.95,
            },
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
          });

          map.addLayer({
            id: "route-result-lines",
            type: "line",
            source: "route-result-lines",
            paint: {
              "line-color": "#10b981",
              "line-width": 4.2,
              "line-opacity": 0.96,
            },
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
          });

          map.addSource("transfer-group-areas", {
            type: "geojson",
            data: isTransferDetailVisible(map.getZoom())
              ? transferGroupAreaFeaturesRef.current
              : EMPTY_FEATURE_COLLECTION,
          });

          map.addSource("transfer-group-icons", {
            type: "geojson",
            data: isTransferDetailVisible(map.getZoom())
              ? EMPTY_FEATURE_COLLECTION
              : transferGroupIconFeaturesRef.current,
          });

          map.addLayer({
            id: "transfer-group-areas-fill",
            type: "fill",
            source: "transfer-group-areas",
            paint: {
              "fill-color": [
                "case",
                ["==", ["get", "isSelected"], true],
                "#2563eb",
                "#0f172a",
              ],
              "fill-opacity": [
                "case",
                ["==", ["get", "isSelected"], true],
                0.34,
                0.22,
              ],
            },
          });

          map.addLayer({
            id: "transfer-group-areas-outline",
            type: "line",
            source: "transfer-group-areas",
            paint: {
              "line-color": [
                "case",
                ["==", ["get", "isSelected"], true],
                "#2563eb",
                "#64748b",
              ],
              "line-width": ["case", ["==", ["get", "isSelected"], true], 3.4, 2.2],
              "line-opacity": 0.9,
            },
          });

          map.addLayer({
            id: "transfer-group-collapsed-hit",
            type: "circle",
            source: "transfer-group-icons",
            paint: {
              "circle-radius": MAP_RENDER_POLICY.transferGroupHitRadius,
              "circle-color": "rgba(0,0,0,0)",
              "circle-opacity": 0,
              "circle-stroke-opacity": 0,
            },
          });

          map.addLayer({
            id: "transfer-group-collapsed-icon",
            type: "symbol",
            source: "transfer-group-icons",
            layout: {
              "icon-image": "transfer-icon",
              "icon-size": [
                "case",
                ["==", ["get", "isSelected"], true],
                MAP_RENDER_POLICY.transferGroupSelectedIconSize,
                MAP_RENDER_POLICY.transferGroupIconSize,
              ],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            },
            paint: {
              "icon-opacity": 1,
            },
          });

          map.addLayer({
            id: "transfer-group-collapsed-label",
            type: "symbol",
            source: "transfer-group-icons",
            minzoom: 12,
            layout: {
              "text-field": ["get", "nameKo"],
              "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
              "text-size": 11,
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

          map.addSource("branch-preview-stations", {
            type: "geojson",
            data: stationFeaturesRef.current,
          });

          map.addLayer({
            id: "branch-preview-stations-casing",
            type: "circle",
            source: "branch-preview-stations",
            paint: {
              "circle-color": "#ffffff",
              "circle-radius": [
                "case",
                ["==", ["get", "isEmphasized"], true],
                MAP_RENDER_POLICY.selectedStationCasingRadius,
                MAP_RENDER_POLICY.stationCasingRadius,
              ],
              "circle-opacity": 0.96,
            },
          });

          map.addLayer({
            id: "branch-preview-stations-dot",
            type: "circle",
            source: "branch-preview-stations",
            paint: {
              "circle-color": ["coalesce", ["get", "colorHex"], "#64748b"],
              "circle-radius": [
                "case",
                ["==", ["get", "isEmphasized"], true],
                MAP_RENDER_POLICY.selectedStationRadius,
                MAP_RENDER_POLICY.stationRadius,
              ],
              "circle-stroke-color": [
                "case",
                ["==", ["get", "isSelected"], true],
                "#111827",
                "#ffffff",
              ],
              "circle-stroke-width": [
                "case",
                ["==", ["get", "isSelected"], true],
                MAP_RENDER_POLICY.selectedStationStrokeWidth,
                MAP_RENDER_POLICY.stationStrokeWidth,
              ],
              "circle-stroke-opacity": 1,
              "circle-opacity": 0.96,
            },
          });

          map.addLayer({
            id: "branch-preview-station-labels",
            type: "symbol",
            source: "branch-preview-stations",
            minzoom: 12,
            layout: {
              "text-field": ["get", "labelNameKo"],
              "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
              "text-size": 11,
              "text-offset": [0, -1.15],
              "text-anchor": "bottom",
              "text-allow-overlap": false,
              "text-ignore-placement": false,
            },
            paint: {
              "text-color": "#0f172a",
              "text-halo-color": "#ffffff",
              "text-halo-width": 1.4,
              "text-opacity": 0.92,
            },
          });

          map.addLayer({
            id: "branch-preview-station-labels-emphasized",
            type: "symbol",
            source: "branch-preview-stations",
            minzoom: 12,
            filter: ["==", ["get", "isEmphasized"], true],
            layout: {
              "text-field": ["get", "nameKo"],
              "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
              "text-size": 12,
              "text-offset": [0, -1.35],
              "text-anchor": "bottom",
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            },
            paint: {
              "text-color": "#0f172a",
              "text-halo-color": "#ffffff",
              "text-halo-width": 1.6,
              "text-opacity": 1,
            },
          });

          for (const layerId of [
            "transfer-group-collapsed-hit",
            "transfer-group-collapsed-icon",
            "transfer-group-collapsed-label",
          ]) {
            if (map.getLayer(layerId)) map.moveLayer(layerId);
          }

          map.on("mouseenter", "branch-preview-lines", () => {
            map.getCanvas().style.cursor = "pointer";
          });

          map.on("mouseleave", "branch-preview-lines", () => {
            map.getCanvas().style.cursor = "";
          });

          map.on("click", "branch-preview-lines", (event) => {
            const feature = event.features?.[0];
            if (!feature) return;

            const properties = feature.properties as Record<string, unknown>;
            const branchId = String(properties.id ?? "");
            const branch = branchByIdRef.current.get(branchId);

            if (branch) onSelectBranchRef.current?.(branch);
          });

          map.on("mouseenter", "transfer-group-collapsed-hit", () => {
            map.getCanvas().style.cursor = "pointer";
          });

          map.on("mouseleave", "transfer-group-collapsed-hit", () => {
            map.getCanvas().style.cursor = "";
          });

          map.on("mouseenter", "transfer-group-areas-fill", () => {
            map.getCanvas().style.cursor = "pointer";
          });

          map.on("mouseleave", "transfer-group-areas-fill", () => {
            map.getCanvas().style.cursor = "";
          });

          const selectTransferGroupFromFeature = (
            feature:
              { properties?: Record<string, unknown> | null } | undefined,
          ) => {
            const properties = feature?.properties as
              Record<string, unknown> | undefined;
            const groupId = String(properties?.id ?? "");
            const group = transferGroupIndexRef.current.get(groupId);
            if (group) onSelectTransferGroupRef.current?.(group);
          };

          map.on("click", "transfer-group-collapsed-hit", (event) => {
            selectTransferGroupFromFeature(event.features?.[0]);
          });

          map.on("click", "transfer-group-areas-fill", (event) => {
            selectTransferGroupFromFeature(event.features?.[0]);
          });

          map.on("mouseenter", "branch-preview-stations-dot", () => {
            map.getCanvas().style.cursor = "pointer";
          });

          map.on("mouseleave", "branch-preview-stations-dot", () => {
            map.getCanvas().style.cursor = "";
          });

          map.on("click", "branch-preview-stations-dot", (event) => {
            const feature = event.features?.[0];
            const properties = feature?.properties as
              Record<string, unknown> | undefined;
            if (
              map.getZoom() < TRANSFER_DETAIL_ZOOM_THRESHOLD &&
              properties?.isTransferChild === true
            ) {
              return;
            }
            const stationId = String(properties?.id ?? "");
            const station = stationByIdRef.current.get(stationId);
            if (station) onSelectStationRef.current?.(station);
          });

          map.on("click", (event) => {
            const transferDetailVisible =
              isTransferDetailVisible(map.getZoom());
            const interactiveLayers = [
              "branch-preview-lines",
              "branch-preview-lines-selected",
              ...(transferDetailVisible
                ? ["transfer-group-areas-fill", "branch-preview-stations-dot"]
                : ["transfer-group-collapsed-hit"]),
            ].filter((layerId) => map.getLayer(layerId));
            const interactiveFeatures = interactiveLayers.length
              ? map.queryRenderedFeatures(event.point, {
                  layers: interactiveLayers,
                })
              : [];

            if (interactiveFeatures.length === 0) onClearStationRef.current?.();
          });

          map.resize();
          resizeTimer = window.setTimeout(() => map.resize(), 80);
        });
      } catch (error) {
        setMapError(getMapErrorMessage(error));
      }
    };

    frame = window.requestAnimationFrame(initialize);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      if (resizeTimer) window.clearTimeout(resizeTimer);
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return;

    const resize = () => map.resize();
    const observer = new ResizeObserver(resize);

    observer.observe(container);
    window.addEventListener("resize", resize);
    resize();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || visibleBranchStations.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();

    for (const station of visibleBranchStations) {
      bounds.extend([station.lng, station.lat]);
    }

    const fit = () => {
      map.fitBounds(bounds, {
        padding: getFitPadding(),
        maxZoom: visibleBranchStations.length <= 6 ? 13 : 10.5,
        duration: 250,
      });
      map.resize();
    };

    if (map.isStyleLoaded()) {
      fit();
    } else {
      map.once("load", fit);
    }
  }, [visibleBranchStations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const updateSource = () => {
      const source = map.getSource("branch-preview-lines") as
        GeoJSONSource | undefined;
      if (!source) return;
      source.setData(branchFeatures);
    };

    updateSource();
  }, [branchFeatures, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource("line-branch-lines") as
      GeoJSONSource | undefined;
    if (!source) return;

    source.setData(lineBranchFeatures);
  }, [lineBranchFeatures, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource("route-result-lines") as
      GeoJSONSource | undefined;
    if (!source) return;

    source.setData(highlightedRouteFeatures);
  }, [highlightedRouteFeatures, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const areaSource = map.getSource("transfer-group-areas") as
      GeoJSONSource | undefined;
    const iconSource = map.getSource("transfer-group-icons") as
      GeoJSONSource | undefined;

    areaSource?.setData(
      transferDetailVisible ? transferGroupAreaFeatures : EMPTY_FEATURE_COLLECTION,
    );
    iconSource?.setData(
      transferDetailVisible ? EMPTY_FEATURE_COLLECTION : transferGroupIconFeatures,
    );
  }, [
    transferDetailVisible,
    transferGroupAreaFeatures,
    transferGroupIconFeatures,
    mapReady,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource("branch-preview-stations") as
      GeoJSONSource | undefined;
    if (!source) return;

    source.setData(stationFeatures);
  }, [stationFeatures, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    if (map.getLayer("branch-preview-lines-selected")) {
      map.setFilter("branch-preview-lines-selected", [
        "==",
        ["get", "id"],
        selectedBranchId ?? "",
      ]);
    }

    if (map.getLayer("branch-preview-lines")) {
      map.setPaintProperty(
        "branch-preview-lines",
        "line-opacity",
        selectedBranchId
          ? ["case", ["==", ["get", "id"], selectedBranchId], 0.42, 0.2]
          : highlightedRouteBranchIds.length > 0
            ? [
                "case",
                ["in", ["get", "id"], ["literal", highlightedRouteBranchIds]],
                0.38,
                0.16,
              ]
            : 0.76,
      );
    }

    if (map.getLayer("branch-preview-lines-casing")) {
      map.setPaintProperty(
        "branch-preview-lines-casing",
        "line-opacity",
        selectedBranchId
          ? 0.48
          : highlightedRouteBranchIds.length > 0
            ? 0.32
            : 0.88,
      );
    }
  }, [selectedBranchId, highlightedRouteBranchIds, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || focusVersion === 0) return;

    const selectedStation = validStations.find(
      (station) => station.id === selectedStationId,
    );

    if (selectedStation) {
      map.flyTo({
        center: isValidCoordinate(selectedStation)
          ? [selectedStation.lng, selectedStation.lat]
          : undefined,
        zoom: Math.max(map.getZoom(), 12.5),
        duration: 250,
      });
      map.resize();
      return;
    }

    if (visibleBranchStations.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();

    for (const station of visibleBranchStations) {
      bounds.extend([station.lng, station.lat]);
    }

    map.fitBounds(bounds, {
      padding: getFitPadding(),
      maxZoom: visibleBranchStations.length <= 6 ? 13 : 10.5,
      duration: 250,
    });
    map.resize();
  }, [
    focusVersion,
    mapReady,
    selectedStationId,
    validStations,
    visibleBranchStations,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || highlightedRouteStationIds.length < 2) return;

    const stationIndex = new Map(
      validStations.map((station) => [station.id, station]),
    );
    const routeStations = highlightedRouteStationIds
      .map((stationId) => stationIndex.get(stationId))
      .filter(isValidCoordinate);

    if (routeStations.length < 2) return;

    const bounds = new maplibregl.LngLatBounds();
    for (const station of routeStations) {
      bounds.extend([station.lng, station.lat]);
    }

    map.fitBounds(bounds, {
      padding: getFitPadding(),
      maxZoom: routeStations.length <= 3 ? 13 : 11.5,
      duration: 280,
    });
    map.resize();
  }, [focusVersion, highlightedRouteStationIds, mapReady, validStations]);

  return (
    <div
      className={`relative h-full min-h-[100dvh] w-full min-w-0 overflow-hidden bg-slate-100 ${className}`}
    >
      <div
        ref={containerRef}
        className="absolute inset-0 h-full min-h-[100dvh] w-full"
      />

      {!mapReady && !mapError ? (
        <div className="absolute inset-0 grid place-items-center bg-slate-100 text-xs font-semibold text-slate-500">
          지도를 불러오는 중입니다.
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-2 left-2 z-10 hidden max-w-[260px] border border-slate-200 bg-white/90 px-2 py-1 text-[11px] font-medium leading-4 text-slate-500 shadow-sm backdrop-blur lg:block">
        현재 구간선은 정차역 좌표를 통과하는 부드러운 참고 선형입니다. 이후
        에디터에서 중간 정점을 직접 보정할 수 있게 확장할 예정입니다.
      </div>

      {!showBranches && !showStations ? (
        <div className="pointer-events-none absolute left-2 top-2 z-10 border border-slate-200 bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-600 shadow-sm backdrop-blur">
          지도 표시 항목이 꺼져 있습니다.
        </div>
      ) : null}

      {mapError ? (
        <div className="absolute left-3 top-3 z-10 max-w-[320px] border border-red-200 bg-white px-3 py-2 text-xs leading-5 text-red-700 shadow-sm">
          <p className="font-bold">지도 표시 오류</p>
          <p className="mt-1 break-words">{mapError}</p>
        </div>
      ) : null}
    </div>
  );
}
