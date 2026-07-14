# Current task

## Applied through

- `13.104.0-13.106.0`

## Completed

- Web MapLibre source and layer registration separated from `RailMap.tsx`
- source and interactive layer IDs centralized
- repeated GeoJSON source updates use one helper
- Web click and hover event binding separated from `RailMap.tsx`
- station-first hit-test behavior and blank-map selection clearing retained
- map initialization, source/layer registration and data updates now have explicit boundaries

## Next

- move common Editor/Web hit-test priority policy to `packages/ui`
- align Editor and Web selection and deselection behavior
- split Editor audit, transfer recommendation and timetable import sections
- continue map regression fixes before fare model work
