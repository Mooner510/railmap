import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { ChevronRight, Trash2 } from "lucide-react";
import {
  RAIL_LINE_CATEGORIES,
  RAIL_SERVICE_TYPES,
  formatRailLineCategory,
  formatRailServiceType,
  type EditorStation,
  type ManualBranchRouteOverride,
  type ManualBranchStationExclusion,
  type ManualLineBranchOverride,
  type RailLineCategory,
  type RailServiceType,
} from "../editorModel";
import type { EditorMapBranch } from "../editorData";
import { isBranchCircular } from "./branchRules";

type StationIndex = Map<string, EditorStation>;
type BranchIndex = Map<string, EditorMapBranch>;

function getBranchStopStations(branch: EditorMapBranch): EditorStation[] {
  return branch.routeStops
    .map((stop) => stop.station)
    .filter((station): station is EditorStation => Boolean(station));
}

function formatBranchDisplayName(branch: EditorMapBranch | null | undefined) {
  if (!branch) return "알 수 없는 노선";
  const sourceName =
    branch.sourceLineName && branch.sourceLineName !== branch.canonicalLineNameKo
      ? ` · ${branch.sourceLineName}`
      : "";
  return `${branch.canonicalLineNameKo}${sourceName}`;
}

function formatStationDisplayName(station: EditorStation | null | undefined) {
  if (!station) return "알 수 없는 역";
  const lineName = station.lineNameKo ? ` · ${station.lineNameKo}` : "";
  return `${station.nameKo}${lineName}`;
}

function BranchPill({ branch }: { branch: EditorMapBranch | null | undefined }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-700">
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: branch?.colorHex ?? "#94a3b8" }}
      />
      <span className="truncate">{branch?.canonicalLineNameKo ?? "알 수 없는 노선"}</span>
    </span>
  );
}

function StationNode({
  station,
  colorHex,
  active = false,
}: {
  station: EditorStation | null | undefined;
  colorHex?: string | null;
  active?: boolean;
}) {
  return (
    <span className="grid min-w-0 justify-items-center gap-1">
      <span
        className={cn(
          "grid size-7 place-items-center rounded-full border-4 border-white shadow-sm ring-2",
          active ? "bg-slate-950 text-white ring-blue-300" : "bg-white text-slate-700 ring-slate-200",
        )}
      >
        <span
          className="size-2.5 rounded-full"
          style={{ backgroundColor: colorHex ?? station?.colorHex ?? "#64748b" }}
        />
      </span>
      <span className="max-w-20 truncate text-center text-[10px] font-bold text-slate-700">
        {station?.nameKo ?? "?"}
      </span>
    </span>
  );
}

function LineBranchConnectionCard({
  override,
  branchIndex,
  stationIndex,
}: {
  override: ManualLineBranchOverride;
  branchIndex: BranchIndex;
  stationIndex: StationIndex;
}) {
  const parentBranch = branchIndex.get(override.parentBranchId) ?? null;
  const anchorStation = stationIndex.get(override.anchorStationId) ?? null;

  if (override.mode === "add-station") {
    const branchStation = override.branchStationId
      ? (stationIndex.get(override.branchStationId) ?? null)
      : null;

    return (
      <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <BranchPill branch={parentBranch} />
          <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-bold text-blue-700">지선 추가</span>
        </div>
        <div className="grid justify-items-center gap-1">
          <div className="flex w-full items-center gap-2">
            <StationNode station={anchorStation} colorHex={parentBranch?.colorHex} active />
            <span className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: parentBranch?.colorHex ?? "#94a3b8" }} />
            <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-500">본선</span>
          </div>
          <div className="h-7 w-1.5 rounded-full bg-blue-300" />
          <div className="flex w-full items-center justify-center gap-2">
            <span className="h-1.5 w-10 rounded-full bg-blue-300" />
            <StationNode station={branchStation} colorHex={parentBranch?.colorHex} />
            <span className="h-1.5 w-10 rounded-full bg-blue-300" />
          </div>
        </div>
      </div>
    );
  }

  const connectedBranch = override.connectedBranchId
    ? (branchIndex.get(override.connectedBranchId) ?? null)
    : null;
  const connectedStation = override.connectedEndpointStationId
    ? (stationIndex.get(override.connectedEndpointStationId) ?? null)
    : null;

  return (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <BranchPill branch={parentBranch} />
        <span className="text-[11px] font-black text-emerald-500">↘</span>
        <BranchPill branch={connectedBranch} />
      </div>
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <StationNode station={anchorStation} colorHex={parentBranch?.colorHex} active />
          <span className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: parentBranch?.colorHex ?? "#94a3b8" }} />
        </div>
        <div className="ml-6 flex items-center gap-2">
          <span className="h-8 w-8 rounded-bl-2xl border-b-4 border-l-4 border-emerald-300" />
          <StationNode station={connectedStation} colorHex={connectedBranch?.colorHex} />
          <span className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: connectedBranch?.colorHex ?? "#94a3b8" }} />
        </div>
      </div>
    </div>
  );
}

export function BranchInspector({
  branch,
  branches,
  lineBranchOverrides,
  branchStationExclusions,
  branchRouteOverride,
  unassignedStations,
  onDeleteLineBranch,
  onRestoreBranchStation,
  onUpdateRoute,
  onResetRoute,
  onSetCircular,
  onUpdateLineMetadata,
}: {
  branch: EditorMapBranch;
  branches: EditorMapBranch[];
  lineBranchOverrides: ManualLineBranchOverride[];
  branchStationExclusions: ManualBranchStationExclusion[];
  branchRouteOverride: ManualBranchRouteOverride | null;
  unassignedStations: EditorStation[];
  onDeleteLineBranch: (id: string) => void;
  onRestoreBranchStation: (id: string) => void;
  onUpdateRoute: (stationIds: string[], label: string, circular?: boolean) => void;
  onResetRoute: () => void;
  onSetCircular: (circular: boolean) => void;
  onUpdateLineMetadata: (category: RailLineCategory, serviceTypes: RailServiceType[]) => void;
}) {
  const branchStations = getBranchStopStations(branch);
  const relatedLineBranches = lineBranchOverrides.filter(
    (override) =>
      override.parentBranchId === branch.id ||
      override.connectedBranchId === branch.id,
  );
  const branchStationExclusionsForBranch = branchStationExclusions.filter(
    (exclusion) =>
      exclusion.enabled !== false && exclusion.branchId === branch.id,
  );
  const stationIndex = new Map(
    [
      ...branchStations,
      ...unassignedStations,
      ...branches.flatMap(getBranchStopStations),
    ].map((station) => [station.id, station]),
  );
  const branchIndex = new Map(
    branches.map((candidate) => [candidate.id, candidate]),
  );
  const routeStationIds = branchStations.map((station) => station.id);
  const isCircular = branchRouteOverride?.circular === true || branch.isCircular === true;

  function moveStation(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= routeStationIds.length) return;
    const next = [...routeStationIds];
    const target = next[index];
    const sibling = next[targetIndex];
    if (!target || !sibling) return;
    next[index] = sibling;
    next[targetIndex] = target;
    onUpdateRoute(next, "노선 정차 순서 변경", isCircular);
  }

  function removeFromRoute(stationId: string) {
    onUpdateRoute(
      routeStationIds.filter((id) => id !== stationId),
      "노선 정차역 제거",
      isCircular,
    );
  }

  return (
    <div className="grid gap-3">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <span
          className="block h-2 w-14 rounded-full"
          style={{ backgroundColor: branch.colorHex }}
        />
        <h3 className="mt-2 truncate text-base font-semibold">
          {branch.canonicalLineNameKo}
        </h3>
        <p className="mt-1 truncate text-xs font-medium text-slate-500">
          {branch.sourceLineName} · {branch.role}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white px-2 py-1.5">
            <p className="text-[10px] font-semibold text-slate-400">정차역</p>
            <p className="mt-1 text-sm font-bold text-slate-700">
              {branch.routeStopCount}
            </p>
          </div>
          <div className="rounded-xl bg-white px-2 py-1.5">
            <p className="text-[10px] font-semibold text-slate-400">기점</p>
            <p className="mt-1 truncate text-xs font-bold text-slate-700">
              {branch.origin ?? "-"}
            </p>
          </div>
          <div className="rounded-xl bg-white px-2 py-1.5">
            <p className="text-[10px] font-semibold text-slate-400">종점</p>
            <p className="mt-1 truncate text-xs font-bold text-slate-700">
              {branch.terminal ?? "-"}
            </p>
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <strong className="text-xs font-semibold text-slate-800">
                철도 유형 / 서비스
              </strong>
              <p className="mt-1 text-[11px] font-medium leading-4 text-slate-500">
                일반철도와 고속철 확장을 위한 노선 메타데이터입니다. KTX/SRT는 노선명이 아니라 서비스 타입으로만 표시합니다.
              </p>
            </div>
            <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
              {formatRailLineCategory(branch.category)}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {RAIL_LINE_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                className={cn(
                  "rounded-xl border px-2 py-1.5 text-[11px] font-bold transition",
                  branch.category === category
                    ? "border-sky-300 bg-sky-50 text-sky-800"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                )}
                onClick={() => onUpdateLineMetadata(category, branch.serviceTypes)}
              >
                {formatRailLineCategory(category)}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {RAIL_SERVICE_TYPES.map((serviceType) => {
              const active = branch.serviceTypes.includes(serviceType);
              const nextServiceTypes = active
                ? branch.serviceTypes.filter((item) => item !== serviceType)
                : [...branch.serviceTypes, serviceType];
              return (
                <button
                  key={serviceType}
                  type="button"
                  className={cn(
                    "rounded-full border px-2 py-1 text-[11px] font-bold transition",
                    active
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                  )}
                  onClick={() =>
                    onUpdateLineMetadata(
                      branch.category,
                      nextServiceTypes.length > 0 ? nextServiceTypes : ["unknown"],
                    )
                  }
                >
                  {formatRailServiceType(serviceType)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <strong className="text-xs font-semibold text-slate-800">
                순환 노선
              </strong>
              <p className="mt-1 text-[11px] font-medium leading-4 text-slate-500">
                켜면 마지막 역과 첫 역이 연결됩니다. 순환 노선 자체가 외부 노선으로 나가는 결합은 막고, 일반 노선이 이 노선 역으로 들어오는 결합은 허용합니다.
              </p>
            </div>
            <button
              type="button"
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition",
                isCircular
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200",
              )}
              onClick={() => onSetCircular(!isCircular)}
              aria-pressed={isCircular}
            >
              {isCircular ? "순환 켜짐" : "순환 꺼짐"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-2 rounded-2xl border border-blue-100 bg-blue-50/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <strong className="text-xs font-semibold text-blue-800">
            기존 노선 정차역 편집
          </strong>
          <span className="text-[11px] font-semibold text-blue-700">
            {branchRouteOverride ? "보정됨" : "원본"}
          </span>
        </div>
        <div className="grid gap-1.5">
          {branchStations.map((station, index) => (
            <div
              key={`${station.id}:${index}`}
              className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-white/85 px-2 py-2"
            >
              <span className="text-center text-[10px] font-bold text-blue-500">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-blue-900">
                  {station.nameKo}
                </span>
                <span className="block truncate text-[10px] font-medium text-blue-500">
                  {station.id}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => moveStation(index, -1)}
                  title="위로 이동"
                >
                  <ChevronRight className="size-3 -rotate-90" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={index === branchStations.length - 1}
                  onClick={() => moveStation(index, 1)}
                  title="아래로 이동"
                >
                  <ChevronRight className="size-3 rotate-90" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={branchStations.length <= 2}
                  onClick={() => removeFromRoute(station.id)}
                  title="이 노선에서만 제거"
                >
                  <Trash2 className="size-3" />
                </Button>
              </span>
            </div>
          ))}
        </div>
        {branchRouteOverride ? (
          <Button variant="outline" onClick={onResetRoute}>
            노선 정차 순서 원본으로 되돌리기
          </Button>
        ) : null}
      </div>

      {branchStationExclusionsForBranch.length > 0 ? (
        <div className="grid gap-2 rounded-2xl border border-amber-100 bg-amber-50/70 p-3">
          <div className="flex items-center justify-between">
            <strong className="text-xs font-semibold text-amber-800">
              제거된 역
            </strong>
            <span className="text-[11px] font-semibold text-amber-700">
              {branchStationExclusionsForBranch.length}
            </span>
          </div>
          {branchStationExclusionsForBranch.map((exclusion) => {
            const station = stationIndex.get(exclusion.stationId);
            return (
              <div
                key={exclusion.id}
                className="flex items-center justify-between gap-2 rounded-2xl bg-white/75 px-3 py-2"
              >
                <span className="min-w-0 truncate text-xs font-semibold text-amber-800">
                  {formatStationDisplayName(station)}
                </span>
                <Button
                  variant="outline"
                  onClick={() => onRestoreBranchStation(exclusion.id)}
                >
                  복원
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="grid gap-2 rounded-2xl border border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <strong className="text-xs font-semibold text-slate-600">
            연결된 지선 오버레이
          </strong>
          <span className="text-[11px] font-semibold text-slate-400">
            {relatedLineBranches.length}
          </span>
        </div>
        {relatedLineBranches.length === 0 ? (
          <p className="text-xs font-medium text-slate-400">없음</p>
        ) : (
          relatedLineBranches.map((override) => (
            <div
              key={override.id}
              className="grid gap-1.5 rounded-xl bg-slate-50 p-2"
            >
              <LineBranchConnectionCard
                override={override}
                branchIndex={branchIndex}
                stationIndex={stationIndex}
              />
              <Button
                variant="outline"
                onClick={() => onDeleteLineBranch(override.id)}
              >
                <Trash2 className="mr-1 size-3" />
                제거
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
