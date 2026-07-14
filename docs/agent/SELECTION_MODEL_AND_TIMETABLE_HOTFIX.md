# Selection model and timetable review hotfix

## Scope

- Guard empty candidate station arrays before map lookup in bulk timetable CSV review.
- Centralize public web line, branch, station, and transfer-group selection shapes in `packages/ui`.
- Use one selection transition helper for public web search, map click, filter reset, and clear actions.
- Keep mutually exclusive selection state consistent when switching between station, branch, line, and transfer targets.

## Selection invariants

- Selecting a line clears branch, station, and transfer-group selection.
- Selecting a branch keeps its parent line and clears station and transfer-group selection.
- Selecting a station clears line, branch, and transfer-group selection.
- Selecting a transfer group clears line, branch, and station selection.
- Clearing filters or map focus resets every selection field together.
