import type { EditorStation, ManualServicePattern } from "../editorModel";

export type TrainCsvPendingReviewItem = {
  stationId: string;
  sequence: number;
  stationName: string;
  sourceName: string;
  arrivalTime: string;
  departureTime: string;
};

export type TrainCsvMissedReviewItem = {
  sourceName: string;
  arrivalTime: string;
  departureTime: string;
  candidateStationIds: string[];
};

export type TrainCsvReview = {
  pending: TrainCsvPendingReviewItem[];
  missed: TrainCsvMissedReviewItem[];
  invalidTimes: string[];
  duplicateStops: string[];
};

function pendingKey(item: Pick<TrainCsvPendingReviewItem, "stationId" | "sequence">) {
  return `${item.stationId}:${item.sequence}`;
}

export function updateTrainCsvPendingTime(
  review: TrainCsvReview,
  index: number,
  field: "arrivalTime" | "departureTime",
  value: string,
): TrainCsvReview {
  return {
    ...review,
    pending: review.pending.map((item, itemIndex) =>
      itemIndex === index ? { ...item, [field]: value } : item,
    ),
  };
}

export function removeTrainCsvPendingItem(review: TrainCsvReview, index: number): TrainCsvReview {
  return {
    ...review,
    pending: review.pending.filter((_, itemIndex) => itemIndex !== index),
  };
}

export function resolveTrainCsvMissedItem(input: {
  review: TrainCsvReview;
  index: number;
  stationId: string;
  pattern: ManualServicePattern;
  stationById: ReadonlyMap<string, EditorStation>;
}): TrainCsvReview {
  const { review, index, stationId, pattern, stationById } = input;
  const missedItem = review.missed[index];
  const stop = pattern.stops.find((candidate) => candidate.stationId === stationId);
  if (!missedItem || !stop) return review;

  const key = pendingKey(stop);
  if (review.pending.some((item) => pendingKey(item) === key)) {
    return {
      ...review,
      missed: review.missed.filter((_, itemIndex) => itemIndex !== index),
      duplicateStops: [...review.duplicateStops, missedItem.sourceName],
    };
  }

  return {
    ...review,
    pending: [
      ...review.pending,
      {
        stationId: stop.stationId,
        sequence: stop.sequence,
        stationName: stationById.get(stop.stationId)?.nameKo ?? stop.stationId,
        sourceName: missedItem.sourceName,
        arrivalTime: missedItem.arrivalTime,
        departureTime: missedItem.departureTime,
      },
    ].sort((left, right) => left.sequence - right.sequence),
    missed: review.missed.filter((_, itemIndex) => itemIndex !== index),
  };
}

export function resolveAllUniqueTrainCsvMissedItems(input: {
  review: TrainCsvReview;
  pattern: ManualServicePattern;
  stationById: ReadonlyMap<string, EditorStation>;
}): TrainCsvReview {
  const { review, pattern, stationById } = input;
  const stopByStationId = new Map(pattern.stops.map((stop) => [stop.stationId, stop]));
  const pending = [...review.pending];
  const pendingKeys = new Set(pending.map(pendingKey));
  const duplicateStops = [...review.duplicateStops];
  const missed: TrainCsvMissedReviewItem[] = [];

  for (const item of review.missed) {
    if (item.candidateStationIds.length !== 1) {
      missed.push(item);
      continue;
    }
    const [candidateStationId] = item.candidateStationIds;
    if (!candidateStationId) {
      missed.push(item);
      continue;
    }
    const stop = stopByStationId.get(candidateStationId);
    if (!stop) {
      missed.push(item);
      continue;
    }
    const key = pendingKey(stop);
    if (pendingKeys.has(key)) {
      duplicateStops.push(item.sourceName);
      continue;
    }
    pendingKeys.add(key);
    pending.push({
      stationId: stop.stationId,
      sequence: stop.sequence,
      stationName: stationById.get(stop.stationId)?.nameKo ?? stop.stationId,
      sourceName: item.sourceName,
      arrivalTime: item.arrivalTime,
      departureTime: item.departureTime,
    });
  }

  pending.sort((left, right) => left.sequence - right.sequence);
  return { ...review, pending, missed, duplicateStops };
}
