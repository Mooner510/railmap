# Current task

## Applied through

- `13.110.0-13.113.0`

## Completed

- Editor geometry dragging throttled to one update per animation frame
- final pointer position flushed before geometry history commit
- geometry draft application changed to indexed one-pass updates
- long railway segments now use adaptive curve smoothing and even-distance resampling
- render-only generated samples keep saved station/control points compact
- sample count bounded to protect MapLibre rendering performance
- common geometry smoothing policy added to `packages/ui`

## Next

- split Editor audit and diagnostics UI from `UnifiedMapEditor.tsx`
- split transfer recommendation workflow
- split timetable CSV import workflow
- continue Editor/Web shared selection and rendering policy consolidation
