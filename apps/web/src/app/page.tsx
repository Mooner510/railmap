import fs from "node:fs";
import path from "node:path";
import RailExplorer from "./RailExplorer";
import { type RailMapBranch, type RailMapStation } from "./RailMap";

type MatchConfidence = "high" | "medium" | "low" | "none" | string;

interface CanonicalRouteStop {
  id: string;
  canonicalLineId: string;
  branchId: string;
  sourceLineNumber: string;
  sourceLineName: string;
  role: string;
  sequence: number;
  stationId: string;
  sourceStationCode: string;
  displayNameKo: string;
  matchStatus: string;
  confidence: MatchConfidence;
  sourceCandidateId: string;
  diagnostics?: string[];
}

interface CanonicalBranch {
  id: string;
  canonicalLineId: string;
  role: "main" | "branch" | string;
  sourceLineNumber: string;
  sourceLineName: string;
  origin: string | null;
  terminal: string | null;
  routeStops: CanonicalRouteStop[];
}

interface CanonicalLine {
  id: string;
  canonicalKey: string;
  lnCd: string;
  mreaWideCd: string;
  nameKo: string;
  colorHex: string;
  colorSource: string;
  branches: CanonicalBranch[];
  sourceLineNumbers: string[];
}

interface CanonicalStation {
  id: string;
  stationNumber: string;
  nameKo: string;
  nameEn?: string | null;
  lineNumber: string;
  lineNameKo: string;
  lat: number | null;
  lng: number | null;
  operatorNameKo?: string | null;
  sourceCandidateId: string;
}


interface ManualTransferEdge {
  id: string;
  fromStationId: string;
  toStationId: string;
  labelKo?: string | null;
  transferMinutes?: number | null;
  bidirectional?: boolean;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

interface ManualOverlayBundle {
  schemaVersion: 1;
  manualTransferEdges?: ManualTransferEdge[];
  stationOverrides?: unknown[];
  branchOverrides?: unknown[];
  geometryOverrides?: unknown[];
}

interface CanonicalBundle {
  bundleId: string;
  acquiredDate: string;
  generatedAt: string;
  counts: {
    canonicalLines: number;
    branches: number;
    stations: number;
    routeStops: number;
    skippedRouteStops: number;
    missingCanonicalLines: number;
  };
  lines: CanonicalLine[];
  manualTransferEdges?: ManualTransferEdge[];
  stations: CanonicalStation[];
  routeStops: CanonicalRouteStop[];
  skippedRouteStops: unknown[];
  missingCanonicalLines: string[];
}

function readBundle(): CanonicalBundle {
  const bundlePath = path.join(
    process.cwd(),
    "public/data/kric-canonical-app-bundle.json",
  );

  return JSON.parse(fs.readFileSync(bundlePath, "utf8")) as CanonicalBundle;
}

function readManualOverlays(): ManualOverlayBundle {
  const overlaysPath = path.join(process.cwd(), "public/data/manual-overlays.json");

  if (!fs.existsSync(overlaysPath)) {
    return { schemaVersion: 1, manualTransferEdges: [] };
  }

  return JSON.parse(fs.readFileSync(overlaysPath, "utf8")) as ManualOverlayBundle;
}

function mergeManualOverlays(bundle: CanonicalBundle, overlays: ManualOverlayBundle): CanonicalBundle {
  const stationIds = new Set(bundle.stations.map((station) => station.id));
  const manualTransferEdges = [
    ...(bundle.manualTransferEdges ?? []),
    ...(overlays.manualTransferEdges ?? []),
  ].filter((edge, index, edges) => {
    if (!edge.id || !edge.fromStationId || !edge.toStationId) return false;
    if (!stationIds.has(edge.fromStationId) || !stationIds.has(edge.toStationId)) return false;

    return edges.findIndex((candidate) => candidate.id === edge.id) === index;
  });

  return {
    ...bundle,
    manualTransferEdges,
  };
}

function toMapStations(stations: CanonicalStation[]): RailMapStation[] {
  return stations.map((station) => ({
    id: station.id,
    nameKo: station.nameKo,
    lineNameKo: station.lineNameKo,
    lat: station.lat,
    lng: station.lng,
  }));
}

function toMapBranches(bundle: CanonicalBundle): RailMapBranch[] {
  const stationById = new Map(
    bundle.stations.map((station) => [
      station.id,
      {
        id: station.id,
        nameKo: station.nameKo,
        lineNameKo: station.lineNameKo,
        lat: station.lat,
        lng: station.lng,
      } satisfies RailMapStation,
    ]),
  );

  return bundle.lines.flatMap((line) =>
    line.branches.map((branch) => ({
      id: branch.id,
      canonicalLineId: line.canonicalKey,
      canonicalLineNameKo: line.nameKo,
      colorHex: line.colorHex,
      role: branch.role,
      sourceLineNumber: branch.sourceLineNumber,
      sourceLineName: branch.sourceLineName,
      routeStops: branch.routeStops.map((stop) => ({
        id: stop.id,
        sequence: stop.sequence,
        displayNameKo: stop.displayNameKo,
        station: stationById.get(stop.stationId) ?? null,
        confidence: stop.confidence,
      })),
    })),
  );
}

export default function Home() {
  const bundle = mergeManualOverlays(readBundle(), readManualOverlays());

  return (
    <main className="h-[100dvh] overflow-hidden bg-slate-950 text-slate-950">
      <RailExplorer
        bundle={bundle}
        mapStations={toMapStations(bundle.stations)}
        mapBranches={toMapBranches(bundle)}
      />
    </main>
  );
}
