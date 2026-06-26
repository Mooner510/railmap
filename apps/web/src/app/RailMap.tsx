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

interface RailMapProps {
  stations: RailMapStation[];
  branches: RailMapBranch[];
  selectedBranchId?: string | null;
  selectedStationId?: string | null;
  focusVersion?: number;
  onSelectBranch?: (branch: RailMapBranch) => void;
  onSelectStation?: (station: RailMapStation) => void;
  className?: string;
}

const KOREA_MAX_BOUNDS: [[number, number], [number, number]] = [
  [121.4, 30.9],
  [134.3, 43.1],
];

function isValidCoordinate(station: RailMapStation | null): station is RailMapStation & {
  lat: number;
  lng: number;
} {
  return (
    !!station &&
    typeof station.lat === "number" &&
    typeof station.lng === "number" &&
    Number.isFinite(station.lat) &&
    Number.isFinite(station.lng)
  );
}

function buildBranchFeatures(branches: RailMapBranch[]) {
  return branches
    .map((branch) => {
      const coordinates = branch.routeStops
        .map((stop) => stop.station)
        .filter(isValidCoordinate)
        .map((station) => [station.lng, station.lat]);

      if (coordinates.length < 2) return null;

      return {
        type: "Feature" as const,
        properties: {
          id: branch.id,
          canonicalLineId: branch.canonicalLineId,
          canonicalLineNameKo: branch.canonicalLineNameKo,
          colorHex: branch.colorHex,
          role: branch.role,
          sourceLineNumber: branch.sourceLineNumber,
          sourceLineName: branch.sourceLineName,
          routeStopCount: branch.routeStops.length,
          coordinateCount: coordinates.length,
        },
        geometry: {
          type: "LineString" as const,
          coordinates,
        },
      };
    })
    .filter((feature): feature is NonNullable<typeof feature> => feature !== null);
}

function getFitPadding() {
  if (typeof window === "undefined") return 64;

  if (window.innerWidth >= 1024) {
    return { top: 40, bottom: 40, left: 300, right: 296 };
  }

  return { top: 32, bottom: 210, left: 24, right: 24 };
}

function getMapErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "지도 초기화 중 오류가 발생했습니다.";
}

export default function RailMap({
  stations,
  branches,
  selectedBranchId = null,
  selectedStationId = null,
  focusVersion = 0,
  onSelectBranch,
  onSelectStation,
  className = "",
}: RailMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const branchesRef = useRef(branches);
  const onSelectBranchRef = useRef(onSelectBranch);

  useEffect(() => {
    branchesRef.current = branches;
  }, [branches]);

  useEffect(() => {
    onSelectBranchRef.current = onSelectBranch;
  }, [onSelectBranch]);

  const validStations = useMemo(() => stations.filter(isValidCoordinate), [stations]);
  const branchFeatures = useMemo(() => buildBranchFeatures(branches), [branches]);
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
            data: {
              type: "FeatureCollection",
              features: [],
            },
          });

          map.addLayer({
            id: "branch-preview-lines-casing",
            type: "line",
            source: "branch-preview-lines",
            paint: {
              "line-color": "#ffffff",
              "line-width": 4.2,
              "line-opacity": 0.9,
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
              "line-width": 2.0,
              "line-opacity": 0.7,
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
              "line-width": 4.6,
              "line-opacity": 0.95,
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
    if (!map) return;

    const updateSource = () => {
      const source = map.getSource("branch-preview-lines") as GeoJSONSource | undefined;

      if (!source) return;

      source.setData({
        type: "FeatureCollection",
        features: branchFeatures,
      });
    };

    if (map.isStyleLoaded()) {
      updateSource();
    } else {
      map.once("load", updateSource);
    }
  }, [branchFeatures]);

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
  }, [selectedBranchId, mapReady]);


  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || focusVersion === 0) return;

    const selectedStation = validStations.find((station) => station.id === selectedStationId);

    if (selectedStation) {
      map.flyTo({
        center: [selectedStation.lng, selectedStation.lat],
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
    if (!map || !mapReady) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const markerStations =
      selectedBranchStationIds.size > 0
        ? validStations.filter((station) => selectedBranchStationIds.has(station.id))
        : visibleBranchStations.length > 0
          ? visibleBranchStations
          : validStations.slice(0, 1200);

    for (const station of markerStations) {
      const element = document.createElement("button");
      element.type = "button";
      element.title = station.nameKo;
      const isSelected = selectedStationId === station.id;
      const isInSelectedBranch = selectedBranchStationIds.has(station.id);

      element.className = isSelected
        ? "h-3.5 w-3.5 rounded-full border-2 border-white bg-amber-500 shadow-md shadow-amber-500/40 transition-transform hover:scale-150"
        : isInSelectedBranch
          ? "h-2.5 w-2.5 rounded-full border border-white bg-sky-600 shadow-sm transition-transform hover:scale-150"
          : "h-2 w-2 rounded-full border border-white bg-sky-500 shadow-sm transition-transform hover:scale-150";

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
      element.addEventListener("click", () => {
        popup.remove();
        onSelectStation?.(station);
      });

      const marker = new maplibregl.Marker({ element })
        .setLngLat([station.lng, station.lat])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
    }
  }, [validStations, visibleBranchStations, selectedBranchStationIds, selectedStationId, onSelectStation, mapReady]);

  return (
    <div className={`relative h-full min-h-[100dvh] w-full min-w-0 overflow-hidden bg-slate-100 ${className}`}>
      <div ref={containerRef} className="absolute inset-0 h-full min-h-[100dvh] w-full" />

      {!mapReady && !mapError ? (
        <div className="absolute inset-0 grid place-items-center bg-slate-100 text-xs font-semibold text-slate-500">
          지도를 불러오는 중입니다.
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
