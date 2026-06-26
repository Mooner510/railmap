export type RawCell = {
  rawValue: unknown;
  rawText: string | null;
};

export function toRawText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value).trim();
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
