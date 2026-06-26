"use client";

import { useEffect, useMemo, useState } from "react";
import RailMap, { type RailMapBranch, type RailMapStation } from "./RailMap";

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
  confidence: string;
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
  missingCanonicalLines: string[];
}

interface RailExplorerProps {
  bundle: CanonicalBundle;
  mapStations: RailMapStation[];
  mapBranches: RailMapBranch[];
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

function formatNumber(value: number): string {
  return value.toLocaleString("ko-KR");
}

export default function RailExplorer({ bundle, mapStations, mapBranches }: RailExplorerProps) {
  const areaCodes = useMemo(
    () => [...new Set(bundle.lines.map((line) => line.mreaWideCd))].sort(),
    [bundle.lines],
  );

  const [selectedArea, setSelectedArea] = useState<string>("all");
  const [onlyLowConfidence, setOnlyLowConfidence] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [isHydratedFromUrl, setIsHydratedFromUrl] = useState(false);
  const [copiedShareUrl, setCopiedShareUrl] = useState(false);
  const [copiedReviewCsv, setCopiedReviewCsv] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const area = params.get("area");
    const low = params.get("low");
    const q = params.get("q");
    const line = params.get("line");
    const branch = params.get("branch");

    if (area) setSelectedArea(area);
    if (low === "1") setOnlyLowConfidence(true);
    if (q) setSearchQuery(q);
    if (line) setSelectedLineKey(line);
    if (branch) setSelectedBranchId(branch);

    setIsHydratedFromUrl(true);
  }, []);

  useEffect(() => {
    if (!isHydratedFromUrl) return;

    const params = new URLSearchParams();

    if (selectedArea !== "all") params.set("area", selectedArea);
    if (onlyLowConfidence) params.set("low", "1");
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (selectedLineKey) params.set("line", selectedLineKey);
    if (selectedBranchId) params.set("branch", selectedBranchId);

    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;

    window.history.replaceState(null, "", nextUrl);
  }, [
    isHydratedFromUrl,
    onlyLowConfidence,
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
        if (onlyLowConfidence && countLowConfidence(line) === 0) return false;

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
    [onlyLowConfidence, searchQuery, selectedArea, sortedLines],
  );

  const selectedLine = useMemo(
    () =>
      filteredLines.find((line) => line.canonicalKey === selectedLineKey) ??
      filteredLines[0] ??
      null,
    [filteredLines, selectedLineKey],
  );

  useEffect(() => {
    if (!selectedLineKey) return;
    if (filteredLines.some((line) => line.canonicalKey === selectedLineKey)) return;

    setSelectedLineKey(null);
    setSelectedBranchId(null);
  }, [filteredLines, selectedLineKey]);

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

  const lowConfidenceLines = bundle.lines.filter((line) => countLowConfidence(line) > 0);

  const selectedReviewStops = useMemo<
    (CanonicalRouteStop & {
      branchId: string;
      branchName: string;
      branchNumber: string;
    })[]
  >(() => {
    if (!selectedLine) return [];

    const targetBranches = selectedBranch ? [selectedBranch] : selectedLine.branches;

    return targetBranches
      .flatMap((branch) =>
        getLowConfidenceStops(branch).map((stop) => ({
          ...stop,
          branchId: branch.id,
          branchName: branch.sourceLineName,
          branchNumber: branch.sourceLineNumber,
        })),
      )
      .sort(
        (a, b) =>
          a.branchName.localeCompare(b.branchName, "ko-KR") || a.sequence - b.sequence,
      );
  }, [selectedBranch, selectedLine]);

  const copySelectedReviewCsv = async () => {
    if (!selectedLine || selectedReviewStops.length === 0) return;

    const rows = [
      [
        "canonicalKey",
        "canonicalName",
        "branchNumber",
        "branchName",
        "sourceStationCode",
        "displayNameKo",
        "stationId",
        "matchStatus",
        "confidence",
      ],
      ...selectedReviewStops.map((stop) => [
        selectedLine.canonicalKey,
        selectedLine.nameKo,
        stop.branchNumber,
        stop.branchName,
        stop.sourceStationCode,
        stop.displayNameKo,
        stop.stationId,
        stop.matchStatus,
        stop.confidence,
      ]),
    ];

    const csv = rows
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");

    await navigator.clipboard.writeText(csv);
    setCopiedReviewCsv(true);
    window.setTimeout(() => setCopiedReviewCsv(false), 1200);
  };



  return (
    <section className="mx-auto grid max-w-7xl gap-6 px-6 py-8 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="flex flex-col gap-6">
        <RailMap stations={visibleMapStations} branches={visibleMapBranches} />

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-xl font-bold">Canonical Line Cards</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                필터 적용 결과 {formatNumber(filteredLines.length)}개 노선 · 지도 branch{" "}
                {formatNumber(visibleMapBranches.length)}개 · 지도 역{" "}
                {formatNumber(visibleMapStations.length)}개. 선택한 노선/branch 기준으로 지도 범위가 자동 이동합니다.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                className="min-w-56 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400 focus:border-sky-300"
                value={searchQuery}
                placeholder="노선명, 코드, source 검색"
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSelectedLineKey(null);
                }}
              />

              <select
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                value={selectedArea}
                onChange={(event) => {
                  setSelectedArea(event.target.value);
                  setSelectedLineKey(null);
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
                className={
                  onlyLowConfidence
                    ? "rounded-2xl bg-amber-500 px-4 py-2 text-sm font-bold text-white"
                    : "rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                }
                onClick={() => {
                  setOnlyLowConfidence((value) => !value);
                  setSelectedLineKey(null);
                }}
              >
                검수 필요만
              </button>

              <button
                type="button"
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                onClick={() => {
                  setSelectedArea("all");
                  setOnlyLowConfidence(false);
                  setSearchQuery("");
                  setSelectedLineKey(null);
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
                검색어, 권역 필터, 검수 필요 필터를 조정하세요.
              </p>
            </div>
          ) : null}

          <div className="mt-6 grid gap-4">
            {filteredLines.map((line) => {
              const lowConfidenceCount = countLowConfidence(line);
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
                        {line.sourceLineNumbers.join(", ")} · color {line.colorHex}
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
                <MetricMini label="Branches" value={selectedLine.branches.length} />
                <MetricMini label="Stops" value={countRouteStops(selectedLine)} />
                <MetricMini label="Low" value={countLowConfidence(selectedLine)} />
                <MetricMini label="Area" value={selectedLine.mreaWideCd} />
                <MetricMini label="Visible" value={selectedBranch ? "Branch" : "Line"} />
              </div>

              <div className="mt-4">
                <p className="text-xs font-bold text-slate-400 uppercase">Branch filter</p>
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

              <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase">Review queue</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">
                      검수 필요 {formatNumber(selectedReviewStops.length)}개
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      현재 선택한 {selectedBranch ? "branch" : "line"} 기준
                    </p>
                  </div>

                  <button
                    type="button"
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={selectedReviewStops.length === 0}
                    onClick={copySelectedReviewCsv}
                  >
                    {copiedReviewCsv ? "복사됨" : "CSV 복사"}
                  </button>
                </div>

                {selectedReviewStops.length > 0 ? (
                  <div className="mt-3 grid gap-2">
                    {selectedReviewStops.slice(0, 8).map((stop) => (
                      <div
                        key={`${stop.branchId}:${stop.sourceCandidateId}`}
                        className="rounded-xl bg-slate-50 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-800">{stop.displayNameKo}</span>
                          <span className="text-slate-500">
                            {stop.confidence}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-slate-500">
                          {stop.branchName} · seq {stop.sequence} · code {stop.sourceStationCode}
                        </p>
                        <p className="mt-0.5 truncate text-slate-400">
                          stationId {stop.stationId || "없음"} · {stop.matchStatus}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">현재 선택 범위에 검수 대상이 없습니다.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">선택된 노선 없음</p>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold">검수 상태</h2>
          <div className="mt-4 space-y-3 text-sm">
            <StatusRow label="Skipped route stops" value={bundle.counts.skippedRouteStops} />
            <StatusRow label="Missing canonical lines" value={bundle.counts.missingCanonicalLines} warn />
            <StatusRow label="Low confidence lines" value={lowConfidenceLines.length} warn />
          </div>
        </section>

        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-amber-950">검수 필요 노선</h2>
          <p className="mt-2 text-sm leading-6 text-amber-800">
            low confidence는 전역 역명 fallback으로 복구된 route stop입니다.
          </p>
          <div className="mt-4 space-y-3">
            {lowConfidenceLines.map((line) => (
              <button
                type="button"
                key={line.canonicalKey}
                className="w-full rounded-2xl border border-amber-200 bg-white/70 p-4 text-left hover:bg-white"
                onClick={() => {
                  setSelectedArea("all");
                  setOnlyLowConfidence(false);
                  setSearchQuery("");
                  setSelectedLineKey(line.canonicalKey);
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-amber-950">{line.nameKo}</p>
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">
                    {countLowConfidence(line)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-amber-700">{line.canonicalKey}</p>
              </button>
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
            <th className="px-4 py-3">Role</th>
            <th className="px-4 py-3">Source</th>
            <th className="px-4 py-3">구간</th>
            <th className="px-4 py-3 text-right">역 수</th>
            <th className="px-4 py-3 text-right">검수</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {line.branches.map((branch) => {
            const low = getLowConfidenceStops(branch).length;
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
                    {isSelected ? "selected" : branch.role}
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

                    {low > 0 ? (
                      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs font-bold text-amber-900">검수 필요 정차역</p>
                        <ul className="mt-2 space-y-1 text-xs text-amber-800">
                          {getLowConfidenceStops(branch).map((stop) => (
                            <li key={stop.id}>
                              {stop.sequence}. {stop.displayNameKo} · {stop.matchStatus}:
                              {stop.confidence}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </details>
                </td>
                <td className="px-4 py-3 align-top text-slate-600">
                  {branch.origin ?? getFirstStop(branch)} → {branch.terminal ?? getLastStop(branch)}
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

function StatusRow({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  const ok = value === 0;

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3">
      <span className="text-slate-600">{label}</span>
      <span className={ok ? "font-bold text-emerald-700" : warn ? "font-bold text-amber-700" : "font-bold text-slate-900"}>
        {formatNumber(value)}
      </span>
    </div>
  );
}
