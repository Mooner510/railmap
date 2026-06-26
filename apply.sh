#!/usr/bin/env zsh
set -euo pipefail

ROOT="${1:-$PWD}"
cd "$ROOT"

echo "[1/5] canonical collector 파일 적용 중..."
mkdir -p packages/collector/src/canonical apps/web/src/app
cp -R .railmap-canonical-pr1/packages/collector/src/canonical/* packages/collector/src/canonical/
cp .railmap-canonical-pr1/packages/collector/src/index.ts packages/collector/src/index.ts
cp .railmap-canonical-pr1/apps/web/src/app/page.tsx apps/web/src/app/page.tsx

echo "[2/5] collector 타입 체크 중..."
pnpm --filter @repo/collector check-types

echo "[3/5] collector 실행 중..."
pnpm --filter @repo/collector dev

echo "[4/5] web public bundle 갱신 중..."
mkdir -p apps/web/public/data
cp data/generated/2026-06-19/app-bundle/kric-canonical-app-bundle.json apps/web/public/data/kric-canonical-app-bundle.json

echo "[5/5] web 타입 체크 중..."
pnpm --filter web check-types

echo "완료"
