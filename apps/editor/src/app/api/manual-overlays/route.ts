import { NextResponse } from "next/server";
import { normalizeManualOverlays, readManualOverlays, writeManualOverlays } from "../../manualOverlayStore";

export async function GET() {
  return NextResponse.json(await readManualOverlays());
}

export async function PUT(request: Request) {
  const overlays = normalizeManualOverlays(await request.json());
  const saved = await writeManualOverlays(overlays);

  return NextResponse.json(saved);
}
