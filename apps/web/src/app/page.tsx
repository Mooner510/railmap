import fs from "node:fs";
import path from "node:path";
import RailMap, { type RailMapBranch, type RailMapStation } from "./RailMap";

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

function countLowConfidence(line: CanonicalLine): number {
  return line.branches.reduce(
    (sum, branch) =>
      sum + branch.routeStops.filter((stop) => stop.confidence === "low").length,
    0,
  );
}

function countRouteStops(line: CanonicalLine): number {
  return line.branches.reduce((sum, branch) => sum + branch.routeStops.length, 0);
}

function getFirstStop(branch: CanonicalBranch): string {
  return branch.routeStops[0]?.displayNameKo ?? "-";
}

function getLastStop(branch: CanonicalBranch): string {
  return branch.routeStops[branch.routeStops.length - 1]?.displayNameKo ?? "-";
}

function getLowConfidenceStops(branch: CanonicalBranch): CanonicalRouteStop[] {
  return branch.routeStops.filter((stop) => stop.confidence === "low");
}

function getBranchDetailsId(branch: CanonicalBranch): string {
  return `branch-${branch.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
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

export default function Home() {
  const bundle = readBundle();

  const linesWithLowConfidence = bundle.lines.filter((line) => countLowConfidence(line) > 0);

  const topLines = [...bundle.lines].sort((a, b) => {
    const areaCompare = a.mreaWideCd.localeCompare(b.mreaWideCd, "ko");
    if (areaCompare !== 0) return areaCompare;

    return a.nameKo.localeCompare(b.nameKo, "ko", { numeric: true });
  });

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
                  acquired: <span className="font-semibold text-slate-900">{bundle.acquiredDate}</span>
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

      <section className="mx-auto grid max-w-7xl gap-6 px-6 py-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex flex-col gap-6">
          <RailMap stations={toMapStations(bundle.stations)} branches={toMapBranches(bundle)} />

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-bold">Canonical Line Cards</h2>
              <p className="text-sm leading-6 text-slate-500">
                노선 카드는 canonical 노선 단위입니다. 내부에는 KRIC source line을 branch로
                보존합니다.
              </p>
            </div>

            <div className="mt-6 grid gap-4">
              {topLines.map((line) => {
                const lowConfidenceCount = countLowConfidence(line);
                const routeStopCount = countRouteStops(line);

                return (
                  <article
                    key={line.canonicalKey}
                    className="rounded-3xl border border-slate-200 bg-slate-50 p-5"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-bold text-slate-950">{line.nameKo}</h3>
                          <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">
                            {line.canonicalKey}
                          </span>
                          {lowConfidenceCount > 0 ? (
                            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                              검수 필요 {lowConfidenceCount}
                            </span>
                          ) : (
                            <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
                              매칭 안정
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-sm text-slate-500">
                          branch {line.branches.length}개 · route stop {routeStopCount}개 · source{" "}
                          {line.sourceLineNumbers.join(", ")}
                        </p>
                      </div>

                      <div className="text-sm font-semibold text-slate-500">
                        권역 {line.mreaWideCd} · lnCd {line.lnCd}
                      </div>
                    </div>

                    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-100 text-xs font-semibold text-slate-500 uppercase">
                          <tr>
                            <th className="px-4 py-3">Role</th>
                            <th className="px-4 py-3">Source</th>
                            <th className="px-4 py-3">구간</th>
                            <th className="px-4 py-3 text-right">역 수</th>
                            <th className="px-4 py-3 text-right">검수</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {line.branches.map((branch) => {
                            const low = branch.routeStops.filter(
                              (stop) => stop.confidence === "low",
                            ).length;

                            return (
                              <tr key={branch.id}>
                                <td className="px-4 py-3 align-top">
                                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                                    {branch.role}
                                  </span>
                                </td>
                                <td className="px-4 py-3 align-top">
                                  <p className="font-semibold text-slate-900">
                                    {branch.sourceLineName}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {branch.sourceLineNumber}
                                  </p>

                                  <details id={getBranchDetailsId(branch)} className="group mt-3">
                                    <summary className="cursor-pointer select-none text-xs font-semibold text-sky-700 hover:text-sky-900">
                                      정차역 {branch.routeStops.length}개 펼치기
                                    </summary>

                                    <ol className="mt-3 flex flex-wrap gap-1.5">
                                      {branch.routeStops.map((stop) => (
                                        <li
                                          key={stop.id}
                                          title={`${stop.matchStatus}:${stop.confidence}`}
                                          className={
                                            stop.confidence === "low"
                                              ? "rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800"
                                              : "rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
                                          }
                                        >
                                          <span className="text-slate-400">{stop.sequence}. </span>
                                          {stop.displayNameKo}
                                        </li>
                                      ))}
                                    </ol>

                                    {getLowConfidenceStops(branch).length > 0 ? (
                                      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                                        <p className="text-xs font-bold text-amber-900">
                                          검수 필요 정차역
                                        </p>
                                        <ul className="mt-2 space-y-1 text-xs text-amber-800">
                                          {getLowConfidenceStops(branch).map((stop) => (
                                            <li key={stop.id}>
                                              {stop.sequence}. {stop.displayNameKo} ·{" "}
                                              {stop.matchStatus}:{stop.confidence}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    ) : null}
                                  </details>
                                </td>
                                <td className="px-4 py-3 align-top text-slate-600">
                                  {branch.origin ?? getFirstStop(branch)} →{" "}
                                  {branch.terminal ?? getLastStop(branch)}
                                </td>
                                <td className="px-4 py-3 text-right align-top font-semibold">
                                  {branch.routeStops.length}
                                </td>
                                <td className="px-4 py-3 text-right align-top">
                                  {low > 0 ? (
                                    <span className="font-semibold text-amber-700">{low}</span>
                                  ) : (
                                    <span className="text-slate-400">0</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold">검수 상태</h2>
            <div className="mt-4 space-y-3 text-sm">
              <StatusRow label="Skipped route stops" value={bundle.counts.skippedRouteStops} ok />
              <StatusRow
                label="Missing canonical lines"
                value={bundle.counts.missingCanonicalLines}
              />
              <StatusRow
                label="Low confidence lines"
                value={linesWithLowConfidence.length}
              />
            </div>
          </section>

          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h2 className="text-lg font-bold text-amber-950">검수 필요 노선</h2>
            <p className="mt-2 text-sm leading-6 text-amber-800">
              low confidence는 전역 역명 fallback으로 복구된 route stop입니다.
            </p>
            <div className="mt-4 space-y-3">
              {linesWithLowConfidence.map((line) => (
                <div
                  key={line.canonicalKey}
                  className="rounded-2xl border border-amber-200 bg-white/70 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-amber-950">{line.nameKo}</p>
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">
                      {countLowConfidence(line)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-amber-700">{line.canonicalKey}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold">제외된 canonical line</h2>
            <div className="mt-4 space-y-2">
              {bundle.missingCanonicalLines.map((line) => (
                <div
                  key={line}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                >
                  <p className="font-semibold text-slate-900">{line}</p>
                  <p className="mt-1 text-xs text-slate-500">GTX-A는 현재 제외 상태</p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold tracking-wide text-slate-400 uppercase">{label}</p>
      <p className="mt-3 text-3xl font-black text-slate-950">{formatNumber(value)}</p>
    </div>
  );
}

function StatusRow({ label, value, ok = false }: { label: string; value: number; ok?: boolean }) {
  const isOk = ok ? value === 0 : value === 0;

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3">
      <span className="text-slate-600">{label}</span>
      <span
        className={
          isOk
            ? "font-bold text-emerald-700"
            : "font-bold text-amber-700"
        }
      >
        {formatNumber(value)}
      </span>
    </div>
  );
}
