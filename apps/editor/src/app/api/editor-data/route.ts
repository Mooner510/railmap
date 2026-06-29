import { NextResponse } from "next/server";
import { readUnifiedEditorData } from "../../editorData";

export async function GET() {
  const data = await readUnifiedEditorData();
  return NextResponse.json(data);
}
