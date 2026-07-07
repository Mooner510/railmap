# Deploy, Cache, and Version Policy

## Goal

Keep the public web viewer predictable when `apps/web/public/data` changes. The manual source of truth remains `data/manual`; public files are export artifacts.

## Version rule

Use the project data version as the cache boundary:

- minor change: invalidate public data cache and refresh bundles;
- patch-only change: keep browser/runtime cache unless public bundle shape changed;
- manual overlay export change: treat as public data change.

## Public data files

The web app must treat these as versioned public artifacts:

- `apps/web/public/data/kric-canonical-app-bundle.json`
- `apps/web/public/data/manual-overlays.json`

Do not edit public copies by hand. Regenerate/export from collector or editor flow.

## Release checklist

Before deploying:

1. `pnpm --filter editor check-types`
2. `pnpm --filter web check-types`
3. `pnpm --filter collector check-types`
4. Confirm `data/manual/manual-overlays.json` and `apps/web/public/data/manual-overlays.json` are in sync.
5. Confirm route search opens and a basic route can be searched.
6. Confirm public line/station/transfer group panels render.

## Cloudflare Pages recommendation

- HTML/app shell: normal Pages deployment cache.
- JSON public data: use cache-busting by deployment/versioned artifact path when possible.
- If keeping fixed JSON paths, deploy with a new app build whenever public data changes.

## Rollback

Rollback app deployment and data artifacts together. Do not rollback only app code while keeping newer public data unless the schema is known to be backward compatible.
