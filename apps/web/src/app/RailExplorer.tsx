"use client";

import { useEffect, useMemo, useState } from "react";
import RailMap, { type RailMapBranch, type RailMapStation } from "./RailMap";
import {
  countRouteStops,
  formatBranchRole,
  formatNumber,
  getFirstStop,
  getLastStop,
  type CanonicalBundle,
  type CanonicalLine,
} from "./railExplorerModel";

interface RailExplorerProps {
  bundle: CanonicalBundle;
  mapStations: RailMapStation[];
  mapBranches: RailMapBranch[];
}

export default function RailExplorer({ bundle, mapStations, mapBranches }: RailExplorerProps) {
  const areaCodes = useMemo(
    () => [...new Set(bundle.lines.map((line) => line.mreaWideCd))].sort(),
    [bundle.lines],
  );

  const [selectedArea, setSelectedArea] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [isHydratedFromUrl, setIsHydratedFromUrl] = useState(false);
  const [copiedShareUrl, setCopiedShareUrl] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const area = params.get("area");
    const q = params.get("q");
    const line = params.get("line");
    const branch = params.get("branch");

    if (area) setSelectedArea(area);
    if (q) setSearchQuery(q);
    if (line) setSelectedLineKey(line);
    if (branch) setSelectedBranchId(branch);

    setIsHydratedFromUrl(true);
  }, []);

  useEffect(() => {
    if (!isHydratedFromUrl) return;

    const params = new URLSearchParams();

    if (selectedArea !== "all") params.set("area", selectedArea);
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (selectedLineKey) params.set("line", selectedLineKey);
    if (selectedBranchId) params.set("branch", selectedBranchId);

    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;

    window.history.replaceState(null, "", nextUrl);
  }, [
    isHydratedFromUrl,
    searchQuery,
    selectedArea,
    selectedBranchId,
    selectedLineKey,
  ]);

  const sortedLines = useMemo(
    () =>
      [...bundle.lines].sort((a, b) => {
        const areaCompare = a.mreaWideCd.localeCompare(b.mreaWideCd, "ko");
        if (areaCompare !== 0) return areaCompare;

        return a.nameKo.localeCompare(b.nameKo, "ko", { numeric: true });
      }),
    [bundle.lines],
  );

  const filteredLines = useMemo(
    () =>
      sortedLines.filter((line) => {
        const query = searchQuery.trim().toLowerCase();

        if (selectedArea !== "all" && line.mreaWideCd !== selectedArea) return false;

        if (query) {
          const haystack = [
            line.canonicalKey,
            line.lnCd,
            line.mreaWideCd,
            line.nameKo,
            line.colorHex,
            ...line.sourceLineNumbers,
            ...line.branches.map((branch) => branch.sourceLineName),
            ...line.branches.map((branch) => branch.sourceLineNumber),
          ]
            .join(" ")
            .toLowerCase();

          if (!haystack.includes(query)) return false;
        }

        return true;
      }),
    [searchQuery, selectedArea, sortedLines],
  );

  const selectedLine = useMemo(
    () =>
      filteredLines.find((line) => line.canonicalKey === selectedLineKey) ??
      filteredLines[0] ??
      null,
    [filteredLines, selectedLineKey],
  );

  const selectedBranch = useMemo(() => {
    if (!selectedLine || !selectedBranchId) return null;

    return selectedLine.branches.find((branch) => branch.id === selectedBranchId) ?? null;
  }, [selectedBranchId, selectedLine]);

  useEffect(() => {
    if (!selectedLine) {
      setSelectedBranchId(null);
      return;
    }

    if (!selectedBranchId) return;
    if (selectedLine.branches.some((branch) => branch.id === selectedBranchId)) return;

    setSelectedBranchId(null);
  }, [selectedBranchId, selectedLine]);

  const visibleLineKeys = useMemo(
    () => new Set(filteredLines.map((line) => line.canonicalKey)),
    [filteredLines],
  );

  const visibleMapBranches = useMemo(
    () =>
      mapBranches.filter((branch) => {
        if (!visibleLineKeys.has(branch.canonicalLineId)) return false;
        if (selectedBranch) return branch.id === selectedBranch.id;
        if (selectedLine) return branch.canonicalLineId === selectedLine.canonicalKey;
        return true;
      }),
    [mapBranches, selectedBranch, selectedLine, visibleLineKeys],
  );

  const visibleStationIds = useMemo(() => {
    const ids = new Set<string>();

    for (const branch of visibleMapBranches) {
      for (const stop of branch.routeStops) {
        if (stop.station?.id) ids.add(stop.station.id);
      }
    }

    return ids;
  }, [visibleMapBranches]);

  const visibleMapStations = useMemo(
    () => mapStations.filter((station) => visibleStationIds.has(station.id)),
    [mapStations, visibleStationIds],
  );

  return (
    <section className="mx-auto grid max-w-7xl gap-6 px-6 py-8 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="flex flex-col gap-6">
        <RailMap stations={visibleMapStations} branches={visibleMapBranches} />

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-xl font-bold">노선 목록</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                필터 적용 결과 {formatNumber(filteredLines.length)}개 노선 · 지도 구간{" "}
                {formatNumber(visibleMapBranches.length)}개 · 지도 역{" "}
                {formatNumber(visibleMapStations.length)}개. 선택한 노선/구간 기준으로 지도 범위가 자동 이동합니다.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                className="min-w-56 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400 focus:border-sky-300"
                value={searchQuery}
                placeholder="노선명, 코드 검색"
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSelectedLineKey(null);
                  setSelectedBranchId(null);
                }}
              />

              <select
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                value={selectedArea}
                onChange={(event) => {
                  setSelectedArea(event.target.value);
                  setSelectedLineKey(null);
                  setSelectedBranchId(null);
                }}
              >
                <option value="all">전체 권역</option>
                {areaCodes.map((areaCode) => (
                  <option key={areaCode} value={areaCode}>
                    권역 {areaCode}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                onClick={() => {
                  setSelectedArea("all");
                  setSearchQuery("");
                  setSelectedLineKey(null);
                  setSelectedBranchId(null);
                }}
              >
                초기화
              </button>

              <button
                type="button"
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                onClick={async () => {
                  await navigator.clipboard.writeText(window.location.href);
                  setCopiedShareUrl(true);
                  window.setTimeout(() => setCopiedShareUrl(false), 1200);
                }}
              >
                {copiedShareUrl ? "복사됨" : "URL 복사"}
              </button>
            </div>
          </div>

          {filteredLines.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <p className="font-bold text-slate-900">검색 결과 없음</p>
              <p className="mt-2 text-sm text-slate-500">
                검색어 또는 권역 필터를 조정하세요.
              </p>
            </div>
          ) : null}

          <div className="mt-6 grid gap-4">
            {filteredLines.map((line) => {
              const routeStopCount = countRouteStops(line);
              const isSelected = selectedLine?.canonicalKey === line.canonicalKey;

              return (
                <article
                  key={line.canonicalKey}
                  className={
                    isSelected
                      ? "rounded-3xl border border-sky-300 bg-sky-50 p-5 shadow-sm"
                      : "rounded-3xl border border-slate-200 bg-slate-50 p-5"
                  }
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => {
                        setSelectedLineKey(line.canonicalKey);
                        setSelectedBranchId(null);
                      }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="h-4 w-4 rounded-full border border-white shadow-sm"
                          style={{ backgroundColor: line.colorHex }}
                          title={line.colorHex}
                        />
                        <h3 className="text-lg font-bold text-slate-950">{line.nameKo}</h3>
                        <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">
                          {line.canonicalKey}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-500">
                        구간 {line.branches.length}개 · 정차역 {routeStopCount}개 · 출처 코드{" "}
                        {line.sourceLineNumbers.join(", ")}
                      </p>
                    </button>

                    <div className="text-sm font-semibold text-slate-500">
                      권역 {line.mreaWideCd} · lnCd {line.lnCd}
                    </div>
                  </div>

                  {isSelected ? (
                    <BranchTable
                      line={line}
                      selectedBranchId={selectedBranchId}
                      onSelectBranch={(branchId) => setSelectedBranchId(branchId)}
                      onClearBranch={() => setSelectedBranchId(null)}
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <aside className="flex flex-col gap-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold">선택 노선</h2>
          {selectedLine ? (
            <div className="mt-4">
              <div className="flex items-center gap-2">
                <span
                  className="h-4 w-4 rounded-full border border-white shadow-sm"
                  style={{ backgroundColor: selectedLine.colorHex }}
                />
                <p className="font-bold">{selectedLine.nameKo}</p>
              </div>
              <p className="mt-2 text-sm text-slate-500">{selectedLine.canonicalKey}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <MetricMini label="구간" value={selectedLine.branches.length} />
                <MetricMini label="정차역" value={countRouteStops(selectedLine)} />
                <MetricMini label="권역" value={selectedLine.mreaWideCd} />
                <MetricMini label="표시" value={selectedBranch ? "구간" : "노선"} />
              </div>

              <div className="mt-4">
                <p className="text-xs font-bold text-slate-400 uppercase">구간 선택</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={
                      selectedBranchId === null
                        ? "rounded-full bg-sky-600 px-3 py-1 text-xs font-bold text-white"
                        : "rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                    }
                    onClick={() => setSelectedBranchId(null)}
                  >
                    전체
                  </button>

                  {selectedLine.branches.map((branch) => (
                    <button
                      type="button"
                      key={branch.id}
                      className={
                        selectedBranchId === branch.id
                          ? "rounded-full bg-sky-600 px-3 py-1 text-xs font-bold text-white"
                          : "rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                      }
                      onClick={() => setSelectedBranchId(branch.id)}
                    >
                      {branch.sourceLineName}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">선택된 노선 없음</p>
          )}
        </section>
      </aside>
    </section>
  );
}

function BranchTable({
  line,
  selectedBranchId,
  onSelectBranch,
  onClearBranch,
}: {
  line: CanonicalLine;
  selectedBranchId: string | null;
  onSelectBranch: (branchId: string) => void;
  onClearBranch: () => void;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-100 text-xs font-semibold text-slate-500 uppercase">
          <tr>
            <th className="px-4 py-3">구분</th>
            <th className="px-4 py-3">출처</th>
            <th className="px-4 py-3">구간</th>
            <th className="px-4 py-3 text-right">역 수</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {line.branches.map((branch) => {
            const isSelected = selectedBranchId === branch.id;

            return (
              <tr key={branch.id} className={isSelected ? "bg-sky-50" : undefined}>
                <td className="px-4 py-3 align-top">
                  <button
                    type="button"
                    className={
                      isSelected
                        ? "rounded-full bg-sky-600 px-2 py-1 text-xs font-semibold text-white"
                        : "rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                    }
                    onClick={() => {
                      if (isSelected) {
                        onClearBranch();
                      } else {
                        onSelectBranch(branch.id);
                      }
                    }}
                  >
                    {isSelected ? "선택됨" : formatBranchRole(branch.role)}
                  </button>
                </td>
                <td className="px-4 py-3 align-top">
                  <p className="font-semibold text-slate-900">{branch.sourceLineName}</p>
                  <p className="text-xs text-slate-500">{branch.sourceLineNumber}</p>

                  <details className="group mt-3">
                    <summary className="cursor-pointer select-none text-xs font-semibold text-sky-700 hover:text-sky-900">
                      정차역 {branch.routeStops.length}개 펼치기
                    </summary>

                    <ol className="mt-3 flex flex-wrap gap-1.5">
                      {branch.routeStops.map((stop) => (
                        <li
                          key={stop.id}
                          title={`${stop.matchStatus}:${stop.confidence}`}
                          className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
                        >
                          <span className="text-slate-400">{stop.sequence}. </span>
                          {stop.displayNameKo}
                        </li>
                      ))}
                    </ol>
                  </details>
                </td>
                <td className="px-4 py-3 align-top text-slate-600">
                  {branch.origin ?? getFirstStop(branch)} → {branch.terminal ?? getLastStop(branch)}
                </td>
                <td className="px-4 py-3 text-right align-top font-semibold">
                  {branch.routeStops.length}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MetricMini({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3">
      <p className="text-xs font-bold text-slate-400 uppercase">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-950">{value}</p>
    </div>
  );
}
