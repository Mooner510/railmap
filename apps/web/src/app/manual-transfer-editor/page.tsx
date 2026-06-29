import fs from "node:fs";
import path from "node:path";
import ManualTransferEditor from "./ManualTransferEditor";
import { type ManualTransferEdge } from "../railExplorerModel";

interface CanonicalStation {
  id: string;
  stationNumber: string;
  nameKo: string;
  lineNameKo: string;
}

interface CanonicalBundle {
  stations: CanonicalStation[];
}

interface ManualOverlays {
  schemaVersion: 1;
  manualTransferEdges: ManualTransferEdge[];
}

function readBundle(): CanonicalBundle {
  const bundlePath = path.join(process.cwd(), "public/data/kric-canonical-app-bundle.json");
  return JSON.parse(fs.readFileSync(bundlePath, "utf8")) as CanonicalBundle;
}

function readManualOverlays(): ManualOverlays {
  const candidates = [
    path.join(process.cwd(), "public/data/manual-overlays.json"),
    path.join(process.cwd(), "../../data/manual/manual-overlays.json"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as Partial<ManualOverlays>;
    return {
      schemaVersion: 1,
      manualTransferEdges: Array.isArray(parsed.manualTransferEdges) ? parsed.manualTransferEdges : [],
    };
  }

  return {
    schemaVersion: 1,
    manualTransferEdges: [],
  };
}

export default function ManualTransferEditorPage() {
  const bundle = readBundle();
  const overlays = readManualOverlays();

  return (
    <ManualTransferEditor
      stations={bundle.stations.map((station) => ({
        id: station.id,
        nameKo: station.nameKo,
        stationNumber: station.stationNumber,
        lineNameKo: station.lineNameKo,
      }))}
      initialOverlays={overlays}
    />
  );
}
