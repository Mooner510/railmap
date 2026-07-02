import { readUnifiedEditorData } from "../editorData";
import StationOverrideEditor from "./StationOverrideEditor";

export default async function StationsPage() {
  const { stations, overlays } = await readUnifiedEditorData();

  return (
    <main className="editor-page-shell wide-shell transfer-editor-page">
      <StationOverrideEditor stations={stations} initialOverlays={overlays} />
    </main>
  );
}
