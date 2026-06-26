"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";

type Station = {
  id: string;
  nameKo: string | null;
  lat: number | null;
  lng: number | null;
  lineNameKo: string | null;
};

type Props = {
  stations: Station[];
};

export function RailMap({ stations }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const validStations = stations.filter(
      (station): station is Station & { lat: number; lng: number } =>
        typeof station.lat === "number" && typeof station.lng === "number",
    );

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [126.978, 37.5665],
      zoom: 10,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    for (const station of validStations.slice(0, 500)) {
      const marker = new maplibregl.Marker()
        .setLngLat([station.lng, station.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 16 }).setHTML(
            `<strong>${station.nameKo ?? "이름 없음"}</strong><br/>${station.lineNameKo ?? ""}`,
          ),
        )
        .addTo(map);

      marker.getElement().setAttribute("aria-label", station.nameKo ?? "station");
    }

    return () => {
      map.remove();
    };
  }, [stations]);

  return <div ref={containerRef} className="h-[560px] w-full overflow-hidden rounded-2xl border border-gray-200" />;
}
