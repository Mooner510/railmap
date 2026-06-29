"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  makeTransferGroupId,
  makeTransferPairKey,
  normalizeSearchText,
  type EditorStation,
  type ManualOverlayBundle,
  type ManualTransferGroup,
} from "../editorModel";

interface ManualTransferEditorProps {
  stations: EditorStation[];
  initialOverlays: ManualOverlayBundle;
}

function getStationLabel(station: EditorStation | null | undefined) {
  if (!station) return "역을 선택하세요";
  return `${station.nameKo} · ${station.lineNameKo} · ${station.stationNumber}`;
}


function getStationBaseName(nameKo: string) {
  const withoutParentheses = nameKo.replace(/\([^)]*\)/g, "").trim();
  return withoutParentheses.endsWith("역") ? withoutParentheses.slice(0, -1) : withoutParentheses;
}

function getSuggestedGroupName(stations: EditorStation[]) {
  if (stations.length === 0) return "새 환승 그룹";

  const baseNames = [...new Set(stations.map((station) => getStationBaseName(station.nameKo)).filter(Boolean))];
  if (baseNames.length === 1) return `${baseNames[0]}역`;

  return baseNames.map((name) => `${name}${name.endsWith("역") ? "" : "역"}`).join(" · ");
}

function getStationSearchRank(station: EditorStation, query: string) {
  if (!query) return 0;

  const stationName = normalizeSearchText(station.nameKo);
  const stationBaseName = normalizeSearchText(getStationBaseName(station.nameKo));
  const lineName = normalizeSearchText(station.lineNameKo);

  if (stationName.startsWith(query) || stationBaseName.startsWith(query)) return 0;
  if (stationName.includes(query) || stationBaseName.includes(query)) return 1;
  if (lineName.includes(query)) return 2;
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

function createEmptyPairMinutes(stationIds: string[], previous: Record<string, number | null> = {}) {
  const result: Record<string, number | null> = {};

  for (let i = 0; i < stationIds.length - 1; i += 1) {
    for (let j = i + 1; j < stationIds.length; j += 1) {
      const pairKey = makeTransferPairKey(stationIds[i] ?? "", stationIds[j] ?? "");
      result[pairKey] = previous[pairKey] ?? null;
    }
  }

  return result;
}

export default function ManualTransferEditor({ stations, initialOverlays }: ManualTransferEditorProps) {
  const stationById = useMemo(() => new Map(stations.map((station) => [station.id, station])), [stations]);
  const [groups, setGroups] = useState<ManualTransferGroup[]>(initialOverlays.manualTransferGroups ?? []);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("새 환승 그룹");
  const [groupNameTouched, setGroupNameTouched] = useState(false);
  const [note, setNote] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [selectedStationIds, setSelectedStationIds] = useState<string[]>([]);
  const [pairMinutes, setPairMinutes] = useState<Record<string, number | null>>({});
  const [stationQuery, setStationQuery] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const selectedStations = selectedStationIds
    .map((stationId) => stationById.get(stationId))
    .filter((station): station is EditorStation => station !== undefined);
  const suggestedGroupName = useMemo(() => getSuggestedGroupName(selectedStations), [selectedStations]);
  const normalizedQuery = normalizeSearchText(stationQuery);
  const searchResults = useMemo(() => {
    const selectedIdSet = new Set(selectedStationIds);

    return stations
      .map((station) => ({ station, rank: getStationSearchRank(station, normalizedQuery) }))
      .filter((item) => !selectedIdSet.has(item.station.id) && (!normalizedQuery || item.rank !== null))
      .sort((a, b) => {
        const rankA = a.rank ?? 0;
        const rankB = b.rank ?? 0;
        if (rankA !== rankB) return rankA - rankB;

        const nameCompare = a.station.nameKo.localeCompare(b.station.nameKo, "ko");
        if (nameCompare !== 0) return nameCompare;

        return a.station.lineNameKo.localeCompare(b.station.lineNameKo, "ko");
      })
      .slice(0, 18)
      .map((item) => item.station);
  }, [normalizedQuery, selectedStationIds, stations]);

  useEffect(() => {
    if (groupNameTouched) return;
    setGroupName(suggestedGroupName);
  }, [groupNameTouched, suggestedGroupName]);

  const pairs = useMemo(() => {
    const result: Array<{ key: string; from: EditorStation; to: EditorStation }> = [];

    for (let i = 0; i < selectedStations.length - 1; i += 1) {
      for (let j = i + 1; j < selectedStations.length; j += 1) {
        const from = selectedStations[i];
        const to = selectedStations[j];
        if (!from || !to) continue;
        result.push({ key: makeTransferPairKey(from.id, to.id), from, to });
      }
    }

    return result;
  }, [selectedStations]);

  const resetForm = () => {
    setEditingGroupId(null);
    setGroupName("새 환승 그룹");
    setGroupNameTouched(false);
    setNote("");
    setEnabled(true);
    setSelectedStationIds([]);
    setPairMinutes({});
    setStationQuery("");
    setMessage(null);
  };

  const loadGroup = (group: ManualTransferGroup) => {
    setEditingGroupId(group.id);
    setGroupName(group.nameKo);
    setGroupNameTouched(true);
    setNote(group.note ?? "");
    setEnabled(group.enabled);
    setSelectedStationIds(group.stationIds);
    setPairMinutes(createEmptyPairMinutes(group.stationIds, group.transferMinutesByPair));
    setStationQuery("");
    setMessage("환승 그룹을 편집 중입니다.");
  };

  const addStation = (station: EditorStation) => {
    setSelectedStationIds((previous) => {
      if (previous.includes(station.id)) return previous;
      const next = [...previous, station.id];
      setPairMinutes((minutes) => createEmptyPairMinutes(next, minutes));
      return next;
    });
  };

  const removeStation = (stationId: string) => {
    setSelectedStationIds((previous) => {
      const next = previous.filter((id) => id !== stationId);
      setPairMinutes((minutes) => createEmptyPairMinutes(next, minutes));
      return next;
    });
  };

  const updatePairMinutes = (pairKey: string, value: string) => {
    setPairMinutes((previous) => ({
      ...previous,
      [pairKey]: value.trim() === "" ? null : Math.max(0, Math.round(Number(value) || 0)),
    }));
  };

  const upsertGroup = () => {
    if (selectedStationIds.length < 2) {
      setMessage("환승 그룹에는 최소 2개 역이 필요합니다.");
      return;
    }

    const nameKo = groupName.trim() || selectedStations.map((station) => station.nameKo).join(" · ");
    const id = editingGroupId ?? makeTransferGroupId(nameKo, selectedStationIds);
    const nextGroup: ManualTransferGroup = {
      id,
      nameKo,
      stationIds: selectedStationIds,
      transferMinutesByPair: createEmptyPairMinutes(selectedStationIds, pairMinutes),
      enabled,
      source: "editor",
      note: note.trim() || null,
    };

    setGroups((previous) => [nextGroup, ...previous.filter((group) => group.id !== id)]);
    setEditingGroupId(id);
    setMessage("환승 그룹이 임시 목록에 반영되었습니다. 저장을 눌러야 파일에 기록됩니다.");
  };

  const save = async () => {
    setSaveState("saving");
    setMessage(null);

    try {
      const response = await fetch("/api/manual-overlays", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...initialOverlays,
          schemaVersion: 1,
          manualTransferGroups: groups,
          manualTransferEdges: [],
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const saved = (await response.json()) as ManualOverlayBundle;
      setGroups(saved.manualTransferGroups ?? []);
      setSaveState("saved");
      setMessage("manual-overlays.json에 저장되었습니다. viewer는 새로고침 후 반영됩니다.");
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    }
  };

  return (
    <div className="transfer-editor-shell">
      <section className="editor-hero compact">
        <div>
          <p className="eyebrow">Transfer Group Editor</p>
          <h1>수동 환승 그룹</h1>
          <p>
            같은 환승 그룹에 들어간 역들은 서로 환승 가능한 것으로 처리됩니다. 역간 환승 시간은 아래 시간표에서 직접 지정합니다.
          </p>
        </div>
        <div className="hero-stat">
          <span>그룹</span>
          <strong>{groups.length}</strong>
        </div>
      </section>

      <div className="transfer-workspace">
        <section className="editor-panel soft-panel">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Step 1</p>
              <h2>전체 역 목록에서 추가</h2>
            </div>
            <span className="helper-pill">검색 후 클릭</span>
          </div>
          <input
            className="search-input"
            placeholder="역명 또는 노선명 검색"
            value={stationQuery}
            onChange={(event) => setStationQuery(event.target.value)}
          />
          <div className="station-search-list">
            {searchResults.map((station) => (
              <button key={station.id} type="button" className="station-search-item" onClick={() => addStation(station)}>
                <span className="station-search-name">{highlightMatch(station.nameKo, stationQuery)}</span>
                <span className="station-search-meta">{highlightMatch(station.lineNameKo, stationQuery)} · {station.stationNumber}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="editor-panel soft-panel main-editor-panel">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Step 2</p>
              <h2>이번 환승 목록</h2>
            </div>
            <button type="button" className="ghost-button" onClick={resetForm}>새 그룹</button>
          </div>

          <div className="group-form-grid">
            <label className="input-label">
              그룹 이름
              <div className="group-name-row">
                <input
                  className="text-input"
                  value={groupName}
                  onChange={(event) => {
                    setGroupNameTouched(true);
                    setGroupName(event.target.value);
                  }}
                />
                <button
                  type="button"
                  className="inline-soft-button"
                  onClick={() => {
                    setGroupNameTouched(false);
                    setGroupName(suggestedGroupName);
                  }}
                >
                  자동
                </button>
              </div>
              <span className="input-hint">추천 이름: {suggestedGroupName}</span>
            </label>
            <label className="input-label">
              메모
              <input className="text-input" placeholder="검증 근거 또는 설명" value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
          </div>

          <div className="selected-station-list">
            {selectedStations.length === 0 ? <p className="empty-box compact-empty">왼쪽에서 환승 가능한 역을 추가하세요.</p> : null}
            {selectedStations.map((station, index) => (
              <div key={station.id} className="selected-station-card">
                <span className="station-order">{index + 1}</span>
                <div className="selected-station-main">
                  <strong>{station.nameKo}</strong>
                  <span>{station.lineNameKo} · {station.stationNumber}</span>
                </div>
                <button type="button" className="icon-button" onClick={() => removeStation(station.id)}>삭제</button>
              </div>
            ))}
          </div>

          <div className="section-title-row timetable-title">
            <div>
              <p className="eyebrow">Step 3</p>
              <h2>역간 환승 시간표</h2>
            </div>
            <span className="helper-pill">항상 양방향</span>
          </div>

          <div className="transfer-time-matrix-wrap">
            {selectedStations.length < 2 ? (
              <p className="empty-box compact-empty">역을 2개 이상 추가하면 시간표가 생성됩니다.</p>
            ) : (
              <table className="transfer-time-matrix">
                <thead>
                  <tr>
                    <th scope="col" className="matrix-corner">역간 시간</th>
                    {selectedStations.map((station) => (
                      <th key={station.id} scope="col">
                        <span>{station.nameKo}</span>
                        <small>{station.lineNameKo}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedStations.map((rowStation, rowIndex) => (
                    <tr key={rowStation.id}>
                      <th scope="row">
                        <span>{rowStation.nameKo}</span>
                        <small>{rowStation.lineNameKo}</small>
                      </th>
                      {selectedStations.map((columnStation, columnIndex) => {
                        if (rowIndex === columnIndex) {
                          return <td key={columnStation.id} className="matrix-diagonal">-</td>;
                        }

                        const pairKey = makeTransferPairKey(rowStation.id, columnStation.id);
                        const value = pairMinutes[pairKey];

                        if (rowIndex < columnIndex) {
                          return (
                            <td key={columnStation.id} className="matrix-editable-cell">
                              <label>
                                <input
                                  type="number"
                                  min="0"
                                  className="matrix-time-input"
                                  value={value ?? ""}
                                  placeholder="분"
                                  aria-label={`${rowStation.nameKo}에서 ${columnStation.nameKo} 환승 시간`}
                                  onChange={(event) => updatePairMinutes(pairKey, event.target.value)}
                                />
                                <span>분</span>
                              </label>
                            </td>
                          );
                        }

                        return (
                          <td key={columnStation.id} className="matrix-mirrored-cell">
                            {value === null || value === undefined ? <span className="muted-value">-</span> : <span>{value}분</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="action-row sticky-actions">
            <label className="toggle-row">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              그룹 활성화
            </label>
            <button type="button" className="secondary-button" onClick={upsertGroup}>이번 환승 목록 반영</button>
            <button type="button" className="primary-button" disabled={saveState === "saving"} onClick={save}>
              {saveState === "saving" ? "저장 중" : "manual-overlays.json 저장"}
            </button>
          </div>

          {message ? <p className="message-box">{message}</p> : null}
        </section>

        <section className="editor-panel soft-panel">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Saved</p>
              <h2>저장 대기 그룹</h2>
            </div>
          </div>
          <div className="group-list">
            {groups.length === 0 ? <p className="empty-box compact-empty">저장된 환승 그룹이 없습니다.</p> : null}
            {groups.map((group) => (
              <TransferGroupCard
                key={group.id}
                group={group}
                stations={group.stationIds.map((stationId) => stationById.get(stationId)).filter((station): station is EditorStation => station !== undefined)}
                onEdit={() => loadGroup(group)}
                onToggle={() => {
                  setGroups((previous) => previous.map((item) => (item.id === group.id ? { ...item, enabled: !item.enabled } : item)));
                }}
                onDelete={() => {
                  setGroups((previous) => previous.filter((item) => item.id !== group.id));
                  if (editingGroupId === group.id) resetForm();
                }}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function TransferGroupCard({
  group,
  stations,
  onEdit,
  onToggle,
  onDelete,
}: {
  group: ManualTransferGroup;
  stations: EditorStation[];
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group-card">
      <div className="group-card-top">
        <div>
          <p className="group-title">{group.nameKo}</p>
          <p className="group-meta">{stations.length}개 역 · {group.enabled ? "활성" : "비활성"}</p>
        </div>
        <span className={group.enabled ? "status-pill" : "status-pill off"}>{group.enabled ? "ON" : "OFF"}</span>
      </div>
      <div className="group-station-chips">
        {stations.map((station) => (
          <span key={station.id}>{getStationLabel(station)}</span>
        ))}
      </div>
      {group.note ? <p className="group-note">{group.note}</p> : null}
      <div className="edge-actions">
        <button type="button" className="secondary-button" onClick={onEdit}>편집</button>
        <button type="button" className="secondary-button" onClick={onToggle}>{group.enabled ? "비활성" : "활성"}</button>
        <button type="button" className="danger-button" onClick={onDelete}>삭제</button>
      </div>
    </div>
  );
}
