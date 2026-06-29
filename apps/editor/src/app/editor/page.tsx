import { readUnifiedEditorData } from "../editorData";
import UnifiedMapEditor from "./UnifiedMapEditor";

export default async function UnifiedEditorPage() {
  const data = await readUnifiedEditorData();
  return <UnifiedMapEditor data={data} />;
}
