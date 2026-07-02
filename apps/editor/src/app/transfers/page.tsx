import { readUnifiedEditorData } from "../editorData";
import ManualTransferEditor from "./ManualTransferEditor";

export default async function TransfersPage() {
  const { stations, overlays } = await readUnifiedEditorData();

  return (
    <main className="editor-page-shell wide-shell transfer-editor-page">
      <ManualTransferEditor stations={stations} initialOverlays={overlays} />
    </main>
  );
}
