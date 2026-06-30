"use client";

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

function orientParentBranchCoordinatesToStation(
  branch: RailMapBranch,
  stationId: string,
) {
  const points = getBranchStopCoordinatePoints(branch);
  if (points.length === 0) return [];

  const index = points.findIndex((point) => point.stationId === stationId);
  if (index < 0) return [];

  const coordinates = points.map((point) => point.coordinate);
  const fromStart = coordinates.slice(0, index + 1);
  const fromEnd = coordinates.slice(index).reverse();

  return fromStart.length >= fromEnd.length ? fromStart : fromEnd;
}

function orientConnectedBranchCoordinatesFromStation(
  branch: RailMapBranch,
  stationId: string,
) {
  const points = getBranchStopCoordinatePoints(branch);
  if (points.length === 0) return [];

  const index = points.findIndex((point) => point.stationId === stationId);
  if (index < 0) return [];

  const coordinates = points.map((point) => point.coordinate);
  const towardEnd = coordinates.slice(index);
  const towardStart = coordinates.slice(0, index + 1).reverse();

  return towardEnd.length >= 2 ? towardEnd : towardStart;
}

function buildConnectLineBranchCoordinates(
  override: RailMapLineBranchOverride,
  parentBranch: RailMapBranch | null,
  connectedBranch: RailMapBranch | null,
) {
  if (!parentBranch || !connectedBranch || !override.connectedEndpointStationId) return [];

  const parentCoordinates = orientParentBranchCoordinatesToStation(
    parentBranch,
    override.anchorStationId,
  );
  const connectedCoordinates = orientConnectedBranchCoordinatesFromStation(
    connectedBranch,
    override.connectedEndpointStationId,
  );

  if (parentCoordinates.length < 1 || connectedCoordinates.length < 1) return [];

  return smoothCoordinates([...parentCoordinates, ...connectedCoordinates]);
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
            coordinates,
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
            coordinates,
          },
        };
      })
      .filter(
        (feature): feature is NonNullable<typeof feature> => feature !== null,
      ),
  };
}

function smoothCoordinateRange(
  coordinates: LngLatTuple[],
  startIndex: number,
  endIndex: number,
) {
  if (coordinates.length < 2 || startIndex === endIndex) return [];

  const start = Math.max(0, Math.min(startIndex, endIndex));
  const end = Math.min(coordinates.length - 1, Math.max(startIndex, endIndex));

  if (coordinates.length < 3) return coordinates.slice(start, end + 1);

  const samplesPerSegment = 5;
  const result: LngLatTuple[] = [];

  for (let i = start; i < end; i += 1) {
    const p0 = coordinates[Math.max(0, i - 1)] ?? coordinates[i];
    const p1 = coordinates[i];
    const p2 = coordinates[i + 1];
    const p3 = coordinates[Math.min(coordinates.length - 1, i + 2)] ?? p2;

    if (!p0 || !p1 || !p2 || !p3) continue;

    if (i === start) result.push(p1);

    for (let step = 1; step <= samplesPerSegment; step += 1) {
      result.push(catmullRomPoint(p0, p1, p2, p3, step / samplesPerSegment));
    }
  }

  return startIndex <= endIndex ? result : [...result].reverse();
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
            coordinates,
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
) {
  return {
    type: "FeatureCollection" as const,
    features: stations.map((station) => {
      const transferGroup = stationTransferGroupIndex.get(station.id) ?? null;
      const lineNameKo = station.lineNameKo ?? "";
      const isSelected = selectedStationId === station.id;
      const isRouteStation = highlightedRouteStationIdSet.has(station.id);
      return {
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
      };
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

function buildTransferGroupCircleCoordinates(members: ValidRailMapStation[]) {
  const centerLng = members.reduce((sum, station) => sum + station.lng, 0) / members.length;
  const centerLat = members.reduce((sum, station) => sum + station.lat, 0) / members.length;
  const lngScale = Math.max(0.35, Math.cos((centerLat * Math.PI) / 180));
  const radius = Math.max(
    0.0022,
    ...members.map((station) => {
      const dx = (station.lng - centerLng) * lngScale;
      const dy = station.lat - centerLat;
      return Math.sqrt(dx * dx + dy * dy) * 1.45;
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

function buildTransferGroupAreaFeatures(
  transferGroups: RailMapTransferGroup[],
  stationIndex: Map<string, ValidRailMapStation>,
  selectedTransferGroupId: string | null,
) {
  return {
    type: "FeatureCollection" as const,
    features: transferGroups
      .map((group) => {
        if (group.enabled === false) return null;
        const members = group.stationIds
          .map((stationId) => stationIndex.get(stationId))
          .filter((station): station is ValidRailMapStation =>
            Boolean(station),
          );
        if (members.length < 2) return null;

        const coordinates = buildTransferGroupCircleCoordinates(members);

        return {
          type: "Feature" as const,
          properties: {
            id: group.id,
            nameKo: group.nameKo,
            stationCount: members.length,
            isSelected: selectedTransferGroupId === group.id,
          },
          geometry: {
            type: "Polygon" as const,
            coordinates: [coordinates],
          },
        };
      })
      .filter(
        (feature): feature is NonNullable<typeof feature> => feature !== null,
      ),
  };
}

function buildTransferGroupIconFeatures(
  transferGroups: RailMapTransferGroup[],
  stationIndex: Map<string, ValidRailMapStation>,
  selectedTransferGroupId: string | null,
) {
  return {
    type: "FeatureCollection" as const,
    features: transferGroups
      .map((group) => {
        if (group.enabled === false) return null;
        const members = group.stationIds
          .map((stationId) => stationIndex.get(stationId))
          .filter((station): station is ValidRailMapStation =>
            Boolean(station),
          );
        if (members.length < 2) return null;

        const lng =
          members.reduce((sum, station) => sum + station.lng, 0) /
          members.length;
        const lat =
          members.reduce((sum, station) => sum + station.lat, 0) /
          members.length;

        return {
          type: "Feature" as const,
          properties: {
            id: group.id,
            nameKo: group.nameKo,
            stationCount: members.length,
            isSelected: selectedTransferGroupId === group.id,
          },
          geometry: {
            type: "Point" as const,
            coordinates: [lng, lat] as LngLatTuple,
          },
        };
      })
      .filter(
        (feature): feature is NonNullable<typeof feature> => feature !== null,
      ),
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

const KOREA_MAX_BOUNDS: [[number, number], [number, number]] = [
  [121.4, 30.9],
  [134.3, 43.1],
];

type LngLatTuple = [number, number];

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

  const lng =
    0.5 *
    (2 * p1Lng +
      (-p0Lng + p2Lng) * t +
      (2 * p0Lng - 5 * p1Lng + 4 * p2Lng - p3Lng) * t2 +
      (-p0Lng + 3 * p1Lng - 3 * p2Lng + p3Lng) * t3);

  const lat =
    0.5 *
    (2 * p1Lat +
      (-p0Lat + p2Lat) * t +
      (2 * p0Lat - 5 * p1Lat + 4 * p2Lat - p3Lat) * t2 +
      (-p0Lat + 3 * p1Lat - 3 * p2Lat + p3Lat) * t3);

  return [lng, lat];
}

function toLngLatTuple(point: ReadonlyArray<number>): LngLatTuple | null {
  const [lng, lat] = point;

  if (typeof lng !== "number" || typeof lat !== "number") return null;

  return [lng, lat];
}

function getHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function smoothCoordinates(coordinates: ReadonlyArray<ReadonlyArray<number>>): LngLatTuple[] {
  const points = coordinates
    .map(toLngLatTuple)
    .filter((point): point is LngLatTuple => point !== null);

  if (points.length < 3) return points;

  const samplesPerSegment = 5;
  const result: LngLatTuple[] = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)] ?? p2;

    if (!p0 || !p1 || !p2 || !p3) continue;

    if (i === 0) result.push(p1);

    for (let step = 1; step <= samplesPerSegment; step += 1) {
      result.push(catmullRomPoint(p0, p1, p2, p3, step / samplesPerSegment));
    }
  }

  return result;
}

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
  const branchesRef = useRef(branches);
  const stationsRef = useRef(stations);
  const onSelectBranchRef = useRef(onSelectBranch);
  const onSelectStationRef = useRef(onSelectStation);
  const onSelectTransferGroupRef = useRef(onSelectTransferGroup);
  const onClearStationRef = useRef(onClearStation);

  useEffect(() => {
    branchesRef.current = branches;
  }, [branches]);

  useEffect(() => {
    stationsRef.current = stations;
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
  const transferGroupIndex = useMemo(
    () => new Map(transferGroups.map((group) => [group.id, group])),
    [transferGroups],
  );
  const transferGroupAreaFeatures = useMemo(
    () =>
      buildTransferGroupAreaFeatures(
        transferGroups,
        validStationIndex,
        selectedTransferGroupId,
      ),
    [selectedTransferGroupId, transferGroups, validStationIndex],
  );
  const transferGroupIconFeatures = useMemo(
    () =>
      buildTransferGroupIconFeatures(
        transferGroups,
        validStationIndex,
        selectedTransferGroupId,
      ),
    [selectedTransferGroupId, transferGroups, validStationIndex],
  );
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
      ),
    [
      highlightedRouteStationIdSet,
      markerStations,
      selectedStationId,
      stationColorIndex,
      stationTransferGroupIndex,
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
              "line-width": 3.8,
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
              "line-width": 2.2,
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
              "line-width": 4.2,
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
              "line-width": 4.2,
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
              "line-width": 2.4,
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
            data: transferGroupAreaFeaturesRef.current,
          });

          map.addSource("transfer-group-icons", {
            type: "geojson",
            data: transferGroupIconFeaturesRef.current,
          });

          map.addLayer({
            id: "transfer-group-areas-fill",
            type: "fill",
            source: "transfer-group-areas",
            minzoom: 12,
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
            minzoom: 12,
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
            maxzoom: 14.5,
            paint: {
              "circle-radius": 22,
              "circle-color": "#000000",
              "circle-opacity": 0.01,
            },
          });

          map.addLayer({
            id: "transfer-group-collapsed-casing",
            type: "circle",
            source: "transfer-group-icons",
            maxzoom: 14.5,
            paint: {
              "circle-color": "rgba(255,255,255,0)",
              "circle-radius": 0,
              "circle-stroke-width": 0,
              "circle-opacity": 0,
            },
          });

          map.addLayer({
            id: "transfer-group-collapsed-icon",
            type: "symbol",
            source: "transfer-group-icons",
            maxzoom: 14.5,
            layout: {
              "icon-image": "transfer-icon",
              "icon-size": ["case", ["==", ["get", "isSelected"], true], 0.18, 0.16],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            },
          });

          map.addLayer({
            id: "transfer-group-collapsed-label",
            type: "symbol",
            source: "transfer-group-icons",
            minzoom: 12,
            maxzoom: 14.5,
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
                7.2,
                5.6,
              ],
              "circle-opacity": [
                "step",
                ["zoom"],
                ["case", ["==", ["get", "isTransferChild"], true], 0, 0.96],
                14.5,
                0.96,
              ],
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
                5.2,
                3.8,
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
                2.2,
                1.2,
              ],
              "circle-opacity": [
                "step",
                ["zoom"],
                ["case", ["==", ["get", "isTransferChild"], true], 0, 0.96],
                14.5,
                0.96,
              ],
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
              "text-opacity": [
                "step",
                ["zoom"],
                ["case", ["==", ["get", "isTransferChild"], true], 0, 0.92],
                14.5,
                0.92,
              ],
            },
          });

          map.addLayer({
            id: "branch-preview-station-labels-emphasized",
            type: "symbol",
            source: "branch-preview-stations",
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
            },
          });

          for (const layerId of [
            "transfer-group-collapsed-hit",
            "transfer-group-collapsed-casing",
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

            const props = feature.properties as Record<string, unknown>;
            const branchId = String(props.id ?? "");
            const branch = branchesRef.current.find(
              (item) => item.id === branchId,
            );

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
            const props = feature?.properties as
              Record<string, unknown> | undefined;
            const groupId = String(props?.id ?? "");
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
            const props = feature?.properties as
              Record<string, unknown> | undefined;
            const stationId = String(props?.id ?? "");
            const transferGroup =
              stationTransferGroupIndexRef.current.get(stationId);
            if (transferGroup && onSelectTransferGroupRef.current) {
              onSelectTransferGroupRef.current(transferGroup);
              return;
            }

            const station = stationsRef.current.find(
              (item) => item.id === stationId,
            );
            if (station) onSelectStationRef.current?.(station);
          });

          map.on("click", (event) => {
            const interactiveFeatures = map.queryRenderedFeatures(event.point, {
              layers: [
                "branch-preview-lines",
                "branch-preview-lines-selected",
                "transfer-group-collapsed-hit",
                "transfer-group-areas-fill",
                "branch-preview-stations-dot",
              ],
            });

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

    areaSource?.setData(transferGroupAreaFeatures);
    iconSource?.setData(transferGroupIconFeatures);
  }, [transferGroupAreaFeatures, transferGroupIconFeatures, mapReady]);

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
