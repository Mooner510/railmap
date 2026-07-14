import type { EditorStation } from "../editorModel";

export type TransferGroupSuggestion = {
  key: string;
  nameKo: string;
  stationIds: string[];
  reasonLabels: string[];
  confidence: "strong" | "weak";
  maxDistanceMeters: number;
};

export type TransferGroupReviewFilter = "pending" | "dismissed" | "approved" | "all";

export function filterTransferGroupSuggestions(
  suggestions: TransferGroupSuggestion[],
  filter: TransferGroupReviewFilter,
  approvedKeys: ReadonlySet<string>,
  dismissedKeys: ReadonlySet<string>,
) {
  return suggestions.filter((suggestion) => {
    const approved = approvedKeys.has(suggestion.key);
    const dismissed = dismissedKeys.has(suggestion.key);
    if (filter === "approved") return approved;
    if (filter === "dismissed") return dismissed;
    if (filter === "pending") return !approved && !dismissed;
    return true;
  });
}

function approximateDistanceMeters(left: EditorStation, right: EditorStation) {
  const leftLng = left.lng;
  const leftLat = left.lat;
  const rightLng = right.lng;
  const rightLat = right.lat;
  if (
    typeof leftLng !== "number" || !Number.isFinite(leftLng) ||
    typeof leftLat !== "number" || !Number.isFinite(leftLat) ||
    typeof rightLng !== "number" || !Number.isFinite(rightLng) ||
    typeof rightLat !== "number" || !Number.isFinite(rightLat)
  ) {
    return Number.POSITIVE_INFINITY;
  }
  const latitudeRadians = ((leftLat + rightLat) / 2) * Math.PI / 180;
  const dx = (leftLng - rightLng) * 111_320 * Math.cos(latitudeRadians);
  const dy = (leftLat - rightLat) * 110_540;
  return Math.sqrt(dx * dx + dy * dy);
}

export function findNearestPendingTransferSuggestion(input: {
  sourceStationIds: string[];
  excludeKey: string | null;
  suggestions: TransferGroupSuggestion[];
  approvedKeys: ReadonlySet<string>;
  dismissedKeys: ReadonlySet<string>;
  stationById: ReadonlyMap<string, EditorStation>;
}) {
  const {
    sourceStationIds,
    excludeKey,
    suggestions,
    approvedKeys,
    dismissedKeys,
    stationById,
  } = input;

  let best: { suggestion: TransferGroupSuggestion; distance: number } | null = null;
  for (const suggestion of suggestions) {
    if (
      suggestion.key === excludeKey ||
      approvedKeys.has(suggestion.key) ||
      dismissedKeys.has(suggestion.key)
    ) {
      continue;
    }

    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const sourceStationId of sourceStationIds) {
      const source = stationById.get(sourceStationId);
      if (!source) continue;
      for (const targetStationId of suggestion.stationIds) {
        const target = stationById.get(targetStationId);
        if (!target) continue;
        nearestDistance = Math.min(
          nearestDistance,
          approximateDistanceMeters(source, target),
        );
      }
    }

    if (
      !best ||
      nearestDistance < best.distance ||
      (nearestDistance === best.distance &&
        suggestion.confidence === "strong" &&
        best.suggestion.confidence !== "strong") ||
      (nearestDistance === best.distance &&
        suggestion.confidence === best.suggestion.confidence &&
        suggestion.maxDistanceMeters < best.suggestion.maxDistanceMeters)
    ) {
      best = { suggestion, distance: nearestDistance };
    }
  }

  return best?.suggestion ?? null;
}
