"use client";

import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  makeTransferGroupId,
  makeTransferPairKey,
  type EditorStation,
  type ManualOverlayBundle,
  type ManualTransferGroup,
} from "../../editorModel";

export type TransferMapBranch = {
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
    station: EditorStation | null;
    confidence: string;
  }>;
};

type SaveState = "idle" | "saving" | "saved" | "error";
type LngLatTuple = [number, number];

type ValidEditorStation = EditorStation & {
  lat: number;
  lng: number;
};

const KOREA_MAX_BOUNDS: [[number, number], [number, number]] = [
  [121.4, 30.9],
  [134.3, 43.1],
];

function isValidCoordinate(
  station: EditorStation | null | undefined,
): station is ValidEditorStation {
  return (
    station !== null &&
    station !== undefined &&
    typeof station.lat === "number" &&
    typeof station.lng === "number" &&
    Number.isFinite(station.lat) &&
    Number.isFinite(station.lng)
  );
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

function buildBranchFeatures(branches: TransferMapBranch[]) {
  return {
    type: "FeatureCollection" as const,
    features: branches
      .map((branch) => {
        const overrideCoordinates = (branch.geometryOverrideCoordinates ?? [])
          .map((coordinate): LngLatTuple | null => {
            const [lng, lat] = coordinate;
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
            return [lng, lat];
          })
          .filter((coordinate): coordinate is LngLatTuple => coordinate !== null);
        const coordinates = overrideCoordinates.length >= 2
          ? overrideCoordinates
          : branch.routeStops
              .map((stop) => stop.station)
              .filter(isValidCoordinate)
              .map((station): LngLatTuple => [station.lng, station.lat]);

        if (coordinates.length < 2) return null;

        return {
          type: "Feature" as const,
          properties: {
            id: branch.id,
            colorHex: branch.colorHex,
          },
          geometry: {
            type: "LineString" as const,
            coordinates: smoothCoordinates(coordinates),
          },
        };
      })
      .filter(
        (feature): feature is NonNullable<typeof feature> => feature !== null,
      ),
  };
}

function buildStationFeatures(
  stations: ValidEditorStation[],
  selectedStationIdSet: Set<string>,
  nonTransferStationIdSet: Set<string>,
) {
  return {
    type: "FeatureCollection" as const,
    features: stations.map((station) => {
      const selected = selectedStationIdSet.has(station.id);
      const nonTransfer = nonTransferStationIdSet.has(station.id);
      return {
        type: "Feature" as const,
        properties: {
          id: station.id,
          nameKo: station.nameKo ?? "역",
          lineNameKo: station.lineNameKo ?? "",
          stationNumber: station.stationNumber ?? "",
          colorHex: station.colorHex ?? "#64748b",
          selected,
          nonTransfer,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [station.lng, station.lat] as LngLatTuple,
        },
      };
    }),
  };
}

function getStationBaseName(nameKo: string) {
  const withoutParentheses = nameKo.replace(/\([^)]*\)/g, "").trim();
  return withoutParentheses.endsWith("역")
    ? withoutParentheses.slice(0, -1)
    : withoutParentheses;
}

function getSuggestedGroupName(stations: EditorStation[]) {
  if (stations.length === 0) return "새 환승 그룹";
  const baseNames = [
    ...new Set(
      stations
        .map((station) => getStationBaseName(station.nameKo))
        .filter(Boolean),
    ),
  ];
  if (baseNames.length === 1) return `${baseNames[0]}역`;
  return baseNames
    .map((name) => `${name}${name.endsWith("역") ? "" : "역"}`)
    .join(" · ");
}

function createPairMinutes(
  stationIds: string[],
  previous: Record<string, number | null> = {},
) {
  const result: Record<string, number | null> = {};

  for (let row = 0; row < stationIds.length - 1; row += 1) {
    for (let column = row + 1; column < stationIds.length; column += 1) {
      const pairKey = makeTransferPairKey(
        stationIds[row] ?? "",
        stationIds[column] ?? "",
      );
      result[pairKey] = previous[pairKey] ?? null;
    }
  }

  return result;
}

function getHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function formatStationSubLabel(station: EditorStation) {
  return `${station.lineNameKo} · ${station.stationNumber}`;
}

function getMapErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "지도를 불러오지 못했습니다.";
}

function getFitPadding() {
  return { top: 72, right: 420, bottom: 72, left: 48 };
}

function PersistMessage({
  saveState,
  message,
}: {
  saveState: SaveState;
  message: string | null;
}) {
  if (!message) return null;

  return (
    <div
      className={
        saveState === "error" ? "map-editor-toast error" : "map-editor-toast"
      }
      role="status"
    >
      {message}
    </div>
  );
}

export default function ManualTransferMapEditor({
  stations,
  branches,
  initialOverlays,
}: {
  stations: EditorStation[];
  branches: TransferMapBranch[];
  initialOverlays: ManualOverlayBundle;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selectionBoxRef = useRef<HTMLDivElement | null>(null);
  const selectionDragRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const stationsRef = useRef<ValidEditorStation[]>([]);
  const nonTransferRef = useRef<Set<string>>(new Set());
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [groups, setGroups] = useState<ManualTransferGroup[]>(
    initialOverlays.manualTransferGroups ?? [],
  );
  const [nonTransferStationIds, setNonTransferStationIds] = useState<string[]>(
    initialOverlays.nonTransferStationIds ?? [],
  );
  const [selectedStationIds, setSelectedStationIds] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);

  const branchFeatures = useMemo(
    () => buildBranchFeatures(branches),
    [branches],
  );
  const validStations = useMemo(
    () => stations.filter(isValidCoordinate),
    [stations],
  );
  const stationById = useMemo(
    () => new Map(stations.map((station) => [station.id, station])),
    [stations],
  );
  const selectedStationIdSet = useMemo(
    () => new Set(selectedStationIds),
    [selectedStationIds],
  );
  const nonTransferStationIdSet = useMemo(
    () => new Set(nonTransferStationIds),
    [nonTransferStationIds],
  );
  const stationFeatures = useMemo(
    () =>
      buildStationFeatures(
        validStations,
        selectedStationIdSet,
        nonTransferStationIdSet,
      ),
    [nonTransferStationIdSet, selectedStationIdSet, validStations],
  );
  const stationFeaturesRef = useRef(stationFeatures);

  useEffect(() => {
    stationFeaturesRef.current = stationFeatures;
  }, [stationFeatures]);
  const selectedStations = selectedStationIds
    .map((stationId) => stationById.get(stationId))
    .filter((station): station is EditorStation => station !== undefined);
  const allSelectedAreTransferable =
    selectedStationIds.length > 0 &&
    selectedStationIds.every(
      (stationId) => !nonTransferStationIdSet.has(stationId),
    );

  useEffect(() => {
    stationsRef.current = validStations;
  }, [validStations]);

  useEffect(() => {
    nonTransferRef.current = nonTransferStationIdSet;
  }, [nonTransferStationIdSet]);

  useEffect(() => {
    selectedIdsRef.current = selectedStationIdSet;
  }, [selectedStationIdSet]);

  const persist = async (
    nextGroups: ManualTransferGroup[],
    nextNonTransferStationIds: string[],
    successMessage: string,
  ) => {
    const uniqueNonTransferStationIds = [
      ...new Set(nextNonTransferStationIds),
    ].filter(Boolean);
    setSaveState("saving");
    setMessage("저장 중입니다.");

    try {
      const response = await fetch("/api/manual-overlays", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...initialOverlays,
          schemaVersion: 1,
          manualTransferGroups: nextGroups,
          manualTransferEdges: [],
          nonTransferStationIds: uniqueNonTransferStationIds,
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const saved = (await response.json()) as ManualOverlayBundle;
      setGroups(saved.manualTransferGroups ?? []);
      setNonTransferStationIds(saved.nonTransferStationIds ?? []);
      setSaveState("saved");
      setMessage(successMessage);
      window.setTimeout(() => setMessage(null), 2200);
    } catch (error) {
      setSaveState("error");
      setMessage(
        error instanceof Error ? error.message : "저장에 실패했습니다.",
      );
    }
  };

  useEffect(() => {
    if (mapRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    let resizeTimer: number | null = null;

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
              paint: { "background-color": "#eef3f8" },
            },
            {
              id: "osm",
              type: "raster",
              source: "osm",
              paint: { "raster-opacity": 0.82 },
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
        map.addSource("manual-map-lines", {
          type: "geojson",
          data: branchFeatures,
        });

        map.addLayer({
          id: "manual-map-lines-casing",
          type: "line",
          source: "manual-map-lines",
          paint: {
            "line-color": "#ffffff",
            "line-width": 3.8,
            "line-opacity": 0.88,
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });

        map.addLayer({
          id: "manual-map-lines",
          type: "line",
          source: "manual-map-lines",
          paint: {
            "line-color": ["coalesce", ["get", "colorHex"], "#0284c7"],
            "line-width": 2.2,
            "line-opacity": 0.78,
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });

        map.addSource("manual-map-stations", {
          type: "geojson",
          data: stationFeaturesRef.current,
        });

        map.addLayer({
          id: "manual-map-stations-casing",
          type: "circle",
          source: "manual-map-stations",
          paint: {
            "circle-color": "#ffffff",
            "circle-radius": [
              "case",
              ["==", ["get", "selected"], true],
              7.6,
              5.8,
            ],
            "circle-opacity": [
              "case",
              ["==", ["get", "nonTransfer"], true],
              0.34,
              0.96,
            ],
          },
        });

        map.addLayer({
          id: "manual-map-stations-dot",
          type: "circle",
          source: "manual-map-stations",
          paint: {
            "circle-color": ["coalesce", ["get", "colorHex"], "#64748b"],
            "circle-radius": [
              "case",
              ["==", ["get", "selected"], true],
              5.4,
              3.9,
            ],
            "circle-stroke-color": [
              "case",
              ["==", ["get", "selected"], true],
              "#111827",
              "#ffffff",
            ],
            "circle-stroke-width": [
              "case",
              ["==", ["get", "selected"], true],
              2.2,
              1.2,
            ],
            "circle-opacity": [
              "case",
              ["==", ["get", "nonTransfer"], true],
              0.28,
              0.96,
            ],
          },
        });

        map.addLayer({
          id: "manual-map-station-labels",
          type: "symbol",
          source: "manual-map-stations",
          minzoom: 12,
          layout: {
            "text-field": ["get", "nameKo"],
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
              "case",
              ["==", ["get", "nonTransfer"], true],
              0.42,
              1,
            ],
          },
        });

        map.addLayer({
          id: "manual-map-station-labels-selected",
          type: "symbol",
          source: "manual-map-stations",
          filter: ["==", ["get", "selected"], true],
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

        map.on("mouseenter", "manual-map-stations-dot", () => {
          map.getCanvas().style.cursor = "pointer";
        });

        map.on("mouseleave", "manual-map-stations-dot", () => {
          map.getCanvas().style.cursor = "";
        });

        map.on("click", "manual-map-stations-dot", (event) => {
          const feature = event.features?.[0];
          const props = feature?.properties as
            Record<string, unknown> | undefined;
          const stationId = String(props?.id ?? "");
          if (!stationId) return;

          setSelectedStationIds((previous) => {
            if (previous.includes(stationId))
              return previous.filter((id) => id !== stationId);
            return [...previous, stationId];
          });
        });

        if (stationsRef.current.length > 0) {
          const bounds = new maplibregl.LngLatBounds();
          for (const station of stationsRef.current)
            bounds.extend([station.lng, station.lat]);
          map.fitBounds(bounds, {
            padding: getFitPadding(),
            maxZoom: 10.5,
            duration: 180,
          });
        }

        map.resize();
        resizeTimer = window.setTimeout(() => map.resize(), 80);
      });

      map.on("mousedown", (event) => {
        const originalEvent = event.originalEvent;
        if (!(originalEvent.ctrlKey || originalEvent.metaKey)) return;
        originalEvent.preventDefault();
        map.dragPan.disable();

        selectionDragRef.current = {
          startX: event.point.x,
          startY: event.point.y,
          active: true,
        };

        if (selectionBoxRef.current) {
          selectionBoxRef.current.style.display = "block";
          selectionBoxRef.current.style.left = `${event.point.x}px`;
          selectionBoxRef.current.style.top = `${event.point.y}px`;
          selectionBoxRef.current.style.width = "0px";
          selectionBoxRef.current.style.height = "0px";
        }
      });

      map.on("mousemove", (event) => {
        const drag = selectionDragRef.current;
        if (!drag?.active || !selectionBoxRef.current) return;

        const left = Math.min(drag.startX, event.point.x);
        const top = Math.min(drag.startY, event.point.y);
        const width = Math.abs(event.point.x - drag.startX);
        const height = Math.abs(event.point.y - drag.startY);

        selectionBoxRef.current.style.left = `${left}px`;
        selectionBoxRef.current.style.top = `${top}px`;
        selectionBoxRef.current.style.width = `${width}px`;
        selectionBoxRef.current.style.height = `${height}px`;
      });

      map.on("mouseup", (event) => {
        const drag = selectionDragRef.current;
        if (!drag?.active) return;

        selectionDragRef.current = null;
        map.dragPan.enable();
        if (selectionBoxRef.current)
          selectionBoxRef.current.style.display = "none";

        const left = Math.min(drag.startX, event.point.x);
        const right = Math.max(drag.startX, event.point.x);
        const top = Math.min(drag.startY, event.point.y);
        const bottom = Math.max(drag.startY, event.point.y);

        if (Math.abs(right - left) < 6 || Math.abs(bottom - top) < 6) return;

        const selected = stationsRef.current.filter((station) => {
          const point = map.project([station.lng, station.lat]);
          return (
            point.x >= left &&
            point.x <= right &&
            point.y >= top &&
            point.y <= bottom
          );
        });

        const selectedIds = selected.map((station) => station.id);
        setSelectedStationIds((previous) => [
          ...new Set([...previous, ...selectedIds]),
        ]);
      });
    } catch (error) {
      setMapError(getMapErrorMessage(error));
    }

    return () => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [branchFeatures]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource("manual-map-lines") as
      GeoJSONSource | undefined;
    source?.setData(branchFeatures);
  }, [branchFeatures, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource("manual-map-stations") as
      GeoJSONSource | undefined;
    source?.setData(stationFeatures);
  }, [mapReady, stationFeatures]);

  const setSelectedAsNonTransfer = async () => {
    if (selectedStationIds.length === 0) return;
    const nextNonTransferStationIds = [
      ...new Set([...nonTransferStationIds, ...selectedStationIds]),
    ];
    await persist(
      groups,
      nextNonTransferStationIds,
      `${selectedStationIds.length}개 역을 미환승역으로 설정했습니다.`,
    );
  };

  const setSelectedAsTransferable = async () => {
    if (selectedStationIds.length === 0) return;
    const selectedSet = new Set(selectedStationIds);
    const nextNonTransferStationIds = nonTransferStationIds.filter(
      (stationId) => !selectedSet.has(stationId),
    );
    await persist(
      groups,
      nextNonTransferStationIds,
      `${selectedStationIds.length}개 역을 환승 가능역으로 설정했습니다.`,
    );
  };

  const saveGroup = async (group: ManualTransferGroup) => {
    const nextGroups = [
      group,
      ...groups.filter((item) => item.id !== group.id),
    ];
    await persist(
      nextGroups,
      nonTransferStationIds,
      "수동 환승 그룹을 저장했습니다.",
    );
    setGroupModalOpen(false);
    setSelectedStationIds([]);
  };

  return (
    <div className="manual-map-editor-shell">
      <div ref={containerRef} className="manual-map-canvas" />
      <div ref={selectionBoxRef} className="map-selection-box" />

      <header className="map-editor-header-panel">
        <a href="/" className="compact-back-link">
          ← 홈
        </a>
        <div>
          <p className="eyebrow">Transfer Map Editor</p>
          <h1>수동 환승 그룹 맵 에디터</h1>
        </div>
        <span className="helper-pill">{groups.length}개 그룹</span>
      </header>

      <aside className="map-editor-selection-panel">
        <div className="section-title-row compact-section-title">
          <div>
            <p className="eyebrow">Selection</p>
            <h2>{selectedStationIds.length}개 역 선택됨</h2>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setSelectedStationIds([])}
          >
            해제
          </button>
        </div>

        <p className="map-editor-help">
          Windows는 <strong>Ctrl</strong>, Mac은 <strong>Cmd</strong>를 누른
          상태로 드래그하면 영역 안의 역을 선택합니다. 역 점을 직접 클릭해도
          선택/해제됩니다.
        </p>

        <div className="map-editor-selected-list fixed-inner-scroll">
          {selectedStations.length === 0 ? (
            <p className="empty-box compact-empty">선택된 역이 없습니다.</p>
          ) : null}
          {selectedStations.map((station) => {
            const nonTransfer = nonTransferStationIdSet.has(station.id);
            return (
              <div
                key={station.id}
                className={
                  nonTransfer
                    ? "selected-station-card compact-selected-station-card map-selected-card non-transfer"
                    : "selected-station-card compact-selected-station-card map-selected-card"
                }
              >
                <span
                  className="station-order"
                  style={
                    station.colorHex
                      ? ({ backgroundColor: station.colorHex } as CSSProperties)
                      : undefined
                  }
                />
                <div className="selected-station-main">
                  <strong>{station.nameKo}</strong>
                  <span>
                    {formatStationSubLabel(station)}
                    {nonTransfer ? " · 미환승역" : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() =>
                    setSelectedStationIds((previous) =>
                      previous.filter((id) => id !== station.id),
                    )
                  }
                >
                  삭제
                </button>
              </div>
            );
          })}
        </div>

        <div className="map-editor-action-grid">
          <button
            type="button"
            className="secondary-button"
            disabled={selectedStationIds.length === 0 || saveState === "saving"}
            onClick={() => void setSelectedAsNonTransfer()}
          >
            미환승역으로 설정
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={selectedStationIds.length === 0 || saveState === "saving"}
            onClick={() => void setSelectedAsTransferable()}
          >
            환승 가능역으로 설정
          </button>
          <button
            type="button"
            className="primary-button map-editor-wide-action"
            disabled={
              !allSelectedAreTransferable ||
              selectedStationIds.length < 2 ||
              saveState === "saving"
            }
            onClick={() => setGroupModalOpen(true)}
          >
            환승 그룹 생성
          </button>
        </div>

        {!allSelectedAreTransferable && selectedStationIds.length > 0 ? (
          <p className="map-editor-warning">
            미환승역이 포함되어 있어 환승 그룹을 만들 수 없습니다.
          </p>
        ) : null}
      </aside>

      <PersistMessage saveState={saveState} message={message} />

      {mapError ? (
        <div className="map-editor-error-panel">
          <strong>지도 표시 오류</strong>
          <span>{mapError}</span>
        </div>
      ) : null}

      {!mapReady && !mapError ? (
        <div className="map-editor-loading">지도를 불러오는 중입니다.</div>
      ) : null}

      {groupModalOpen ? (
        <TransferGroupMapModal
          stations={selectedStations}
          onCancel={() => setGroupModalOpen(false)}
          onSave={(group) => void saveGroup(group)}
          saving={saveState === "saving"}
        />
      ) : null}
    </div>
  );
}

function TransferGroupMapModal({
  stations,
  onCancel,
  onSave,
  saving,
}: {
  stations: EditorStation[];
  onCancel: () => void;
  onSave: (group: ManualTransferGroup) => void;
  saving: boolean;
}) {
  const suggestedGroupName = useMemo(
    () => getSuggestedGroupName(stations),
    [stations],
  );
  const stationIds = useMemo(
    () => stations.map((station) => station.id),
    [stations],
  );
  const [groupName, setGroupName] = useState(suggestedGroupName);
  const [note, setNote] = useState("");
  const [pairMinutes, setPairMinutes] = useState<Record<string, number | null>>(
    () => createPairMinutes(stationIds),
  );

  useEffect(() => {
    setGroupName(suggestedGroupName);
    setPairMinutes(createPairMinutes(stationIds));
  }, [stationIds, suggestedGroupName]);

  const updatePairMinutes = (pairKey: string, value: string) => {
    setPairMinutes((previous) => ({
      ...previous,
      [pairKey]:
        value.trim() === ""
          ? null
          : Math.max(0, Math.round(Number(value) || 0)),
    }));
  };

  const handleSave = () => {
    const nameKo = groupName.trim() || suggestedGroupName;
    onSave({
      id: makeTransferGroupId(nameKo, stationIds),
      nameKo,
      stationIds,
      transferMinutesByPair: createPairMinutes(stationIds, pairMinutes),
      enabled: true,
      source: "editor",
      note: note.trim() || null,
    });
  };

  return (
    <div className="map-group-modal-backdrop" role="dialog" aria-modal="true">
      <section className="map-group-modal-dialog">
        <header className="map-picker-header">
          <div>
            <p className="eyebrow">New Transfer Group</p>
            <h2>선택한 역으로 환승 그룹 생성</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onCancel}>
            닫기
          </button>
        </header>

        <div className="map-group-modal-body fixed-inner-scroll">
          <div className="group-form-grid compact-form-grid">
            <label className="input-label">
              그룹 이름
              <div className="group-name-row">
                <input
                  className="text-input"
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                />
                <button
                  type="button"
                  className="inline-soft-button"
                  onClick={() => setGroupName(suggestedGroupName)}
                >
                  자동
                </button>
              </div>
              <span className="input-hint">
                추천 이름: {suggestedGroupName}
              </span>
            </label>
            <label className="input-label">
              메모
              <input
                className="text-input"
                placeholder="검증 근거 또는 설명"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </div>

          <div className="selected-station-list compact-selected-list">
            {stations.map((station, index) => (
              <div
                key={station.id}
                className="selected-station-card compact-selected-station-card"
              >
                <span className="station-order">{index + 1}</span>
                <div className="selected-station-main">
                  <strong>{station.nameKo}</strong>
                  <span>{formatStationSubLabel(station)}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="section-title-row timetable-title compact-section-title">
            <div>
              <p className="eyebrow">Timetable</p>
              <h2>역간 환승 시간표</h2>
            </div>
            <span className="helper-pill">양방향</span>
          </div>

          <div className="transfer-time-matrix-wrap">
            <table className="transfer-time-matrix">
              <thead>
                <tr>
                  <th scope="col" className="matrix-corner">
                    역간 시간
                  </th>
                  {stations.map((station) => (
                    <th key={station.id} scope="col">
                      <span>{station.nameKo}</span>
                      <small>{station.lineNameKo}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stations.map((rowStation, rowIndex) => (
                  <tr key={rowStation.id}>
                    <th scope="row">
                      <span>{rowStation.nameKo}</span>
                      <small>{rowStation.lineNameKo}</small>
                    </th>
                    {stations.map((columnStation, columnIndex) => {
                      if (rowIndex === columnIndex)
                        return (
                          <td
                            key={columnStation.id}
                            className="matrix-diagonal"
                          >
                            -
                          </td>
                        );

                      const pairKey = makeTransferPairKey(
                        rowStation.id,
                        columnStation.id,
                      );
                      const value = pairMinutes[pairKey];

                      if (rowIndex < columnIndex) {
                        return (
                          <td
                            key={columnStation.id}
                            className="matrix-editable-cell"
                          >
                            <label>
                              <input
                                type="number"
                                min="0"
                                className="matrix-time-input"
                                value={value ?? ""}
                                placeholder="분"
                                aria-label={`${rowStation.nameKo}에서 ${columnStation.nameKo} 환승 시간`}
                                onChange={(event) =>
                                  updatePairMinutes(pairKey, event.target.value)
                                }
                              />
                              <span>분</span>
                            </label>
                          </td>
                        );
                      }

                      return (
                        <td
                          key={columnStation.id}
                          className="matrix-mirrored-cell"
                        >
                          {value === null || value === undefined ? (
                            <span className="muted-value">-</span>
                          ) : (
                            <span>{value}분</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="map-picker-footer">
          <p>저장하면 모달만 닫히고 맵 에디터에 그대로 머무릅니다.</p>
          <div className="map-picker-actions">
            <button type="button" className="ghost-button" onClick={onCancel}>
              취소
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={saving || stations.length < 2}
              onClick={handleSave}
            >
              {saving ? "저장 중" : "저장"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
