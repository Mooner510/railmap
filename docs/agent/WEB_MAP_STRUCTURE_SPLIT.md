# Web map structure split

Applied in `13.104.0-13.106.0`.

## Purpose

Reduce the responsibilities of `RailMap.tsx` without changing public map behavior.

## Boundaries

- `RailMap.tsx`: React state, memoized feature construction, lifecycle orchestration
- `map/railMapLayers.ts`: source IDs, interactive layer IDs, source registration, layer registration, GeoJSON source updates
- `map/railMapInteractions.ts`: click and hover event binding, hit-test priority, blank-map selection clearing
- `map/railMapEmphasis.ts`: MapLibre emphasis expressions

## Interaction priority

1. station hit layer
2. transfer group hit layer
3. branch line
4. blank map clears selection

Faded features continue to use the same hit layers and remain selectable.
