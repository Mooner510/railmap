import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { Waypoints } from "lucide-react";
import type { ManualGeometryOverridePoint, ManualOverlayBundle } from "../editorModel";

export type LineBranchValidationIssueCategory =
  | "missing-reference"
  | "invalid-connection"
  | "station-line-identity"
  | "stale-anchor"
  | "detached-geometry"
  | "missing-geometry";

export type LineBranchValidationIssueSeverity = "error" | "warning";

export type LineBranchValidationAutoFix =
  | { kind: "delete-line-branch"; id: string }
  | { kind: "delete-branch-station-exclusion"; id: string }
  | { kind: "remove-branch-route-station"; overrideId: string; stationId: string }
  | { kind: "convert-geometry-station-to-control"; branchId: string; pointIndex: number }
  | { kind: "convert-line-branch-station-to-control"; overrideId: string; pointIndex: number }
  | { kind: "create-geometry-from-branch-stops"; branchId: string };

export type LineBranchValidationIssue = {
  id: string;
  title: string;
  message: string;
  category: LineBranchValidationIssueCategory;
  severity: LineBranchValidationIssueSeverity;
  cause: string;
  solution: string;
  autoFix?: LineBranchValidationAutoFix;
  includeInBulkFix?: boolean;
};

export type StaleSavedStationAnchorSummary = {
  stationId: string;
  stationLabel: string;
  changedCount: number;
  geometryCount: number;
  lineBranchCount: number;
};

type PublicWebParityStatus = "ok" | "warning" | "error";

type PublicWebParityRow = {
  label: string;
  status: PublicWebParityStatus;
  value: string;
  description: string;
};

function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
      <strong className="text-sm font-semibold text-slate-700">{title}</strong>
      <p className="mt-2 text-xs font-medium leading-5 text-slate-500">
        {description}
      </p>
    </div>
  );
}

function getValidationCategoryLabel(category: LineBranchValidationIssueCategory) {
  if (category === "missing-reference") return "존재하지 않는 대상";
  if (category === "invalid-connection") return "잘못된 연결";
  if (category === "station-line-identity") return "역/노선 규칙 위반";
  if (category === "stale-anchor") return "저장 선형 anchor 불일치";
  if (category === "detached-geometry") return "선형 좌표 문제";
  if (category === "missing-geometry") return "선형 없음";
  return "기타 문제";
}

function getValidationCategoryDescription(category: LineBranchValidationIssueCategory) {
  if (category === "missing-reference") return "현재 데이터에서 찾을 수 없는 역/노선/override 참조입니다.";
  if (category === "invalid-connection") return "노선 결합 방향이나 연결 기준이 현재 규칙과 맞지 않습니다.";
  if (category === "station-line-identity") return "한 stationId를 여러 노선의 역처럼 직접 재사용한 문제입니다.";
  if (category === "stale-anchor") return "역 위치 변경 후 저장 선형의 station anchor가 이전 좌표에 남아 있습니다.";
  if (category === "detached-geometry") return "station anchor가 실제 역 위치와 너무 멀거나 좌표 품질이 낮습니다.";
  if (category === "missing-geometry") return "정차역은 있지만 지도에 그릴 선형 좌표가 없습니다.";
  return "추가 확인이 필요한 문제입니다.";
}

function getPublicWebManualChangeRows(overlays: ManualOverlayBundle) {
  return [
    { label: "역 보정", count: overlays.stationOverrides.length, description: "역 표시명, 위치 override, 메모가 공개 Web 역/선형 계산에 반영됩니다." },
    { label: "환승 그룹", count: overlays.manualTransferGroups.length, description: "환승역 collapsed/expanded 표시와 환승 그룹 라벨에 반영됩니다." },
    { label: "미환승역", count: overlays.nonTransferStationIds.length, description: "환승 후보에서 제외되는 역 목록입니다." },
    { label: "노선별 역 제외", count: overlays.branchStationExclusions.length, description: "특정 branch에서 역을 제거한 override입니다." },
    { label: "노선 정차 순서", count: overlays.branchRouteOverrides.length, description: "기존 branch의 역 추가/삭제/순서 변경 override입니다." },
    { label: "지선 overlay", count: (overlays.lineBranchOverrides ?? []).length, description: "지선 추가/노선 결합으로 만든 수동 지선 선형입니다." },
    { label: "선형 보정", count: overlays.geometryOverrides.length, description: "일반 branch의 수동 station anchor/control point 보정입니다." },
    { label: "노선 보정", count: overlays.branchOverrides.length, description: "노선 단위 표시/메타 보정입니다." },
  ];
}

function getPublicWebManualChangeTotal(overlays: ManualOverlayBundle) {
  return getPublicWebManualChangeRows(overlays).reduce((total, row) => total + row.count, 0);
}

function formatParityStatusLabel(status: PublicWebParityStatus) {
  if (status === "error") return "확인 필요";
  if (status === "warning") return "주의";
  return "정상";
}

function getParityStatusClassName(status: PublicWebParityStatus) {
  if (status === "error") return "border-red-100 bg-red-50 text-red-700";
  if (status === "warning") return "border-amber-100 bg-amber-50 text-amber-700";
  return "border-emerald-100 bg-emerald-50 text-emerald-700";
}

function countStationAnchorReferences(points: ManualGeometryOverridePoint[] = []) {
  return points.filter((point) => point.kind === "station" && point.stationId).length;
}

function getPublicWebParityRows(overlays: ManualOverlayBundle, issues: LineBranchValidationIssue[]): PublicWebParityRow[] {
  const stationOverrideCount = overlays.stationOverrides.length;
  const geometryOverrideCount = overlays.geometryOverrides.length;
  const branchRouteOverrideCount = overlays.branchRouteOverrides.length;
  const lineBranchOverrideCount = overlays.lineBranchOverrides?.length ?? 0;
  const stationAnchorReferenceCount =
    overlays.geometryOverrides.reduce((total, override) => total + countStationAnchorReferences(override.points), 0) +
    (overlays.lineBranchOverrides ?? []).reduce((total, override) => total + countStationAnchorReferences(override.geometry ?? []), 0);

  return [
    { label: "역 위치 반영", status: stationOverrideCount > 0 ? "ok" : "warning", value: `${stationOverrideCount.toLocaleString("ko-KR")}개`, description: stationOverrideCount > 0 ? "Web에서 역 위치 보정값을 읽어 표시합니다." : "현재 Web에 반영할 역 위치 보정이 없습니다." },
    { label: "선형 보정 반영", status: geometryOverrideCount + branchRouteOverrideCount + lineBranchOverrideCount > 0 ? "ok" : "warning", value: `${(geometryOverrideCount + branchRouteOverrideCount + lineBranchOverrideCount).toLocaleString("ko-KR")}개`, description: geometryOverrideCount + branchRouteOverrideCount + lineBranchOverrideCount > 0 ? "Web에서 일반 선형 보정, 노선 정차 순서, 수동 지선을 함께 읽습니다." : "현재 Web에 반영할 선형 보정이 없습니다." },
    { label: "역 anchor 재계산", status: stationAnchorReferenceCount > 0 ? "ok" : "warning", value: `${stationAnchorReferenceCount.toLocaleString("ko-KR")}개`, description: stationAnchorReferenceCount > 0 ? "Web에서 station anchor를 현재 역 위치 기준으로 다시 계산합니다." : "현재 점검할 station anchor가 없습니다." },
    { label: "검증 오류", status: issues.length > 0 ? "error" : "ok", value: `${issues.length.toLocaleString("ko-KR")}개`, description: issues.length > 0 ? "이 오류는 Web 표시에서도 문제를 만들 수 있으니 먼저 고쳐야 합니다." : "현재 저장된 overlay에서 Web 표시를 막을 오류가 없습니다." },
  ];
}

function getValidationIssueToneClassName(issue: LineBranchValidationIssue) {
  if (issue.severity === "warning") return "border-amber-100 bg-amber-50 text-amber-900";
  return "border-red-100 bg-red-50 text-red-900";
}

function getValidationIssueBadgeClassName(issue: LineBranchValidationIssue) {
  if (issue.severity === "warning") return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function ValidationStatCard({
  label,
  value,
  description,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  description: string;
  tone?: "slate" | "red" | "amber" | "blue" | "emerald";
}) {
  const toneClassName = {
    slate: "border-slate-200 bg-white text-slate-700",
    red: "border-red-100 bg-red-50 text-red-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    blue: "border-blue-100 bg-blue-50 text-blue-700",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
  }[tone];

  return (
    <div className={cn("rounded-2xl border px-3 py-2", toneClassName)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-tight opacity-70">{label}</span>
        <strong className="text-sm font-black">{value}</strong>
      </div>
      <p className="mt-1 text-[10px] font-semibold leading-4 opacity-80">{description}</p>
    </div>
  );
}

export function LineBranchValidationPanel({
  count,
  issues,
  overlays,
  staleSavedAnchorSummaries,
  onSyncStaleSavedAnchors,
  onApplyIssueFix,
  onApplyAllSafeFixes,
}: {
  count: number;
  issues: LineBranchValidationIssue[];
  overlays: ManualOverlayBundle;
  staleSavedAnchorSummaries: StaleSavedStationAnchorSummary[];
  onSyncStaleSavedAnchors: () => void;
  onApplyIssueFix: (fix: LineBranchValidationAutoFix) => void;
  onApplyAllSafeFixes: () => void;
}) {
  const webRows = getPublicWebManualChangeRows(overlays);
  const webChangeTotal = getPublicWebManualChangeTotal(overlays);
  const parityRows = getPublicWebParityRows(overlays, issues);
  const staleSavedAnchorTotal = staleSavedAnchorSummaries.reduce((sum, item) => sum + item.changedCount, 0);
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const safeFixCount = issues.filter((issue) => issue.autoFix && issue.includeInBulkFix !== false).length;
  const groupedIssues = issues.reduce((groups, issue) => {
    const list = groups.get(issue.category) ?? [];
    list.push(issue);
    groups.set(issue.category, list);
    return groups;
  }, new Map<LineBranchValidationIssueCategory, LineBranchValidationIssue[]>());

  return (
    <div className="grid gap-3">
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <strong className="text-sm font-semibold text-slate-700">오버레이/선형 검증</strong>
            <p className="mt-2 text-xs font-medium text-slate-500">문제 유형을 먼저 보고, 필요한 항목만 바로 해결합니다.</p>
          </div>
          <Button size="sm" variant="outline" disabled={safeFixCount === 0} onClick={onApplyAllSafeFixes}>가능한 것 모두 해결</Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <ValidationStatCard label="지선 등록" value={count.toLocaleString("ko-KR")} description="수동 지선/결합 override" tone="blue" />
          <ValidationStatCard label="오류" value={errorCount.toLocaleString("ko-KR")} description="저장 전 수정 권장" tone={errorCount > 0 ? "red" : "emerald"} />
          <ValidationStatCard label="주의" value={warningCount.toLocaleString("ko-KR")} description="표시 품질 점검" tone={warningCount > 0 ? "amber" : "emerald"} />
          <ValidationStatCard label="자동 해결" value={safeFixCount.toLocaleString("ko-KR")} description="일괄 처리 가능 항목" tone={safeFixCount > 0 ? "blue" : "slate"} />
        </div>
        <p className="mt-3 text-[11px] font-medium leading-5 text-slate-500">자동 해결은 데이터 손실 가능성이 낮은 항목만 일괄 처리합니다. 선형 없음처럼 임시 선형을 새로 만드는 작업은 개별 버튼으로만 처리합니다.</p>
      </div>

      {staleSavedAnchorSummaries.length > 0 ? (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <strong className="font-semibold">저장 선형 anchor 불일치</strong>
              <p className="mt-1 leading-5 text-orange-800">역 위치는 바뀌었지만 저장된 선형 안의 역 좌표가 예전 위치인 항목입니다.</p>
              <p className="mt-1 leading-5 text-orange-800">해결 방법: 현재 역 위치로 anchor 좌표를 다시 맞추면 됩니다.</p>
            </div>
            <Badge>{staleSavedAnchorTotal}개</Badge>
          </div>
          <div className="mt-3 grid gap-1.5">
            {staleSavedAnchorSummaries.slice(0, 5).map((item) => (
              <div key={item.stationId} className="rounded-xl bg-white/75 px-3 py-2 text-[11px] font-medium text-orange-900">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{item.stationLabel}</span>
                  <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700">{item.changedCount}개</span>
                </div>
                <p className="mt-1 text-orange-700">본선 {item.geometryCount}개 · 지선 {item.lineBranchCount}개</p>
              </div>
            ))}
            {staleSavedAnchorSummaries.length > 5 ? <div className="rounded-xl bg-white/75 px-3 py-2 text-[11px] font-semibold text-orange-700">그 외 {staleSavedAnchorSummaries.length - 5}개 역도 함께 수정됩니다.</div> : null}
          </div>
          <Button className="mt-3 w-full" variant="outline" onClick={onSyncStaleSavedAnchors}><Waypoints className="mr-1 size-4" />불일치 anchor 모두 현재 위치로 맞추기</Button>
        </div>
      ) : null}

      <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <strong className="text-xs font-semibold text-blue-900">공개 Web 반영 대상</strong>
            <p className="mt-1 text-[11px] font-medium leading-4 text-blue-800">Editor override 중 공개 Web 렌더링과 데이터 계산에 반영되어야 하는 항목입니다.</p>
          </div>
          <Badge className="shrink-0 bg-white/80 text-blue-700">{webChangeTotal}개</Badge>
        </div>
        <div className="mt-3 grid gap-1.5">
          {webRows.map((row) => (
            <div key={row.label} className="rounded-xl bg-white/75 px-3 py-2 text-[11px] font-medium text-slate-600">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">{row.label}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{row.count.toLocaleString("ko-KR")}</span>
              </div>
              {row.count > 0 ? <p className="mt-1 leading-4 text-slate-500">{row.description}</p> : null}
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-1.5">
          {parityRows.map((row) => (
            <div key={row.label} className={cn("rounded-xl border px-3 py-2 text-[11px] font-medium", getParityStatusClassName(row.status))}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{row.label}</span>
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold">{formatParityStatusLabel(row.status)} · {row.value}</span>
              </div>
              <p className="mt-1 leading-4 opacity-85">{row.description}</p>
            </div>
          ))}
        </div>
      </div>

      {issues.length === 0 ? (
        <Placeholder title="선형 검증 통과" description="역 위치, 본선/지선 선형, 저장된 anchor에서 감지된 불일치가 없습니다." />
      ) : (
        <div className="grid gap-3">
          {[...groupedIssues.entries()].map(([category, categoryIssues]) => (
            <section key={category} className="rounded-3xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <strong className="text-sm font-semibold text-slate-800">{getValidationCategoryLabel(category)}</strong>
                  <p className="mt-1 text-[11px] font-medium leading-4 text-slate-500">{getValidationCategoryDescription(category)}</p>
                </div>
                <Badge className="shrink-0">{categoryIssues.length}개</Badge>
              </div>
              <div className="mt-3 grid gap-2">
                {categoryIssues.map((issue) => (
                  <div key={issue.id} className={cn("rounded-2xl border px-3 py-3 text-xs", getValidationIssueToneClassName(issue))}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", getValidationIssueBadgeClassName(issue))}>{issue.severity === "error" ? "오류" : "주의"}</span>
                          <strong className="font-bold">{issue.title}</strong>
                        </div>
                        <p className="mt-2 break-words font-semibold leading-5">{issue.message}</p>
                      </div>
                      {issue.autoFix ? <Button size="sm" variant="outline" className="shrink-0" onClick={() => onApplyIssueFix(issue.autoFix!)}>해결</Button> : null}
                    </div>
                    <div className="mt-3 grid gap-2 text-[11px] leading-5">
                      <div className="rounded-xl bg-white/65 px-3 py-2"><span className="font-bold">원인: </span>{issue.cause}</div>
                      <div className="rounded-xl bg-white/65 px-3 py-2"><span className="font-bold">해결 방법: </span>{issue.solution}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
