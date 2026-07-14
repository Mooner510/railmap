export type RailMapLngLatTuple = [number, number];

export type TransferGroupMemberCoordinate = {
  lat: number;
  lng: number;
};

export const TRANSFER_DETAIL_ZOOM_THRESHOLD = 13.8;
export const TRANSFER_GROUP_AREA_MIN_RADIUS = 0.0018;
export const TRANSFER_GROUP_AREA_MAX_RADIUS = 0.012;
export const TRANSFER_GROUP_AREA_PADDING_RATIO = 1.55;
export const TRANSFER_GROUP_AREA_SEGMENTS = 56;

export function isTransferDetailVisible(zoom: number) {
  return zoom >= TRANSFER_DETAIL_ZOOM_THRESHOLD;
}

export function isCollapsedTransferZoom(zoom: number) {
  return !isTransferDetailVisible(zoom);
}

export function clampTransferGroupRadius(radius: number) {
  if (!Number.isFinite(radius)) return TRANSFER_GROUP_AREA_MIN_RADIUS;
  return Math.min(
    TRANSFER_GROUP_AREA_MAX_RADIUS,
    Math.max(TRANSFER_GROUP_AREA_MIN_RADIUS, radius),
  );
}

export function buildTransferGroupCircleGeometry(
  members: TransferGroupMemberCoordinate[],
) {
  const centerLng =
    members.reduce((sum, station) => sum + station.lng, 0) / members.length;
  const centerLat =
    members.reduce((sum, station) => sum + station.lat, 0) / members.length;
  const lngScale = Math.max(0.35, Math.cos((centerLat * Math.PI) / 180));
  const farthestMemberRadius = Math.max(
    0,
    ...members.map((station) => {
      const dx = (station.lng - centerLng) * lngScale;
      const dy = station.lat - centerLat;
      return Math.sqrt(dx * dx + dy * dy);
    }),
  );
  const radius = clampTransferGroupRadius(
    farthestMemberRadius * TRANSFER_GROUP_AREA_PADDING_RATIO,
  );

  const coordinates: RailMapLngLatTuple[] = [];
  for (let index = 0; index <= TRANSFER_GROUP_AREA_SEGMENTS; index += 1) {
    const angle = (Math.PI * 2 * index) / TRANSFER_GROUP_AREA_SEGMENTS;
    coordinates.push([
      centerLng + (Math.cos(angle) * radius) / lngScale,
      centerLat + Math.sin(angle) * radius,
    ]);
  }

  return {
    center: [centerLng, centerLat] as RailMapLngLatTuple,
    radius,
    coordinates,
  };
}

export function toLngLatTuple(
  point: ReadonlyArray<number>,
): RailMapLngLatTuple | null {
  const [lng, lat] = point;

  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  return [lng, lat];
}

export function catmullRomPoint(
  p0: RailMapLngLatTuple,
  p1: RailMapLngLatTuple,
  p2: RailMapLngLatTuple,
  p3: RailMapLngLatTuple,
  t: number,
): RailMapLngLatTuple {
  const [p0Lng, p0Lat] = p0;
  const [p1Lng, p1Lat] = p1;
  const [p2Lng, p2Lat] = p2;
  const [p3Lng, p3Lat] = p3;
  const t2 = t * t;
  const t3 = t2 * t;

  return [
    0.5 *
      (2 * p1Lng +
        (-p0Lng + p2Lng) * t +
        (2 * p0Lng - 5 * p1Lng + 4 * p2Lng - p3Lng) * t2 +
        (-p0Lng + 3 * p1Lng - 3 * p2Lng + p3Lng) * t3),
    0.5 *
      (2 * p1Lat +
        (-p0Lat + p2Lat) * t +
        (2 * p0Lat - 5 * p1Lat + 4 * p2Lat - p3Lat) * t2 +
        (-p0Lat + 3 * p1Lat - 3 * p2Lat + p3Lat) * t3),
  ];
}

export function smoothCoordinates(
  coordinates: ReadonlyArray<ReadonlyArray<number>>,
  samplesPerSegment = 5,
): RailMapLngLatTuple[] {
  const points = coordinates
    .map(toLngLatTuple)
    .filter((point): point is RailMapLngLatTuple => point !== null);

  if (points.length < 3) return points;

  const result: RailMapLngLatTuple[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)] ?? p2;

    if (!p0 || !p1 || !p2 || !p3) continue;

    if (index === 0) result.push(p1);

    for (let step = 1; step <= samplesPerSegment; step += 1) {
      result.push(catmullRomPoint(p0, p1, p2, p3, step / samplesPerSegment));
    }
  }

  return result;
}


export type AdaptiveSmoothCoordinateOptions = {
  minSpacing?: number;
  maxSpacing?: number;
  maxPoints?: number;
  smoothingPasses?: number;
};

function interpolateCoordinate(
  start: RailMapLngLatTuple,
  end: RailMapLngLatTuple,
  progress: number,
): RailMapLngLatTuple {
  return [
    start[0] + (end[0] - start[0]) * progress,
    start[1] + (end[1] - start[1]) * progress,
  ];
}

function resampleCoordinatesByDistance(
  coordinates: RailMapLngLatTuple[],
  pointCount: number,
): RailMapLngLatTuple[] {
  if (coordinates.length < 2 || pointCount <= 2) {
    const first = coordinates[0];
    const last = coordinates.at(-1);
    return first && last ? [first, last] : coordinates;
  }

  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulative.push(
      (cumulative[index - 1] ?? 0) +
        getCoordinateDistance(coordinates[index - 1]!, coordinates[index]!),
    );
  }

  const total = cumulative.at(-1) ?? 0;
  if (!Number.isFinite(total) || total <= 0) return coordinates;

  const result: RailMapLngLatTuple[] = [];
  let segmentIndex = 1;

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const distance = (total * pointIndex) / (pointCount - 1);
    while (
      segmentIndex < cumulative.length - 1 &&
      (cumulative[segmentIndex] ?? 0) < distance
    ) {
      segmentIndex += 1;
    }

    const startIndex = Math.max(0, segmentIndex - 1);
    const startDistance = cumulative[startIndex] ?? 0;
    const endDistance = cumulative[segmentIndex] ?? total;
    const span = Math.max(endDistance - startDistance, Number.EPSILON);
    const progress = Math.max(0, Math.min(1, (distance - startDistance) / span));
    result.push(
      interpolateCoordinate(
        coordinates[startIndex]!,
        coordinates[segmentIndex]!,
        progress,
      ),
    );
  }

  // Arc-length resampling must never move the editable anchors.
  result[0] = coordinates[0]!;
  result[result.length - 1] = coordinates.at(-1)!;
  return result;
}

function coordinateTurnAngle(
  previous: RailMapLngLatTuple,
  current: RailMapLngLatTuple,
  next: RailMapLngLatTuple,
) {
  const incomingX = current[0] - previous[0];
  const incomingY = current[1] - previous[1];
  const outgoingX = next[0] - current[0];
  const outgoingY = next[1] - current[1];
  const incomingLength = Math.hypot(incomingX, incomingY);
  const outgoingLength = Math.hypot(outgoingX, outgoingY);
  if (incomingLength <= Number.EPSILON || outgoingLength <= Number.EPSILON) {
    return 0;
  }

  const cosine = Math.max(
    -1,
    Math.min(
      1,
      (incomingX * outgoingX + incomingY * outgoingY) /
        (incomingLength * outgoingLength),
    ),
  );
  return Math.acos(cosine);
}

/**
 * Builds a render-only railway polyline while preserving every editable point
 * exactly. Each pair of station/control anchors is smoothed and arc-length
 * resampled independently, so a later global resample can never cut across a
 * station or leave the rendered line short of its coordinate.
 */
export function buildAdaptiveSmoothCoordinates(
  coordinates: ReadonlyArray<ReadonlyArray<number>>,
  options: AdaptiveSmoothCoordinateOptions = {},
): RailMapLngLatTuple[] {
  const points = coordinates
    .map(toLngLatTuple)
    .filter((point): point is RailMapLngLatTuple => point !== null)
    .filter(
      (point, index, source) =>
        index === 0 || getCoordinateDistance(source[index - 1]!, point) > 1e-10,
    );
  if (points.length < 2) return points;

  const minSpacing = options.minSpacing ?? 0.000035;
  const maxSpacing = options.maxSpacing ?? 0.00055;
  const maxPoints = Math.max(points.length, options.maxPoints ?? 720);
  const requestedDensity = Math.max(12, options.smoothingPasses ?? 18);

  const segmentPointCounts = points.slice(0, -1).map((start, index) => {
    const end = points[index + 1]!;
    const distance = getCoordinateDistance(start, end);
    const previous = points[Math.max(0, index - 1)] ?? start;
    const next = points[Math.min(points.length - 1, index + 2)] ?? end;
    const turnBefore = coordinateTurnAngle(previous, start, end);
    const turnAfter = coordinateTurnAngle(start, end, next);
    const curvatureBoost = Math.ceil(((turnBefore + turnAfter) / Math.PI) * 18);
    const targetSpacing = Math.max(
      minSpacing,
      Math.min(maxSpacing, distance / requestedDensity),
    );

    // Even very short sections need enough samples to read as a curve.
    return Math.max(
      14,
      Math.min(72, Math.ceil(distance / targetSpacing) + 1 + curvatureBoost),
    );
  });

  const requestedTotal =
    1 + segmentPointCounts.reduce((sum, pointCount) => sum + pointCount - 1, 0);
  const scale = requestedTotal > maxPoints ? (maxPoints - 1) / (requestedTotal - 1) : 1;
  const result: RailMapLngLatTuple[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)] ?? points[index]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[Math.min(points.length - 1, index + 2)] ?? p2;
    const pointCount = Math.max(
      6,
      Math.round(((segmentPointCounts[index] ?? 14) - 1) * scale) + 1,
    );
    const denseCount = Math.max(32, pointCount * 3);
    const denseSegment: RailMapLngLatTuple[] = [p1];

    for (let step = 1; step <= denseCount; step += 1) {
      denseSegment.push(
        catmullRomPoint(p0, p1, p2, p3, step / denseCount),
      );
    }

    // Reassert exact station/control coordinates before and after resampling.
    denseSegment[0] = p1;
    denseSegment[denseSegment.length - 1] = p2;
    const segment = resampleCoordinatesByDistance(denseSegment, pointCount);
    segment[0] = p1;
    segment[segment.length - 1] = p2;

    if (index === 0) result.push(segment[0]!);
    result.push(...segment.slice(1));
  }

  // Final safety: all original anchors must exist byte-for-byte in the result.
  let resultIndex = 0;
  for (const anchor of points) {
    while (
      resultIndex < result.length - 1 &&
      getCoordinateDistance(result[resultIndex]!, anchor) > 1e-10
    ) {
      resultIndex += 1;
    }
    if (getCoordinateDistance(result[resultIndex]!, anchor) <= 1e-10) {
      result[resultIndex] = anchor;
    }
  }

  return result;
}

export function smoothCoordinateRange(
  coordinates: RailMapLngLatTuple[],
  startIndex: number,
  endIndex: number,
  samplesPerSegment = 5,
): RailMapLngLatTuple[] {
  if (coordinates.length < 2 || startIndex === endIndex) return [];

  const start = Math.max(0, Math.min(startIndex, endIndex));
  const end = Math.min(coordinates.length - 1, Math.max(startIndex, endIndex));

  if (coordinates.length < 3) return coordinates.slice(start, end + 1);

  const result: RailMapLngLatTuple[] = [];

  for (let index = start; index < end; index += 1) {
    const p0 = coordinates[Math.max(0, index - 1)] ?? coordinates[index];
    const p1 = coordinates[index];
    const p2 = coordinates[index + 1];
    const p3 = coordinates[Math.min(coordinates.length - 1, index + 2)] ?? p2;

    if (!p0 || !p1 || !p2 || !p3) continue;

    if (index === start) result.push(p1);

    for (let step = 1; step <= samplesPerSegment; step += 1) {
      result.push(catmullRomPoint(p0, p1, p2, p3, step / samplesPerSegment));
    }
  }

  return startIndex <= endIndex ? result : [...result].reverse();
}

export function cubicBezierPoint(
  start: RailMapLngLatTuple,
  control1: RailMapLngLatTuple,
  control2: RailMapLngLatTuple,
  end: RailMapLngLatTuple,
  t: number,
): RailMapLngLatTuple {
  const inverse = 1 - t;
  const inverse2 = inverse * inverse;
  const inverse3 = inverse2 * inverse;
  const t2 = t * t;
  const t3 = t2 * t;

  return [
    inverse3 * start[0] +
      3 * inverse2 * t * control1[0] +
      3 * inverse * t2 * control2[0] +
      t3 * end[0],
    inverse3 * start[1] +
      3 * inverse2 * t * control1[1] +
      3 * inverse * t2 * control2[1] +
      t3 * end[1],
  ];
}

export function getCoordinateDistance(
  a: RailMapLngLatTuple,
  b: RailMapLngLatTuple,
) {
  const lngScale = Math.max(
    0.35,
    Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180),
  );
  const dx = (b[0] - a[0]) * lngScale;
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

export function normalizeCoordinateVector(
  from: RailMapLngLatTuple,
  to: RailMapLngLatTuple,
): RailMapLngLatTuple | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(length) || length <= 0) return null;
  return [dx / length, dy / length];
}

export function buildSmoothConnectionCurve(
  start: RailMapLngLatTuple,
  end: RailMapLngLatTuple,
  startContext: RailMapLngLatTuple | null,
  endContext: RailMapLngLatTuple | null,
  segments = 28,
): RailMapLngLatTuple[] {
  const distance = getCoordinateDistance(start, end);
  if (!Number.isFinite(distance) || distance <= 0) return [start, end];

  const controlDistance = Math.min(Math.max(distance * 0.42, 0.0012), 0.08);
  const startDirection = startContext
    ? normalizeCoordinateVector(startContext, start)
    : normalizeCoordinateVector(start, end);
  const endDirection = endContext
    ? normalizeCoordinateVector(end, endContext)
    : normalizeCoordinateVector(start, end);

  const control1: RailMapLngLatTuple = startDirection
    ? [
        start[0] + startDirection[0] * controlDistance,
        start[1] + startDirection[1] * controlDistance,
      ]
    : [
        start[0] + (end[0] - start[0]) * 0.33,
        start[1] + (end[1] - start[1]) * 0.33,
      ];
  const control2: RailMapLngLatTuple = endDirection
    ? [
        end[0] - endDirection[0] * controlDistance,
        end[1] - endDirection[1] * controlDistance,
      ]
    : [
        start[0] + (end[0] - start[0]) * 0.66,
        start[1] + (end[1] - start[1]) * 0.66,
      ];

  const coordinates: RailMapLngLatTuple[] = [start];
  for (let step = 1; step <= segments; step += 1) {
    coordinates.push(
      cubicBezierPoint(start, control1, control2, end, step / segments),
    );
  }
  return coordinates;
}

export function optimizeCoordinates(
  coordinates: RailMapLngLatTuple[],
  maxPoints = 420,
) {
  if (coordinates.length <= maxPoints) return coordinates;

  const stride = Math.ceil(coordinates.length / maxPoints);
  const result = coordinates.filter((_, index) => index % stride === 0);
  const last = coordinates.at(-1);
  if (last && result.at(-1) !== last) result.push(last);
  return result;
}

export const RAIL_MAP_VISUAL_POLICY = {
  baseLineWidth: 3,
  selectedLineWidth: 6,
  lineCasingWidth: 0,
  lineCasingOpacity: 0,
  stationLabelMinZoom: 11.5,
  stationLabelTextSize: 11,
  selectedStationLabelTextSize: 12,
  stationLabelHaloWidth: 1.5,
  stationLabelOpacity: 1,
} as const;

export function getRailStationLabelVisibility(zoom: number) {
  return zoom >= RAIL_MAP_VISUAL_POLICY.stationLabelMinZoom;
}

export type RailMapFocusMode = "idle" | "selection" | "route";

export const RAIL_MAP_EMPHASIS_POLICY = {
  line: {
    idle: 0.76,
    selected: 0.94,
    route: 0.92,
    contextOnSelection: 0.026,
    contextOnRoute: 0.018,
  },
  station: {
    emphasized: 0.99,
    context: 0.97,
    background: 0.18,
    casingEmphasized: 0.99,
    casingContext: 0.94,
    casingBackground: 0.13,
    strokeBackground: 0.2,
    labelContext: 0.94,
    labelBackground: 0.22,
  },
  transfer: {
    context: 1,
    background: 0.22,
    labelBackground: 0.2,
  },
} as const;

export function getRailMapFocusMode({
  selectedBranchId,
  highlightedRouteBranchIds,
}: {
  selectedBranchId?: string | null;
  highlightedRouteBranchIds?: readonly string[];
}): RailMapFocusMode {
  if ((highlightedRouteBranchIds?.length ?? 0) > 0) return "route";
  if (selectedBranchId) return "selection";
  return "idle";
}
