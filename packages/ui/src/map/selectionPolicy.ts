export type RailMapSelection = {
  lineKey: string | null;
  branchId: string | null;
  stationId: string | null;
  transferGroupId: string | null;
};

export const EMPTY_RAIL_MAP_SELECTION: RailMapSelection = {
  lineKey: null,
  branchId: null,
  stationId: null,
  transferGroupId: null,
};

export type RailMapSelectionTarget =
  | { type: "line"; lineKey: string }
  | { type: "branch"; lineKey: string; branchId: string }
  | { type: "station"; stationId: string }
  | { type: "transfer"; transferGroupId: string };

export function hasRailMapSelection(selection: RailMapSelection): boolean {
  return Boolean(
    selection.lineKey ||
      selection.branchId ||
      selection.stationId ||
      selection.transferGroupId,
  );
}

export function getRailMapSelectionLabel(selection: RailMapSelection): string {
  if (selection.transferGroupId) return "환승역 보기";
  if (selection.stationId) return "역으로 이동";
  if (selection.branchId) return "구간 보기";
  if (selection.lineKey) return "노선 보기";
  return "선택 이동";
}

export function selectRailMapTarget(target: RailMapSelectionTarget): RailMapSelection {
  switch (target.type) {
    case "line":
      return {
        lineKey: target.lineKey,
        branchId: null,
        stationId: null,
        transferGroupId: null,
      };
    case "branch":
      return {
        lineKey: target.lineKey,
        branchId: target.branchId,
        stationId: null,
        transferGroupId: null,
      };
    case "station":
      return {
        lineKey: null,
        branchId: null,
        stationId: target.stationId,
        transferGroupId: null,
      };
    case "transfer":
      return {
        lineKey: null,
        branchId: null,
        stationId: null,
        transferGroupId: target.transferGroupId,
      };
  }
}
