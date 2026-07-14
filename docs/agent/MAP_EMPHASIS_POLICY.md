# Map emphasis policy

## Applied versions

- `13.101.0`: search and route emphasis tuning
- `13.102.0`: shared emphasis values moved to `packages/ui`
- `13.103.0`: manual line-branch emphasis parity and Web helper extraction

## Policy

When a line or route is focused, background network geometry remains interactive but is visually secondary.

- background line opacity is intentionally very low
- background station dots, casing and labels remain more visible than background lines
- focused route and selected line remain fully legible
- manual line branches inherit the focus state of their parent branch
- hit layers are not faded or disabled

The numeric policy is owned by `RAIL_MAP_EMPHASIS_POLICY` in `packages/ui/src/map/renderPolicy.ts`.
MapLibre expression construction remains in the Web app under `apps/web/src/app/map/railMapEmphasis.ts`.
