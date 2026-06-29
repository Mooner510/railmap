import fs from "node:fs/promises";
import { getBundlePath, readManualOverlays } from "../manualOverlayStore";
import { normalizeSearchText, type CanonicalBundle, type EditorStation } from "../editorModel";
import ManualTransferEditor from "./ManualTransferEditor";

type RouteStopColorRef = {
  stationId?: string | null;
  station?: { id?: string | null } | null;
};

type BranchColorRef = {
  sourceLineNumber?: string | null;
  sourceLineName?: string | null;
  routeStops?: RouteStopColorRef[];
};

type LineColorRef = {
  id?: string | null;
  canonicalKey?: string | null;
  lnCd?: string | null;
  nameKo?: string | null;
  colorHex?: string | null;
  sourceLineNumbers?: string[] | null;
  branches?: BranchColorRef[];
};

function getRouteStopStationId(stop: RouteStopColorRef): string | null {
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

function buildStationColorIndex(lines: LineColorRef[] | undefined) {
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

function resolveStationColor(
  station: EditorStation,
  colorIndex: ReturnType<typeof buildStationColorIndex>,
): string | null {
  const lineKeys = [station.lineNameKo, station.lineNumber].filter((value): value is string => Boolean(value));

  for (const lineKey of lineKeys) {
    const color = colorIndex.colorByStationAndLine.get(makeStationLineColorKey(station.id, lineKey));
    if (color) return color;
  }

  return colorIndex.colorByStationId.get(station.id) ?? null;
}

async function readStations(): Promise<EditorStation[]> {
  const body = await fs.readFile(getBundlePath(), "utf8");
  const bundle = JSON.parse(body) as CanonicalBundle & { lines?: LineColorRef[] };
  const stationColorIndex = buildStationColorIndex(bundle.lines);

  return bundle.stations.map((station) => ({
    ...station,
    colorHex: resolveStationColor(station, stationColorIndex),
  })).sort((a, b) => {
    const nameCompare = a.nameKo.localeCompare(b.nameKo, "ko-KR");
    if (nameCompare !== 0) return nameCompare;
    const lineCompare = a.lineNameKo.localeCompare(b.lineNameKo, "ko-KR");
    if (lineCompare !== 0) return lineCompare;
    return a.stationNumber.localeCompare(b.stationNumber, "ko-KR");
  });
}

export default async function TransfersPage() {
  const [stations, overlays] = await Promise.all([readStations(), readManualOverlays()]);

  return (
    <main className="editor-page-shell wide-shell transfer-editor-page">
      <ManualTransferEditor stations={stations} initialOverlays={overlays} />
    </main>
  );
}
