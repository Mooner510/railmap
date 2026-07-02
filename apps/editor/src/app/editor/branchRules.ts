import type { EditorMapBranch } from "../editorData";

export function isBranchCircular(branch: EditorMapBranch | null | undefined) {
  return branch?.isCircular === true;
}

export function getLineBranchConnectionBlockReason(
  parentBranch: EditorMapBranch | null | undefined,
  connectedBranch: EditorMapBranch | null | undefined,
) {
  if (!parentBranch || !connectedBranch) return null;
  if (parentBranch.id === connectedBranch.id) {
    return "같은 branch끼리는 결합할 수 없습니다.";
  }
  if (isBranchCircular(parentBranch)) {
    return "순환 노선 자체는 시작/끝 역이 없으므로 다른 노선으로 지선 결합할 수 없습니다. 일반 노선의 시작/끝 역을 순환 노선의 역에 연결하는 것은 가능합니다.";
  }
  return null;
}

export function canConnectLineBranches(
  parentBranch: EditorMapBranch | null | undefined,
  connectedBranch: EditorMapBranch | null | undefined,
) {
  return getLineBranchConnectionBlockReason(parentBranch, connectedBranch) === null;
}
