import fs from "node:fs/promises";
import { getBundlePath, readManualOverlays } from "../manualOverlayStore";
import { type CanonicalBundle, type EditorStation } from "../editorModel";
import ManualTransferEditor from "./ManualTransferEditor";

async function readStations(): Promise<EditorStation[]> {
  const body = await fs.readFile(getBundlePath(), "utf8");
  const bundle = JSON.parse(body) as CanonicalBundle & {
    lines?: Array<{ colorHex?: string | null; branches?: Array<{ routeStops?: Array<{ station?: { id?: string } | null }> }> }>;
  };

  const stationColorIndex = new Map<string, string>();
  for (const line of bundle.lines ?? []) {
    if (!line.colorHex) continue;

    for (const branch of line.branches ?? []) {
      for (const stop of branch.routeStops ?? []) {
        const stationId = stop.station?.id;
        if (stationId && !stationColorIndex.has(stationId)) {
          stationColorIndex.set(stationId, line.colorHex);
        }
      }
    }
  }

  return bundle.stations.map((station) => ({
    ...station,
    colorHex: stationColorIndex.get(station.id) ?? null,
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
