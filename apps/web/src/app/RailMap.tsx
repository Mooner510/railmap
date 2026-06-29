"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type Marker } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

export interface RailMapStation {
  id: string;
  nameKo: string;
  lineNameKo?: string | null;
  lat: number | null;
  lng: number | null;
}

export interface RailMapBranch {
  id: string;
  canonicalLineId: string;
  canonicalLineNameKo: string;
  colorHex: string;
  role: string;
  sourceLineNumber: string;
  sourceLineName: string;
  routeStops: Array<{
    id: string;
    sequence: number;
    displayNameKo: string;
    station: RailMapStation | null;
    confidence: string;
  }>;
}


type ValidRailMapStation = RailMapStation & {
  lat: number;
  lng: number;
};

function isValidCoordinate(station: RailMapStation | null | undefined): station is ValidRailMapStation {
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
  const coordinates = branch.routeStops
    .map((stop) => stop.station)
    .filter(isValidCoordinate)
    .map((station): LngLatTuple => [station.lng, station.lat]);

  if (coordinates.length < 2) return [];

  const smoothed = smoothCoordinates(coordinates);

  return smoothed.length >= 2 ? smoothed : coordinates;
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
      .filter((feature): feature is NonNullable<typeof feature> => feature !== null),
  };
}


function smoothCoordinateRange(coordinates: LngLatTuple[], startIndex: number, endIndex: number) {
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

function getBranchRouteSegmentCoordinates(branch: RailMapBranch, fromStationId: string, toStationId: string) {
  const points = branch.routeStops
    .map((stop) => {
      const station = stop.station;
      if (!isValidCoordinate(station)) return null;

      return {
        stationId: station.id,
        coordinate: [station.lng, station.lat] as LngLatTuple,
      };
    })
    .filter((point): point is { stationId: string; coordinate: LngLatTuple } => point !== null);

  const fromIndex = points.findIndex((point) => point.stationId === fromStationId);
  const toIndex = points.findIndex((point) => point.stationId === toStationId);

  if (fromIndex < 0 || toIndex < 0) return [];

  return smoothCoordinateRange(
    points.map((point) => point.coordinate),
    fromIndex,
    toIndex,
  );
}

function buildHighlightedRouteFeature(branches: RailMapBranch[], stationIds: string[], branchIds: string[]) {
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
    const shouldCloseSegment = edgeIndex === branchIds.length || nextBranchId !== currentBranchId;

    if (!shouldCloseSegment || !currentBranchId) continue;

    const branch = branchIndex.get(currentBranchId);
    const fromStationId = stationIds[segmentStartIndex];
    const toStationId = stationIds[edgeIndex];

    if (branch && fromStationId && toStationId) {
      const coordinates = getBranchRouteSegmentCoordinates(branch, fromStationId, toStationId);

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
  focusVersion?: number;
  showBranches?: boolean;
  showStations?: boolean;
  onSelectBranch?: (branch: RailMapBranch) => void;
  onSelectStation?: (station: RailMapStation) => void;
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

function toLngLatTuple(point: number[]): LngLatTuple | null {
  const [lng, lat] = point;

  if (typeof lng !== "number" || typeof lat !== "number") return null;

  return [lng, lat];
}

function smoothCoordinates(coordinates: number[][]): LngLatTuple[] {
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
  focusVersion = 0,
  showBranches = true,
  showStations = true,
  onSelectBranch,
  onSelectStation,
  onClearStation,
  className = "",
}: RailMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const branchesRef = useRef(branches);
  const onSelectBranchRef = useRef(onSelectBranch);
  const onSelectStationRef = useRef(onSelectStation);
  const onClearStationRef = useRef(onClearStation);

  useEffect(() => {
    branchesRef.current = branches;
  }, [branches]);

  useEffect(() => {
    onSelectBranchRef.current = onSelectBranch;
  }, [onSelectBranch]);

  useEffect(() => {
    onSelectStationRef.current = onSelectStation;
  }, [onSelectStation]);

  useEffect(() => {
    onClearStationRef.current = onClearStation;
  }, [onClearStation]);

  const validStations = useMemo(() => stations.filter(isValidCoordinate), [stations]);
  const branchFeatures = useMemo(() => buildBranchFeatures(showBranches ? branches : []), [branches, showBranches]);
  const highlightedRouteFeatures = useMemo(
    () => buildHighlightedRouteFeature(branches, highlightedRouteStationIds, highlightedRouteBranchIds),
    [branches, highlightedRouteStationIds, highlightedRouteBranchIds],
  );
  const branchFeaturesRef = useRef(branchFeatures);
  const highlightedRouteFeaturesRef = useRef(highlightedRouteFeatures);
  const highlightedRouteStationIdSet = useMemo(() => new Set(highlightedRouteStationIds), [highlightedRouteStationIds]);

  useEffect(() => {
    branchFeaturesRef.current = branchFeatures;
  }, [branchFeatures]);

  useEffect(() => {
    highlightedRouteFeaturesRef.current = highlightedRouteFeatures;
  }, [highlightedRouteFeatures]);
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
        if (stationId && !index.has(stationId)) index.set(stationId, branch.colorHex);
      }
    }

    return index;
  }, [branches, selectedBranch]);

  const visibleBranchStations = useMemo(() => {
    const stationsInBranches = branches.flatMap((branch) =>
      branch.routeStops.map((stop) => stop.station).filter(isValidCoordinate),
    );

    const unique = new Map<string, RailMapStation & { lat: number; lng: number }>();

    for (const station of stationsInBranches) {
      unique.set(station.id, station);
    }

    return [...unique.values()];
  }, [branches]);

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
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
        map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

        map.on("error", (event) => {
          const error = (event as { error?: unknown }).error;
          if (error) setMapError(getMapErrorMessage(error));
        });

        map.on("load", () => {
          setMapReady(true);
          setMapError(null);

          map.addSource("branch-preview-lines", {
            type: "geojson",
            data: branchFeaturesRef.current,
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
            const branch = branchesRef.current.find((item) => item.id === branchId);

            if (branch) onSelectBranchRef.current?.(branch);
          });

          map.on("click", (event) => {
            const lineFeatures = map.queryRenderedFeatures(event.point, {
              layers: ["branch-preview-lines", "branch-preview-lines-selected"],
            });

            if (lineFeatures.length === 0) onClearStationRef.current?.();
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
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
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
      const source = map.getSource("branch-preview-lines") as GeoJSONSource | undefined;
      if (!source) return;
      source.setData(branchFeatures);
    };

    updateSource();
  }, [branchFeatures, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource("route-result-lines") as GeoJSONSource | undefined;
    if (!source) return;

    source.setData(highlightedRouteFeatures);
  }, [highlightedRouteFeatures, mapReady]);

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
            ? ["case", ["in", ["get", "id"], ["literal", highlightedRouteBranchIds]], 0.38, 0.16]
            : 0.76,
      );
    }

    if (map.getLayer("branch-preview-lines-casing")) {
      map.setPaintProperty("branch-preview-lines-casing", "line-opacity", selectedBranchId ? 0.48 : highlightedRouteBranchIds.length > 0 ? 0.32 : 0.88);
    }
  }, [selectedBranchId, highlightedRouteBranchIds, mapReady]);


  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || focusVersion === 0) return;

    const selectedStation = validStations.find((station) => station.id === selectedStationId);

    if (selectedStation) {
      map.flyTo({
        center: isValidCoordinate(selectedStation) ? [selectedStation.lng, selectedStation.lat] : undefined,
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
  }, [focusVersion, mapReady, selectedStationId, validStations, visibleBranchStations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || highlightedRouteStationIds.length < 2) return;

    const stationIndex = new Map(validStations.map((station) => [station.id, station]));
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (!showStations) return;

    const markerStations =
      selectedBranchStationIds.size > 0
        ? validStations.filter((station) => selectedBranchStationIds.has(station.id))
        : visibleBranchStations.length > 0
          ? visibleBranchStations
          : validStations.slice(0, 1200);

    for (const station of markerStations) {
      const isSelected = selectedStationId === station.id;
      const isRouteStation = highlightedRouteStationIdSet.has(station.id);
      const color = stationColorIndex.get(station.id) ?? "#64748b";

      const element = document.createElement("button");
      element.type = "button";
      element.className = "flex h-7 w-7 items-center justify-center rounded-full";
      element.setAttribute("aria-label", station.nameKo ?? "역");

      const dot = document.createElement("span");
      dot.className = isSelected
        ? "block h-4 w-4 rounded-full border-2 border-white shadow-lg ring-2 transition-transform duration-150 ease-out hover:scale-125"
        : isRouteStation
          ? "block h-3 w-3 rounded-full border-2 border-white shadow-md ring-2 transition-transform duration-150 ease-out hover:scale-125"
          : selectedBranchStationIds.has(station.id)
            ? "block h-2.5 w-2.5 rounded-full border border-white shadow-sm transition-transform duration-150 ease-out hover:scale-125"
            : "block h-2 w-2 rounded-full border border-white shadow-sm opacity-90 transition-transform duration-150 ease-out hover:scale-125";
      dot.style.backgroundColor = color;
      dot.style.setProperty("--tw-ring-color", color);
      element.appendChild(dot);
      const popup = new maplibregl.Popup({
        offset: 12,
        closeButton: false,
        closeOnClick: false,
      }).setHTML(
        `<div style="font-size:12px;line-height:1.5"><strong>${station.nameKo}</strong>${
          station.lineNameKo ? `<br/>${station.lineNameKo}` : ""
        }</div>`,
      );

      element.addEventListener("mouseenter", () => popup.addTo(map));
      element.addEventListener("mouseleave", () => popup.remove());
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        popup.remove();
        onSelectStationRef.current?.(station);
      });

      const marker = new maplibregl.Marker({ element })
        .setLngLat([station.lng, station.lat])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
    }
  }, [validStations, visibleBranchStations, selectedBranchStationIds, selectedStationId, highlightedRouteStationIdSet, mapReady, showStations, stationColorIndex]);

  return (
    <div className={`relative h-full min-h-[100dvh] w-full min-w-0 overflow-hidden bg-slate-100 ${className}`}>
      <div ref={containerRef} className="absolute inset-0 h-full min-h-[100dvh] w-full" />

      {!mapReady && !mapError ? (
        <div className="absolute inset-0 grid place-items-center bg-slate-100 text-xs font-semibold text-slate-500">
          지도를 불러오는 중입니다.
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-2 left-2 z-10 hidden max-w-[260px] border border-slate-200 bg-white/90 px-2 py-1 text-[11px] font-medium leading-4 text-slate-500 shadow-sm backdrop-blur lg:block">
        현재 구간선은 정차역 좌표를 통과하는 부드러운 참고 선형입니다. 이후 에디터에서 중간 정점을 직접 보정할 수 있게 확장할 예정입니다.
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
