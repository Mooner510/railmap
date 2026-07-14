"use client";

import { Badge } from "@repo/ui/badge";
import { cn } from "@repo/ui/utils";
import { ChevronRight } from "lucide-react";
import { memo, useMemo } from "react";
import type { EditorStation, ManualOverlayBundle } from "../editorModel";
import { makeTransferPairKey } from "../editorModel";
import type { LineBranchValidationIssue } from "./validationPanel";

type AuditNavigationTab = "manualLines" | "transfers" | "patterns" | "validation";

type Props = {
  overlays: ManualOverlayBundle;
  stationById: Map<string, EditorStation>;
  validationIssues: LineBranchValidationIssue[];
  onNavigate: (tab: AuditNavigationTab) => void;
};

function getTimetableMinutes(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function getPrimaryTime(stop: { arrivalTime?: string | null; departureTime?: string | null }) {
  return stop.departureTime || stop.arrivalTime || null;
}

function EmptyAuditState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center">
      <strong className="block text-xs font-semibold text-slate-700">위험 항목 없음</strong>
      <p className="mt-1 text-[11px] leading-4 text-slate-500">현재 감사 기준에서는 큰 누락이 보이지 않습니다.</p>
    </div>
  );
}

export const ManualDataAuditDashboard = memo(function ManualDataAuditDashboard({
  overlays,
  stationById,
  validationIssues,
  onNavigate,
}: Props) {
  const model = useMemo(() => {
    const enabledManualLines = overlays.manualLineDefinitions.filter((line) => line.enabled !== false);
    const enabledTransferGroups = overlays.manualTransferGroups.filter((group) => group.enabled !== false);
    const enabledPatterns = overlays.manualServicePatterns.filter((pattern) => pattern.enabled !== false);
    const enabledTrainRuns = overlays.manualTrainRuns.filter((run) => run.enabled !== false);
    const patternIdsWithTrainRuns = new Set(enabledTrainRuns.map((run) => run.patternId).filter(Boolean));
    const patternsWithoutTrainRuns = enabledPatterns.filter((pattern) => !patternIdsWithTrainRuns.has(pattern.id));
    const transferGroupsWithoutTime = enabledTransferGroups.filter((group) => {
      const stationIds = group.stationIds.filter(Boolean);
      if (stationIds.length < 2) return false;
      for (let i = 0; i < stationIds.length - 1; i += 1) {
        for (let j = i + 1; j < stationIds.length; j += 1) {
          const fromStationId = stationIds[i];
          const toStationId = stationIds[j];
          if (!fromStationId || !toStationId) continue;
          if (typeof group.transferMinutesByPair?.[makeTransferPairKey(fromStationId, toStationId)] !== "number") return true;
        }
      }
      return false;
    });
    const missingStationReferences = enabledPatterns.flatMap((pattern) =>
      pattern.stops.filter((stop) => !stationById.has(stop.stationId)),
    );
    const trainRunsWithSparseTimes = enabledTrainRuns.filter(
      (run) => run.stopTimes.filter((stop) => stop.arrivalTime || stop.departureTime).length < 2,
    );
    const trainRunsWithTimeOrderWarnings = enabledTrainRuns.filter((run) => {
      let previous: number | null = null;
      for (const stop of run.stopTimes.slice().sort((a, b) => a.sequence - b.sequence)) {
        const current = getTimetableMinutes(getPrimaryTime(stop));
        if (current === null) continue;
        if (previous !== null && current < previous) return true;
        previous = current;
      }
      return false;
    });
    const manualLinesWithoutPerformance = enabledManualLines.filter((line) => {
      const performance = line.trainPerformance;
      return !performance ||
        typeof performance.accelerationMps2 !== "number" ||
        typeof performance.decelerationMps2 !== "number" ||
        typeof performance.maxSpeedKph !== "number";
    });
    const enabledOneWayBranches = overlays.branchRouteOverrides.filter(
      (branch) => branch.enabled !== false && (branch.routeDirection === "forward" || branch.routeDirection === "reverse"),
    );
    const oneWayBranchesWithTooFewStops = enabledOneWayBranches.filter((branch) => branch.stationIds.filter(Boolean).length < 2);
    const circularOneWayBranches = enabledOneWayBranches.filter((branch) => branch.circular === true);
    const oneWayBranchById = new Map(enabledOneWayBranches.map((branch) => [branch.branchId, branch]));
    const oneWayPatternDirectionIssues = enabledPatterns.filter((pattern) => {
      if (!pattern.branchId) return false;
      const branch = oneWayBranchById.get(pattern.branchId);
      if (!branch) return false;
      const indexByStationId = new Map(branch.stationIds.map((stationId, index) => [stationId, index]));
      const orderedStops = pattern.stops.slice().sort((a, b) => a.sequence - b.sequence);
      let previousIndex: number | null = null;
      for (const stop of orderedStops) {
        const currentIndex = indexByStationId.get(stop.stationId);
        if (currentIndex === undefined) continue;
        if (previousIndex !== null) {
          if (branch.routeDirection === "forward" && currentIndex < previousIndex) return true;
          if (branch.routeDirection === "reverse" && currentIndex > previousIndex) return true;
        }
        previousIndex = currentIndex;
      }
      return false;
    });
    const routeReadyPatternCount = enabledPatterns.filter((pattern) => patternIdsWithTrainRuns.has(pattern.id)).length;
    const oneWayIssueCount = oneWayBranchesWithTooFewStops.length + circularOneWayBranches.length + oneWayPatternDirectionIssues.length;

    const routeDiagnostics = [
      { label: "시간표 우선 계산", value: enabledTrainRuns.length, detail: `${routeReadyPatternCount.toLocaleString("ko-KR")}개 패턴 연결`, warning: enabledTrainRuns.length === 0 },
      { label: "성능 fallback", value: manualLinesWithoutPerformance.length, detail: "성능값 누락 노선", warning: manualLinesWithoutPerformance.length > 0 },
      { label: "환승 edge", value: transferGroupsWithoutTime.length, detail: "환승 시간 미완성", warning: transferGroupsWithoutTime.length > 0 },
      { label: "시간 순서", value: trainRunsWithTimeOrderWarnings.length, detail: "이전 역보다 빠른 시각", warning: trainRunsWithTimeOrderWarnings.length > 0 },
      { label: "단방향 정합성", value: oneWayIssueCount, detail: `${enabledOneWayBranches.length.toLocaleString("ko-KR")}개 단방향 branch`, warning: oneWayIssueCount > 0 },
    ];
    const comparisonReadinessItems = [
      { label: "최단 시간", ready: enabledTrainRuns.length > 0 || manualLinesWithoutPerformance.length < enabledManualLines.length },
      { label: "최소 환승", ready: enabledTransferGroups.length > 0 },
      { label: "시간표 우선", ready: routeReadyPatternCount > 0 },
    ];
    const auditItems = [
      { label: "수기 노선", value: enabledManualLines.length, detail: `${overlays.manualBranchDefinitions.length.toLocaleString("ko-KR")}개 지선` },
      { label: "환승 그룹", value: enabledTransferGroups.length, detail: `${transferGroupsWithoutTime.length.toLocaleString("ko-KR")}개 시간 확인` },
      { label: "정차 패턴", value: enabledPatterns.length, detail: `${patternsWithoutTrainRuns.length.toLocaleString("ko-KR")}개 시간표 없음` },
      { label: "시간표", value: enabledTrainRuns.length, detail: `${trainRunsWithSparseTimes.length.toLocaleString("ko-KR")}개 시각 부족` },
      { label: "검증 이슈", value: validationIssues.length, detail: `${missingStationReferences.length.toLocaleString("ko-KR")}개 역 참조 확인` },
    ];
    const riskItems = [
      transferGroupsWithoutTime.length > 0 ? { label: `환승 시간 미입력 ${transferGroupsWithoutTime.length.toLocaleString("ko-KR")}개`, tab: "transfers" as const } : null,
      patternsWithoutTrainRuns.length > 0 ? { label: `시간표 없는 정차 패턴 ${patternsWithoutTrainRuns.length.toLocaleString("ko-KR")}개`, tab: "patterns" as const } : null,
      trainRunsWithSparseTimes.length > 0 ? { label: `시각 부족 시간표 ${trainRunsWithSparseTimes.length.toLocaleString("ko-KR")}개`, tab: "patterns" as const } : null,
      trainRunsWithTimeOrderWarnings.length > 0 ? { label: `시간 순서 확인 ${trainRunsWithTimeOrderWarnings.length.toLocaleString("ko-KR")}개`, tab: "patterns" as const } : null,
      manualLinesWithoutPerformance.length > 0 ? { label: `성능값 누락 노선 ${manualLinesWithoutPerformance.length.toLocaleString("ko-KR")}개`, tab: "manualLines" as const } : null,
      oneWayBranchesWithTooFewStops.length > 0 ? { label: `정차역 부족 단방향 ${oneWayBranchesWithTooFewStops.length.toLocaleString("ko-KR")}개`, tab: "manualLines" as const } : null,
      circularOneWayBranches.length > 0 ? { label: `순환·단방향 충돌 ${circularOneWayBranches.length.toLocaleString("ko-KR")}개`, tab: "manualLines" as const } : null,
      oneWayPatternDirectionIssues.length > 0 ? { label: `단방향 역행 정차 패턴 ${oneWayPatternDirectionIssues.length.toLocaleString("ko-KR")}개`, tab: "patterns" as const } : null,
      missingStationReferences.length > 0 ? { label: `없는 역 참조 ${missingStationReferences.length.toLocaleString("ko-KR")}개`, tab: "patterns" as const } : null,
      validationIssues.length > 0 ? { label: `검증 패널 이슈 ${validationIssues.length.toLocaleString("ko-KR")}개`, tab: "validation" as const } : null,
    ].filter((item): item is NonNullable<typeof item> => item !== null);

    return { auditItems, routeDiagnostics, comparisonReadinessItems, riskItems };
  }, [overlays, stationById, validationIssues]);

  const hasDiagnosticWarnings = model.routeDiagnostics.some((item) => item.warning);

  return (
    <div className="grid gap-3">
      <section className="rounded-3xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <strong className="block text-sm font-semibold text-slate-900">수기 데이터 감사</strong>
            <p className="mt-1 text-xs text-slate-500">노선·환승·시간표의 핵심 상태만 요약합니다.</p>
          </div>
          <Badge className={model.riskItems.length > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}>
            {model.riskItems.length > 0 ? "확인 필요" : "양호"}
          </Badge>
        </div>
        <div className="mt-3 grid gap-1.5">
          {model.auditItems.map((item) => (
            <div key={item.label} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold text-slate-700">{item.label}</p>
                <p className="truncate text-[10px] text-slate-500">{item.detail}</p>
              </div>
              <strong className="shrink-0 text-base font-semibold tabular-nums text-slate-900">{item.value.toLocaleString("ko-KR")}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <strong className="block text-sm font-semibold text-slate-900">경로검색 품질 진단</strong>
            <p className="mt-1 text-xs text-slate-500">검색 결과에 직접 영향을 주는 항목입니다.</p>
          </div>
          <Badge className={hasDiagnosticWarnings ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}>
            {hasDiagnosticWarnings ? "보정 필요" : "준비됨"}
          </Badge>
        </div>
        <div className="mt-3 grid gap-1.5">
          {model.routeDiagnostics.map((item) => (
            <div key={item.label} className={cn("grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-3 py-2", item.warning ? "border-amber-100 bg-amber-50" : "border-emerald-100 bg-emerald-50")}>
              <div className="min-w-0">
                <p className={cn("truncate text-[11px] font-semibold", item.warning ? "text-amber-700" : "text-emerald-700")}>{item.label}</p>
                <p className="truncate text-[10px] text-slate-500">{item.detail}</p>
              </div>
              <strong className="shrink-0 text-base font-semibold tabular-nums text-slate-900">{item.value.toLocaleString("ko-KR")}</strong>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {model.comparisonReadinessItems.map((item) => (
            <div key={item.label} className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 px-2 py-2 text-center">
              <span className="block truncate text-[10px] font-semibold text-slate-600">{item.label}</span>
              <span className={cn("mt-1 block truncate text-[10px] font-semibold", item.ready ? "text-emerald-700" : "text-amber-700")}>
                {item.ready ? "가능" : "부족"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4">
        <strong className="text-sm font-semibold text-slate-900">바로 수정할 항목</strong>
        <div className="mt-3 grid gap-1.5">
          {model.riskItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => onNavigate(item.tab)}
              className="grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-left text-[11px] font-medium leading-4 text-amber-800 transition hover:border-amber-200 hover:bg-amber-100"
            >
              <span className="min-w-0 truncate">{item.label}</span>
              <ChevronRight className="size-3.5 shrink-0" />
            </button>
          ))}
          {model.riskItems.length === 0 ? <EmptyAuditState /> : null}
        </div>
      </section>
    </div>
  );
});
