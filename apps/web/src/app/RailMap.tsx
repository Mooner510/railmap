"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type Marker } from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";

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
}

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
          role: branch.role,
          sourceLineNumber: branch.sourceLineNumber,
          sourceLineName: branch.sourceLineName,
          routeStopCount: branch.routeStops.length,
          coordinateCount: coordinates.length,
          lowConfidenceCount: branch.routeStops.filter((stop) => stop.confidence === "low").length,
        },
        geometry: {
          type: "LineString" as const,
          coordinates,
        },
      };
    })
    .filter((feature): feature is NonNullable<typeof feature> => feature !== null);
}

export default function RailMap({ stations, branches }: RailMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  const validStations = useMemo(() => stations.filter(isValidCoordinate), [stations]);
  const branchFeatures = useMemo(() => buildBranchFeatures(branches), [branches]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [127.0276, 37.4979],
      zoom: 9,
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
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
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
          "line-width": 6,
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
          "line-color": [
            "case",
            [">", ["get", "lowConfidenceCount"], 0],
            "#f59e0b",
            "#0284c7",
          ],
          "line-width": 3,
          "line-opacity": 0.8,
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
        const coordinates = event.lngLat;

        if (!feature) return;

        const props = feature.properties as Record<string, unknown>;

        new maplibregl.Popup({ offset: 12 })
          .setLngLat(coordinates)
          .setHTML(
            `<div style="font-size:12px;line-height:1.5">
              <strong>${String(props.canonicalLineNameKo ?? "")}</strong><br/>
              ${String(props.sourceLineName ?? "")} · ${String(props.role ?? "")}<br/>
              정차역 ${String(props.routeStopCount ?? "-")}개 · 좌표 ${String(
                props.coordinateCount ?? "-",
              )}개<br/>
              검수 ${String(props.lowConfidenceCount ?? "0")}개
            </div>`,
          )
          .addTo(map);
      });
    });

    mapRef.current = map;

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

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
    if (!map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const markerStations = validStations.slice(0, 1200);

    for (const station of markerStations) {
      const element = document.createElement("button");
      element.type = "button";
      element.title = station.nameKo;
      element.className =
        "h-3 w-3 rounded-full border border-white bg-sky-500 shadow-md transition-transform hover:scale-150";

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

      const marker = new maplibregl.Marker({ element })
        .setLngLat([station.lng, station.lat])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
    }
  }, [validStations]);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-100">
      <div ref={containerRef} className="h-[520px] w-full" />
      <div className="pointer-events-none absolute left-4 top-4 rounded-2xl border border-white/70 bg-white/85 px-4 py-3 text-sm shadow-sm backdrop-blur">
        <p className="font-semibold text-slate-900">Rail Map Preview</p>
        <p className="mt-1 text-xs text-slate-500">
          역 {validStations.length.toLocaleString("ko-KR")}개 · branch preview line{" "}
          {branchFeatures.length.toLocaleString("ko-KR")}개
        </p>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 rounded-2xl border border-white/70 bg-white/85 px-4 py-3 text-xs shadow-sm backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="h-1 w-6 rounded-full bg-sky-600" />
          <span className="text-slate-600">일반 branch</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="h-1 w-6 rounded-full bg-amber-500" />
          <span className="text-slate-600">검수 필요 포함</span>
        </div>
      </div>
    </div>
  );
}
