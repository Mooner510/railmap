import fs from "node:fs/promises";
import { getBundlePath, readManualOverlays } from "./manualOverlayStore";
import {
  normalizeSearchText,
  type EditorStation,
  type ManualGeometryOverride,
  type ManualOverlayBundle,
  type ManualStationOverride,
} from "./editorModel";

export type CanonicalRouteStop = {
  id: string;
  sequence: number;
  stationId?: string | null;
  station?: { id?: string | null } | null;
  displayNameKo: string;
  confidence?: string | null;
};

export type CanonicalBranch = {
  id: string;
  role: string;
  sourceLineNumber: string;
  sourceLineName: string;
  origin?: string | null;
  terminal?: string | null;
  routeStops: CanonicalRouteStop[];
};

export type CanonicalLine = {
  id?: string | null;
  canonicalKey?: string | null;
  lnCd?: string | null;
  nameKo: string;
  colorHex?: string | null;
  sourceLineNumbers?: string[] | null;
  branches?: CanonicalBranch[];
};

export type EditorMapBranch = {
  id: string;
  canonicalLineId: string;
  canonicalLineNameKo: string;
  colorHex: string;
  role: string;
  sourceLineNumber: string;
  sourceLineName: string;
  origin?: string | null;
  terminal?: string | null;
  geometryOverrideCoordinates?: Array<[number, number]>;
  geometryCoordinates: Array<[number, number]>;
  routeStopCount: number;
  routeStops: Array<{
    id: string;
    sequence: number;
    displayNameKo: string;
    station: EditorStation | null;
    confidence: string;
  }>;
};

export type EditorMapLine = {
  id: string;
  nameKo: string;
  colorHex: string;
  branchCount: number;
};

export type UnifiedEditorData = {
  stations: EditorStation[];
  branches: EditorMapBranch[];
  lines: EditorMapLine[];
  overlays: ManualOverlayBundle;
};

type CanonicalBundle = {
  stations: EditorStation[];
  lines?: CanonicalLine[];
};

type StationColorIndex = ReturnType<typeof buildStationColorIndex>;

function getRouteStopStationId(stop: CanonicalRouteStop): string | null {
  return stop.stationId ?? stop.station?.id ?? null;
}

function makeStationLineColorKey(stationId: string, lineKey: string) {
  return `${stationId}::${normalizeSearchText(lineKey)}`;
}

function addStationLineColor(
  colorByStationAndLine: Map<string, string>,
  stationId: string,
  lineKey: string | null | undefined,
  colorHex: string,
) {
  if (!lineKey) return;
  const normalized = normalizeSearchText(lineKey);
  if (!normalized) return;
  const key = makeStationLineColorKey(stationId, normalized);
  if (!colorByStationAndLine.has(key)) colorByStationAndLine.set(key, colorHex);
}

function buildStationColorIndex(lines: CanonicalLine[] | undefined) {
  const colorByStationId = new Map<string, string>();
  const colorByStationAndLine = new Map<string, string>();

  for (const line of lines ?? []) {
    if (!line.colorHex) continue;

    for (const branch of line.branches ?? []) {
      for (const stop of branch.routeStops ?? []) {
        const stationId = getRouteStopStationId(stop);
        if (!stationId) continue;

        if (!colorByStationId.has(stationId)) colorByStationId.set(stationId, line.colorHex);

        addStationLineColor(colorByStationAndLine, stationId, line.nameKo, line.colorHex);
        addStationLineColor(colorByStationAndLine, stationId, branch.sourceLineName, line.colorHex);
        addStationLineColor(colorByStationAndLine, stationId, branch.sourceLineNumber, line.colorHex);
        addStationLineColor(colorByStationAndLine, stationId, line.id, line.colorHex);
        addStationLineColor(colorByStationAndLine, stationId, line.canonicalKey, line.colorHex);
        addStationLineColor(colorByStationAndLine, stationId, line.lnCd, line.colorHex);

        for (const sourceLineNumber of line.sourceLineNumbers ?? []) {
          addStationLineColor(colorByStationAndLine, stationId, sourceLineNumber, line.colorHex);
        }
      }
    }
  }

  return { colorByStationId, colorByStationAndLine };
}

function resolveStationColor(station: EditorStation, colorIndex: StationColorIndex): string | null {
  const lineKeys = [station.lineNameKo, station.lineNumber].filter((value): value is string => Boolean(value));

  for (const lineKey of lineKeys) {
    const color = colorIndex.colorByStationAndLine.get(makeStationLineColorKey(station.id, lineKey));
    if (color) return color;
  }

  return colorIndex.colorByStationId.get(station.id) ?? null;
}

function applyStationOverrides(stations: EditorStation[], overrides: ManualStationOverride[]): EditorStation[] {
  const overrideByStationId = new Map(
    overrides
      .filter((override) => override.enabled !== false)
      .map((override) => [override.stationId, override]),
  );

  return stations.map((station) => {
    const override = overrideByStationId.get(station.id);
    if (!override) return station;

    return {
      ...station,
      nameKo: override.nameKo?.trim() || station.nameKo,
      lat: typeof override.lat === "number" && Number.isFinite(override.lat) ? override.lat : station.lat,
      lng: typeof override.lng === "number" && Number.isFinite(override.lng) ? override.lng : station.lng,
    };
  });
}

function toMapBranches(bundle: CanonicalBundle, stations: EditorStation[], geometryOverrides: ManualGeometryOverride[]): EditorMapBranch[] {
  const stationById = new Map(stations.map((station) => [station.id, station]));
  const overrideByBranchId = new Map(
    geometryOverrides
      .filter((override) => override.enabled !== false && override.points.length >= 2)
      .map((override) => [override.branchId, override]),
  );

  return (bundle.lines ?? []).flatMap((line) =>
    (line.branches ?? []).map((branch) => {
      const geometryOverrideCoordinates = overrideByBranchId.get(branch.id)?.points
        .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat))
        .map((point) => [point.lng, point.lat] as [number, number]);
      const geometryCoordinates = geometryOverrideCoordinates && geometryOverrideCoordinates.length >= 2
        ? geometryOverrideCoordinates
        : branch.routeStops
            .map((stop) => {
              const stationId = getRouteStopStationId(stop);
              const station = stationId ? stationById.get(stationId) : null;
              return station && typeof station.lng === "number" && typeof station.lat === "number" && Number.isFinite(station.lng) && Number.isFinite(station.lat)
                ? ([station.lng, station.lat] as [number, number])
                : null;
            })
            .filter((coordinates): coordinates is [number, number] => coordinates !== null);

      return {
        id: branch.id,
        canonicalLineId: line.canonicalKey ?? line.id ?? branch.id,
        canonicalLineNameKo: line.nameKo,
        colorHex: line.colorHex ?? "#0284c7",
        role: branch.role,
        sourceLineNumber: branch.sourceLineNumber,
        sourceLineName: branch.sourceLineName,
        origin: branch.origin ?? null,
        terminal: branch.terminal ?? null,
        geometryOverrideCoordinates,
        geometryCoordinates,
        routeStopCount: branch.routeStops.length,
        routeStops: [],
      };
    }),
  );
}

function toMapLines(lines: CanonicalLine[] | undefined): EditorMapLine[] {
  return (lines ?? []).map((line) => ({
    id: line.canonicalKey ?? line.id ?? line.nameKo,
    nameKo: line.nameKo,
    colorHex: line.colorHex ?? "#0284c7",
    branchCount: line.branches?.length ?? 0,
  }));
}

export async function readUnifiedEditorData(): Promise<UnifiedEditorData> {
  const body = await fs.readFile(getBundlePath(), "utf8");
  const bundle = JSON.parse(body) as CanonicalBundle;
  const overlays = await readManualOverlays();
  const colorIndex = buildStationColorIndex(bundle.lines);
  const stations = applyStationOverrides(bundle.stations, overlays.stationOverrides)
    .map((station) => ({
      ...station,
      colorHex: resolveStationColor(station, colorIndex),
    }))
    .sort((a, b) => {
      const nameCompare = a.nameKo.localeCompare(b.nameKo, "ko-KR");
      if (nameCompare !== 0) return nameCompare;
      const lineCompare = a.lineNameKo.localeCompare(b.lineNameKo, "ko-KR");
      if (lineCompare !== 0) return lineCompare;
      return a.stationNumber.localeCompare(b.stationNumber, "ko-KR");
    });

  return {
    stations,
    branches: toMapBranches(bundle, stations, overlays.geometryOverrides),
    lines: toMapLines(bundle.lines),
    overlays,
  };
}
