"use client";

import type { ReactNode } from "react";
import type { RailMapStation } from "../RailMap";
import { formatNumber } from "../railExplorerModel";

export interface RouteResultEdgeView {
  toStationId: string;
  branchId: string;
  lineNameKo: string;
  sourceLineName: string;
  colorHex: string;
  kind: "ride" | "manual-transfer" | "timetable";
  transferMinutes?: number | null;
  durationMinutes?: number | null;
  distanceMeters?: number | null;
}

export interface RouteResultView {
  stationIds: string[];
  edges: RouteResultEdgeView[];
  transferCount: number;
  totalMinutes: number;
  totalDistanceMeters: number;
  criterion: string;
  label: string;
}

interface RouteResultPanelProps {
  results: RouteResultView[];
  activeResultIndex: number;
  stationById: Map<string, RailMapStation>;
  onSelectResult: (index: number) => void;
  comparisonContent?: ReactNode;
  diagnosticContent?: ReactNode;
  calculationContent?: ReactNode;
}

interface RouteSegment {
  branchId: string;
  lineNameKo: string;
  sourceLineName: string;
  colorHex: string;
  fromStationId: string;
  toStationId: string;
  edgeCount: number;
  kind: RouteResultEdgeView["kind"];
  transferMinutes?: number | null;
  durationMinutes?: number | null;
}

export default function RouteResultPanel({
  results,
  activeResultIndex,
  stationById,
  onSelectResult,
  comparisonContent,
  diagnosticContent,
  calculationContent,
}: RouteResultPanelProps) {
  const result = results[activeResultIndex] ?? results[0];
  if (!result) return null;

  const originName = stationById.get(result.stationIds[0] ?? "")?.nameKo ?? "출발";
  const destinationName =
    stationById.get(result.stationIds[result.stationIds.length - 1] ?? "")?.nameKo ?? "도착";
  const segments = buildSegments(result);

  return (
    <section className="route-result-panel mt-3 min-w-0 overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-lg shadow-slate-950/8">
      <header className="border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-sky-50/70 px-3 py-3">
        <p className="text-[10px] font-bold tracking-[0.08em] text-emerald-600 uppercase">추천 경로</p>
        <h3 className="mt-1 truncate text-sm font-bold text-slate-950" title={`${originName} → ${destinationName}`}>
          {originName} → {destinationName}
        </h3>

        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <Metric label="예상 시간" value={`${Math.ceil(result.totalMinutes).toLocaleString("ko-KR")}분`} strong />
          <Metric label="환승" value={`${result.transferCount.toLocaleString("ko-KR")}회`} />
          <Metric label="거리" value={formatDistance(result.totalDistanceMeters)} />
        </div>

        {results.length > 1 ? (
          <div className="mt-3 flex min-w-0 gap-1.5 overflow-x-auto pb-0.5">
            {results.map((candidate, index) => (
              <button
                key={`${candidate.criterion}:${index}`}
                type="button"
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${index === activeResultIndex ? "bg-slate-950 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}
                onClick={() => onSelectResult(index)}
              >
                {candidate.label} · {Math.ceil(candidate.totalMinutes)}분
              </button>
            ))}
          </div>
        ) : null}
        {comparisonContent}
      </header>

      <div className="route-result-timeline grid gap-0 px-3 py-3">
        {segments.map((segment, index) => (
          <RouteTimelineItem
            key={`${segment.branchId}:${segment.kind}:${index}:${segment.fromStationId}:${segment.toStationId}`}
            segment={segment}
            fromName={stationById.get(segment.fromStationId)?.nameKo ?? "이전 역"}
            toName={stationById.get(segment.toStationId)?.nameKo ?? "다음 역"}
            isLast={index === segments.length - 1}
          />
        ))}
      </div>

      {diagnosticContent || calculationContent ? (
        <div className="grid gap-1.5 border-t border-slate-100 bg-slate-50/70 px-3 py-2.5">
          {diagnosticContent ? <details className="route-result-detail"><summary>상세 진단</summary>{diagnosticContent}</details> : null}
          {calculationContent ? <details className="route-result-detail"><summary>계산 근거</summary>{calculationContent}</details> : null}
        </div>
      ) : null}
    </section>
  );
}

function buildSegments(result: RouteResultView): RouteSegment[] {
  const segments: RouteSegment[] = [];
  result.edges.forEach((edge, index) => {
    const fromStationId = result.stationIds[index];
    const toStationId = result.stationIds[index + 1];
    if (!fromStationId || !toStationId) return;
    const last = segments[segments.length - 1];
    if (last && last.branchId === edge.branchId && last.kind === edge.kind && edge.kind === "ride") {
      last.toStationId = toStationId;
      last.edgeCount += 1;
      last.durationMinutes = (last.durationMinutes ?? 0) + (edge.durationMinutes ?? 0);
      return;
    }
    segments.push({
      branchId: edge.branchId,
      lineNameKo: edge.lineNameKo,
      sourceLineName: edge.sourceLineName,
      colorHex: edge.colorHex,
      fromStationId,
      toStationId,
      edgeCount: 1,
      kind: edge.kind,
      transferMinutes: edge.transferMinutes,
      durationMinutes: edge.durationMinutes,
    });
  });
  return segments;
}

function RouteTimelineItem({ segment, fromName, toName, isLast }: { segment: RouteSegment; fromName: string; toName: string; isLast: boolean }) {
  if (segment.kind === "manual-transfer") {
    return (
      <div className="grid grid-cols-[22px_minmax(0,1fr)] gap-2">
        <div className="flex flex-col items-center"><span className="mt-1 h-3 w-3 rounded-full bg-slate-400" />{!isLast ? <span className="min-h-8 w-px flex-1 border-l border-dashed border-slate-300" /> : null}</div>
        <div className="mb-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-bold text-slate-700">환승 · {fromName === toName ? fromName : `${fromName} → ${toName}`}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">{typeof segment.transferMinutes === "number" ? `약 ${segment.transferMinutes}분` : "환승 시간 미입력"}</p>
        </div>
      </div>
    );
  }

  const lineLabel = segment.sourceLineName && segment.sourceLineName !== segment.lineNameKo
    ? `${segment.lineNameKo} · ${segment.sourceLineName}`
    : segment.lineNameKo;
  return (
    <div className="grid grid-cols-[22px_minmax(0,1fr)] gap-2">
      <div className="flex flex-col items-center">
        <span className="mt-1 h-3.5 w-3.5 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: segment.colorHex }} />
        {!isLast ? <span className="min-h-12 w-1 flex-1 rounded-full" style={{ backgroundColor: segment.colorHex }} /> : null}
      </div>
      <div className="mb-2 min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm shadow-slate-950/5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[11px] font-bold text-slate-900" title={lineLabel}>{lineLabel}</p>
          <span className="shrink-0 text-[10px] font-semibold text-slate-500">{segment.kind === "timetable" ? "시간표" : `${Math.max(1, segment.edgeCount)}구간`}</span>
        </div>
        <p className="mt-1 truncate text-xs font-semibold text-slate-800" title={`${fromName} → ${toName}`}>{fromName} → {toName}</p>
        {typeof segment.durationMinutes === "number" && segment.durationMinutes > 0 ? <p className="mt-0.5 text-[10px] text-slate-500">약 {Math.ceil(segment.durationMinutes)}분</p> : null}
      </div>
    </div>
  );
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`rounded-2xl px-2.5 py-2 ${strong ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-800"}`}><span className={`block text-[10px] font-medium ${strong ? "text-white/60" : "text-slate-400"}`}>{label}</span><strong className="mt-0.5 block truncate text-sm font-bold">{value}</strong></div>;
}

function formatDistance(distanceMeters: number) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return "-";
  if (distanceMeters >= 1000) return `${formatNumber(Math.round(distanceMeters / 100) / 10)}km`;
  return `${formatNumber(Math.round(distanceMeters))}m`;
}
