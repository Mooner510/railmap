export const RAIL_MAP_INTERACTION_POLICY = {
  hitPaddingPx: 8,
  priority: ["station", "transfer", "branch"] as const,
} as const;

export type RailMapInteractionTarget =
  (typeof RAIL_MAP_INTERACTION_POLICY.priority)[number];

export type RailMapScreenPoint = { x: number; y: number };

export function buildRailMapHitBox(
  point: RailMapScreenPoint,
  paddingPx = RAIL_MAP_INTERACTION_POLICY.hitPaddingPx,
): [[number, number], [number, number]] {
  return [
    [point.x - paddingPx, point.y - paddingPx],
    [point.x + paddingPx, point.y + paddingPx],
  ];
}

export function pickRailMapInteractionTarget<T>(targets: {
  station?: T | null;
  transfer?: T | null;
  branch?: T | null;
}): { type: RailMapInteractionTarget; value: T } | null {
  for (const type of RAIL_MAP_INTERACTION_POLICY.priority) {
    const value = targets[type];
    if (value != null) return { type, value };
  }
  return null;
}
