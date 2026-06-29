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

type SaveState = "idle" | "saving" | "saved" | "error";

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

function fingerprintGroups(groups: ManualTransferGroup[], nonTransferStationIds: string[] = []) {
  const comparableGroups = groups
    .map((group) => ({
      id: group.id,
      nameKo: group.nameKo,
      stationIds: group.stationIds,
      transferMinutesByPair: group.transferMinutesByPair,
      enabled: group.enabled,
      note: group.note ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return JSON.stringify({
    groups: comparableGroups,
    nonTransferStationIds: [...new Set(nonTransferStationIds)].sort(),
  });
}

export default function ManualTransferEditor({ stations, initialOverlays }: ManualTransferEditorProps) {
  const initialGroups = initialOverlays.manualTransferGroups ?? [];
  const initialNonTransferStationIds = initialOverlays.nonTransferStationIds ?? [];
  const stationById = useMemo(() => new Map(stations.map((station) => [station.id, station])), [stations]);
  const [groups, setGroups] = useState<ManualTransferGroup[]>(initialGroups);
  const [nonTransferStationIds, setNonTransferStationIds] = useState<string[]>(initialNonTransferStationIds);
  const [savedFingerprint, setSavedFingerprint] = useState(() => fingerprintGroups(initialGroups, initialNonTransferStationIds));
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("새 환승 그룹");
  const [groupNameTouched, setGroupNameTouched] = useState(false);
  const [note, setNote] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [selectedStationIds, setSelectedStationIds] = useState<string[]>([]);
  const [pairMinutes, setPairMinutes] = useState<Record<string, number | null>>({});
  const [stationQuery, setStationQuery] = useState("");
  const [hideMappedStations, setHideMappedStations] = useState(true);
  const [showOnlyNonTransferStations, setShowOnlyNonTransferStations] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const selectedStations = selectedStationIds
    .map((stationId) => stationById.get(stationId))
    .filter((station): station is EditorStation => station !== undefined);
  const suggestedGroupName = useMemo(() => getSuggestedGroupName(selectedStations), [selectedStations]);
  const normalizedQuery = normalizeSearchText(stationQuery);
  const currentFingerprint = useMemo(() => fingerprintGroups(groups, nonTransferStationIds), [groups, nonTransferStationIds]);
  const hasPendingChanges = currentFingerprint !== savedFingerprint;
  const editingGroup = editingGroupId ? groups.find((group) => group.id === editingGroupId) ?? null : null;

  const mappedStationIds = useMemo(() => {
    const ids = new Set<string>();

    for (const group of groups) {
      if (group.id === editingGroupId) continue;
      for (const stationId of group.stationIds) ids.add(stationId);
    }

    return ids;
  }, [editingGroupId, groups]);
  const selectedStationIdSet = useMemo(() => new Set(selectedStationIds), [selectedStationIds]);
  const nonTransferStationIdSet = useMemo(() => new Set(nonTransferStationIds), [nonTransferStationIds]);
  const nonTransferStationCount = nonTransferStationIds.length;

  const searchResults = useMemo(() => {
    return stations
      .map((station) => ({ station, rank: getStationSearchRank(station, normalizedQuery) }))
      .filter((item) => {
        if (selectedStationIdSet.has(item.station.id)) return false;

        const isNonTransferStation = nonTransferStationIdSet.has(item.station.id);
        if (showOnlyNonTransferStations) {
          if (!isNonTransferStation) return false;
        } else if (isNonTransferStation) {
          return false;
        }

        if (hideMappedStations && mappedStationIds.has(item.station.id)) return false;
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
      .slice(0, 40)
      .map((item) => item.station);
  }, [hideMappedStations, mappedStationIds, nonTransferStationIdSet, normalizedQuery, selectedStationIdSet, showOnlyNonTransferStations, stations]);

  useEffect(() => {
    if (groupNameTouched) return;
    setGroupName(suggestedGroupName);
  }, [groupNameTouched, suggestedGroupName]);

  const persistEditorState = async (
    nextGroups: ManualTransferGroup[],
    nextNonTransferStationIds: string[],
    successMessage: string,
  ) => {
    const uniqueNonTransferStationIds = [...new Set(nextNonTransferStationIds)].filter(Boolean);
    setGroups(nextGroups);
    setNonTransferStationIds(uniqueNonTransferStationIds);
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
      const savedGroups = saved.manualTransferGroups ?? [];
      const savedNonTransferStationIds = saved.nonTransferStationIds ?? [];
      setGroups(savedGroups);
      setNonTransferStationIds(savedNonTransferStationIds);
      setSavedFingerprint(fingerprintGroups(savedGroups, savedNonTransferStationIds));
      setSaveState("saved");
      setMessage(successMessage);
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    }
  };

  const persistGroups = async (nextGroups: ManualTransferGroup[], successMessage: string) => {
    await persistEditorState(nextGroups, nonTransferStationIds, successMessage);
  };

  const addNonTransferStation = async (station: EditorStation) => {
    if (nonTransferStationIdSet.has(station.id)) return;

    const nextNonTransferStationIds = [...nonTransferStationIds, station.id];
    await persistEditorState(groups, nextNonTransferStationIds, `${station.nameKo}을(를) 미환승역으로 등록했습니다.`);
  };

  const restoreTransferStation = async (stationId: string) => {
    const station = stationById.get(stationId);
    const nextNonTransferStationIds = nonTransferStationIds.filter((id) => id !== stationId);
    await persistEditorState(groups, nextNonTransferStationIds, `${station?.nameKo ?? "선택한 역"}을(를) 환승역 후보로 전환했습니다.`);
  };

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
    setSaveState("idle");
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
    setSaveState("idle");
    setMessage("환승 그룹을 편집 중입니다. 변경사항 저장을 누르면 즉시 파일에 반영됩니다.");
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

  const upsertGroup = async () => {
    if (selectedStationIds.length < 2) {
      setMessage("환승 그룹에는 최소 2개 역이 필요합니다.");
      return;
    }

    const nameKo = groupName.trim() || suggestedGroupName;
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
    const nextGroups = [nextGroup, ...groups.filter((group) => group.id !== id)];
    const nextNonTransferStationIds = nonTransferStationIds.filter((stationId) => !selectedStationIds.includes(stationId));

    setEditingGroupId(id);
    await persistEditorState(nextGroups, nextNonTransferStationIds, editingGroupId ? "그룹 수정사항을 저장했습니다." : "새 환승 그룹을 추가하고 저장했습니다.");
  };

  const deleteGroup = async (groupId: string) => {
    const nextGroups = groups.filter((group) => group.id !== groupId);
    if (editingGroupId === groupId) resetForm();
    await persistGroups(nextGroups, "환승 그룹을 삭제하고 저장했습니다.");
  };

  const toggleGroup = async (groupId: string) => {
    const nextGroups = groups.map((group) => (group.id === groupId ? { ...group, enabled: !group.enabled } : group));
    await persistGroups(nextGroups, "그룹 활성화 상태를 저장했습니다.");
  };

  return (
    <div className="transfer-editor-shell compact-transfer-editor">
      <section className="transfer-editor-header">
        <a href="/" className="back-link compact-back-link">← 홈</a>
        <div className="transfer-header-title">
          <p className="eyebrow">Transfer Groups</p>
          <h1>수동 환승 그룹</h1>
        </div>
        <div className="transfer-header-meta">
          <span>{groups.length}개 그룹</span>
          <span className={hasPendingChanges ? "pending-pill" : "helper-pill"}>{saveState === "saving" ? "저장 중" : hasPendingChanges ? "수정 중" : "저장됨"}</span>
        </div>
      </section>

      <div className="transfer-workspace managed-transfer-workspace no-page-scroll-workspace">
        <section className="editor-panel soft-panel scroll-panel group-management-panel">
          <div className="section-title-row compact-section-title">
            <div>
              <p className="eyebrow">Groups</p>
              <h2>저장된 그룹</h2>
            </div>
            <button type="button" className="primary-button compact-button" onClick={resetForm}>
              새 그룹
            </button>
          </div>

          <div className="group-list managed-group-list fixed-inner-scroll">
            {groups.length === 0 ? <p className="empty-box compact-empty">저장된 환승 그룹이 없습니다.</p> : null}
            {groups.map((group) => (
              <TransferGroupCard
                key={group.id}
                group={group}
                active={editingGroupId === group.id}
                stations={group.stationIds.map((stationId) => stationById.get(stationId)).filter((station): station is EditorStation => station !== undefined)}
                onEdit={() => loadGroup(group)}
                onToggle={() => void toggleGroup(group.id)}
                onDelete={() => void deleteGroup(group.id)}
              />
            ))}
          </div>
        </section>

        <section className="editor-panel soft-panel scroll-panel station-search-panel">
          <div className="section-title-row compact-section-title">
            <div>
              <p className="eyebrow">Stations</p>
              <h2>전체 역 목록</h2>
            </div>
            <span className="helper-pill">{searchResults.length}개</span>
          </div>
          <input
            className="search-input"
            placeholder="역명 또는 노선명 검색"
            value={stationQuery}
            onChange={(event) => setStationQuery(event.target.value)}
          />
          <div className="station-filter-stack">
            <label className="filter-checkbox-row">
              <input type="checkbox" checked={hideMappedStations} onChange={(event) => setHideMappedStations(event.target.checked)} />
              이미 1개 이상 매핑된 역 제외
            </label>
            <label className="filter-checkbox-row">
              <input type="checkbox" checked={showOnlyNonTransferStations} onChange={(event) => setShowOnlyNonTransferStations(event.target.checked)} />
              미환승역만 보기 <span className="muted-count">{nonTransferStationCount}개</span>
            </label>
          </div>
          <div className="station-search-list fixed-inner-scroll">
            {searchResults.map((station) => {
              const isNonTransferStation = nonTransferStationIdSet.has(station.id);

              return (
                <div key={station.id} className={isNonTransferStation ? "station-search-item non-transfer-search-item" : "station-search-item"}>
                  <button type="button" className="station-search-main-button" onClick={() => addStation(station)} disabled={isNonTransferStation}>
                    <span className="station-search-name">{highlightMatch(station.nameKo, stationQuery)}</span>
                    <span className="station-search-meta">{highlightMatch(station.lineNameKo, stationQuery)} · {station.stationNumber}</span>
                  </button>
                  {isNonTransferStation ? (
                    <button type="button" className="secondary-button compact-station-action" onClick={() => void restoreTransferStation(station.id)}>
                      환승역으로 전환
                    </button>
                  ) : (
                    <button type="button" className="ghost-button compact-station-action" onClick={() => void addNonTransferStation(station)}>
                      미환승역으로 추가
                    </button>
                  )}
                </div>
              );
            })}
            {searchResults.length === 0 ? <p className="empty-box compact-empty">조건에 맞는 역이 없습니다.</p> : null}
          </div>
        </section>

        <section className="editor-panel soft-panel main-editor-panel scroll-panel current-transfer-panel">
          <div className="section-title-row compact-section-title">
            <div>
              <p className="eyebrow">{editingGroup ? "Editing" : "New Group"}</p>
              <h2>{editingGroup ? editingGroup.nameKo : "이번 환승 목록"}</h2>
            </div>
            <button type="button" className="ghost-button" onClick={resetForm}>초기화</button>
          </div>

          <div className="main-editor-scroll fixed-inner-scroll">
            <div className="group-form-grid compact-form-grid">
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

            <div className="selected-station-list compact-selected-list">
              {selectedStations.length === 0 ? <p className="empty-box compact-empty">왼쪽 역 목록에서 환승 가능한 역을 추가하세요.</p> : null}
              {selectedStations.map((station, index) => (
                <div key={station.id} className="selected-station-card compact-selected-station-card">
                  <span className="station-order">{index + 1}</span>
                  <div className="selected-station-main">
                    <strong>{station.nameKo}</strong>
                    <span>{station.lineNameKo} · {station.stationNumber}</span>
                  </div>
                  <button type="button" className="icon-button" onClick={() => removeStation(station.id)}>삭제</button>
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
          </div>

          <div className="action-row sticky-actions compact-sticky-actions">
            <label className="toggle-row">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              그룹 활성화
            </label>
            <button type="button" className="primary-button" disabled={saveState === "saving"} onClick={() => void upsertGroup()}>
              {saveState === "saving" ? "저장 중" : editingGroupId ? "변경사항 저장" : "환승 그룹 추가"}
            </button>
          </div>

          {message ? <p className="message-box compact-message-box">{message}</p> : null}
        </section>
      </div>
    </div>
  );
}

function TransferGroupCard({
  group,
  stations,
  active,
  onEdit,
  onToggle,
  onDelete,
}: {
  group: ManualTransferGroup;
  stations: EditorStation[];
  active: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={active ? "group-card active" : "group-card"}>
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
