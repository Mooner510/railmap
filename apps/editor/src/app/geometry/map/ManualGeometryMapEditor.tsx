"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  ManualGeometryOverride,
  ManualOverlayBundle,
} from "../../editorModel";

export type GeometryMapPoint = {
  lng: number;
  lat: number;
  kind: "station" | "control";
  stationId?: string;
};

export type GeometryMapBranch = {
  id: string;
  canonicalLineId: string;
  canonicalLineNameKo: string;
  colorHex: string;
  role: string;
  sourceLineNumber: string;
  sourceLineName: string;
  origin?: string | null;
  terminal?: string | null;
  sourceGeometryPoints?: GeometryMapPoint[];
  geometryPoints: GeometryMapPoint[];
};

type LngLatTuple = [number, number];
type SaveState = "idle" | "saving" | "saved" | "error";

const KOREA_MAX_BOUNDS: [[number, number], [number, number]] = [
  [121.4, 30.9],
  [134.3, 43.1],
];

function isFinitePoint(point: GeometryMapPoint) {
  return Number.isFinite(point.lng) && Number.isFinite(point.lat);
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
    for (let step = 1; step <= samplesPerSegment; step += 1) {
      result.push(catmullRomPoint(p0, p1, p2, p3, step / samplesPerSegment));
    }
  }

  return result;
}

function getBranchCoordinates(branch: GeometryMapBranch) {
  return branch.geometryPoints
    .filter(isFinitePoint)
    .map((point): LngLatTuple => [point.lng, point.lat]);
}

function buildBranchFeatures(branches: GeometryMapBranch[]) {
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
            colorHex: branch.colorHex,
            canonicalLineNameKo: branch.canonicalLineNameKo,
            sourceLineName: branch.sourceLineName,
          },
          geometry: {
            type: "LineString" as const,
            coordinates: smoothCoordinates(coordinates),
          },
        };
      })
      .filter((feature): feature is NonNullable<typeof feature> => feature !== null),
  };
}

function buildControlPointFeatures(branch: GeometryMapBranch | null, selectedIndex: number | null) {
  return {
    type: "FeatureCollection" as const,
    features: (branch?.geometryPoints ?? [])
      .map((point, index) => {
        if (!isFinitePoint(point)) return null;

        return {
          type: "Feature" as const,
          properties: {
            id: `${branch?.id ?? "branch"}:${index}`,
            index,
            kind: point.kind,
            selected: selectedIndex === index,
          },
          geometry: {
            type: "Point" as const,
            coordinates: [point.lng, point.lat] as LngLatTuple,
          },
        };
      })
      .filter((feature): feature is NonNullable<typeof feature> => feature !== null),
  };
}

function getMapErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "지도를 불러오지 못했습니다.";
}

function formatRole(role: string) {
  if (role === "main") return "본선";
  if (role === "branch") return "지선";
  return role;
}

function makeGeometryOverride(branch: GeometryMapBranch): ManualGeometryOverride {
  return {
    branchId: branch.id,
    enabled: true,
    note: null,
    points: branch.geometryPoints.map((point) => ({
      lng: Number(point.lng.toFixed(7)),
      lat: Number(point.lat.toFixed(7)),
      kind: point.kind,
      stationId: point.stationId,
    })),
  };
}

function insertPointAtNearestSegment(branch: GeometryMapBranch, lng: number, lat: number) {
  const points = branch.geometryPoints;
  if (points.length < 2) {
    return { ...branch, geometryPoints: [...points, { lng, lat, kind: "control" as const }] };
  }

  let bestIndex = 1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (!a || !b) continue;

    const midLng = (a.lng + b.lng) / 2;
    const midLat = (a.lat + b.lat) / 2;
    const distance = (midLng - lng) ** 2 + (midLat - lat) ** 2;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index + 1;
    }
  }

  return {
    ...branch,
    geometryPoints: [
      ...points.slice(0, bestIndex),
      { lng, lat, kind: "control" as const },
      ...points.slice(bestIndex),
    ],
  };
}

export default function ManualGeometryMapEditor({
  branches,
  initialOverlays,
}: {
  branches: GeometryMapBranch[];
  initialOverlays: ManualOverlayBundle;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const branchesRef = useRef(branches);
  const selectedBranchRef = useRef<GeometryMapBranch | null>(branches[0] ?? null);
  const dragPointIndexRef = useRef<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [branchList, setBranchList] = useState(branches);
  const [selectedBranchId, setSelectedBranchId] = useState(branches[0]?.id ?? "");
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [overlays, setOverlays] = useState(initialOverlays);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const selectedBranch = useMemo(
    () => branchList.find((branch) => branch.id === selectedBranchId) ?? null,
    [branchList, selectedBranchId],
  );

  const filteredBranches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return branchList;

    return branchList.filter((branch) =>
      [branch.canonicalLineNameKo, branch.sourceLineName, branch.sourceLineNumber, branch.origin, branch.terminal]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [branchList, query]);

  const branchFeatures = useMemo(() => buildBranchFeatures(branchList), [branchList]);
  const selectedControlPointFeatures = useMemo(
    () => buildControlPointFeatures(selectedBranch, selectedPointIndex),
    [selectedBranch, selectedPointIndex],
  );

  const branchFeaturesRef = useRef(branchFeatures);
  const controlPointFeaturesRef = useRef(selectedControlPointFeatures);

  useEffect(() => {
    branchesRef.current = branchList;
  }, [branchList]);

  useEffect(() => {
    selectedBranchRef.current = selectedBranch;
  }, [selectedBranch]);

  useEffect(() => {
    branchFeaturesRef.current = branchFeatures;
  }, [branchFeatures]);

  useEffect(() => {
    controlPointFeaturesRef.current = selectedControlPointFeatures;
  }, [selectedControlPointFeatures]);

  const updateBranch = useCallback((branch: GeometryMapBranch) => {
    setBranchList((current) => current.map((item) => (item.id === branch.id ? branch : item)));
  }, []);

  const selectBranch = useCallback((branchId: string) => {
    setSelectedBranchId(branchId);
    setSelectedPointIndex(null);
    const map = mapRef.current;
    const branch = branchesRef.current.find((item) => item.id === branchId);
    if (!map || !branch) return;

    const coordinates = getBranchCoordinates(branch);
    if (coordinates.length >= 2) {
      const bounds = coordinates.reduce(
        (result, coordinate) => result.extend(coordinate),
        new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
      );
      map.fitBounds(bounds, { padding: { top: 96, right: 430, bottom: 72, left: 48 }, maxZoom: 14, duration: 360 });
    }
  }, []);

  async function persistGeometryOverrides(nextBranches: GeometryMapBranch[]) {
    const overrideByBranchId = new Map(overlays.geometryOverrides.map((override) => [override.branchId, override]));
    const changedBranch = nextBranches.find((branch) => branch.id === selectedBranchId);
    if (!changedBranch) return;

    overrideByBranchId.set(changedBranch.id, makeGeometryOverride(changedBranch));

    const nextOverlays: ManualOverlayBundle = {
      ...overlays,
      geometryOverrides: [...overrideByBranchId.values()],
    };

    setSaveState("saving");
    setMessage("선형 보정 저장 중...");

    try {
      const response = await fetch("/api/manual-overlays", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextOverlays),
      });

      if (!response.ok) throw new Error(await response.text());

      const saved = (await response.json()) as ManualOverlayBundle;
      setOverlays(saved);
      setSaveState("saved");
      setMessage("선형 보정을 저장했습니다.");
    } catch (error) {
      setSaveState("error");
      setMessage(getMapErrorMessage(error));
    }
  }

  function saveSelectedBranch() {
    void persistGeometryOverrides(branchList);
  }

  function resetSelectedBranch() {
    const original = branches.find((branch) => branch.id === selectedBranchId);
    if (!original) return;

    updateBranch({
      ...original,
      geometryPoints: original.sourceGeometryPoints?.length ? original.sourceGeometryPoints : original.geometryPoints,
    });
    setSelectedPointIndex(null);
    setMessage("저장 전 원본 선형으로 되돌렸습니다. 저장해야 반영됩니다.");
    setSaveState("idle");
  }

  function deleteSelectedControlPoint() {
    if (!selectedBranch || selectedPointIndex === null) return;
    const point = selectedBranch.geometryPoints[selectedPointIndex];
    if (!point || point.kind === "station") return;

    const nextBranch = {
      ...selectedBranch,
      geometryPoints: selectedBranch.geometryPoints.filter((_, index) => index !== selectedPointIndex),
    };
    updateBranch(nextBranch);
    setSelectedPointIndex(null);
  }

  useEffect(() => {
    if (mapRef.current) return;

    let frame = 0;
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
              { id: "background", type: "background", paint: { "background-color": "#eef3f8" } },
              { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.82 } },
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

          map.addSource("geometry-lines", { type: "geojson", data: branchFeaturesRef.current });
          map.addSource("geometry-control-points", { type: "geojson", data: controlPointFeaturesRef.current });

          map.addLayer({
            id: "geometry-lines-casing",
            type: "line",
            source: "geometry-lines",
            paint: { "line-color": "#ffffff", "line-width": 4.8, "line-opacity": 0.88 },
            layout: { "line-cap": "round", "line-join": "round" },
          });

          map.addLayer({
            id: "geometry-lines",
            type: "line",
            source: "geometry-lines",
            paint: {
              "line-color": ["coalesce", ["get", "colorHex"], "#0284c7"],
              "line-width": 2.5,
              "line-opacity": 0.68,
            },
            layout: { "line-cap": "round", "line-join": "round" },
          });

          map.addLayer({
            id: "geometry-lines-selected",
            type: "line",
            source: "geometry-lines",
            filter: ["==", ["get", "id"], selectedBranchRef.current?.id ?? ""],
            paint: {
              "line-color": ["coalesce", ["get", "colorHex"], "#2563eb"],
              "line-width": 5.2,
              "line-opacity": 0.96,
            },
            layout: { "line-cap": "round", "line-join": "round" },
          });

          map.addLayer({
            id: "geometry-control-points-casing",
            type: "circle",
            source: "geometry-control-points",
            paint: {
              "circle-color": "#ffffff",
              "circle-radius": ["case", ["==", ["get", "selected"], true], 8, 6],
              "circle-opacity": 0.96,
            },
          });

          map.addLayer({
            id: "geometry-control-points",
            type: "circle",
            source: "geometry-control-points",
            paint: {
              "circle-color": [
                "case",
                ["==", ["get", "kind"], "station"],
                "#111827",
                ["==", ["get", "selected"], true],
                "#ef4444",
                "#f97316",
              ],
              "circle-radius": ["case", ["==", ["get", "selected"], true], 5.5, 4.2],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 1.4,
            },
          });

          map.on("mouseenter", "geometry-lines", () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "geometry-lines", () => {
            map.getCanvas().style.cursor = "";
          });
          map.on("click", "geometry-lines", (event: MapLayerMouseEvent) => {
            const feature = event.features?.[0];
            const branchId = String((feature?.properties as Record<string, unknown> | undefined)?.id ?? "");
            if (!branchId) return;

            const current = selectedBranchRef.current;
            if (current?.id === branchId) {
              const nextBranch = insertPointAtNearestSegment(current, event.lngLat.lng, event.lngLat.lat);
              updateBranch(nextBranch);
              setSelectedPointIndex(nextBranch.geometryPoints.findIndex((point) => point.lng === event.lngLat.lng && point.lat === event.lngLat.lat));
              return;
            }

            selectBranch(branchId);
          });

          map.on("mouseenter", "geometry-control-points", () => {
            map.getCanvas().style.cursor = "grab";
          });
          map.on("mouseleave", "geometry-control-points", () => {
            if (dragPointIndexRef.current === null) map.getCanvas().style.cursor = "";
          });
          map.on("mousedown", "geometry-control-points", (event: MapLayerMouseEvent) => {
            const feature = event.features?.[0];
            const props = feature?.properties as Record<string, unknown> | undefined;
            const index = Number(props?.index);
            if (!Number.isInteger(index)) return;

            event.originalEvent.preventDefault();
            setSelectedPointIndex(index);

            if (props?.kind === "station") return;

            dragPointIndexRef.current = index;
            map.dragPan.disable();
            map.getCanvas().style.cursor = "grabbing";
          });

          map.on("mousemove", (event) => {
            const pointIndex = dragPointIndexRef.current;
            const branch = selectedBranchRef.current;
            if (pointIndex === null || !branch) return;

            const nextPoints = branch.geometryPoints.map((point, index) =>
              index === pointIndex ? { ...point, lng: event.lngLat.lng, lat: event.lngLat.lat } : point,
            );
            updateBranch({ ...branch, geometryPoints: nextPoints });
          });

          map.on("mouseup", () => {
            if (dragPointIndexRef.current === null) return;
            dragPointIndexRef.current = null;
            map.dragPan.enable();
            map.getCanvas().style.cursor = "";
          });
        });
      } catch (error) {
        setMapError(getMapErrorMessage(error));
      }
    };

    frame = window.requestAnimationFrame(initialize);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [selectBranch, updateBranch]);

  useEffect(() => {
    if (!mapReady) return;
    const source = mapRef.current?.getSource("geometry-lines") as GeoJSONSource | undefined;
    source?.setData(branchFeatures);
  }, [branchFeatures, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const source = mapRef.current?.getSource("geometry-control-points") as GeoJSONSource | undefined;
    source?.setData(selectedControlPointFeatures);
    mapRef.current?.setFilter("geometry-lines-selected", ["==", ["get", "id"], selectedBranch?.id ?? ""]);
  }, [mapReady, selectedBranch?.id, selectedControlPointFeatures]);

  return (
    <div className="geometry-map-editor">
      <div ref={containerRef} className="geometry-map-canvas" />

      <aside className="geometry-map-panel">
        <div className="geometry-map-panel-header">
          <a href="/" className="map-editor-back-link">← Editor</a>
          <p className="eyebrow">Geometry Editor</p>
          <h1>노선 선형 보정</h1>
          <p>노선을 선택하고 주황 control point를 추가/드래그해서 선형을 보정합니다.</p>
        </div>

        <input
          className="search-input"
          placeholder="노선명, 분기명, 번호 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <div className="geometry-branch-list fixed-inner-scroll">
          {filteredBranches.map((branch) => (
            <button
              key={branch.id}
              type="button"
              className={branch.id === selectedBranchId ? "geometry-branch-card active" : "geometry-branch-card"}
              onClick={() => selectBranch(branch.id)}
            >
              <span className="line-color-label" style={{ "--line-color": branch.colorHex } as CSSProperties}>
                {branch.canonicalLineNameKo}
              </span>
              <strong>{branch.sourceLineName}</strong>
              <small>{formatRole(branch.role)} · {branch.geometryPoints.length} points</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="geometry-edit-toolbar">
        <div>
          <p className="eyebrow">Selected branch</p>
          <h2>{selectedBranch?.sourceLineName ?? "노선 없음"}</h2>
          <p>{selectedBranch ? `${selectedBranch.geometryPoints.length}개 point` : "노선을 선택하세요."}</p>
        </div>

        <div className="geometry-toolbar-grid">
          <button type="button" className="primary-action-button" disabled={!selectedBranch} onClick={saveSelectedBranch}>
            저장
          </button>
          <button type="button" className="secondary-action-button" disabled={!selectedBranch} onClick={resetSelectedBranch}>
            원본으로 되돌리기
          </button>
          <button
            type="button"
            className="danger-action-button"
            disabled={
              !selectedBranch ||
              selectedPointIndex === null ||
              selectedBranch.geometryPoints[selectedPointIndex]?.kind === "station"
            }
            onClick={deleteSelectedControlPoint}
          >
            선택 control 삭제
          </button>
        </div>

        <p className="geometry-help-text">
          노선선을 클릭하면 해당 위치 근처에 control point가 추가됩니다. 검은 점은 역 기준점이라 삭제할 수 없습니다.
        </p>
      </section>

      {message ? <div className={saveState === "error" ? "map-editor-toast error" : "map-editor-toast"}>{message}</div> : null}
      {mapError ? <div className="map-editor-error">{mapError}</div> : null}
    </div>
  );
}
