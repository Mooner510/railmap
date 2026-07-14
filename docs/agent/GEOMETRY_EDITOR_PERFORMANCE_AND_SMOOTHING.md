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

## 13.113.2 anchor-preserving smoothing hotfix

- 곡선 전체를 한 번에 재샘플링하지 않고 역/제어점 사이 구간별로 보간한다.
- 모든 역과 제어점 좌표를 최종 렌더 선형에 정확히 포함한다.
- 짧은 구간도 구간당 최소 샘플 수를 보장하고, 굽은 정도에 따라 추가 샘플을 배정한다.
- 각 구간은 고밀도 Catmull-Rom 생성 후 호 길이 기준으로 균등 재배치한다.
- 전체 정점 상한은 유지해 편집 성능을 보호한다.
