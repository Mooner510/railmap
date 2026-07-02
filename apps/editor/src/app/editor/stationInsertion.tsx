import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { cn } from "@repo/ui/utils";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { EditorStation } from "../editorModel";
import type { EditorMapBranch } from "../editorData";

type AdjacentStationPair = {
  before: EditorStation;
  after: EditorStation;
  circular: boolean;
};

type DiagramStationItem = {
  station: EditorStation;
  sequenceIndex: number;
};

export type PendingAddStationInsertion = {
  parentBranchId: string;
  beforeStationId: string;
  afterStationId: string;
  newStationNameKo?: string;
};

const DIAGRAM_ROW_SIZE = 6;

function formatBranchDisplayName(branch: EditorMapBranch | null | undefined) {
  if (!branch) return "알 수 없는 노선";
  return `${branch.canonicalLineNameKo} · ${branch.sourceLineName}`;
}

function isValidStation(
  station: EditorStation,
): station is EditorStation & { lat: number; lng: number } {
  return Number.isFinite(station.lat) && Number.isFinite(station.lng);
}

function getBranchStopStations(branch: EditorMapBranch): EditorStation[] {
  return branch.routeStops
    .map((stop) => stop.station)
    .filter((station): station is EditorStation => Boolean(station));
}

function getBranchAdjacentStationPairs(
  branch: EditorMapBranch,
  circular = false,
): AdjacentStationPair[] {
  const stations = getBranchStopStations(branch).filter(isValidStation);
  const pairs: AdjacentStationPair[] = [];

  for (let index = 0; index < stations.length - 1; index += 1) {
    const before = stations[index];
    const after = stations[index + 1];
    if (before && after) pairs.push({ before, after, circular: false });
  }

  const first = stations[0];
  const last = stations[stations.length - 1];
  if (circular && first && last && first.id !== last.id) {
    pairs.push({ before: last, after: first, circular: true });
  }

  return pairs;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
      {label}
      {children}
    </label>
  );
}

function makeSequenceStations(branch: EditorMapBranch, circular: boolean) {
  const stations = getBranchStopStations(branch).filter(isValidStation);
  if (!circular || stations.length < 2) return stations;
  const first = stations[0];
  const last = stations[stations.length - 1];
  if (!first || !last || first.id === last.id) return stations;
  return [...stations, first];
}

function makeDiagramRows(stations: EditorStation[]) {
  const rows: DiagramStationItem[][] = [];
  for (let start = 0; start < stations.length; start += DIAGRAM_ROW_SIZE) {
    const row = stations.slice(start, start + DIAGRAM_ROW_SIZE).map(
      (station, offset): DiagramStationItem => ({
        station,
        sequenceIndex: start + offset,
      }),
    );
    rows.push(rows.length % 2 === 0 ? row : [...row].reverse());
  }
  return rows;
}

function getPairFromSequence(
  sequence: EditorStation[],
  beforeIndex: number,
  circular: boolean,
): AdjacentStationPair | null {
  const before = sequence[beforeIndex];
  const after = sequence[beforeIndex + 1];
  if (!before || !after) return null;
  return {
    before,
    after,
    circular: circular && beforeIndex === sequence.length - 2 && before.id !== after.id,
  };
}

function StationNode({
  station,
  index,
  labelPosition,
  colorHex,
}: {
  station: EditorStation;
  index: number;
  labelPosition: "top" | "bottom";
  colorHex?: string | null;
}) {
  const label = (
    <span className="line-clamp-2 min-h-8 max-w-24 text-center text-[10px] font-bold leading-4 text-slate-700">
      {station.nameKo}
    </span>
  );

  return (
    <div className="flex w-24 shrink-0 flex-col items-center gap-1" title={`${index + 1}. ${station.nameKo}`}>
      {labelPosition === "top" ? label : <span className="min-h-8" aria-hidden="true" />}
      <div className="grid size-8 place-items-center rounded-full border-[5px] border-white bg-white shadow-md ring-2 ring-slate-300 transition group-hover:ring-blue-300">
        <span
          className="size-3.5 rounded-full shadow-inner"
          style={{ backgroundColor: colorHex ?? station.colorHex ?? "#64748b" }}
        />
      </div>
      {labelPosition === "bottom" ? label : <span className="min-h-8" aria-hidden="true" />}
    </div>
  );
}

function SegmentButton({
  pair,
  disabled,
  creationMode,
  vertical = false,
  colorHex,
  onSelect,
}: {
  pair: AdjacentStationPair;
  disabled: boolean;
  creationMode: boolean;
  vertical?: boolean;
  colorHex?: string | null;
  onSelect: (pair: AdjacentStationPair) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "group relative grid place-items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40",
        vertical ? "h-16 w-12" : "h-12 w-20",
      )}
      disabled={disabled}
      title={`${pair.before.nameKo} - ${pair.after.nameKo} 사이에 ${creationMode ? "새 역 생성" : "기존 역 연결"}${pair.circular ? " · 순환 연결" : ""}`}
      onClick={() => onSelect(pair)}
    >
      <span
        className={cn(
          "absolute rounded-full transition group-hover:bg-blue-500 group-hover:shadow-lg group-hover:shadow-blue-500/20",
          vertical ? "h-full w-1.5 group-hover:w-2.5" : "h-1.5 w-full group-hover:h-2.5",
          pair.circular ? "bg-violet-300" : "bg-blue-200",
        )}
        style={pair.circular ? undefined : { backgroundColor: colorHex ?? "#bfdbfe" }}
      />
      <span className="relative grid size-7 place-items-center rounded-full border-2 border-white bg-blue-600 text-white opacity-0 shadow-sm transition group-hover:scale-110 group-hover:opacity-100">
        <Plus className="size-3.5" />
      </span>
    </button>
  );
}

function RouteInsertionDiagram({
  branch,
  circular,
  disabled,
  creationMode,
  onSelect,
}: {
  branch: EditorMapBranch;
  circular: boolean;
  disabled: boolean;
  creationMode: boolean;
  onSelect: (pair: AdjacentStationPair) => void;
}) {
  const sequence = makeSequenceStations(branch, circular);
  const rows = makeDiagramRows(sequence);

  if (sequence.length < 2) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs font-medium text-slate-400">
        인접한 두 역을 찾을 수 없습니다.
      </div>
    );
  }

  const branchColor = branch.colorHex ?? "#2563eb";

  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3 text-[11px] font-bold text-slate-500">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-1 shadow-sm">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: branchColor }} />
          {formatBranchDisplayName(branch)}
        </span>
        <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">선 구간을 눌러 삽입 위치 선택</span>
      </div>
      <div className="grid min-w-[760px] gap-0">
        {rows.map((row, rowIndex) => {
          const labelPosition = rowIndex % 2 === 0 ? "top" : "bottom";
          const rowStartIndex = rowIndex * DIAGRAM_ROW_SIZE;
          const rowEndIndex = Math.min(
            rowStartIndex + DIAGRAM_ROW_SIZE - 1,
            sequence.length - 1,
          );
          const nextPair = getPairFromSequence(sequence, rowEndIndex, circular);
          const verticalSide = rowIndex % 2 === 0 ? "right" : "left";

          return (
            <div key={`row:${rowIndex}`} className="grid gap-0">
              <div className="flex items-center">
                {row.map((item, itemIndex) => {
                  const nextItem = row[itemIndex + 1];
                  const pairIndex = nextItem
                    ? Math.min(item.sequenceIndex, nextItem.sequenceIndex)
                    : null;
                  const pair =
                    pairIndex === null
                      ? null
                      : getPairFromSequence(sequence, pairIndex, circular);

                  return (
                    <div
                      key={`${item.station.id}:${item.sequenceIndex}`}
                      className="flex items-center"
                    >
                      <StationNode
                        station={item.station}
                        index={item.sequenceIndex}
                        labelPosition={labelPosition}
                        colorHex={branchColor}
                      />
                      {pair ? (
                        <SegmentButton
                          pair={pair}
                          disabled={disabled}
                          creationMode={creationMode}
                          colorHex={branchColor}
                          onSelect={onSelect}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {nextPair ? (
                <div
                  className={cn(
                    "flex h-16 px-6",
                    verticalSide === "right" ? "justify-end" : "justify-start",
                  )}
                >
                  <SegmentButton
                    pair={nextPair}
                    disabled={disabled}
                    creationMode={creationMode}
                    vertical
                    colorHex={branchColor}
                    onSelect={onSelect}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AddStationInsertionDialog({
  open,
  station,
  branches,
  onClose,
  onSelect,
}: {
  open: boolean;
  station: EditorStation | null;
  branches: EditorMapBranch[];
  onClose: () => void;
  onSelect: (insertion: PendingAddStationInsertion) => void;
}) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [newStationNameKo, setNewStationNameKo] = useState("");
  const selectedBranch =
    branches.find((branch) => branch.id === branchId) ?? branches[0] ?? null;
  const selectedBranchCircular = selectedBranch?.isCircular === true;
  const pairs = useMemo(
    () =>
      selectedBranch
        ? getBranchAdjacentStationPairs(
            selectedBranch,
            selectedBranch.isCircular === true,
          )
        : [],
    [selectedBranch],
  );
  const creationMode = !station;

  useEffect(() => {
    if (!branches.some((branch) => branch.id === branchId)) {
      setBranchId(branches[0]?.id ?? "");
    }
  }, [branchId, branches]);

  useEffect(() => {
    if (!open) setNewStationNameKo("");
  }, [open]);

  const canSelectLocation = !creationMode || newStationNameKo.trim().length > 0;

  return (
    <Dialog open={open} className="flex max-h-[680px] max-w-4xl flex-col">
      <div className="border-b border-slate-200 px-4 py-3">
        <strong className="block text-sm font-semibold text-slate-950">
          {creationMode ? "새 역 생성" : "기존 역을 노선에 연결"}
        </strong>
        <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
          {creationMode
            ? "새 역 이름과 들어갈 구간을 고른 뒤, 지도에서 실제 위치를 클릭해 저장합니다."
            : `${station.nameKo}은(는) 이미 위치가 있으므로 구간만 고르면 바로 노선에 연결됩니다.`}
        </p>
      </div>
      <div className="grid min-h-0 gap-3 overflow-y-auto p-4">
        {creationMode ? (
          <Field label="새 역 이름">
            <Input
              autoFocus
              placeholder="예: 서울역(경의중앙선)"
              value={newStationNameKo}
              onChange={(event) => setNewStationNameKo(event.target.value)}
            />
          </Field>
        ) : null}
        <Field label="노선">
          <select
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium"
            value={selectedBranch?.id ?? ""}
            onChange={(event) => setBranchId(event.target.value)}
            disabled={branches.length === 0}
          >
            {branches.length === 0 ? (
              <option value="">선택 가능한 노선 없음</option>
            ) : (
              branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {formatBranchDisplayName(branch)}
                </option>
              ))
            )}
          </select>
        </Field>
        <div className="grid gap-2">
          <div className="flex items-start justify-between gap-3">
            <span>
              <strong className="block text-xs font-semibold text-slate-700">
                추가 위치
              </strong>
              <span className="mt-0.5 block text-[11px] font-medium leading-4 text-slate-400">
                역 사이 선 구간을 누르세요. 선에 마우스를 올리면 굵어지고 + 버튼이 나타납니다.
              </span>
            </span>
            <Badge className="bg-blue-50 text-blue-700">
              {creationMode ? "새 역" : "기존 역 연결"}
              {selectedBranchCircular ? " · 순환" : ""}
            </Badge>
          </div>
          {selectedBranch && pairs.length > 0 ? (
            <RouteInsertionDiagram
              branch={selectedBranch}
              circular={selectedBranchCircular}
              disabled={!canSelectLocation}
              creationMode={creationMode}
              onSelect={(pair) =>
                onSelect({
                  parentBranchId: selectedBranch.id,
                  beforeStationId: pair.before.id,
                  afterStationId: pair.after.id,
                  newStationNameKo: creationMode
                    ? newStationNameKo.trim()
                    : undefined,
                })
              }
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs font-medium text-slate-400">
              인접한 두 역을 찾을 수 없습니다.
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-slate-200 p-3">
        <Button className="w-full" variant="outline" onClick={onClose}>
          닫기
        </Button>
      </div>
    </Dialog>
  );
}
