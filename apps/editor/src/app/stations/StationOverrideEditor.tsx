"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import { normalizeSearchText, type EditorStation, type ManualOverlayBundle, type ManualStationOverride } from "../editorModel";

interface StationOverrideEditorProps {
  stations: EditorStation[];
  initialOverlays: ManualOverlayBundle;
}

type SaveState = "idle" | "saving" | "saved" | "error";

type MapPoint = {
  lat: number;
  lng: number;
};

type MapTile = {
  key: string;
  url: string;
  left: number;
  top: number;
};

const TILE_SIZE = 256;
const DEFAULT_ZOOM = 16;
const MODAL_ZOOM = 17;

function getStationSearchRank(station: EditorStation, query: string) {
  if (!query) return 0;

  const stationName = normalizeSearchText(station.nameKo);
  const lineName = normalizeSearchText(station.lineNameKo);
  const stationNumber = normalizeSearchText(station.stationNumber);

  if (stationName.startsWith(query)) return 0;
  if (stationName.includes(query)) return 1;
  if (lineName.includes(query)) return 2;
  if (stationNumber.includes(query)) return 3;
  return null;
}

function highlightMatch(text: string, rawQuery: string): ReactNode {
  const query = rawQuery.trim();
  if (!query) return text;

  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark className="search-highlight">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

function makeDraft(station: EditorStation, overrides: ManualStationOverride[]): ManualStationOverride {
  const existing = overrides.find((override) => override.stationId === station.id);

  return {
    stationId: station.id,
    nameKo: existing?.nameKo ?? station.nameKo,
    lat: typeof existing?.lat === "number" ? existing.lat : station.lat,
    lng: typeof existing?.lng === "number" ? existing.lng : station.lng,
    enabled: existing?.enabled ?? true,
    note: existing?.note ?? null,
  };
}

function parseNullableNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toMapPoint(lat: unknown, lng: unknown): MapPoint | null {
  if (typeof lat !== "number" || !Number.isFinite(lat) || typeof lng !== "number" || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function clampLat(lat: number) {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

function normalizeLng(lng: number) {
  const normalized = ((lng + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

function lngToWorldX(lng: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  return ((normalizeLng(lng) + 180) / 360) * scale;
}

function latToWorldY(lat: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const rad = (clampLat(lat) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale;
}

function worldXToLng(x: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  return normalizeLng((x / scale) * 360 - 180);
}

function worldYToLat(y: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return clampLat((180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))));
}

function pointToWorld(point: MapPoint, zoom: number) {
  return {
    x: lngToWorldX(point.lng, zoom),
    y: latToWorldY(point.lat, zoom),
  };
}

function worldToPoint(world: { x: number; y: number }, zoom: number): MapPoint {
  return {
    lat: worldYToLat(world.y, zoom),
    lng: worldXToLng(world.x, zoom),
  };
}

function roundCoordinate(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function buildTiles(center: MapPoint, zoom: number, width: number, height: number): MapTile[] {
  const centerWorld = pointToWorld(center, zoom);
  const minTileX = Math.floor((centerWorld.x - width / 2) / TILE_SIZE);
  const maxTileX = Math.floor((centerWorld.x + width / 2) / TILE_SIZE);
  const minTileY = Math.floor((centerWorld.y - height / 2) / TILE_SIZE);
  const maxTileY = Math.floor((centerWorld.y + height / 2) / TILE_SIZE);
  const tileLimit = 2 ** zoom;
  const tiles: MapTile[] = [];

  for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      if (tileY < 0 || tileY >= tileLimit) continue;

      const wrappedX = ((tileX % tileLimit) + tileLimit) % tileLimit;
      tiles.push({
        key: `${zoom}-${tileX}-${tileY}`,
        url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`,
        left: tileX * TILE_SIZE - centerWorld.x + width / 2,
        top: tileY * TILE_SIZE - centerWorld.y + height / 2,
      });
    }
  }

  return tiles;
}

function StationPositionMap({
  center,
  marker,
  zoom,
  interactive = false,
  modal = false,
  onCenterChange,
}: {
  center: MapPoint | null;
  marker?: MapPoint | null;
  zoom: number;
  interactive?: boolean;
  modal?: boolean;
  onCenterChange?: (point: MapPoint) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startCenter: MapPoint } | null>(null);
  const [size, setSize] = useState({ width: modal ? 920 : 640, height: modal ? 560 : 320 });

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({ width: rect.width, height: rect.height });
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const tiles = useMemo(() => {
    if (!center) return [];
    return buildTiles(center, zoom, size.width, size.height);
  }, [center, size.height, size.width, zoom]);

  const markerPosition = useMemo(() => {
    if (!center || !marker) return null;
    const centerWorld = pointToWorld(center, zoom);
    const markerWorld = pointToWorld(marker, zoom);
    return {
      left: markerWorld.x - centerWorld.x + size.width / 2,
      top: markerWorld.y - centerWorld.y + size.height / 2,
    };
  }, [center, marker, size.height, size.width, zoom]);

  const moveCenterByPixels = useCallback((baseCenter: MapPoint, deltaX: number, deltaY: number) => {
    const baseWorld = pointToWorld(baseCenter, zoom);
    return worldToPoint({ x: baseWorld.x - deltaX, y: baseWorld.y - deltaY }, zoom);
  }, [zoom]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive || !center || !onCenterChange) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startCenter: center,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive || !onCenterChange || !dragRef.current || dragRef.current.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragRef.current.startX;
    const deltaY = event.clientY - dragRef.current.startY;
    onCenterChange(moveCenterByPixels(dragRef.current.startCenter, deltaX, deltaY));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!interactive) return;
    event.preventDefault();
  };

  if (!center) {
    return (
      <div className={modal ? "station-map-shell modal-map" : "station-map-shell"}>
        <div className="station-map-empty">좌표가 있는 역을 선택하세요.</div>
      </div>
    );
  }

  return (
    <div className={modal ? "station-map-shell modal-map" : "station-map-shell"}>
      <div
        ref={viewportRef}
        className={interactive ? "station-map-viewport interactive" : "station-map-viewport"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        {tiles.map((tile) => (
          <img
            key={tile.key}
            className="station-map-tile"
            src={tile.url}
            alt=""
            draggable={false}
            style={{ left: tile.left, top: tile.top }}
          />
        ))}
        {markerPosition ? (
          <div className="station-map-marker" style={{ left: markerPosition.left, top: markerPosition.top }} aria-hidden="true" />
        ) : null}
        <div className="station-map-crosshair" aria-hidden="true" />
        <div className="station-map-coordinate-badge">
          {roundCoordinate(center.lat)}, {roundCoordinate(center.lng)}
        </div>
        <div className="station-map-attribution">© OpenStreetMap</div>
      </div>
    </div>
  );
}

export default function StationOverrideEditor({ stations, initialOverlays }: StationOverrideEditorProps) {
  const [overrides, setOverrides] = useState<ManualStationOverride[]>(initialOverlays.stationOverrides ?? []);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ManualStationOverride | null>(null);
  const [query, setQuery] = useState("");
  const [showOnlyOverridden, setShowOnlyOverridden] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [mapPickerCenter, setMapPickerCenter] = useState<MapPoint | null>(null);

  const stationById = useMemo(() => new Map(stations.map((station) => [station.id, station])), [stations]);
  const overrideStationIds = useMemo(() => new Set(overrides.map((override) => override.stationId)), [overrides]);
  const normalizedQuery = normalizeSearchText(query);
  const selectedStation = selectedStationId ? stationById.get(selectedStationId) ?? null : null;
  const draftMapPoint = toMapPoint(draft?.lat, draft?.lng);
  const originalMapPoint = toMapPoint(selectedStation?.lat, selectedStation?.lng);

  const results = useMemo(() => {
    return stations
      .map((station) => ({ station, rank: getStationSearchRank(station, normalizedQuery) }))
      .filter((item) => {
        if (showOnlyOverridden && !overrideStationIds.has(item.station.id)) return false;
        return !normalizedQuery || item.rank !== null;
      })
      .sort((a, b) => {
        const rankA = a.rank ?? 0;
        const rankB = b.rank ?? 0;
        if (rankA !== rankB) return rankA - rankB;

        const nameCompare = a.station.nameKo.localeCompare(b.station.nameKo, "ko");
        if (nameCompare !== 0) return nameCompare;

        return a.station.lineNameKo.localeCompare(b.station.lineNameKo, "ko");
      })
      .slice(0, 80)
      .map((item) => item.station);
  }, [normalizedQuery, overrideStationIds, showOnlyOverridden, stations]);

  const selectStation = (station: EditorStation) => {
    const nextDraft = makeDraft(station, overrides);
    setSelectedStationId(station.id);
    setDraft(nextDraft);
    setMapPickerCenter(toMapPoint(nextDraft.lat, nextDraft.lng));
    setMessage(null);
    setSaveState("idle");
  };

  const updateDraftCoordinate = (key: "lat" | "lng", value: string) => {
    if (!draft) return;
    const nextDraft = { ...draft, [key]: parseNullableNumber(value) };
    setDraft(nextDraft);
    const nextPoint = toMapPoint(nextDraft.lat, nextDraft.lng);
    if (nextPoint) setMapPickerCenter(nextPoint);
  };

  const openMapPicker = () => {
    const center = draftMapPoint ?? originalMapPoint;
    if (!center) {
      setMessage("지도에서 선택하려면 먼저 유효한 위도/경도가 필요합니다.");
      return;
    }
    setMapPickerCenter(center);
    setMapPickerOpen(true);
  };

  const applyMapPickerCenter = () => {
    if (!draft || !mapPickerCenter) return;
    setDraft({ ...draft, lat: roundCoordinate(mapPickerCenter.lat), lng: roundCoordinate(mapPickerCenter.lng) });
    setMapPickerOpen(false);
    setMessage("지도 중앙 좌표를 입력값에 반영했습니다. 저장하려면 보정 저장을 누르세요.");
    setSaveState("idle");
  };

  const persistOverrides = async (nextOverrides: ManualStationOverride[], successMessage: string) => {
    setOverrides(nextOverrides);
    setSaveState("saving");
    setMessage("저장 중입니다.");

    try {
      const response = await fetch("/api/manual-overlays", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...initialOverlays,
          schemaVersion: 1,
          stationOverrides: nextOverrides,
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const saved = (await response.json()) as ManualOverlayBundle;
      const savedOverrides = saved.stationOverrides ?? [];
      setOverrides(savedOverrides);
      setSaveState("saved");
      setMessage(successMessage);

      if (selectedStationId) {
        const station = stationById.get(selectedStationId);
        if (station) setDraft(makeDraft(station, savedOverrides));
      }
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    }
  };

  const saveDraft = async () => {
    if (!selectedStation || !draft) {
      setMessage("역을 먼저 선택하세요.");
      return;
    }

    const cleaned: ManualStationOverride = {
      stationId: selectedStation.id,
      nameKo: draft.nameKo?.trim() && draft.nameKo.trim() !== selectedStation.nameKo ? draft.nameKo.trim() : undefined,
      lat: typeof draft.lat === "number" && draft.lat !== selectedStation.lat ? draft.lat : null,
      lng: typeof draft.lng === "number" && draft.lng !== selectedStation.lng ? draft.lng : null,
      enabled: true,
      note: draft.note?.trim() || null,
    };

    const hasValue = Boolean(cleaned.nameKo || typeof cleaned.lat === "number" || typeof cleaned.lng === "number" || cleaned.note);
    const nextOverrides = hasValue
      ? [cleaned, ...overrides.filter((override) => override.stationId !== selectedStation.id)]
      : overrides.filter((override) => override.stationId !== selectedStation.id);

    await persistOverrides(nextOverrides, hasValue ? "역 보정값을 저장했습니다." : "변경값이 없어 기존 보정을 제거했습니다.");
  };

  const removeOverride = async (stationId: string) => {
    const nextOverrides = overrides.filter((override) => override.stationId !== stationId);
    await persistOverrides(nextOverrides, "역 보정값을 제거했습니다.");
  };

  return (
    <div className="station-override-shell compact-transfer-editor">
      <section className="transfer-editor-header">
        <a href="/" className="back-link compact-back-link">← 홈</a>
        <div className="transfer-header-title">
          <p className="eyebrow">Station Override</p>
          <h1>역 보정</h1>
        </div>
        <div className="transfer-header-meta">
          <span>{overrides.length}개 보정</span>
          <span className="helper-pill">즉시 저장</span>
        </div>
      </section>

      <div className="station-override-workspace">
        <section className="editor-panel soft-panel scroll-panel station-search-panel">
          <div className="section-title-row compact-section-title">
            <div>
              <p className="eyebrow">Stations</p>
              <h2>전체 역 목록</h2>
            </div>
            <span className="helper-pill">{results.length}개</span>
          </div>
          <input
            className="search-input"
            placeholder="역명, 역번호, 노선명 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="filter-checkbox-row">
            <input type="checkbox" checked={showOnlyOverridden} onChange={(event) => setShowOnlyOverridden(event.target.checked)} />
            보정된 역만 보기
          </label>
          <div className="station-search-list fixed-inner-scroll">
            {results.map((station) => {
              const isOverridden = overrideStationIds.has(station.id);

              return (
                <button
                  key={station.id}
                  type="button"
                  className={selectedStationId === station.id ? "station-search-item active" : "station-search-item"}
                  onClick={() => selectStation(station)}
                >
                  <span className="station-search-name">{highlightMatch(station.nameKo, query)}</span>
                  <span className="station-search-meta">
                    <span
                      className="line-color-label"
                      style={station.colorHex ? { "--line-color": station.colorHex } as CSSProperties : undefined}
                    >
                      {highlightMatch(station.lineNameKo, query)}
                    </span>
                    <span>{station.stationNumber}</span>
                    {isOverridden ? <span className="override-dot">보정</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="editor-panel soft-panel station-editor-panel">
          <div className="section-title-row compact-section-title">
            <div>
              <p className="eyebrow">Edit</p>
              <h2>{selectedStation?.nameKo ?? "역을 선택하세요"}</h2>
            </div>
            {selectedStation ? <span className="helper-pill">{selectedStation.stationNumber}</span> : null}
          </div>

          {selectedStation && draft ? (
            <div className="station-edit-form">
              <div className="station-edit-layout">
                <div className="station-edit-fields">
                  <div className="station-original-card">
                    <p className="eyebrow">Original</p>
                    <strong>{selectedStation.nameKo}</strong>
                    <span>{selectedStation.lineNameKo} · {selectedStation.stationNumber}</span>
                    <code>{selectedStation.lat ?? "-"}, {selectedStation.lng ?? "-"}</code>
                  </div>

                  <label className="input-label">
                    표시 이름
                    <input
                      className="text-input"
                      value={draft.nameKo ?? ""}
                      placeholder={selectedStation.nameKo}
                      onChange={(event) => setDraft({ ...draft, nameKo: event.target.value })}
                    />
                  </label>

                  <div className="station-coordinate-grid">
                    <label className="input-label">
                      위도(lat)
                      <input
                        className="text-input"
                        value={draft.lat ?? ""}
                        placeholder={String(selectedStation.lat ?? "")}
                        onChange={(event) => updateDraftCoordinate("lat", event.target.value)}
                      />
                    </label>
                    <label className="input-label">
                      경도(lng)
                      <input
                        className="text-input"
                        value={draft.lng ?? ""}
                        placeholder={String(selectedStation.lng ?? "")}
                        onChange={(event) => updateDraftCoordinate("lng", event.target.value)}
                      />
                    </label>
                  </div>

                  <label className="input-label">
                    메모
                    <textarea
                      className="text-area"
                      placeholder="수정 사유 또는 검증 근거"
                      value={draft.note ?? ""}
                      onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                    />
                  </label>

                  <div className="action-row compact-sticky-actions">
                    <button type="button" className="primary-button" disabled={saveState === "saving"} onClick={() => void saveDraft()}>
                      {saveState === "saving" ? "저장 중" : "보정 저장"}
                    </button>
                    <button type="button" className="secondary-button" disabled={!draftMapPoint && !originalMapPoint} onClick={openMapPicker}>
                      지도에서 선택
                    </button>
                    <button type="button" className="danger-button" disabled={!overrideStationIds.has(selectedStation.id)} onClick={() => void removeOverride(selectedStation.id)}>
                      보정 제거
                    </button>
                  </div>
                </div>

                <aside className="station-map-preview-card">
                  <div className="station-map-title-row">
                    <div>
                      <p className="eyebrow">Map Preview</p>
                      <h3>현재 입력 위치</h3>
                    </div>
                    <span className="helper-pill">{draftMapPoint ? "반영됨" : "좌표 없음"}</span>
                  </div>
                  <StationPositionMap center={draftMapPoint ?? originalMapPoint} marker={draftMapPoint} zoom={DEFAULT_ZOOM} />
                  <p className="station-map-help">십자선은 현재 입력된 위도/경도 위치입니다. 정확한 보정은 지도에서 선택 버튼으로 조정하세요.</p>
                </aside>
              </div>
            </div>
          ) : (
            <p className="empty-box compact-empty">왼쪽 목록에서 보정할 역을 선택하세요.</p>
          )}

          {message ? <p className="message-box compact-message-box">{message}</p> : null}
        </section>
      </div>

      {mapPickerOpen ? (
        <div className="map-picker-backdrop" role="dialog" aria-modal="true" aria-label="지도에서 역 좌표 선택">
          <div className="map-picker-dialog">
            <div className="map-picker-header">
              <div>
                <p className="eyebrow">Map Picker</p>
                <h2>지도 중앙을 역 좌표로 설정</h2>
              </div>
              <button type="button" className="icon-only-action" onClick={() => setMapPickerOpen(false)} aria-label="닫기">×</button>
            </div>
            <StationPositionMap
              center={mapPickerCenter}
              marker={draftMapPoint ?? originalMapPoint}
              zoom={MODAL_ZOOM}
              interactive
              modal
              onCenterChange={setMapPickerCenter}
            />
            <div className="map-picker-footer">
              <p>지도를 드래그해서 십자선 중앙에 역 위치를 맞춘 뒤 적용하세요.</p>
              <div className="map-picker-actions">
                <button type="button" className="secondary-button" onClick={() => setMapPickerOpen(false)}>취소</button>
                <button type="button" className="primary-button" disabled={!mapPickerCenter} onClick={applyMapPickerCenter}>중앙 좌표 적용</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
