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



interface ManualTransferGroup {
  id: string;
  nameKo: string;
  stationIds: string[];
  transferMinutesByPair?: Record<string, number | null>;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
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

interface ManualOverlays {
  schemaVersion: 1;
  manualTransferGroups: ManualTransferGroup[];
  manualTransferEdges: ManualTransferEdge[];
}

function makeTransferPairKey(stationIdA: string, stationIdB: string) {
  return [stationIdA, stationIdB].slice().sort().join("<->");
}

function deriveTransferEdgesFromGroups(groups: ManualTransferGroup[]): ManualTransferEdge[] {
  const edges: ManualTransferEdge[] = [];

  for (const group of groups) {
    if (!group.enabled) continue;

    const stationIds = [...new Set(group.stationIds)].filter(Boolean);
    if (stationIds.length < 2) continue;

    for (let i = 0; i < stationIds.length - 1; i += 1) {
      for (let j = i + 1; j < stationIds.length; j += 1) {
        const fromStationId = stationIds[i];
        const toStationId = stationIds[j];
        if (!fromStationId || !toStationId || fromStationId === toStationId) continue;

        const pairKey = makeTransferPairKey(fromStationId, toStationId);

        edges.push({
          id: `${group.id}:${pairKey}`,
          fromStationId,
          toStationId,
          labelKo: group.nameKo || "수동 환승",
          transferMinutes: group.transferMinutesByPair?.[pairKey] ?? null,
          bidirectional: true,
          enabled: true,
          source: "editor-group",
          note: group.note ?? null,
        });
      }
    }
  }

  return edges;
}

function readManualOverlays(): ManualOverlays {
  const candidates = [
    path.join(process.cwd(), "public/data/manual-overlays.json"),
    path.join(process.cwd(), "../../data/manual/manual-overlays.json"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;

    const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as Partial<ManualOverlays>;

    const manualTransferGroups = Array.isArray(parsed.manualTransferGroups) ? parsed.manualTransferGroups : [];
    const legacyEdges = Array.isArray(parsed.manualTransferEdges)
      ? parsed.manualTransferEdges.filter((edge) => edge.source !== "editor-group")
      : [];

    return {
      schemaVersion: 1,
      manualTransferGroups,
      manualTransferEdges: [...legacyEdges, ...deriveTransferEdgesFromGroups(manualTransferGroups)],
    };
  }

  return {
    schemaVersion: 1,
    manualTransferGroups: [],
    manualTransferEdges: [],
  };
}

function readBundle(): CanonicalBundle {
  const bundlePath = path.join(
    process.cwd(),
    "public/data/kric-canonical-app-bundle.json",
  );

  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8")) as CanonicalBundle;
  const manualOverlays = readManualOverlays();

  return {
    ...bundle,
    manualTransferEdges: [
      ...(bundle.manualTransferEdges ?? []),
      ...manualOverlays.manualTransferEdges,
    ].filter((edge) => edge.enabled),
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
  const bundle = readBundle();

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
