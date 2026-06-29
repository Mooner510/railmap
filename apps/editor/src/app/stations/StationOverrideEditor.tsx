"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { normalizeSearchText, type EditorStation, type ManualOverlayBundle, type ManualStationOverride } from "../editorModel";

interface StationOverrideEditorProps {
  stations: EditorStation[];
  initialOverlays: ManualOverlayBundle;
}

type SaveState = "idle" | "saving" | "saved" | "error";

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

export default function StationOverrideEditor({ stations, initialOverlays }: StationOverrideEditorProps) {
  const [overrides, setOverrides] = useState<ManualStationOverride[]>(initialOverlays.stationOverrides ?? []);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ManualStationOverride | null>(null);
  const [query, setQuery] = useState("");
  const [showOnlyOverridden, setShowOnlyOverridden] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const stationById = useMemo(() => new Map(stations.map((station) => [station.id, station])), [stations]);
  const overrideStationIds = useMemo(() => new Set(overrides.map((override) => override.stationId)), [overrides]);
  const normalizedQuery = normalizeSearchText(query);
  const selectedStation = selectedStationId ? stationById.get(selectedStationId) ?? null : null;

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
    setSelectedStationId(station.id);
    setDraft(makeDraft(station, overrides));
    setMessage(null);
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
                    onChange={(event) => setDraft({ ...draft, lat: parseNullableNumber(event.target.value) })}
                  />
                </label>
                <label className="input-label">
                  경도(lng)
                  <input
                    className="text-input"
                    value={draft.lng ?? ""}
                    placeholder={String(selectedStation.lng ?? "")}
                    onChange={(event) => setDraft({ ...draft, lng: parseNullableNumber(event.target.value) })}
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
                <button type="button" className="danger-button" disabled={!overrideStationIds.has(selectedStation.id)} onClick={() => void removeOverride(selectedStation.id)}>
                  보정 제거
                </button>
              </div>
            </div>
          ) : (
            <p className="empty-box compact-empty">왼쪽 목록에서 보정할 역을 선택하세요.</p>
          )}

          {message ? <p className="message-box compact-message-box">{message}</p> : null}
        </section>
      </div>
    </div>
  );
}
