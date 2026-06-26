import type { CanonicalSourceLineMapRow } from "./types.js";

export function groupCanonicalMapRows(
  rows: CanonicalSourceLineMapRow[],
): Map<string, CanonicalSourceLineMapRow[]> {
  const grouped = new Map<string, CanonicalSourceLineMapRow[]>();

  for (const row of rows) {
    grouped.set(row.canonicalKey, [...(grouped.get(row.canonicalKey) ?? []), row]);
  }

  return grouped;
}
