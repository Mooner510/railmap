{
  echo "[1/4] origin/terminal raw 필드 fallback 패치..." >&2

  python3 - <<'PY'
from pathlib import Path

p = Path("packages/collector/src/canonical/build-canonical-app-bundle.ts")
s = p.read_text()

old_origin = '''function getOrigin(line: JsonRecord): string | null {
  const n = getNormalized(line);
  return (
    normalizeKey(n.originStationNameKo) ||
    normalizeKey(n.originStationName) ||
    normalizeKey(n.origin) ||
    normalizeKey(n.startStationNameKo) ||
    normalizeKey(n.startStationName) ||
    null
  );
}
'''

new_origin = '''function getRawText(record: JsonRecord, key: string): string {
  return normalizeKey(record.raw?.[key]?.rawText ?? record.raw?.[key]?.rawValue);
}

function getOrigin(line: JsonRecord): string | null {
  const n = getNormalized(line);
  return (
    normalizeKey(n.originStationNameKo) ||
    normalizeKey(n.originStationName) ||
    normalizeKey(n.origin) ||
    normalizeKey(n.startStationNameKo) ||
    normalizeKey(n.startStationName) ||
    getRawText(line, "기점명") ||
    null
  );
}
'''

old_terminal = '''function getTerminal(line: JsonRecord): string | null {
  const n = getNormalized(line);
  return (
    normalizeKey(n.terminalStationNameKo) ||
    normalizeKey(n.terminalStationName) ||
    normalizeKey(n.terminal) ||
    normalizeKey(n.endStationNameKo) ||
    normalizeKey(n.endStationName) ||
    null
  );
}
'''

new_terminal = '''function getTerminal(line: JsonRecord): string | null {
  const n = getNormalized(line);
  return (
    normalizeKey(n.terminalStationNameKo) ||
    normalizeKey(n.terminalStationName) ||
    normalizeKey(n.terminal) ||
    normalizeKey(n.endStationNameKo) ||
    normalizeKey(n.endStationName) ||
    getRawText(line, "종점명") ||
    null
  );
}
'''

if old_origin not in s:
    raise SystemExit("getOrigin block not found")
if old_terminal not in s:
    raise SystemExit("getTerminal block not found")

s = s.replace(old_origin, new_origin)
s = s.replace(old_terminal, new_terminal)

p.write_text(s)
PY

  echo "[2/4] collector 타입 체크 + 실행..." >&2
  pnpm --filter @repo/collector check-types
  pnpm --filter @repo/collector dev

  echo "\n[3/4] web 타입 체크..." >&2
  pnpm --filter web check-types

  echo "\n[4/4] 최종 요약..." >&2
  node - <<'NODE'
const fs = require("fs");

const bundle = JSON.parse(
  fs.readFileSync("apps/web/public/data/kric-canonical-app-bundle.json", "utf8"),
);

for (const key of ["01:G1", "04:1", "01:K1", "01:1", "01:2"]) {
  const line = bundle.lines.find((x) => x.canonicalKey === key);
  console.log(`\n===== ${key} ${line?.nameKo} =====`);
  console.log(JSON.stringify(line?.branches.map((branch) => ({
    role: branch.role,
    sourceLineNumber: branch.sourceLineNumber,
    sourceLineName: branch.sourceLineName,
    origin: branch.origin,
    terminal: branch.terminal,
    routeStops: branch.routeStops.length,
    first: branch.routeStops[0]?.displayNameKo,
    last: branch.routeStops.at(-1)?.displayNameKo,
    lowConfidence: branch.routeStops.filter((x) => x.confidence === "low").length,
  })), null, 2));
}

console.log("\n===== bundle counts =====");
console.log(JSON.stringify(bundle.counts, null, 2));
NODE
} | tee /dev/stderr | pbcopy

echo "완료: 결과가 클립보드에 복사됐습니다. 붙여넣어 주세요."
