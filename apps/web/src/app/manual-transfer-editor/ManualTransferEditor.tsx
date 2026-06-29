"use client";

import { useMemo, useState } from "react";
import { normalizeSearchText, type ManualTransferEdge } from "../railExplorerModel";

interface EditorStation {
  id: string;
  nameKo: string;
  stationNumber: string;
  lineNameKo: string;
}

interface ManualOverlays {
  schemaVersion: 1;
  manualTransferEdges: ManualTransferEdge[];
}

interface ManualTransferEditorProps {
  stations: EditorStation[];
  initialOverlays: ManualOverlays;
}

type TransferEndpoint = "from" | "to";

function makeTransferId(fromStationId: string, toStationId: string) {
  return `manual-transfer:${fromStationId}:${toStationId}`;
}

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
          schemaVersion: 1,
          manualTransferEdges: edges,
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const saved = (await response.json()) as ManualOverlays;
      setEdges(saved.manualTransferEdges);
      setSaveState("saved");
      setMessage("manual-overlays.json에 저장되었습니다. viewer는 새로고침 후 반영됩니다.");
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    }
  };

  return (
    <main className="min-h-[100dvh] bg-slate-100 p-4 text-slate-950">
      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 border border-slate-200 bg-white p-4 shadow-sm">
          <div className="border-b border-slate-200 pb-3">
            <p className="text-[11px] font-bold tracking-wide text-slate-400 uppercase">Manual Transfer Editor</p>
            <h1 className="mt-1 text-xl font-black">수동 환승 edge 편집</h1>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              공공 데이터에 없는 환승 연결을 직접 추가합니다. 저장된 edge는 경로검색 graph에 포함됩니다.
            </p>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
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

          <div className="mt-4 grid gap-3 border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[120px_minmax(0,1fr)]">
            <label className="text-xs font-bold text-slate-500">
              환승 시간(분)
              <input
                type="number"
                min="0"
                className="mt-1 h-9 w-full border border-slate-200 bg-white px-2 text-sm font-semibold outline-none focus:border-sky-400"
                value={transferMinutes}
                onChange={(event) => setTransferMinutes(event.target.value)}
              />
            </label>
            <label className="text-xs font-bold text-slate-500">
              표시 이름
              <input
                className="mt-1 h-9 w-full border border-slate-200 bg-white px-2 text-sm font-semibold outline-none focus:border-sky-400"
                placeholder="예: 공덕 환승"
                value={labelKo}
                onChange={(event) => setLabelKo(event.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-600 lg:col-span-2">
              <input
                type="checkbox"
                checked={bidirectional}
                onChange={(event) => setBidirectional(event.target.checked)}
              />
              양방향 환승으로 저장
            </label>
            <label className="text-xs font-bold text-slate-500 lg:col-span-2">
              메모
              <textarea
                className="mt-1 min-h-20 w-full resize-y border border-slate-200 bg-white p-2 text-sm font-medium outline-none focus:border-sky-400"
                placeholder="검증 근거나 수정 사유"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="h-9 bg-slate-950 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={!canAdd}
              onClick={addEdge}
            >
              환승 edge 추가
            </button>
            <button
              type="button"
              className="h-9 border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={saveState === "saving"}
              onClick={save}
            >
              {saveState === "saving" ? "저장 중" : "manual-overlays.json 저장"}
            </button>
          </div>

          {message ? (
            <p className="mt-3 break-words border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
              {message}
            </p>
          ) : null}
        </section>

        <aside className="min-w-0 border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div>
              <p className="text-[11px] font-bold tracking-wide text-slate-400 uppercase">Transfer Edges</p>
              <h2 className="mt-1 text-base font-black">현재 수동 환승</h2>
            </div>
            <span className="rounded bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">{edges.length}</span>
          </div>

          <div className="mt-3 grid max-h-[calc(100dvh-140px)] gap-2 overflow-y-auto">
            {edges.length === 0 ? (
              <p className="border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-sm font-semibold text-slate-400">
                저장된 수동 환승 edge가 없습니다.
              </p>
            ) : null}
            {edges.map((edge) => (
              <TransferEdgeCard
                key={edge.id}
                edge={edge}
                fromStation={stationById.get(edge.fromStationId)}
                toStation={stationById.get(edge.toStationId)}
                onToggle={() => {
                  setEdges((previous) => previous.map((item) => item.id === edge.id ? { ...item, enabled: !item.enabled } : item));
                }}
                onDelete={() => {
                  setEdges((previous) => previous.filter((item) => item.id !== edge.id));
                }}
              />
            ))}
          </div>
        </aside>
      </div>
    </main>
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
    <div className="min-w-0 border border-slate-200 bg-white p-3">
      <p className="text-xs font-black text-slate-700">{title}</p>
      <p className="mt-1 break-words text-xs font-semibold text-slate-500">{getStationLabel(selectedStation)}</p>
      <input
        className="mt-2 h-9 w-full border border-slate-200 bg-slate-50 px-2 text-sm font-semibold outline-none focus:border-sky-400"
        placeholder="역명, 역번호, 노선명 검색"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
      />
      <div className="mt-2 grid max-h-64 gap-1 overflow-y-auto">
        {results.map((station) => (
          <button
            key={station.id}
            type="button"
            className={
              selectedStation?.id === station.id
                ? "border border-sky-300 bg-sky-50 px-2 py-1.5 text-left text-xs font-bold text-sky-900"
                : "border border-slate-200 bg-white px-2 py-1.5 text-left text-xs font-semibold text-slate-700 hover:border-sky-200 hover:bg-sky-50"
            }
            onClick={() => onSelect(station)}
          >
            <span className="block truncate">{station.nameKo}</span>
            <span className="mt-0.5 block truncate text-[11px] text-slate-400">{station.lineNameKo} · {station.stationNumber}</span>
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
    <div className="min-w-0 border border-slate-200 bg-slate-50 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-xs font-black text-slate-900">{getStationLabel(fromStation)} → {getStationLabel(toStation)}</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">
            {edge.bidirectional === false ? "단방향" : "양방향"} · {typeof edge.transferMinutes === "number" ? `${edge.transferMinutes}분` : "시간 미지정"}
          </p>
        </div>
        <span className={edge.enabled ? "shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-700" : "shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-black text-slate-500"}>
          {edge.enabled ? "ON" : "OFF"}
        </span>
      </div>
      {edge.note ? <p className="mt-1 break-words text-[11px] font-medium text-slate-500">{edge.note}</p> : null}
      <div className="mt-2 flex gap-1.5">
        <button type="button" className="h-7 flex-1 border border-slate-300 bg-white text-xs font-bold text-slate-600" onClick={onToggle}>
          {edge.enabled ? "비활성" : "활성"}
        </button>
        <button type="button" className="h-7 flex-1 border border-rose-200 bg-white text-xs font-bold text-rose-600" onClick={onDelete}>
          삭제
        </button>
      </div>
    </div>
  );
}
