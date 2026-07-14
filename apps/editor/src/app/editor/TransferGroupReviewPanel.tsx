"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { memo, useMemo, useState } from "react";
import type { EditorStation } from "../editorModel";
import {
  filterTransferGroupSuggestions,
  type TransferGroupReviewFilter,
  type TransferGroupSuggestion,
} from "./transferRecommendation";

type Props = {
  suggestions: TransferGroupSuggestion[];
  dismissedKeys: string[];
  dismissedNotes: Record<string, string>;
  approvedKeys: ReadonlySet<string>;
  activeKey: string | null;
  filter: TransferGroupReviewFilter;
  stationById: ReadonlyMap<string, EditorStation>;
  formatStationSubLabel: (station: EditorStation) => string;
  onChangeFilter: (filter: TransferGroupReviewFilter) => void;
  onOpenSuggestion: (suggestion: TransferGroupSuggestion) => void;
  onSelectSuggestion: (suggestion: TransferGroupSuggestion) => void;
  onDismissSuggestion: (suggestion: TransferGroupSuggestion, reason?: string) => void;
};

export const TransferGroupReviewPanel = memo(function TransferGroupReviewPanel({
  suggestions,
  dismissedKeys,
  dismissedNotes,
  approvedKeys,
  activeKey,
  filter,
  stationById,
  formatStationSubLabel,
  onChangeFilter,
  onOpenSuggestion,
  onSelectSuggestion,
  onDismissSuggestion,
}: Props) {
  const dismissed = useMemo(() => new Set(dismissedKeys), [dismissedKeys]);
  const filteredSuggestions = useMemo(
    () => filterTransferGroupSuggestions(suggestions, filter, approvedKeys, dismissed),
    [approvedKeys, dismissed, filter, suggestions],
  );
  const [dismissReason, setDismissReason] = useState("환승역 아님");
  const [dismissTarget, setDismissTarget] = useState<TransferGroupSuggestion | null>(null);
  const activeIndex = Math.max(
    0,
    filteredSuggestions.findIndex((suggestion) => suggestion.key === activeKey),
  );
  const activeSuggestion = filteredSuggestions[activeIndex] ?? filteredSuggestions[0] ?? null;

  return (
    <div className="grid gap-2">
      <div className="rounded-2xl border border-violet-100 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <strong className="block truncate text-sm font-medium text-slate-900">환승 추천</strong>
            <p className="mt-0.5 text-[11px] font-normal text-slate-500">후보 선택 시 지도에 강조됩니다.</p>
          </div>
          <Badge className="bg-violet-50 text-violet-700">{filteredSuggestions.length}개</Badge>
        </div>
        <select
          className="mt-2 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-normal text-slate-700 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
          value={filter}
          onChange={(event) => onChangeFilter(event.target.value as TransferGroupReviewFilter)}
        >
          <option value="pending">검토 필요</option>
          <option value="all">전체</option>
          <option value="dismissed">거절됨</option>
          <option value="approved">승인됨</option>
        </select>
      </div>

      {activeSuggestion ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-400">{activeIndex + 1} / {filteredSuggestions.length}</p>
              <strong className="mt-0.5 block truncate text-base font-medium text-slate-950">{activeSuggestion.nameKo}</strong>
              <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">
                {activeSuggestion.confidence === "strong" ? "강한 추천" : "확인 필요"} · 최대 {Math.ceil(activeSuggestion.maxDistanceMeters).toLocaleString("ko-KR")}m
              </p>
            </div>
            <div className="grid justify-items-end gap-1">
              <Badge className={activeSuggestion.confidence === "strong" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}>
                {activeSuggestion.stationIds.length}개 역
              </Badge>
              {approvedKeys.has(activeSuggestion.key) ? (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">승인됨</span>
              ) : dismissed.has(activeSuggestion.key) ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">거절됨</span>
              ) : null}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1">
            {activeSuggestion.reasonLabels.map((label) => (
              <span key={label} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{label}</span>
            ))}
          </div>

          {dismissed.has(activeSuggestion.key) && dismissedNotes[activeSuggestion.key] ? (
            <p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-normal text-slate-600">
              거절 사유: {dismissedNotes[activeSuggestion.key]}
            </p>
          ) : null}

          <div className="mt-2 grid gap-1 rounded-2xl border border-slate-100 bg-slate-50 p-1.5">
            {activeSuggestion.stationIds.map((stationId) => {
              const station = stationById.get(stationId);
              return (
                <div key={stationId} className="flex min-w-0 items-center gap-2 rounded-xl bg-white px-2 py-1.5">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: station?.colorHex ?? "#64748b" }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-slate-800">{station?.nameKo ?? stationId}</span>
                    <span className="block truncate text-[10px] font-medium text-slate-400">{station ? formatStationSubLabel(station) : "존재하지 않는 역"}</span>
                  </span>
                </div>
              );
            })}
          </div>

          {!approvedKeys.has(activeSuggestion.key) && !dismissed.has(activeSuggestion.key) ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => { setDismissReason("환승역 아님"); setDismissTarget(activeSuggestion); }}>거절</Button>
              <Button onClick={() => onOpenSuggestion(activeSuggestion)}>수정 후 승인</Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center">
          <strong className="block text-sm font-medium text-slate-800">검토할 추천 없음</strong>
          <p className="mt-1 text-xs text-slate-500">필터를 전체로 바꾸거나 수기 역을 더 추가하세요.</p>
        </div>
      )}

      {filteredSuggestions.length > 1 ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={activeIndex <= 0} onClick={() => onSelectSuggestion(filteredSuggestions[Math.max(0, activeIndex - 1)]!)}>이전</Button>
          <Button variant="outline" disabled={activeIndex >= filteredSuggestions.length - 1} onClick={() => onSelectSuggestion(filteredSuggestions[Math.min(filteredSuggestions.length - 1, activeIndex + 1)]!)}>다음</Button>
        </div>
      ) : null}

      <Dialog open={Boolean(dismissTarget)} onClose={() => setDismissTarget(null)} className="max-w-md overflow-hidden rounded-[28px]">
        <div className="border-b border-slate-200 px-4 py-3">
          <strong className="block text-sm font-medium text-slate-950">추천 거절</strong>
          <p className="mt-1 text-xs font-normal text-slate-500">거절 사유를 선택한 뒤 반영하세요.</p>
        </div>
        <div className="grid gap-3 p-4">
          <div className="rounded-2xl bg-slate-50 px-3 py-2">
            <p className="text-xs font-medium text-slate-500">대상</p>
            <p className="mt-0.5 truncate text-sm font-medium text-slate-900">{dismissTarget?.nameKo ?? "환승 추천"}</p>
          </div>
          <select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-700 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100" value={dismissReason} onChange={(event) => setDismissReason(event.target.value)}>
            <option value="환승역 아님">환승역 아님</option>
            <option value="거리가 멂">거리가 멂</option>
            <option value="동명이역">동명이역</option>
            <option value="나중에 재검토">나중에 재검토</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 py-3">
          <Button variant="outline" onClick={() => setDismissTarget(null)}>취소</Button>
          <Button onClick={() => { if (!dismissTarget) return; onDismissSuggestion(dismissTarget, dismissReason); setDismissTarget(null); }}>거절 반영</Button>
        </div>
      </Dialog>
    </div>
  );
});
