import Link from "next/link";
import { readManualOverlays } from "./manualOverlayStore";

const editorCards = [
  {
    href: "/transfers",
    title: "수동 환승 그룹",
    description: "환승 가능한 역들을 하나의 그룹으로 묶고, 역간 환승 시간을 시간표처럼 관리합니다.",
    status: "사용 가능",
  },
  {
    href: "/transfers/map",
    title: "수동 환승 맵 에디터",
    description: "전체화면 지도에서 영역 선택으로 미환승역과 수동 환승 그룹을 빠르게 편집합니다.",
    status: "사용 가능",
  },
  {
    href: "/stations",
    title: "역 보정",
    description: "역 이름과 좌표를 수동 보정하고 viewer에 반영합니다.",
    status: "사용 가능",
  },
  {
    href: "/geometry/map",
    title: "노선 선형",
    description: "전체화면 지도에서 노선 중간 정점과 곡선을 직접 보정합니다.",
    status: "사용 가능",
  },
  {
    href: "#",
    title: "검증",
    description: "잘못된 좌표, 끊긴 route stop, 누락 환승을 점검합니다.",
    status: "준비 예정",
  },
];

export default async function Home() {
  const overlays = await readManualOverlays();

  return (
    <main className="editor-page-shell">
      <section className="editor-hero">
        <p className="eyebrow">Railmap Local Editor</p>
        <h1>수동 데이터 편집기</h1>
        <p>
          Viewer는 읽기 전용으로 유지하고, 수동 환승·역 보정·노선 선형 보정은 이 로컬 에디터에서 관리합니다.
        </p>
      </section>

      <section className="editor-summary-grid" aria-label="manual overlay summary">
        <div className="summary-card">
          <span>환승 그룹</span>
          <strong>{overlays.manualTransferGroups.length}</strong>
        </div>
        <div className="summary-card">
          <span>환승 edge</span>
          <strong>{overlays.manualTransferEdges.length}</strong>
        </div>
        <div className="summary-card">
          <span>역 보정</span>
          <strong>{overlays.stationOverrides.length}</strong>
        </div>
        <div className="summary-card">
          <span>선형 보정</span>
          <strong>{overlays.geometryOverrides.length}</strong>
        </div>
      </section>

      <section className="editor-card-grid" aria-label="editor navigation">
        {editorCards.map((card) => {
          const disabled = card.href === "#";

          if (disabled) {
            return (
              <div key={card.title} className="editor-card disabled-card">
                <div>
                  <p className="card-status">{card.status}</p>
                  <h2>{card.title}</h2>
                  <p>{card.description}</p>
                </div>
              </div>
            );
          }

          return (
            <Link key={card.title} href={card.href} className="editor-card">
              <div>
                <p className="card-status">{card.status}</p>
                <h2>{card.title}</h2>
                <p>{card.description}</p>
              </div>
              <span className="card-link">열기</span>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
