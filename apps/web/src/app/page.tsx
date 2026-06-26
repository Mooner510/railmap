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

function formatNumber(value: number): string {
  return value.toLocaleString("ko-KR");
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold tracking-wide text-slate-400 uppercase">{label}</p>
      <p className="mt-3 text-3xl font-black text-slate-950">{formatNumber(value)}</p>
    </div>
  );
}

export default function Home() {
  const bundle = readBundle();

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-10">
          <div className="flex flex-col gap-4">
            <p className="text-sm font-semibold tracking-[0.25em] text-sky-600 uppercase">
              Korea Rail Map
            </p>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-4xl font-black tracking-tight text-slate-950 md:text-5xl">
                  Canonical Rail Bundle Preview
                </h1>
                <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
                  KRIC 원천 노선을 그대로 노출하지 않고, 수동 allowlist 기준 canonical
                  노선으로 병합한 개발 미리보기입니다. GTX-A는 현재 의도적으로 제외되어
                  있습니다.
                </p>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
                <p>
                  acquired:{" "}
                  <span className="font-semibold text-slate-900">{bundle.acquiredDate}</span>
                </p>
                <p className="mt-1">
                  generated:{" "}
                  <span className="font-semibold text-slate-900">
                    {new Date(bundle.generatedAt).toLocaleString("ko-KR")}
                  </span>
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard label="Canonical Lines" value={bundle.counts.canonicalLines} />
            <MetricCard label="Branches" value={bundle.counts.branches} />
            <MetricCard label="Stations" value={bundle.counts.stations} />
            <MetricCard label="Route Stops" value={bundle.counts.routeStops} />
            <MetricCard label="Skipped" value={bundle.counts.skippedRouteStops} />
            <MetricCard label="Missing" value={bundle.counts.missingCanonicalLines} />
          </div>
        </div>
      </section>

      <RailExplorer
        bundle={bundle}
        mapStations={toMapStations(bundle.stations)}
        mapBranches={toMapBranches(bundle)}
      />
    </main>
  );
}
