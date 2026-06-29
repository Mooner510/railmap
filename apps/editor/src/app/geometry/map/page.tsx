import fs from "node:fs/promises";
import { getBundlePath, readManualOverlays } from "../../manualOverlayStore";
import {
  normalizeSearchText,
  type EditorStation,
  type ManualGeometryOverride,
  type ManualStationOverride,
} from "../../editorModel";
import ManualGeometryMapEditor, { type GeometryMapBranch } from "./ManualGeometryMapEditor";

type CanonicalRouteStop = {
  id: string;
  sequence: number;
  stationId?: string | null;
  station?: { id?: string | null } | null;
  displayNameKo: string;
  confidence?: string | null;
};

type CanonicalBranch = {
  id: string;
  role: string;
  sourceLineNumber: string;
  sourceLineName: string;
  origin?: string | null;
  terminal?: string | null;
  routeStops: CanonicalRouteStop[];
};

type CanonicalLine = {
  id?: string | null;
  canonicalKey?: string | null;
  lnCd?: string | null;
  nameKo: string;
  colorHex?: string | null;
  sourceLineNumbers?: string[] | null;
  branches?: CanonicalBranch[];
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

function toGeometryPoints(
  branch: CanonicalBranch,
  stationById: Map<string, EditorStation>,
  override: ManualGeometryOverride | undefined,
): GeometryMapBranch["geometryPoints"] {
  if (override?.enabled !== false && Array.isArray(override?.points) && override.points.length >= 2) {
    return override.points
      .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat))
      .map((point) => ({
        lng: point.lng,
        lat: point.lat,
        kind: point.kind === "station" ? "station" : "control",
        stationId: point.stationId,
      }));
  }

  return branch.routeStops
    .map((stop) => {
      const stationId = getRouteStopStationId(stop);
      const station = stationId ? stationById.get(stationId) : null;
      if (!station || typeof station.lng !== "number" || typeof station.lat !== "number") return null;
      if (!Number.isFinite(station.lng) || !Number.isFinite(station.lat)) return null;

      return {
        lng: station.lng,
        lat: station.lat,
        kind: "station" as const,
        stationId: station.id,
      };
    })
    .filter((point): point is NonNullable<typeof point> => point !== null);
}

function toSourceGeometryPoints(
  branch: CanonicalBranch,
  stationById: Map<string, EditorStation>,
): GeometryMapBranch["geometryPoints"] {
  return branch.routeStops
    .map((stop) => {
      const stationId = getRouteStopStationId(stop);
      const station = stationId ? stationById.get(stationId) : null;
      if (!station || typeof station.lng !== "number" || typeof station.lat !== "number") return null;
      if (!Number.isFinite(station.lng) || !Number.isFinite(station.lat)) return null;

      return {
        lng: station.lng,
        lat: station.lat,
        kind: "station" as const,
        stationId: station.id,
      };
    })
    .filter((point): point is NonNullable<typeof point> => point !== null);
}

function toMapBranches(
  bundle: CanonicalBundle,
  stations: EditorStation[],
  geometryOverrides: ManualGeometryOverride[],
): GeometryMapBranch[] {
  const stationById = new Map(stations.map((station) => [station.id, station]));
  const overrideByBranchId = new Map(geometryOverrides.map((override) => [override.branchId, override]));

  return (bundle.lines ?? []).flatMap((line) =>
    (line.branches ?? []).map((branch) => ({
      id: branch.id,
      canonicalLineId: line.canonicalKey ?? line.id ?? branch.id,
      canonicalLineNameKo: line.nameKo,
      colorHex: line.colorHex ?? "#0284c7",
      role: branch.role,
      sourceLineNumber: branch.sourceLineNumber,
      sourceLineName: branch.sourceLineName,
      origin: branch.origin ?? null,
      terminal: branch.terminal ?? null,
      sourceGeometryPoints: toSourceGeometryPoints(branch, stationById),
      geometryPoints: toGeometryPoints(branch, stationById, overrideByBranchId.get(branch.id)),
    })),
  );
}

async function readGeometryMapData() {
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
    overlays,
  };
}

export default async function GeometryMapPage() {
  const { branches, overlays } = await readGeometryMapData();

  return (
    <main className="geometry-editor-page-shell">
      <ManualGeometryMapEditor branches={branches} initialOverlays={overlays} />
    </main>
  );
}
