import {
  getRailMapFocusMode,
  RAIL_MAP_EMPHASIS_POLICY,
} from "@repo/ui/map/renderPolicy";
import type { ExpressionSpecification } from "maplibre-gl";

export function buildBranchLineOpacity({
  selectedBranchId,
  highlightedRouteBranchIds,
}: {
  selectedBranchId?: string | null;
  highlightedRouteBranchIds: readonly string[];
}): number | ExpressionSpecification {
  const focusMode = getRailMapFocusMode({
    selectedBranchId,
    highlightedRouteBranchIds,
  });

  if (focusMode === "selection") {
    return [
      "case",
      ["==", ["get", "id"], selectedBranchId ?? ""],
      RAIL_MAP_EMPHASIS_POLICY.line.selected,
      RAIL_MAP_EMPHASIS_POLICY.line.contextOnSelection,
    ];
  }

  if (focusMode === "route") {
    return [
      "case",
      ["in", ["get", "id"], ["literal", [...highlightedRouteBranchIds]]],
      RAIL_MAP_EMPHASIS_POLICY.line.route,
      RAIL_MAP_EMPHASIS_POLICY.line.contextOnRoute,
    ];
  }

  return RAIL_MAP_EMPHASIS_POLICY.line.idle;
}

export function buildLineBranchOpacity({
  selectedBranchId,
  highlightedRouteBranchIds,
}: {
  selectedBranchId?: string | null;
  highlightedRouteBranchIds: readonly string[];
}): number | ExpressionSpecification {
  const focusMode = getRailMapFocusMode({
    selectedBranchId,
    highlightedRouteBranchIds,
  });

  if (focusMode === "selection") {
    return [
      "case",
      ["==", ["get", "parentBranchId"], selectedBranchId ?? ""],
      RAIL_MAP_EMPHASIS_POLICY.line.selected,
      RAIL_MAP_EMPHASIS_POLICY.line.contextOnSelection,
    ];
  }

  if (focusMode === "route") {
    return [
      "case",
      [
        "in",
        ["get", "parentBranchId"],
        ["literal", [...highlightedRouteBranchIds]],
      ],
      RAIL_MAP_EMPHASIS_POLICY.line.route,
      RAIL_MAP_EMPHASIS_POLICY.line.contextOnRoute,
    ];
  }

  return RAIL_MAP_EMPHASIS_POLICY.line.idle;
}

export const STATION_OPACITY_EXPRESSIONS = {
  dot: [
    "case",
    ["==", ["get", "isEmphasized"], true],
    RAIL_MAP_EMPHASIS_POLICY.station.emphasized,
    ["==", ["get", "isContextStation"], true],
    RAIL_MAP_EMPHASIS_POLICY.station.context,
    RAIL_MAP_EMPHASIS_POLICY.station.background,
  ] as ExpressionSpecification,
  casing: [
    "case",
    ["==", ["get", "isEmphasized"], true],
    RAIL_MAP_EMPHASIS_POLICY.station.casingEmphasized,
    ["==", ["get", "isContextStation"], true],
    RAIL_MAP_EMPHASIS_POLICY.station.casingContext,
    RAIL_MAP_EMPHASIS_POLICY.station.casingBackground,
  ] as ExpressionSpecification,
  stroke: [
    "case",
    ["==", ["get", "isEmphasized"], true],
    RAIL_MAP_EMPHASIS_POLICY.station.emphasized,
    ["==", ["get", "isContextStation"], true],
    RAIL_MAP_EMPHASIS_POLICY.station.context,
    RAIL_MAP_EMPHASIS_POLICY.station.strokeBackground,
  ] as ExpressionSpecification,
  label: [
    "case",
    ["==", ["get", "isContextStation"], true],
    RAIL_MAP_EMPHASIS_POLICY.station.labelContext,
    RAIL_MAP_EMPHASIS_POLICY.station.labelBackground,
  ] as ExpressionSpecification,
} as const;
