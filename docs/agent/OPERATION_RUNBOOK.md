# OPERATION_RUNBOOK

Status: active  
Updated: 2026-07-02

## 1. Local development

Install dependencies:

```sh
pnpm install
```

Run editor:

```sh
pnpm --filter editor dev
```

Run public web:

```sh
pnpm --filter web dev
```

Run all development tasks:

```sh
pnpm dev
```

## 2. Type checks

Run all type checks:

```sh
pnpm check-types
```

Run app-specific checks:

```sh
pnpm --filter editor check-types
pnpm --filter web check-types
pnpm --filter collector check-types
```

## 3. Manual editing workflow

1. Open editor.
2. Select station/line/transfer group on map.
3. Make changes through editor UI only.
4. Use validation tab before committing.
5. Use individual auto-repair buttons only when the cause/fix matches the intended data change.
6. Use bulk repair only for clearly safe deterministic fixes.
7. Check public web after export/build.
8. Commit both source manual data and intended public export data when appropriate.

## 4. Validation workflow

Required checks before release:

```sh
pnpm --filter editor check-types
pnpm --filter web check-types
pnpm --filter collector check-types
```

Also check in the editor UI:

- no station-line identity errors;
- no invalid branch connection errors;
- no missing required manual overlay references;
- circular line previews are correct;
- branch/line insertion previews are correct;
- transfer group collapsed icons are visible.

## 5. Public web verification

Check:

- map loads with public data;
- line visibility toggle works;
- station visibility toggle works;
- station selection panel opens;
- line selection panel opens;
- transfer group panel opens;
- share/current selection actions do not crash;
- mini line preview renders;
- manual overlay changes appear in web.

## 6. Data source workflow

Raw source files must remain immutable.

Use this broad flow:

```text
raw files
  -> collector parse/normalize
  -> generated app bundle
  -> manual overlay validation/export
  -> public web data
  -> editor/web verification
```

Do not edit raw files to fix data. Use manual overlays.

## 7. Release checklist

Before committing a patch:

1. Confirm changed files are intended.
2. Run relevant type checks.
3. Confirm no `.txt` debug artifacts are created.
4. Confirm no API keys or secrets appear in diffs.
5. Confirm manual data source-of-truth is preserved.
6. Confirm public export files are committed only when intentionally updated.
7. Write commit message describing the behavior change.

## 8. Common mistakes to avoid

- Treating `apps/web/public/data/manual-overlays.json` as the manual source.
- Reusing one stationId for multiple lines.
- Saving foreign station coordinates as geometry station points.
- Blocking normal lines from connecting into circular lines.
- Automatically generating timetable rows or travel times.
- Letting old docs override current implemented behavior.
