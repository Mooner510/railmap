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
    return "순환 노선은 시작/끝 역이 없으므로 다른 노선과 지선 결합할 수 없습니다. 이 노선 안에서 새 지선을 추가하는 작업은 가능합니다.";
  }
  if (isBranchCircular(connectedBranch)) {
    return "연결 대상이 순환 노선이면 시작/끝 방향을 확정할 수 없어 지선 결합할 수 없습니다. 해당 순환 노선 내부의 지선 추가만 사용하세요.";
  }
  return null;
}

export function canConnectLineBranches(
  parentBranch: EditorMapBranch | null | undefined,
  connectedBranch: EditorMapBranch | null | undefined,
) {
  return getLineBranchConnectionBlockReason(parentBranch, connectedBranch) === null;
}
