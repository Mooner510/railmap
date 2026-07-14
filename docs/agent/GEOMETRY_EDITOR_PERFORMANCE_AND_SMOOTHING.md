# Geometry editor performance and smoothing

## Goals

- keep geometry-point dragging responsive on large maps
- render long station-to-station segments with comparable sample spacing
- recalculate render spacing whenever control points or segment lengths change
- preserve editable station/control points without replacing them with generated samples

## Implementation

- pointer movement is committed at most once per animation frame
- pending pointer coordinates are flushed on mouse-up before history is recorded
- geometry drafts are applied with indexed one-pass maps instead of repeated full-array reductions
- railway lines use adaptive Catmull-Rom smoothing followed by distance-based resampling
- generated samples are render-only; saved station/control points remain unchanged
- sample count is bounded to avoid excessive GeoJSON and MapLibre update cost

## Expected behavior

- dragging a point should remain responsive even when many branches are loaded
- adding or moving a control point immediately recalculates the curve
- long segments receive more render samples and short segments receive fewer
- adjacent rendered samples remain approximately evenly spaced


## 13.113.1 short segment smoothing hotfix

- 짧은 구간도 최소 19개의 렌더 정점을 확보한다.
- 제어점 사이의 누적 회전각에 따라 곡률 보정 정점을 추가한다.
- 기본 Catmull-Rom 샘플 밀도를 높이고 거리 기준으로 다시 균등 배치한다.
- 저장 제어점과 최대 렌더 정점 제한은 유지한다.
