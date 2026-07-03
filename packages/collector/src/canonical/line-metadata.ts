export const RAIL_LINE_CATEGORIES = [
  "urban_rail",
  "gtx",
  "conventional_rail",
  "high_speed_rail",
] as const;

export type RailLineCategory = (typeof RAIL_LINE_CATEGORIES)[number];

export const RAIL_SERVICE_TYPES = [
  "subway",
  "gtx",
  "ktx",
  "srt",
  "itx",
  "saemaeul",
  "mugunghwa",
  "nuriro",
  "airport_rail",
  "unknown",
] as const;

export type RailServiceType = (typeof RAIL_SERVICE_TYPES)[number];

export function isRailLineCategory(value: unknown): value is RailLineCategory {
  return typeof value === "string" && RAIL_LINE_CATEGORIES.includes(value as RailLineCategory);
}

export function isRailServiceType(value: unknown): value is RailServiceType {
  return typeof value === "string" && RAIL_SERVICE_TYPES.includes(value as RailServiceType);
}

export function normalizeRailLineCategory(value: unknown, fallback: RailLineCategory): RailLineCategory {
  return isRailLineCategory(value) ? value : fallback;
}

export function normalizeRailServiceTypes(value: unknown, fallback: RailServiceType[]): RailServiceType[] {
  if (!Array.isArray(value)) return fallback;
  const normalized = [...new Set(value.filter(isRailServiceType))];
  return normalized.length > 0 ? normalized : fallback;
}

export function inferRailLineCategory(line: {
  canonicalKey?: string | null;
  lnCd?: string | null;
  nameKo?: string | null;
}): RailLineCategory {
  const key = `${line.canonicalKey ?? ""} ${line.lnCd ?? ""} ${line.nameKo ?? ""}`.toLowerCase();
  if (key.includes("gtx") || key.includes("수도권광역급행철도")) return "gtx";
  return "urban_rail";
}

export function inferRailServiceTypes(line: {
  canonicalKey?: string | null;
  lnCd?: string | null;
  nameKo?: string | null;
}): RailServiceType[] {
  const category = inferRailLineCategory(line);
  if (category === "gtx") return ["gtx"];
  if ((line.nameKo ?? "").includes("공항철도")) return ["airport_rail"];
  return ["subway"];
}
