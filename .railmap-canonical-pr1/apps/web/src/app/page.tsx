import { RailMap } from "./RailMap";

type RailStation = {
  id: string;
  stationNumber: string | null;
  nameKo: string | null;
  nameEn: string | null;
  lat: number | null;
  lng: number | null;
  operatorNameKo: string | null;
  sourceCandidateId: string;
  sourceLineNumbers: string[];
  canonicalLineIds: string[];
};

type RouteStop = {
  id: string;
  canonicalLineId: string;
  branchId: string;
  sourceLineNumber: string;
  sourceLineName: string;
  role: "main" | "branch";
  sequence: number;
  stationId: string;
  sourceStationCode: string | null;
  displayNameKo: string | null;
  matchStatus: string;
  confidence: string;
  sourceCandidateId: string;
  diagnostics: string[];
};

type RailBranch = {
  id: string;
  canonicalLineId: string;
  role: "main" | "branch";
  sourceLineNumber: string;
  sourceLineName: string;
  origin: string | null;
  terminal: string | null;
  routeStops: RouteStop[];
};

type RailLine = {
  id: string;
  canonicalKey: string;
  lnCd: string;
  mreaWideCd: string;
  nameKo: string;
  branches: RailBranch[];
  sourceLineNumbers: string[];
};

type RailBundle = {
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
  lines: RailLine[];
  stations: RailStation[];
  skippedRouteStops: unknown[];
  missingCanonicalLines: string[];
};

async function getBundle(): Promise<RailBundle> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  const response = await fetch(`${baseUrl}/data/kric-canonical-app-bundle.json`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to load rail bundle: ${response.status}`);
  }

  return response.json() as Promise<RailBundle>;
}

export default async function Home() {
  const bundle = await getBundle();
  const stationsById = new Map(bundle.stations.map((station) => [station.id, station]));

  const lines = [...bundle.lines].sort((a, b) => {
    const area = a.mreaWideCd.localeCompare(b.mreaWideCd, "ko");
    if (area !== 0) return area;
    return a.nameKo.localeCompare(b.nameKo, "ko");
  });

  return (
    <main className="min-h-screen bg-[#f6f8fb] px-6 py-8 text-[#111827]">
      <section className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-blue-600">Railmap</p>
          <h1 className="text-4xl font-bold tracking-tight">철도 지도 데이터 뷰어</h1>
          <p className="max-w-3xl text-base leading-7 text-gray-600">
            KRIC 수동 canonical 분류표를 기준으로 생성한 도시철도 후보 데이터입니다. 지선은 source line 단위로 분리해 표시합니다.
          </p>
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <MetricCard label="Canonical 노선" value={bundle.counts.canonicalLines} />
          <MetricCard label="지선/Source" value={bundle.counts.branches} />
          <MetricCard label="역 후보" value={bundle.counts.stations} />
          <MetricCard label="정차 순서" value={bundle.counts.routeStops} />
          <MetricCard label="검토 제외" value={bundle.counts.skippedRouteStops} />
        </section>

        {bundle.missingCanonicalLines.length > 0 ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
            <h2 className="text-lg font-bold">매핑되지 않은 canonical 노선</h2>
            <p className="mt-1 text-sm">{bundle.missingCanonicalLines.join(", ")}</p>
          </section>
        ) : null}

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-1">
            <h2 className="text-xl font-bold">역 위치 지도</h2>
            <p className="text-sm text-gray-500">KRIC 역사정보 좌표를 기준으로 역 후보를 지도에 표시합니다.</p>
          </div>
          <RailMap
            stations={bundle.stations.map((station) => ({
              id: station.id,
              nameKo: station.nameKo,
              lat: station.lat,
              lng: station.lng,
              lineNameKo: station.canonicalLineIds.join(", "),
            }))}
          />
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-1">
            <h2 className="text-xl font-bold">Canonical 노선 목록</h2>
            <p className="text-sm text-gray-500">
              총 {lines.length.toLocaleString("ko-KR")}개 canonical 노선. 각 노선 안에 main/branch source line을 표시합니다.
            </p>
          </div>

          <div className="grid gap-4">
            {lines.map((line) => {
              const totalStops = line.branches.reduce((sum, branch) => sum + branch.routeStops.length, 0);

              return (
                <article key={line.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold">{line.nameKo}</h3>
                      <p className="text-xs text-gray-500">
                        {line.canonicalKey} · source {line.sourceLineNumbers.join(", ")}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-gray-700">
                      {totalStops.toLocaleString("ko-KR")}역
                    </span>
                  </div>

                  <div className="grid gap-3">
                    {line.branches.map((branch) => (
                      <section key={branch.id} className="rounded-lg border border-gray-200 bg-white p-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs font-semibold text-white">
                            {branch.role}
                          </span>
                          <span className="text-sm font-bold">{branch.sourceLineName}</span>
                          <span className="text-xs text-gray-500">{branch.sourceLineNumber}</span>
                          <span className="text-xs text-gray-400">
                            {branch.origin ?? "?"} → {branch.terminal ?? "?"}
                          </span>
                          <span className="ml-auto text-xs font-semibold text-gray-500">
                            {branch.routeStops.length.toLocaleString("ko-KR")}역
                          </span>
                        </div>

                        <ol className="flex flex-wrap gap-2">
                          {branch.routeStops.map((stop) => {
                            const station = stationsById.get(stop.stationId);

                            return (
                              <li
                                key={stop.id}
                                className="rounded-full border border-gray-200 bg-white px-3 py-1 text-sm"
                                title={`${stop.matchStatus}:${stop.confidence}`}
                              >
                                <span className="text-gray-400">{stop.sequence}. </span>
                                <span>{station?.nameKo ?? stop.displayNameKo ?? "이름 없음"}</span>
                              </li>
                            );
                          })}
                        </ol>
                      </section>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value.toLocaleString("ko-KR")}</p>
    </div>
  );
}
