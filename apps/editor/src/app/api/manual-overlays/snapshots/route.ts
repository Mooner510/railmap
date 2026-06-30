import { NextResponse } from "next/server";
import {
  listManualOverlaySnapshots,
  loadManualOverlaySnapshot,
  saveManualOverlaySnapshot,
} from "../../../manualOverlayStore";

export async function GET() {
  return NextResponse.json(await listManualOverlaySnapshots());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    subtitle?: string | null;
    snapshotId?: string;
  };

  if (body.action === "load") {
    if (!body.snapshotId) {
      return NextResponse.json(
        { error: "snapshotId is required" },
        { status: 400 },
      );
    }

    const loaded = await loadManualOverlaySnapshot(body.snapshotId);
    if (!loaded) {
      return NextResponse.json(
        { error: "snapshot not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(loaded);
  }

  const snapshot = await saveManualOverlaySnapshot(body.subtitle);
  return NextResponse.json(snapshot);
}
