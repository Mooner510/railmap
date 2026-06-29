import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Panel } from "@repo/ui/panel";
import Link from "next/link";
import { readManualOverlays } from "./manualOverlayStore";

const editorCards = [
  {
    href: "/editor",
    title: "통합 맵 에디터",
    description: "검색, 지도, Inspector, 명령 팔레트 기반으로 수동 데이터를 한 화면에서 편집합니다.",
    status: "v12 신규",
    primary: true,
  },
  {
    href: "/transfers",
    title: "수동 환승 그룹",
    description: "환승 가능한 역들을 하나의 그룹으로 묶고, 역간 환승 시간을 시간표처럼 관리합니다.",
    status: "유지",
  },
  {
    href: "/transfers/map",
    title: "수동 환승 맵 에디터",
    description: "전체화면 지도에서 영역 선택으로 미환승역과 수동 환승 그룹을 빠르게 편집합니다.",
    status: "유지",
  },
  {
    href: "/stations",
    title: "역 보정",
    description: "역 이름과 좌표를 수동 보정하고 viewer에 반영합니다.",
    status: "유지",
  },
  {
    href: "/geometry/map",
    title: "노선 선형",
    description: "전체화면 지도에서 노선 중간 정점과 곡선을 직접 보정합니다.",
    status: "유지",
  },
  {
    href: "#",
    title: "검증",
    description: "잘못된 좌표, 끊긴 route stop, 누락 환승을 점검합니다.",
    status: "다음 단계",
  },
];

export default async function Home() {
  const overlays = await readManualOverlays();

  return (
    <main className="min-h-dvh bg-slate-50 px-6 py-8 text-slate-950">
      <section className="mx-auto max-w-6xl rounded-[28px] border border-slate-200 bg-white/95 p-7 shadow-[0_12px_30px_rgb(15_23_42_/_0.08)] backdrop-blur-xl">
        <Badge>Railmap Local Editor</Badge>
        <h1 className="mt-4 text-3xl font-black tracking-[-0.04em]">수동 데이터 편집기</h1>
        <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-500">
          v12부터 통합 맵 에디터를 중심으로 전환합니다. 기존 페이지는 안전한 fallback으로 유지합니다.
        </p>
        <Button asChild className="mt-5">
          <Link href="/editor">통합 에디터 열기</Link>
        </Button>
      </section>

      <section className="mx-auto mt-4 grid max-w-6xl grid-cols-2 gap-3 lg:grid-cols-4" aria-label="manual overlay summary">
        <SummaryCard label="환승 그룹" value={overlays.manualTransferGroups.length} />
        <SummaryCard label="환승 edge" value={overlays.manualTransferEdges.length} />
        <SummaryCard label="역 보정" value={overlays.stationOverrides.length} />
        <SummaryCard label="선형 보정" value={overlays.geometryOverrides.length} />
      </section>

      <section className="mx-auto mt-4 grid max-w-6xl grid-cols-1 gap-3 md:grid-cols-2" aria-label="editor navigation">
        {editorCards.map((card) => {
          const disabled = card.href === "#";
          const content = (
            <Panel className={card.primary ? "border-blue-200 bg-blue-50/80" : disabled ? "opacity-60" : "transition hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50"}>
              <div className="flex min-h-40 flex-col justify-between p-5">
                <div>
                  <Badge className={card.primary ? "bg-blue-600 text-white" : undefined}>{card.status}</Badge>
                  <h2 className="mt-3 text-xl font-black tracking-[-0.03em]">{card.title}</h2>
                  <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{card.description}</p>
                </div>
                {!disabled ? <span className="mt-4 text-sm font-black text-blue-600">열기</span> : null}
              </div>
            </Panel>
          );

          return disabled ? <div key={card.title}>{content}</div> : <Link key={card.title} href={card.href}>{content}</Link>;
        })}
      </section>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Panel>
      <div className="p-4">
        <span className="text-xs font-black text-slate-500">{label}</span>
        <strong className="mt-1 block text-2xl font-black">{value}</strong>
      </div>
    </Panel>
  );
}
