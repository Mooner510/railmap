import { RailMap } from "./RailMap";

type RailLine = {
  id: string;
  nameKo: string;
  sourceCandidateId: string;
};

type RailStation = {
  id: string;
  stationNumber: string | null;
  nameKo: string | null;
  nameEn: string | null;
  lineNumber: string | null;
  lineNameKo: string | null;
  lat: number | null;
  lng: number | null;
  operatorNameKo: string | null;
};

type RouteStop = {
  lineId: string;
  sequence: number;
  stationId: string;
  sourceStationCode: string | null;
  displayNameKo: string | null;
  matchStatus: string;
  confidence: string;
  sourceCandidateId: string;
};

type RailBundle = {
  bundleId: string;
  acquiredDate: string;
  generatedAt: string;
  counts: {
    lines: number;
    stations: number;
    routeStops: number;
    skippedRouteStops: number;
  };
  lines: RailLine[];
  stations: RailStation[];
  routeStops: RouteStop[];
};

async function getBundle(): Promise<RailBundle> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  const response = await fetch(`${baseUrl}/data/kric-minimal-app-bundle.json`, {
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

  const lines = bundle.lines
    .map((line) => {
      const routeStops = bundle.routeStops
        .filter((stop) => stop.lineId === line.id)
        .sort((a, b) => a.sequence - b.sequence);

      return {
        ...line,
        routeStops,
      };
    })
    .sort((a, b) => a.nameKo.localeCompare(b.nameKo, "ko"));

  return (
    <main className="min-h-screen bg-[#f6f8fb] px-6 py-8 text-[#111827]">
      <section className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-blue-600">Railmap</p>
          <h1 className="text-4xl font-bold tracking-tight">철도 지도 데이터 뷰어</h1>
          <p className="max-w-3xl text-base leading-7 text-gray-600">
            KRIC 도시철도 원본 XLSX에서 생성한 최소 앱 번들입니다. 아직 최종 공개 데이터가
            아니라 collector 후보 데이터이며, 수동 검토가 필요한 항목은 제외되어 있습니다.
          </p>
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MetricCard label="노선" value={bundle.counts.lines} />
          <MetricCard label="역 후보" value={bundle.counts.stations} />
          <MetricCard label="정차 순서" value={bundle.counts.routeStops} />
          <MetricCard label="검토 제외" value={bundle.counts.skippedRouteStops} />
        </section>


        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-1">
            <h2 className="text-xl font-bold">역 위치 지도</h2>
            <p className="text-sm text-gray-500">
              KRIC 역사정보 좌표를 기준으로 역 후보를 지도에 표시합니다.
            </p>
          </div>
          <RailMap stations={bundle.stations} />
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-1">
            <h2 className="text-xl font-bold">노선 목록</h2>
            <p className="text-sm text-gray-500">
              총 {lines.length.toLocaleString("ko-KR")}개 노선. 각 노선의 정거장 순서를 원본 후보 기준으로 표시합니다.
            </p>
          </div>

          <div className="grid gap-4">
            {lines.map((line, lineIndex) => (
              <article key={`${line.sourceCandidateId}:${lineIndex}`} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold">{line.nameKo}</h3>
                    <p className="text-xs text-gray-500">{line.id}</p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-gray-700">
                    {line.routeStops.length.toLocaleString("ko-KR")}역
                  </span>
                </div>

                <ol className="flex flex-wrap gap-2">
                  {line.routeStops.map((stop, stopIndex) => {
                    const station = stationsById.get(stop.stationId);

                    return (
                      <li
                        key={`${stop.sourceCandidateId}:${stopIndex}`}
                        className="rounded-full border border-gray-200 bg-white px-3 py-1 text-sm"
                        title={`${stop.matchStatus}:${stop.confidence}`}
                      >
                        <span className="text-gray-400">{stop.sequence}. </span>
                        <span>{station?.nameKo ?? stop.displayNameKo ?? "이름 없음"}</span>
                      </li>
                    );
                  })}
                </ol>
              </article>
            ))}
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
