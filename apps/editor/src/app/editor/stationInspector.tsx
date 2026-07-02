import { Badge } from "@repo/ui/badge";
import { cn } from "@repo/ui/utils";
import type { ManualLineBranchOverride } from "../editorModel";
import type { EditorMapBranch } from "../editorData";
import type { EditorStation } from "../editorModel";

type LineBranchDirection = "toward-start" | "toward-end";

type LineBranchDirectionOption = {
  value: LineBranchDirection;
  label: string;
};

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

function getBranchStopStations(branch: EditorMapBranch): EditorStation[] {
  return branch.routeStops
    .map((stop) => stop.station)
    .filter((station): station is EditorStation => Boolean(station));
}

function getBranchDirectionOptions(branch: EditorMapBranch | null, stationId: string): LineBranchDirectionOption[] {
  if (!branch || !stationId) return [];
  const stations = getBranchStopStations(branch);
  const index = stations.findIndex((station) => station.id === stationId);
  if (index < 0) return [];
  const options: LineBranchDirectionOption[] = [];
  const start = stations[0];
  const end = stations.at(-1);
  const previous = stations[index - 1];
  const next = stations[index + 1];
  if (next && end) options.push({ value: "toward-end", label: `${end.nameKo}행 (${next.nameKo} 방향)` });
  if (previous && start) options.push({ value: "toward-start", label: `${start.nameKo}행 (${previous.nameKo} 방향)` });
  return options;
}

export function formatLineBranchDirectionSummary(
  branch: EditorMapBranch | null,
  stationId: string | undefined,
  direction: LineBranchDirection | undefined,
) {
  if (!branch || !stationId || !direction) return null;
  const options = getBranchDirectionOptions(branch, stationId);
  const label = options.find((option) => option.value === direction)?.label;
  if (!label) return null;
  return label.replace("행 (", "행 / ").replace(/\)$/u, "");
}

export function getLineBranchDisplay(
  override: ManualLineBranchOverride,
  branchById: Map<string, EditorMapBranch>,
  stationById: Map<string, EditorStation>,
) {
  const parentBranch = branchById.get(override.parentBranchId) ?? null;
  const anchorStation = stationById.get(override.anchorStationId) ?? null;

  if (override.mode === "add-station") {
    const branchStation = override.branchStationId ? (stationById.get(override.branchStationId) ?? null) : null;
    return {
      title: "지선 역 추가",
      summary: `${formatBranchDisplayName(parentBranch)} ${formatStationDisplayName(anchorStation)} <-> ${formatStationDisplayName(branchStation)}`,
      detail: "미소속 역을 선택한 노선의 특정 역에 연결합니다.",
    };
  }

  const connectedBranch = override.connectedBranchId ? (branchById.get(override.connectedBranchId) ?? null) : null;
  const connectedStation = override.connectedEndpointStationId ? (stationById.get(override.connectedEndpointStationId) ?? null) : null;
  const directionLabel = formatLineBranchDirectionSummary(
    connectedBranch,
    override.connectedEndpointStationId,
    override.connectedDirection ?? "toward-end",
  );

  return {
    title: "지선 노선 결합",
    summary: `${formatBranchDisplayName(parentBranch)} ${formatStationDisplayName(anchorStation)} <-> ${formatBranchDisplayName(connectedBranch)} ${formatStationDisplayName(connectedStation)}${directionLabel ? ` (${directionLabel})` : ""}`,
    detail: "선택한 노선의 특정 역과 다른 노선의 특정 역을 연결합니다.",
  };
}

function BranchChip({ branch, tone = "slate" }: { branch: EditorMapBranch | null | undefined; tone?: "slate" | "emerald" | "rose" | "blue" }) {
  const toneClassName = {
    slate: "border-slate-200 bg-white text-slate-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
  }[tone];
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-bold", toneClassName)}>
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: branch?.colorHex ?? "#94a3b8" }} />
      <span className="truncate">{branch ? branch.canonicalLineNameKo : "알 수 없는 노선"}</span>
    </span>
  );
}

function VisualStationNode({ station, colorHex, active = false }: { station: EditorStation | null | undefined; colorHex?: string | null; active?: boolean }) {
  return (
    <span className="grid min-w-0 justify-items-center gap-1">
      <span className={cn("grid size-7 place-items-center rounded-full border-4 border-white shadow-sm ring-2", active ? "bg-slate-950 text-white ring-blue-300" : "bg-white text-slate-700 ring-slate-200")}>
        <span className="size-2.5 rounded-full" style={{ backgroundColor: colorHex ?? station?.colorHex ?? "#64748b" }} />
      </span>
      <span className="max-w-20 truncate text-center text-[10px] font-bold text-slate-700">{station?.nameKo ?? "?"}</span>
    </span>
  );
}

function VisualLineSegment({ colorHex, dashed = false }: { colorHex?: string | null; dashed?: boolean }) {
  return <span className={cn("h-1.5 min-w-10 flex-1 rounded-full", dashed ? "border-t-2 border-dashed bg-transparent" : "")} style={dashed ? { borderColor: colorHex ?? "#94a3b8" } : { backgroundColor: colorHex ?? "#94a3b8" }} />;
}

export function AddStationBranchPreview({ parentBranch, anchorStation, branchStation, compact = false }: { parentBranch: EditorMapBranch | null | undefined; anchorStation: EditorStation | null | undefined; branchStation: EditorStation | null | undefined; compact?: boolean }) {
  return (
    <div className="rounded-2xl border border-blue-100 bg-white/90 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <BranchChip branch={parentBranch} tone="blue" />
        <Badge className="bg-blue-50 text-blue-700">지선 추가</Badge>
      </div>
      <div className="grid justify-items-center gap-1">
        <div className="flex w-full items-center gap-2"><VisualStationNode station={anchorStation} colorHex={parentBranch?.colorHex} active /><VisualLineSegment colorHex={parentBranch?.colorHex} /><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">본선</span></div>
        <div className="h-7 w-1.5 rounded-full bg-blue-300" />
        <div className="flex w-full items-center justify-center gap-2"><span className="h-1.5 w-10 rounded-full bg-blue-300" /><VisualStationNode station={branchStation} colorHex={parentBranch?.colorHex} />{!compact ? <span className="h-1.5 w-10 rounded-full bg-blue-300" /> : null}</div>
      </div>
    </div>
  );
}

export function ConnectLineBranchPreview({ parentBranch, anchorStation, connectedBranch, connectedStation, directionLabel }: { parentBranch: EditorMapBranch | null | undefined; anchorStation: EditorStation | null | undefined; connectedBranch: EditorMapBranch | null | undefined; connectedStation: EditorStation | null | undefined; directionLabel?: string | null }) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-white/90 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-2"><BranchChip branch={parentBranch} tone="emerald" /><span className="text-[11px] font-black text-emerald-500">↘</span><BranchChip branch={connectedBranch} tone="emerald" /></div>
      <div className="grid gap-2">
        <div className="flex items-center gap-2"><VisualStationNode station={anchorStation} colorHex={parentBranch?.colorHex} active /><VisualLineSegment colorHex={parentBranch?.colorHex} /></div>
        <div className="ml-6 flex items-center gap-2"><span className="h-8 w-8 rounded-bl-2xl border-b-4 border-l-4 border-emerald-300" /><VisualStationNode station={connectedStation} colorHex={connectedBranch?.colorHex} /><VisualLineSegment colorHex={connectedBranch?.colorHex} /></div>
      </div>
      {directionLabel ? <p className="mt-2 rounded-xl bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">{directionLabel}</p> : null}
    </div>
  );
}

export function LineBranchVisualCard({ override, branchById, stationById }: { override: ManualLineBranchOverride; branchById: Map<string, EditorMapBranch>; stationById: Map<string, EditorStation> }) {
  const parentBranch = branchById.get(override.parentBranchId) ?? null;
  const anchorStation = stationById.get(override.anchorStationId) ?? null;
  if (override.mode === "add-station") {
    const branchStation = override.branchStationId ? (stationById.get(override.branchStationId) ?? null) : null;
    return <AddStationBranchPreview parentBranch={parentBranch} anchorStation={anchorStation} branchStation={branchStation} compact />;
  }
  const connectedBranch = override.connectedBranchId ? (branchById.get(override.connectedBranchId) ?? null) : null;
  const connectedStation = override.connectedEndpointStationId ? (stationById.get(override.connectedEndpointStationId) ?? null) : null;
  const directionLabel = formatLineBranchDirectionSummary(connectedBranch, override.connectedEndpointStationId, override.connectedDirection ?? "toward-end");
  return <ConnectLineBranchPreview parentBranch={parentBranch} anchorStation={anchorStation} connectedBranch={connectedBranch} connectedStation={connectedStation} directionLabel={directionLabel} />;
}
