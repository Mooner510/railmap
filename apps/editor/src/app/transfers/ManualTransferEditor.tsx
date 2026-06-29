"use client";

import { useMemo, useState } from "react";
import {
  makeTransferId,
  normalizeSearchText,
  type EditorStation,
  type ManualOverlayBundle,
  type ManualTransferEdge,
} from "../editorModel";

interface ManualTransferEditorProps {
  stations: EditorStation[];
  initialOverlays: ManualOverlayBundle;
}

type TransferEndpoint = "from" | "to";

function getStationLabel(station: EditorStation | null | undefined) {
  if (!station) return "역을 선택하세요";
  return `${station.nameKo} · ${station.lineNameKo} · ${station.stationNumber}`;
}

export default function ManualTransferEditor({ stations, initialOverlays }: ManualTransferEditorProps) {
  const stationById = useMemo(() => new Map(stations.map((station) => [station.id, station])), [stations]);
  const [edges, setEdges] = useState<ManualTransferEdge[]>(initialOverlays.manualTransferEdges);
  const [fromStationId, setFromStationId] = useState("");
  const [toStationId, setToStationId] = useState("");
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [transferMinutes, setTransferMinutes] = useState("3");
  const [labelKo, setLabelKo] = useState("");
  const [note, setNote] = useState("");
  const [bidirectional, setBidirectional] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const fromStation = stationById.get(fromStationId) ?? null;
  const toStation = stationById.get(toStationId) ?? null;
  const canAdd = Boolean(fromStationId && toStationId && fromStationId !== toStationId);

  const selectStation = (endpoint: TransferEndpoint, station: EditorStation) => {
    if (endpoint === "from") {
      setFromStationId(station.id);
      setFromQuery(station.nameKo);
    } else {
      setToStationId(station.id);
      setToQuery(station.nameKo);
    }
  };

  const addEdge = () => {
    if (!canAdd) {
      setMessage("서로 다른 출발/도착 역을 선택해야 합니다.");
      return;
    }

    const minutes = Number(transferMinutes);
    const nextEdge: ManualTransferEdge = {
      id: makeTransferId(fromStationId, toStationId),
      fromStationId,
      toStationId,
      labelKo: labelKo.trim() || null,
      transferMinutes: Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : null,
      bidirectional,
      enabled: true,
      source: "editor",
      note: note.trim() || null,
    };

    setEdges((previous) => [
      nextEdge,
      ...previous.filter((edge) => edge.id !== nextEdge.id),
    ]);
    setMessage("환승 edge가 목록에 추가되었습니다. 저장을 눌러야 파일에 반영됩니다.");
  };

  const save = async () => {
    setSaveState("saving");
    setMessage(null);

    try {
      const response = await fetch("/api/manual-overlays", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...initialOverlays,
          schemaVersion: 1,
          manualTransferEdges: edges,
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const saved = (await response.json()) as ManualOverlayBundle;
      setEdges(saved.manualTransferEdges);
      setSaveState("saved");
      setMessage("manual-overlays.json에 저장되었습니다. viewer는 새로고침 후 반영됩니다.");
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    }
  };

  return (
    <>
      <div className="panel-header">
        <p className="eyebrow">Manual Transfer Editor</p>
        <h1>수동 환승 edge 편집</h1>
        <p>공공 데이터에 없는 환승 연결을 직접 추가합니다. 저장된 edge는 viewer 경로검색 graph에 포함됩니다.</p>
      </div>

      <div className="transfer-grid">
        <StationPicker
          title="출발 환승 역"
          query={fromQuery}
          selectedStation={fromStation}
          stations={stations}
          onQuery={setFromQuery}
          onSelect={(station) => selectStation("from", station)}
        />
        <StationPicker
          title="도착 환승 역"
          query={toQuery}
          selectedStation={toStation}
          stations={stations}
          onQuery={setToQuery}
          onSelect={(station) => selectStation("to", station)}
        />
      </div>

      <div className="form-box">
        <label className="input-label">
          환승 시간(분)
          <input
            type="number"
            min="0"
            className="text-input"
            value={transferMinutes}
            onChange={(event) => setTransferMinutes(event.target.value)}
          />
        </label>
        <label className="input-label">
          표시 이름
          <input
            className="text-input"
            placeholder="예: 공덕 환승"
            value={labelKo}
            onChange={(event) => setLabelKo(event.target.value)}
          />
        </label>
        <label className="checkbox-row wide">
          <input
            type="checkbox"
            checked={bidirectional}
            onChange={(event) => setBidirectional(event.target.checked)}
          />
          양방향 환승으로 저장
        </label>
        <label className="input-label wide">
          메모
          <textarea
            className="text-area"
            placeholder="검증 근거나 수정 사유"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>

      <div className="action-row">
        <button type="button" className="primary-button" disabled={!canAdd} onClick={addEdge}>
          환승 edge 추가
        </button>
        <button type="button" className="secondary-button" disabled={saveState === "saving"} onClick={save}>
          {saveState === "saving" ? "저장 중" : "manual-overlays.json 저장"}
        </button>
      </div>

      {message ? <p className="message-box">{message}</p> : null}

      <section className="editor-panel" style={{ marginTop: 16 }}>
        <div className="panel-header">
          <p className="eyebrow">Transfer Edges</p>
          <h2>현재 수동 환승 {edges.length}개</h2>
        </div>

        <div className="edge-list">
          {edges.length === 0 ? <p className="empty-box">저장된 수동 환승 edge가 없습니다.</p> : null}
          {edges.map((edge) => (
            <TransferEdgeCard
              key={edge.id}
              edge={edge}
              fromStation={stationById.get(edge.fromStationId)}
              toStation={stationById.get(edge.toStationId)}
              onToggle={() => {
                setEdges((previous) =>
                  previous.map((item) => (item.id === edge.id ? { ...item, enabled: !item.enabled } : item)),
                );
              }}
              onDelete={() => {
                setEdges((previous) => previous.filter((item) => item.id !== edge.id));
              }}
            />
          ))}
        </div>
      </section>
    </>
  );
}

function StationPicker({
  title,
  query,
  selectedStation,
  stations,
  onQuery,
  onSelect,
}: {
  title: string;
  query: string;
  selectedStation: EditorStation | null;
  stations: EditorStation[];
  onQuery: (query: string) => void;
  onSelect: (station: EditorStation) => void;
}) {
  const normalizedQuery = normalizeSearchText(query);
  const results = useMemo(() => {
    if (!normalizedQuery) return stations.slice(0, 12);

    return stations
      .filter((station) => {
        const haystack = normalizeSearchText(`${station.nameKo} ${station.stationNumber} ${station.lineNameKo}`);
        return haystack.includes(normalizedQuery);
      })
      .slice(0, 12);
  }, [normalizedQuery, stations]);

  return (
    <div className="station-picker">
      <p className="station-picker-title">{title}</p>
      <p className="selected-station-label">{getStationLabel(selectedStation)}</p>
      <input
        className="text-input"
        placeholder="역명, 역번호, 노선명 검색"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
      />
      <div className="station-result-list">
        {results.map((station) => (
          <button
            key={station.id}
            type="button"
            className={selectedStation?.id === station.id ? "station-result-button active" : "station-result-button"}
            onClick={() => onSelect(station)}
          >
            <span className="station-result-name">{station.nameKo}</span>
            <span className="station-result-meta">{station.lineNameKo} · {station.stationNumber}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TransferEdgeCard({
  edge,
  fromStation,
  toStation,
  onToggle,
  onDelete,
}: {
  edge: ManualTransferEdge;
  fromStation: EditorStation | undefined;
  toStation: EditorStation | undefined;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="edge-card">
      <div className="edge-card-top">
        <div>
          <p className="edge-title">{getStationLabel(fromStation)} → {getStationLabel(toStation)}</p>
          <p className="edge-meta">
            {edge.bidirectional === false ? "단방향" : "양방향"} · {typeof edge.transferMinutes === "number" ? `${edge.transferMinutes}분` : "시간 미지정"}
          </p>
        </div>
        <span className={edge.enabled ? "status-pill" : "status-pill off"}>{edge.enabled ? "ON" : "OFF"}</span>
      </div>
      {edge.note ? <p className="edge-note">{edge.note}</p> : null}
      <div className="edge-actions">
        <button type="button" className="secondary-button" onClick={onToggle}>
          {edge.enabled ? "비활성" : "활성"}
        </button>
        <button type="button" className="danger-button" onClick={onDelete}>
          삭제
        </button>
      </div>
    </div>
  );
}
