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
import { ChevronRight, Command, Layers3, MapPin, MousePointer2, Route, Search, Settings2, Waypoints, X } from "lucide-react";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type MapLayerMouseEvent, type StyleSpecification } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { EditorStation, ManualOverlayBundle, ManualStationOverride, ManualTransferGroup } from "../editorModel";
import { normalizeSearchText } from "../editorModel";
import type { EditorMapBranch, UnifiedEditorData } from "../editorData";

type Selection =
  | { type: "none" }
  | { type: "station"; id: string }
  | { type: "branch"; id: string }
  | { type: "transferGroup"; id: string }
  | { type: "multiStation"; ids: string[] };

type SidebarTab = "search" | "layers" | "transfers" | "geometry" | "validation" | "history";
type ToolMode = "move" | "select" | "box" | "geometry";
type IconComponent = ComponentType<{ className?: string }>;
type LngLatTuple = [number, number];

type ContextMenuState = {
  x: number;
  y: number;
  stationId?: string;
  branchId?: string;
} | null;

const defaultLayers = { stations: true, lines: true, labels: true, nonTransfer: true };

const layerOptions: Array<{ key: keyof typeof defaultLayers; label: string; Icon: IconComponent }> = [
  { key: "lines", label: "노선선", Icon: Layers3 },
  { key: "stations", label: "역 아이콘", Icon: MapPin },
  { key: "labels", label: "역명 라벨", Icon: Settings2 },
  { key: "nonTransfer", label: "미환승역 상태", Icon: Waypoints },
];

const toolOptions: Array<{ mode: ToolMode; label: string; Icon: IconComponent }> = [
  { mode: "move", label: "이동", Icon: MousePointer2 },
  { mode: "select", label: "선택", Icon: MapPin },
  { mode: "box", label: "박스", Icon: Waypoints },
  { mode: "geometry", label: "선형", Icon: Route },
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

function isValidStation(station: EditorStation): station is EditorStation & { lat: number; lng: number } {
  return Number.isFinite(station.lat) && Number.isFinite(station.lng);
}

function catmullRomPoint(p0: LngLatTuple, p1: LngLatTuple, p2: LngLatTuple, p3: LngLatTuple, t: number): LngLatTuple {
  const [p0Lng, p0Lat] = p0;
  const [p1Lng, p1Lat] = p1;
  const [p2Lng, p2Lat] = p2;
  const [p3Lng, p3Lat] = p3;
  const t2 = t * t;
  const t3 = t2 * t;

  return [
    0.5 * (2 * p1Lng + (-p0Lng + p2Lng) * t + (2 * p0Lng - 5 * p1Lng + 4 * p2Lng - p3Lng) * t2 + (-p0Lng + 3 * p1Lng - 3 * p2Lng + p3Lng) * t3),
    0.5 * (2 * p1Lat + (-p0Lat + p2Lat) * t + (2 * p0Lat - 5 * p1Lat + 4 * p2Lat - p3Lat) * t2 + (-p0Lat + 3 * p1Lat - 3 * p2Lat + p3Lat) * t3),
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
    for (let step = 1; step <= samplesPerSegment; step += 1) result.push(catmullRomPoint(p0, p1, p2, p3, step / samplesPerSegment));
  }

  return result;
}

function branchCoordinates(branch: EditorMapBranch): LngLatTuple[] {
  const override = (branch.geometryOverrideCoordinates ?? [])
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)) as LngLatTuple[];
  if (override.length >= 2) return override;

  return branch.routeStops
    .map((stop) => stop.station)
    .filter((station): station is EditorStation & { lat: number; lng: number } => station !== null && isValidStation(station))
    .map((station) => [station.lng, station.lat] as LngLatTuple);
}

function buildBranchFeatures(branches: EditorMapBranch[], selectedBranchId: string | null, visible: boolean) {
  return {
    type: "FeatureCollection" as const,
    features: visible
      ? branches
          .map((branch) => {
            const coordinates = branchCoordinates(branch);
            if (coordinates.length < 2) return null;
            return {
              type: "Feature" as const,
              properties: {
                id: branch.id,
                colorHex: branch.colorHex,
                selected: branch.id === selectedBranchId,
                nameKo: branch.canonicalLineNameKo,
              },
              geometry: { type: "LineString" as const, coordinates: smoothCoordinates(coordinates) },
            };
          })
          .filter((feature): feature is NonNullable<typeof feature> => feature !== null)
      : [],
  };
}

function buildStationFeatures(stations: EditorStation[], selectedIds: Set<string>, nonTransferIds: Set<string>, visible: boolean, showNonTransferState: boolean) {
  return {
    type: "FeatureCollection" as const,
    features: visible
      ? stations.filter(isValidStation).map((station) => {
          const selected = selectedIds.has(station.id);
          const nonTransfer = nonTransferIds.has(station.id);
          return {
            type: "Feature" as const,
            properties: {
              id: station.id,
              nameKo: station.nameKo,
              lineNameKo: station.lineNameKo,
              stationNumber: station.stationNumber,
              colorHex: station.colorHex ?? "#64748b",
              selected,
              nonTransfer: showNonTransferState && nonTransfer,
            },
            geometry: { type: "Point" as const, coordinates: [station.lng, station.lat] as LngLatTuple },
          };
        })
      : [],
  };
}

function formatStationSubLabel(station: EditorStation) {
  return `${station.lineNameKo} · ${station.stationNumber}`;
}

function selectionLabel(selection: Selection) {
  if (selection.type === "none") return "선택 없음";
  if (selection.type === "multiStation") return `${selection.ids.length}개 역 선택`;
  if (selection.type === "station") return "역";
  if (selection.type === "branch") return "노선/분기";
  return "환승 그룹";
}

function emptyStationOverride(station: EditorStation, previous?: ManualStationOverride): ManualStationOverride {
  return {
    stationId: station.id,
    nameKo: previous?.nameKo ?? station.nameKo,
    lat: previous?.lat ?? station.lat,
    lng: previous?.lng ?? station.lng,
    enabled: previous?.enabled ?? true,
    note: previous?.note ?? null,
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

export default function UnifiedMapEditor({ data }: { data: UnifiedEditorData }) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selectionBoxStartRef = useRef<{ x: number; y: number } | null>(null);
  const [overlays, setOverlays] = useState(data.overlays);
  const [selection, setSelection] = useState<Selection>({ type: "none" });
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("search");
  const [toolMode, setToolMode] = useState<ToolMode>("move");
  const [query, setQuery] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [toast, setToast] = useState<{ message: string | null; tone: ToastTone }>({ message: null, tone: "info" });
  const [stationDraft, setStationDraft] = useState<ManualStationOverride | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [layers, setLayers] = useState(defaultLayers);
  const [zoom, setZoom] = useState(7);
  const [cursorLngLat, setCursorLngLat] = useState<{ lng: number; lat: number } | null>(null);

  const stationById = useMemo(() => new Map(data.stations.map((station) => [station.id, station])), [data.stations]);
  const branchById = useMemo(() => new Map(data.branches.map((branch) => [branch.id, branch])), [data.branches]);
  const groupById = useMemo(() => new Map(overlays.manualTransferGroups.map((group) => [group.id, group])), [overlays.manualTransferGroups]);
  const selectedStationIds = useMemo(() => {
    if (selection.type === "station") return new Set([selection.id]);
    if (selection.type === "multiStation") return new Set(selection.ids);
    if (selection.type === "transferGroup") return new Set(groupById.get(selection.id)?.stationIds ?? []);
    return new Set<string>();
  }, [groupById, selection]);
  const selectedBranchId = selection.type === "branch" ? selection.id : null;
  const nonTransferIds = useMemo(() => new Set(overlays.nonTransferStationIds), [overlays.nonTransferStationIds]);
  const stationFeatures = useMemo(() => buildStationFeatures(data.stations, selectedStationIds, nonTransferIds, layers.stations, layers.nonTransfer), [data.stations, layers.nonTransfer, layers.stations, nonTransferIds, selectedStationIds]);
  const branchFeatures = useMemo(() => buildBranchFeatures(data.branches, selectedBranchId, layers.lines), [data.branches, layers.lines, selectedBranchId]);

  const filteredStations = useMemo(() => {
    const normalized = normalizeSearchText(query);
    if (!normalized) return data.stations.slice(0, 60);
    return data.stations
      .filter((station) => normalizeSearchText(`${station.nameKo} ${station.lineNameKo} ${station.stationNumber}`).includes(normalized))
      .slice(0, 80);
  }, [data.stations, query]);

  const commandResults = useMemo(() => {
    const normalized = normalizeSearchText(commandQuery);
    const stations = data.stations
      .filter((station) => !normalized || normalizeSearchText(`${station.nameKo} ${station.lineNameKo} ${station.stationNumber}`).includes(normalized))
      .slice(0, 8)
      .map((station) => ({ type: "station" as const, id: station.id, title: station.nameKo, subtitle: formatStationSubLabel(station) }));
    const branches = data.branches
      .filter((branch) => !normalized || normalizeSearchText(`${branch.canonicalLineNameKo} ${branch.sourceLineName} ${branch.sourceLineNumber}`).includes(normalized))
      .slice(0, 6)
      .map((branch) => ({ type: "branch" as const, id: branch.id, title: branch.canonicalLineNameKo, subtitle: branch.sourceLineName }));
    const groups = overlays.manualTransferGroups
      .filter((group) => !normalized || normalizeSearchText(group.nameKo).includes(normalized))
      .slice(0, 6)
      .map((group) => ({ type: "transferGroup" as const, id: group.id, title: group.nameKo, subtitle: `${group.stationIds.length}개 역` }));
    return [...stations, ...branches, ...groups];
  }, [commandQuery, data.branches, data.stations, overlays.manualTransferGroups]);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast({ message: null, tone: "info" }), 1800);
  }, []);

  const focusStation = useCallback((stationId: string) => {
    const station = stationById.get(stationId);
    if (!station || !isValidStation(station)) return;
    mapRef.current?.flyTo({ center: [station.lng, station.lat], zoom: Math.max(mapRef.current.getZoom(), 13), duration: 500 });
  }, [stationById]);

  const selectStation = useCallback((stationId: string, shouldFocus = true) => {
    setSelection({ type: "station", id: stationId });
    const station = stationById.get(stationId);
    const previous = overlays.stationOverrides.find((override) => override.stationId === stationId);
    if (station) setStationDraft(emptyStationOverride(station, previous));
    if (shouldFocus) focusStation(stationId);
  }, [focusStation, overlays.stationOverrides, stationById]);

  const selectBranch = useCallback((branchId: string) => {
    setSelection({ type: "branch", id: branchId });
    setStationDraft(null);
  }, []);

  const selectTransferGroup = useCallback((groupId: string) => {
    setSelection({ type: "transferGroup", id: groupId });
    setStationDraft(null);
    const firstStationId = groupById.get(groupId)?.stationIds[0];
    if (firstStationId) focusStation(firstStationId);
  }, [focusStation, groupById]);

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
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(mapContainerRef.current);
    window.requestAnimationFrame(() => map.resize());
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      map.resize();
      map.addSource("railmap-branches", { type: "geojson", data: branchFeatures });
      map.addSource("railmap-stations", { type: "geojson", data: stationFeatures });

      map.addLayer({
        id: "railmap-branches-line",
        type: "line",
        source: "railmap-branches",
        paint: {
          "line-color": ["get", "colorHex"],
          "line-width": ["case", ["boolean", ["get", "selected"], false], 7, 3],
          "line-opacity": ["case", ["boolean", ["get", "selected"], false], 0.95, 0.72],
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });

      map.addLayer({
        id: "railmap-stations-circle",
        type: "circle",
        source: "railmap-stations",
        paint: {
          "circle-color": ["get", "colorHex"],
          "circle-radius": ["case", ["boolean", ["get", "selected"], false], 7, 4.5],
          "circle-stroke-color": ["case", ["boolean", ["get", "selected"], false], "#111827", "#ffffff"],
          "circle-stroke-width": ["case", ["boolean", ["get", "selected"], false], 3, 1.5],
          "circle-opacity": ["case", ["boolean", ["get", "nonTransfer"], false], 0.25, 0.94],
        },
      });

      map.addLayer({
        id: "railmap-stations-label",
        type: "symbol",
        source: "railmap-stations",
        minzoom: 11,
        layout: {
          "text-field": ["get", "nameKo"],
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
          "text-opacity": ["case", ["boolean", ["get", "selected"], false], 1, ["case", ["boolean", ["get", "nonTransfer"], false], 0.35, 0.92]],
        },
      });

      map.addLayer({
        id: "railmap-selected-stations-label",
        type: "symbol",
        source: "railmap-stations",
        filter: ["==", ["get", "selected"], true],
        layout: {
          "text-field": ["get", "nameKo"],
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
    });

    map.on("mousemove", (event) => setCursorLngLat({ lng: event.lngLat.lng, lat: event.lngLat.lat }));
    map.on("zoom", () => setZoom(map.getZoom()));

    map.on("click", "railmap-stations-circle", (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const stationId = feature?.properties?.id as string | undefined;
      if (stationId) selectStation(stationId, false);
    });

    map.on("click", "railmap-branches-line", (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const branchId = feature?.properties?.id as string | undefined;
      if (branchId) selectBranch(branchId);
    });

    map.on("contextmenu", (event) => {
      event.preventDefault();
      const features = map.queryRenderedFeatures(event.point, { layers: ["railmap-stations-circle", "railmap-branches-line"] });
      const feature = features[0];
      setContextMenu({
        x: event.point.x,
        y: event.point.y,
        stationId: feature?.layer.id === "railmap-stations-circle" ? feature.properties?.id : undefined,
        branchId: feature?.layer.id === "railmap-branches-line" ? feature.properties?.id : undefined,
      });
    });

    map.on("mousedown", (event) => {
      const original = event.originalEvent as MouseEvent;
      if (!(original.metaKey || original.ctrlKey) && toolMode !== "box") return;
      original.preventDefault();
      map.dragPan.disable();
      selectionBoxStartRef.current = { x: event.point.x, y: event.point.y };
      setSelectionBox({ left: event.point.x, top: event.point.y, width: 0, height: 0 });
    });

    map.on("mousemove", (event) => {
      const start = selectionBoxStartRef.current;
      if (!start) return;
      const left = Math.min(start.x, event.point.x);
      const top = Math.min(start.y, event.point.y);
      setSelectionBox({ left, top, width: Math.abs(event.point.x - start.x), height: Math.abs(event.point.y - start.y) });
    });

    map.on("mouseup", (event) => {
      const start = selectionBoxStartRef.current;
      if (!start) return;
      const box = [
        [Math.min(start.x, event.point.x), Math.min(start.y, event.point.y)],
        [Math.max(start.x, event.point.x), Math.max(start.y, event.point.y)],
      ] as [[number, number], [number, number]];
      const selected = map.queryRenderedFeatures(box, { layers: ["railmap-stations-circle"] })
        .map((feature) => feature.properties?.id as string | undefined)
        .filter((id): id is string => Boolean(id));
      const ids = [...new Set(selected)];
      if (ids.length === 1) selectStation(ids[0] ?? "", false);
      if (ids.length > 1) setSelection({ type: "multiStation", ids });
      selectionBoxStartRef.current = null;
      setSelectionBox(null);
      map.dragPan.enable();
    });

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource("railmap-stations") as GeoJSONSource | undefined)?.setData(stationFeatures);
  }, [stationFeatures]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource("railmap-branches") as GeoJSONSource | undefined)?.setData(branchFeatures);
  }, [branchFeatures]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    const visibility = layers.labels ? "visible" : "none";
    if (map.getLayer("railmap-stations-label")) map.setLayoutProperty("railmap-stations-label", "visibility", visibility);
    if (map.getLayer("railmap-selected-stations-label")) map.setLayoutProperty("railmap-selected-stations-label", "visibility", visibility);
  }, [layers.labels]);

  async function persist(next: ManualOverlayBundle, message: string) {
    try {
      const saved = await saveOverlays(next);
      setOverlays(saved);
      showToast(message, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "저장 실패", "error");
    }
  }

  async function saveStationDraft() {
    if (!stationDraft) return;
    const next: ManualOverlayBundle = {
      ...overlays,
      stationOverrides: [
        ...overlays.stationOverrides.filter((override) => override.stationId !== stationDraft.stationId),
        stationDraft,
      ],
    };
    await persist(next, "역 보정 저장 완료");
  }

  async function setStationsNonTransfer(ids: string[], enabled: boolean) {
    const nextSet = new Set(overlays.nonTransferStationIds);
    for (const id of ids) {
      if (enabled) nextSet.add(id);
      else nextSet.delete(id);
    }
    await persist({ ...overlays, nonTransferStationIds: [...nextSet] }, enabled ? "미환승역 설정 완료" : "환승 가능역 설정 완료");
    if (selection.type === "multiStation") setSelection({ type: "none" });
  }

  const selectedStation = selection.type === "station" ? stationById.get(selection.id) ?? null : null;
  const selectedBranch = selection.type === "branch" ? branchById.get(selection.id) ?? null : null;
  const selectedGroup = selection.type === "transferGroup" ? groupById.get(selection.id) ?? null : null;
  const multiStationIds = selection.type === "multiStation" ? selection.ids : [];

  return (
    <AppShell>
      <InspectorGrid>
        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <PanelHeader>
            <div className="flex items-center justify-between gap-2.5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Railmap</p>
                <h1 className="mt-1 text-xs font-semibold tracking-[-0.03em]">통합 맵 에디터</h1>
              </div>
              <Button size="icon" variant="outline" onClick={() => setCommandOpen(true)} aria-label="명령 팔레트 열기">
                <Command className="size-4" />
              </Button>
            </div>
            <TabList className="mt-2 grid grid-cols-3">
              <TabButton active={sidebarTab === "search"} onClick={() => setSidebarTab("search")}>검색</TabButton>
              <TabButton active={sidebarTab === "layers"} onClick={() => setSidebarTab("layers")}>레이어</TabButton>
              <TabButton active={sidebarTab === "transfers"} onClick={() => setSidebarTab("transfers")}>환승</TabButton>
            </TabList>
            <TabList className="mt-2 grid grid-cols-3">
              <TabButton active={sidebarTab === "geometry"} onClick={() => setSidebarTab("geometry")}>선형</TabButton>
              <TabButton active={sidebarTab === "validation"} onClick={() => setSidebarTab("validation")}>검증</TabButton>
              <TabButton active={sidebarTab === "history"} onClick={() => setSidebarTab("history")}>기록</TabButton>
            </TabList>
          </PanelHeader>

          <PanelBody className="min-h-0 flex-1 overflow-y-auto">
            {sidebarTab === "search" ? (
              <div className="grid gap-2.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input className="pl-9" placeholder="역명, 노선명, 역번호 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
                </div>
                <div className="grid gap-2">
                  {filteredStations.map((station) => (
                    <button
                      key={station.id}
                      type="button"
                      className={cn(
                        "rounded-xl border border-slate-200 bg-white p-2.5 text-left transition hover:border-blue-200 hover:bg-blue-50",
                        selectedStationIds.has(station.id) ? "border-blue-300 bg-blue-50" : null,
                      )}
                      onClick={() => selectStation(station.id)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: station.colorHex ?? "#64748b" }} />
                        <strong className="truncate text-xs font-semibold">{station.nameKo}</strong>
                      </div>
                      <p className="mt-1 truncate text-xs font-normal text-slate-500">{formatStationSubLabel(station)}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {sidebarTab === "layers" ? (
              <div className="grid gap-2">
                {layerOptions.map(({ key, label, Icon }) => (
                  <label key={String(key)} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={layers[key]}
                      onChange={(event) => setLayers((previous) => ({ ...previous, [key]: event.target.checked }))}
                    />
                    <Icon className="size-4 text-slate-400" />
                    {label}
                  </label>
                ))}
              </div>
            ) : null}

            {sidebarTab === "transfers" ? (
              <div className="grid gap-2">
                {overlays.manualTransferGroups.map((group) => (
                  <button key={group.id} type="button" className="rounded-xl border border-slate-200 bg-white p-2.5 text-left hover:bg-blue-50" onClick={() => selectTransferGroup(group.id)}>
                    <strong className="text-xs font-semibold">{group.nameKo}</strong>
                    <p className="mt-1 text-xs font-normal text-slate-500">{group.stationIds.length}개 역 · {group.note || "메모 없음"}</p>
                  </button>
                ))}
              </div>
            ) : null}

            {sidebarTab === "geometry" ? (
              <div className="grid gap-2">
                {data.branches.slice(0, 200).map((branch) => (
                  <button key={branch.id} type="button" className="rounded-xl border border-slate-200 bg-white p-2.5 text-left hover:bg-blue-50" onClick={() => selectBranch(branch.id)}>
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-8 rounded-full" style={{ backgroundColor: branch.colorHex }} />
                      <strong className="truncate text-xs font-semibold">{branch.canonicalLineNameKo}</strong>
                    </div>
                    <p className="mt-1 truncate text-xs font-normal text-slate-500">{branch.sourceLineName} · {branch.routeStops.length} stops</p>
                  </button>
                ))}
              </div>
            ) : null}

            {sidebarTab === "validation" ? <Placeholder title="Validation" description="다음 단계에서 Validator 결과와 Inspector 이동을 연결합니다." /> : null}
            {sidebarTab === "history" ? <Placeholder title="History" description="다음 단계에서 autosave revision과 diff viewer를 연결합니다." /> : null}
          </PanelBody>
        </Panel>

        <main className="relative h-full min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div ref={mapContainerRef} className="absolute inset-0 h-full w-full" />
          <div className="pointer-events-none absolute left-3 top-2.5 flex flex-wrap gap-1.5">
            <Badge className="bg-white/90 text-slate-700">{selectionLabel(selection)}</Badge>
            <Badge className="bg-white/90 text-slate-700">Zoom {zoom.toFixed(1)}</Badge>
          </div>
          <div className="absolute left-1/2 top-2.5 flex -translate-x-1/2 gap-1 rounded-xl border border-slate-200 bg-white/95 p-0.5 shadow-md backdrop-blur">
            {toolOptions.map(({ mode, label, Icon }) => (
              <button
                key={mode}
                type="button"
                className={cn("flex items-center gap-1 rounded-xl px-2.5 py-2 text-xs font-semibold text-slate-500", toolMode === mode ? "bg-blue-600 text-white" : "hover:bg-slate-100")}
                onClick={() => setToolMode(mode)}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
          {selectionBox ? <div className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/15" style={selectionBox} /> : null}
          <div className="absolute bottom-2 right-2 rounded-xl border border-slate-200 bg-white/95 px-2 py-1.5 text-[11px] font-normal text-slate-600 shadow-md backdrop-blur">
            {cursorLngLat ? `${cursorLngLat.lng.toFixed(6)}, ${cursorLngLat.lat.toFixed(6)}` : "좌표 없음"}
          </div>
          {contextMenu ? (
            <ContextMenu
              state={contextMenu}
              stationById={stationById}
              branchById={branchById}
              onClose={() => setContextMenu(null)}
              onSelectStation={(id) => { selectStation(id, false); setContextMenu(null); }}
              onSelectBranch={(id) => { selectBranch(id); setContextMenu(null); }}
              onSetNonTransfer={(id, enabled) => { void setStationsNonTransfer([id], enabled); setContextMenu(null); }}
            />
          ) : null}
        </main>

        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <PanelHeader>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Inspector</p>
            <h2 className="mt-1 text-xs font-semibold tracking-[-0.03em]">{selectionLabel(selection)}</h2>
          </PanelHeader>
          <PanelBody className="min-h-0 flex-1 overflow-y-auto">
            {selectedStation && stationDraft ? (
              <StationInspector
                station={selectedStation}
                draft={stationDraft}
                nonTransfer={nonTransferIds.has(selectedStation.id)}
                onChange={setStationDraft}
                onSave={() => void saveStationDraft()}
                onSetNonTransfer={(enabled) => void setStationsNonTransfer([selectedStation.id], enabled)}
              />
            ) : null}
            {selectedBranch ? <BranchInspector branch={selectedBranch} /> : null}
            {selectedGroup ? <TransferGroupInspector group={selectedGroup} stationById={stationById} /> : null}
            {multiStationIds.length > 0 ? <MultiStationInspector ids={multiStationIds} stationById={stationById} onSetNonTransfer={(enabled) => void setStationsNonTransfer(multiStationIds, enabled)} /> : null}
            {selection.type === "none" ? <Placeholder title="객체를 선택하세요" description="지도에서 역/노선선을 클릭하거나 Cmd/Ctrl+K로 검색하세요." /> : null}
          </PanelBody>
        </Panel>
      </InspectorGrid>

      <Dialog open={commandOpen} className="max-w-xl">
        <div className="border-b border-slate-200 p-2.5">
          <div className="flex items-center gap-2.5">
            <Command className="size-5 text-slate-400" />
            <Input autoFocus placeholder="역, 노선, 환승 그룹 검색" value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} />
            <Button variant="ghost" size="icon" onClick={() => setCommandOpen(false)}><X className="size-4" /></Button>
          </div>
        </div>
        <div className="max-h-[52dvh] overflow-y-auto p-2">
          {commandResults.map((item) => (
            <button
              key={`${item.type}:${item.id}`}
              type="button"
              className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left hover:bg-blue-50"
              onClick={() => {
                if (item.type === "station") selectStation(item.id);
                if (item.type === "branch") selectBranch(item.id);
                if (item.type === "transferGroup") selectTransferGroup(item.id);
                setCommandOpen(false);
              }}
            >
              <span>
                <strong className="block text-xs font-semibold">{item.title}</strong>
                <span className="text-xs font-normal text-slate-500">{item.subtitle}</span>
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

function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-2.5 text-center">
      <strong className="text-xs font-semibold text-slate-700">{title}</strong>
      <p className="mt-2 text-xs font-normal leading-5 text-slate-500">{description}</p>
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

function StationInspector({ station, draft, nonTransfer, onChange, onSave, onSetNonTransfer }: {
  station: EditorStation;
  draft: ManualStationOverride;
  nonTransfer: boolean;
  onChange: (next: ManualStationOverride) => void;
  onSave: () => void;
  onSetNonTransfer: (enabled: boolean) => void;
}) {
  return (
    <div className="grid gap-2.5">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
        <div className="flex items-center gap-2">
          <span className="size-3 rounded-full" style={{ backgroundColor: station.colorHex ?? "#64748b" }} />
          <strong className="text-xs font-semibold">{station.nameKo}</strong>
        </div>
        <p className="mt-1 text-xs font-normal text-slate-500">{formatStationSubLabel(station)}</p>
        <p className="mt-2 break-all text-[11px] font-normal text-slate-400">{station.id}</p>
      </div>
      <Field label="표시명 보정">
        <Input value={draft.nameKo ?? ""} onChange={(event) => onChange({ ...draft, nameKo: event.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="위도">
          <Input value={draft.lat ?? ""} onChange={(event) => onChange({ ...draft, lat: Number(event.target.value) })} />
        </Field>
        <Field label="경도">
          <Input value={draft.lng ?? ""} onChange={(event) => onChange({ ...draft, lng: Number(event.target.value) })} />
        </Field>
      </div>
      <Field label="메모">
        <Textarea value={draft.note ?? ""} onChange={(event) => onChange({ ...draft, note: event.target.value || null })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Button variant={nonTransfer ? "secondary" : "outline"} onClick={() => onSetNonTransfer(!nonTransfer)}>{nonTransfer ? "환승 가능역" : "미환승역"}</Button>
        <Button onClick={onSave}>저장</Button>
      </div>
    </div>
  );
}

function BranchInspector({ branch }: { branch: EditorMapBranch }) {
  return (
    <div className="grid gap-2.5">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
        <span className="block h-2 w-16 rounded-full" style={{ backgroundColor: branch.colorHex }} />
        <h3 className="mt-2 text-xs font-semibold">{branch.canonicalLineNameKo}</h3>
        <p className="mt-1 text-xs font-normal text-slate-500">{branch.sourceLineName} · {branch.role}</p>
      </div>
      <InfoRow label="Branch ID" value={branch.id} />
      <InfoRow label="기점" value={branch.origin ?? "-"} />
      <InfoRow label="종점" value={branch.terminal ?? "-"} />
      <InfoRow label="Route stops" value={`${branch.routeStops.length}개`} />
      <Button asChild variant="outline"><a href="/geometry/map">선형 보정 화면 열기</a></Button>
    </div>
  );
}

function TransferGroupInspector({ group, stationById }: { group: ManualTransferGroup; stationById: Map<string, EditorStation> }) {
  return (
    <div className="grid gap-2.5">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
        <h3 className="text-xs font-semibold">{group.nameKo}</h3>
        <p className="mt-1 text-xs font-normal text-slate-500">{group.stationIds.length}개 역 · {group.note || "메모 없음"}</p>
      </div>
      <div className="grid gap-2">
        {group.stationIds.map((stationId) => {
          const station = stationById.get(stationId);
          return <InfoRow key={stationId} label={station?.nameKo ?? stationId} value={station ? formatStationSubLabel(station) : "존재하지 않는 역"} />;
        })}
      </div>
      <Button asChild variant="outline"><a href="/transfers">환승 그룹 화면 열기</a></Button>
    </div>
  );
}

function MultiStationInspector({ ids, stationById, onSetNonTransfer }: { ids: string[]; stationById: Map<string, EditorStation>; onSetNonTransfer: (enabled: boolean) => void }) {
  return (
    <div className="grid gap-2.5">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
        <h3 className="text-xs font-semibold">{ids.length}개 역 선택</h3>
        <p className="mt-1 text-xs font-normal text-slate-500">선택한 역에 일괄 작업을 적용합니다.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => onSetNonTransfer(true)}>미환승역</Button>
        <Button variant="outline" onClick={() => onSetNonTransfer(false)}>환승 가능역</Button>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 p-2">
        {ids.map((id) => {
          const station = stationById.get(id);
          return <p key={id} className="rounded-xl px-2.5 py-2 text-xs font-normal text-slate-600">{station ? `${station.nameKo} · ${station.lineNameKo}` : id}</p>;
        })}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5">
      <p className="text-[11px] font-semibold text-slate-400">{label}</p>
      <p className="mt-1 break-all text-xs font-normal text-slate-700">{value}</p>
    </div>
  );
}

function ContextMenu({ state, stationById, branchById, onClose, onSelectStation, onSelectBranch, onSetNonTransfer }: {
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
    <div className="absolute z-40 min-w-48 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-2xl" style={{ left: state.x, top: state.y }}>
      {station ? (
        <>
          <button type="button" className="block w-full rounded-xl px-2.5 py-2 text-left text-xs font-semibold hover:bg-blue-50" onClick={() => onSelectStation(station.id)}>역 선택: {station.nameKo}</button>
          <button type="button" className="block w-full rounded-xl px-2.5 py-2 text-left text-xs font-semibold hover:bg-blue-50" onClick={() => onSetNonTransfer(station.id, true)}>미환승역으로 설정</button>
          <button type="button" className="block w-full rounded-xl px-2.5 py-2 text-left text-xs font-semibold hover:bg-blue-50" onClick={() => onSetNonTransfer(station.id, false)}>환승 가능역으로 설정</button>
        </>
      ) : null}
      {branch ? <button type="button" className="block w-full rounded-xl px-2.5 py-2 text-left text-xs font-semibold hover:bg-blue-50" onClick={() => onSelectBranch(branch.id)}>노선 선택: {branch.canonicalLineNameKo}</button> : null}
      {!station && !branch ? <p className="px-2.5 py-2 text-xs font-normal text-slate-400">선택 가능한 객체 없음</p> : null}
      <button type="button" className="block w-full rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-slate-500 hover:bg-slate-100" onClick={onClose}>닫기</button>
    </div>
  );
}
