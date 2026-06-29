import fs from "node:fs/promises";
import { getBundlePath, readManualOverlays } from "../manualOverlayStore";
import { type CanonicalBundle, type EditorStation } from "../editorModel";
import ManualTransferEditor from "./ManualTransferEditor";

async function readStations(): Promise<EditorStation[]> {
  const body = await fs.readFile(getBundlePath(), "utf8");
  const bundle = JSON.parse(body) as CanonicalBundle;

  return [...bundle.stations].sort((a, b) => {
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
