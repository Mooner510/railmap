"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";

export interface RailMapStation {
  id: string;
  nameKo: string;
  lineNameKo?: string | null;
  lat: number | null;
  lng: number | null;
}

interface RailMapProps {
  stations: RailMapStation[];
}

function isValidCoordinate(station: RailMapStation): station is RailMapStation & {
  lat: number;
  lng: number;
} {
  return (
    typeof station.lat === "number" &&
    typeof station.lng === "number" &&
    Number.isFinite(station.lat) &&
    Number.isFinite(station.lng)
  );
}

export default function RailMap({ stations }: RailMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  const validStations = useMemo(() => stations.filter(isValidCoordinate), [stations]);

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
          좌표 보유 역 {validStations.length.toLocaleString("ko-KR")}개 표시
        </p>
      </div>
    </div>
  );
}
