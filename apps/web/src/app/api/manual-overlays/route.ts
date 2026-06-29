import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { type ManualTransferEdge } from "../../railExplorerModel";

interface ManualOverlays {
  schemaVersion: 1;
  manualTransferEdges: ManualTransferEdge[];
}

const DEFAULT_OVERLAYS: ManualOverlays = {
  schemaVersion: 1,
  manualTransferEdges: [],
};

function getOverlayPaths() {
  return [
    path.join(process.cwd(), "public/data/manual-overlays.json"),
    path.join(process.cwd(), "../../data/manual/manual-overlays.json"),
  ];
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (code === "ENOENT") return null;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTransferEdge(value: unknown, index: number): ManualTransferEdge | null {
  if (!isRecord(value)) return null;

  const fromStationId = typeof value.fromStationId === "string" ? value.fromStationId.trim() : "";
  const toStationId = typeof value.toStationId === "string" ? value.toStationId.trim() : "";

  if (!fromStationId || !toStationId || fromStationId === toStationId) return null;

  const id = typeof value.id === "string" && value.id.trim()
    ? value.id.trim()
    : `manual-transfer:${fromStationId}:${toStationId}:${index + 1}`;

  const transferMinutes = typeof value.transferMinutes === "number" && Number.isFinite(value.transferMinutes)
    ? Math.max(0, Math.round(value.transferMinutes))
    : null;

  return {
    id,
    fromStationId,
    toStationId,
    labelKo: typeof value.labelKo === "string" ? value.labelKo.trim() || null : null,
    transferMinutes,
    bidirectional: value.bidirectional !== false,
    enabled: value.enabled !== false,
    source: "editor",
    note: typeof value.note === "string" ? value.note.trim() || null : null,
  };
}

function normalizeOverlays(value: unknown): ManualOverlays {
  if (!isRecord(value)) return DEFAULT_OVERLAYS;

  const manualTransferEdges = Array.isArray(value.manualTransferEdges)
    ? value.manualTransferEdges
        .map((edge, index) => normalizeTransferEdge(edge, index))
        .filter((edge): edge is ManualTransferEdge => edge !== null)
    : [];

  return {
    schemaVersion: 1,
    manualTransferEdges,
  };
}

async function readManualOverlays(): Promise<ManualOverlays> {
  for (const filePath of getOverlayPaths()) {
    const parsed = await readJsonFile(filePath);
    if (parsed !== null) return normalizeOverlays(parsed);
  }

  return DEFAULT_OVERLAYS;
}

async function writeManualOverlays(overlays: ManualOverlays) {
  const body = `${JSON.stringify(overlays, null, 2)}\n`;

  for (const filePath of getOverlayPaths()) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body, "utf8");
  }
}

export async function GET() {
  return NextResponse.json(await readManualOverlays());
}

export async function PUT(request: Request) {
  const overlays = normalizeOverlays(await request.json());

  await writeManualOverlays(overlays);

  return NextResponse.json(overlays);
}
