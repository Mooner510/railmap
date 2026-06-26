"use client";

import { useEffect, useMemo, useState } from "react";
import RailMap, { type RailMapBranch, type RailMapStation } from "./RailMap";
import {
  countRouteStops,
  formatBranchRole,
  formatNumber,
  getFirstStop,
  getLastStop,
  type CanonicalBranch,
  type CanonicalBundle,
  type CanonicalLine,
} from "./railExplorerModel";

interface RailExplorerProps {
  bundle: CanonicalBundle;
  mapStations: RailMapStation[];
  mapBranches: RailMapBranch[];
}

interface FilterControlsProps {
  areaCodes: string[];
  selectedArea: string;
  searchQuery: string;
  copiedShareUrl: boolean;
  onSelectArea: (area: string) => void;
  onSearch: (query: string) => void;
  onReset: () => void;
  onCopyUrl: () => void;
}

interface LineListProps {
  lines: CanonicalLine[];
  selectedLineKey: string | null;
  onSelectLine: (lineKey: string) => void;
}

interface StationServingBranch {
  branchId: string;
  canonicalLineId: string;
  lineNameKo: string;
  sourceLineNumber: string;
  sourceLineName: string;
  colorHex: string;
  role: string;
  sequence: number;
  routeStopCount: number;
  firstStopName: string;
  lastStopName: string;
}

interface SelectedLinePanelProps {
  selectedLine: CanonicalLine | null;
  selectedBranchId: string | null;
  selectedBranch: CanonicalBranch | null;
  onSelectBranch: (branchId: string) => void;
  onClearBranch: () => void;
}

interface SelectedStationPanelProps {
  station: RailMapStation;
  servingBranches: StationServingBranch[];
  onSelectServingBranch: (branch: StationServingBranch) => void;
  onClear: () => void;
  compact?: boolean;
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
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [isHydratedFromUrl, setIsHydratedFromUrl] = useState(false);
  const [copiedShareUrl, setCopiedShareUrl] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const area = params.get("area");
    const q = params.get("q");
    const line = params.get("line");
    const branch = params.get("branch");
    const station = params.get("station");

    if (area) setSelectedArea(area);
    if (q) setSearchQuery(q);
    if (line) setSelectedLineKey(line);
    if (branch) setSelectedBranchId(branch);
    if (station) setSelectedStationId(station);

    setIsHydratedFromUrl(true);
  }, []);

  useEffect(() => {
    if (!isHydratedFromUrl) return;

    const params = new URLSearchParams();

    if (selectedArea !== "all") params.set("area", selectedArea);
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (selectedLineKey) params.set("line", selectedLineKey);
    if (selectedBranchId) params.set("branch", selectedBranchId);
    if (selectedStationId) params.set("station", selectedStationId);

    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;

    window.history.replaceState(null, "", nextUrl);
  }, [isHydratedFromUrl, searchQuery, selectedArea, selectedBranchId, selectedLineKey, selectedStationId]);

  const sortedLines = useMemo(
    () =>
      [...bundle.lines].sort((a, b) => {
        const areaCompare = a.mreaWideCd.localeCompare(b.mreaWideCd, "ko");
        if (areaCompare !== 0) return areaCompare;

        return a.nameKo.localeCompare(b.nameKo, "ko");
      }),
    [bundle.lines],
  );

  const filteredLines = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return sortedLines.filter((line) => {
      if (selectedArea !== "all" && line.mreaWideCd !== selectedArea) return false;
      if (!query) return true;

      const haystack = [
        line.nameKo,
        line.canonicalKey,
        line.lnCd,
        line.mreaWideCd,
        ...line.sourceLineNumbers,
        ...line.branches.map((branch) => branch.sourceLineName),
        ...line.branches.map((branch) => branch.sourceLineNumber),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [searchQuery, selectedArea, sortedLines]);

  const selectedLine = useMemo(
    () => bundle.lines.find((line) => line.canonicalKey === selectedLineKey) ?? null,
    [bundle.lines, selectedLineKey],
  );

  const selectedBranch = useMemo(() => {
    if (!selectedLine || !selectedBranchId) return null;

    return selectedLine.branches.find((branch) => branch.id === selectedBranchId) ?? null;
  }, [selectedBranchId, selectedLine]);

  const selectedStation = useMemo(
    () => mapStations.find((station) => station.id === selectedStationId) ?? null,
    [mapStations, selectedStationId],
  );

  const selectedStationServingBranches = useMemo<StationServingBranch[]>(() => {
    if (!selectedStationId) return [];

    return mapBranches.flatMap((branch) =>
      branch.routeStops
        .filter((stop) => stop.station?.id === selectedStationId)
        .map((stop) => ({
          branchId: branch.id,
          canonicalLineId: branch.canonicalLineId,
          lineNameKo: branch.canonicalLineNameKo,
          sourceLineNumber: branch.sourceLineNumber,
          sourceLineName: branch.sourceLineName,
          colorHex: branch.colorHex,
          role: branch.role,
          sequence: stop.sequence,
          routeStopCount: branch.routeStops.length,
          firstStopName: branch.routeStops[0]?.displayNameKo ?? "-",
          lastStopName: branch.routeStops[branch.routeStops.length - 1]?.displayNameKo ?? "-",
        })),
    );
  }, [mapBranches, selectedStationId]);

  useEffect(() => {
    if (!selectedLineKey) return;
    if (bundle.lines.some((line) => line.canonicalKey === selectedLineKey)) return;

    setSelectedLineKey(null);
    setSelectedBranchId(null);
  }, [bundle.lines, selectedLineKey]);

  useEffect(() => {
    if (!selectedLine || !selectedBranchId) return;
    if (selectedLine.branches.some((branch) => branch.id === selectedBranchId)) return;

    setSelectedBranchId(null);
  }, [selectedBranchId, selectedLine]);

  useEffect(() => {
    if (!selectedStationId) return;
    if (mapStations.some((station) => station.id === selectedStationId)) return;

    setSelectedStationId(null);
  }, [mapStations, selectedStationId]);

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

  const resetFilters = () => {
    setSelectedArea("all");
    setSearchQuery("");
    setSelectedLineKey(null);
    setSelectedBranchId(null);
    setSelectedStationId(null);
  };

  const selectArea = (area: string) => {
    setSelectedArea(area);
    setSelectedLineKey(null);
    setSelectedBranchId(null);
    setSelectedStationId(null);
  };

  const search = (query: string) => {
    setSearchQuery(query);
    setSelectedLineKey(null);
    setSelectedBranchId(null);
    setSelectedStationId(null);
  };

  const selectLine = (lineKey: string) => {
    setSelectedLineKey(lineKey);
    setSelectedBranchId(null);
    setSelectedStationId(null);
  };

  const selectMapBranch = (branch: RailMapBranch) => {
    setSelectedLineKey(branch.canonicalLineId);
    setSelectedBranchId(branch.id);
    setSelectedStationId(null);
  };

  const selectServingBranch = (branch: StationServingBranch) => {
    setSelectedLineKey(branch.canonicalLineId);
    setSelectedBranchId(branch.branchId);
  };

  const selectMapStation = (station: RailMapStation) => {
    setSelectedStationId(station.id);
  };

  const copyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopiedShareUrl(true);
    window.setTimeout(() => setCopiedShareUrl(false), 1200);
  };

  return (
    <section className="grid h-[100dvh] w-full overflow-hidden bg-slate-100 text-slate-950 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="z-20 hidden h-full min-h-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="border-b border-slate-200 px-2.5 py-2">
          <ExplorerTitle
            filteredLineCount={filteredLines.length}
            visibleBranchCount={visibleMapBranches.length}
            visibleStationCount={visibleMapStations.length}
          />
          <div className="mt-1.5">
            <FilterControls
              areaCodes={areaCodes}
              selectedArea={selectedArea}
              searchQuery={searchQuery}
              copiedShareUrl={copiedShareUrl}
              onSelectArea={selectArea}
              onSearch={search}
              onReset={resetFilters}
              onCopyUrl={copyUrl}
            />
          </div>
        </div>

        <LineList
          lines={filteredLines}
          selectedLineKey={selectedLineKey}
          onSelectLine={selectLine}
        />
      </aside>

      <div className="relative h-full min-h-0 min-w-0 overflow-hidden">
        <RailMap
          className="absolute inset-0 h-full min-h-[100dvh] w-full"
          stations={visibleMapStations}
          branches={visibleMapBranches}
          selectedBranchId={selectedBranchId}
          selectedStationId={selectedStationId}
          onSelectBranch={selectMapBranch}
          onSelectStation={selectMapStation}
        />

        {selectedLine || selectedStation ? (
          <div className="pointer-events-none absolute right-2 top-2 z-10 hidden w-[280px] lg:block">
            <div className="pointer-events-auto grid max-h-[calc(100dvh-16px)] gap-1.5 overflow-y-auto border border-slate-200 bg-white/95 p-1.5 shadow-sm shadow-slate-950/10 backdrop-blur">
              {selectedStation ? (
                <SelectedStationPanel
                  station={selectedStation}
                  servingBranches={selectedStationServingBranches}
                  onSelectServingBranch={selectServingBranch}
                  onClear={() => setSelectedStationId(null)}
                />
              ) : null}

              {selectedLine ? (
                <SelectedLinePanel
                  selectedLine={selectedLine}
                  selectedBranchId={selectedBranchId}
                  selectedBranch={selectedBranch}
                  onSelectBranch={setSelectedBranchId}
                  onClearBranch={() => setSelectedBranchId(null)}
                />
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 lg:hidden">
          <div className="pointer-events-auto max-h-[54dvh] overflow-hidden border-t border-slate-200 bg-white/97 shadow-md shadow-slate-950/10 backdrop-blur">
            <div className="mx-auto mt-1.5 h-0.5 w-8 rounded bg-slate-300" />

            <div className="border-b border-slate-200 px-2.5 pb-2 pt-1.5">
              <ExplorerTitle
                filteredLineCount={filteredLines.length}
                visibleBranchCount={visibleMapBranches.length}
                visibleStationCount={visibleMapStations.length}
                compact
              />
              <div className="mt-1.5">
                <FilterControls
                  areaCodes={areaCodes}
                  selectedArea={selectedArea}
                  searchQuery={searchQuery}
                  copiedShareUrl={copiedShareUrl}
                  onSelectArea={selectArea}
                  onSearch={search}
                  onReset={resetFilters}
                  onCopyUrl={copyUrl}
                  compact
                />
              </div>
            </div>

            <div className="max-h-[calc(54dvh-104px)] overflow-y-auto px-2.5 pb-4 pt-2">
              {selectedStation ? (
                <SelectedStationPanel
                  station={selectedStation}
                  servingBranches={selectedStationServingBranches}
                  onSelectServingBranch={selectServingBranch}
                  onClear={() => setSelectedStationId(null)}
                  compact
                />
              ) : null}

              <div className={selectedStation ? "mt-1.5" : undefined}>
                <SelectedLinePanel
                  selectedLine={selectedLine}
                  selectedBranchId={selectedBranchId}
                  selectedBranch={selectedBranch}
                  onSelectBranch={setSelectedBranchId}
                  onClearBranch={() => setSelectedBranchId(null)}
                  compact
                />
              </div>

              <div className="mt-1.5">
                <LineList
                  lines={filteredLines}
                  selectedLineKey={selectedLineKey}
                  onSelectLine={selectLine}
                  compact
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ExplorerTitle({
  filteredLineCount,
  visibleBranchCount,
  visibleStationCount,
  compact = false,
}: {
  filteredLineCount: number;
  visibleBranchCount: number;
  visibleStationCount: number;
  compact?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-[0.14em] text-sky-600 uppercase">Korea Rail Map</p>
      <h1 className={compact ? "mt-0.5 text-[13px] font-bold" : "mt-1 text-[13px] font-bold"}>
        철도 노선 지도
      </h1>
      <p className="mt-1 text-[11px] leading-4 text-slate-500">
        {formatNumber(filteredLineCount)}개 노선 · {formatNumber(visibleBranchCount)}개 구간 · 지도 역{" "}
        {formatNumber(visibleStationCount)}개
      </p>
    </div>
  );
}

function FilterControls({
  areaCodes,
  selectedArea,
  searchQuery,
  copiedShareUrl,
  onSelectArea,
  onSearch,
  onReset,
  onCopyUrl,
  compact = false,
}: FilterControlsProps & { compact?: boolean }) {
  return (
    <div className="space-y-2">
      <input
        className="h-8 w-full rounded border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 outline-none placeholder:text-slate-400 focus:border-sky-300 focus:ring-1 focus:ring-sky-100"
        value={searchQuery}
        placeholder="노선명, 코드 검색"
        onChange={(event) => onSearch(event.target.value)}
      />

      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        <FilterChip active={selectedArea === "all"} onClick={() => onSelectArea("all")}>
          전체
        </FilterChip>
        {areaCodes.map((areaCode) => (
          <FilterChip
            key={areaCode}
            active={selectedArea === areaCode}
            onClick={() => onSelectArea(areaCode)}
          >
            {areaCode}
          </FilterChip>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          className="h-7 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          onClick={onReset}
        >
          초기화
        </button>
        <button
          type="button"
          className="h-7 rounded bg-slate-950 px-2.5 text-xs font-semibold text-white transition hover:bg-slate-800"
          onClick={onCopyUrl}
        >
          {copiedShareUrl ? "복사됨" : compact ? "공유" : "URL 복사"}
        </button>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        active
          ? "shrink-0 rounded bg-sky-600 px-2.5 py-1 text-xs font-bold text-white"
          : "shrink-0 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function LineList({ lines, selectedLineKey, onSelectLine, compact = false }: LineListProps & { compact?: boolean }) {
  if (lines.length === 0) {
    return (
      <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
        <p className="text-xs font-semibold text-slate-900">검색 결과 없음</p>
        <p className="mt-0.5 text-[11px] text-slate-500">검색어 또는 권역 필터를 조정하세요.</p>
      </div>
    );
  }

  return (
    <div className={compact ? "grid gap-1.5" : "flex-1 overflow-y-auto p-2"}>
      <div className="grid gap-1.5">
        {lines.map((line) => (
          <LineCard
            key={line.canonicalKey}
            line={line}
            selected={selectedLineKey === line.canonicalKey}
            onClick={() => onSelectLine(line.canonicalKey)}
          />
        ))}
      </div>
    </div>
  );
}

function LineCard({ line, selected, onClick }: { line: CanonicalLine; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={
        selected
          ? "rounded border border-sky-300 bg-sky-50 p-2 text-left ring-1 ring-sky-100"
          : "rounded border border-slate-200 bg-white p-2 text-left transition hover:border-sky-200 hover:bg-sky-50/60"
      }
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-sm border border-white"
              style={{ backgroundColor: line.colorHex }}
              title={line.colorHex}
            />
            <p className="truncate text-[13px] font-bold text-slate-950">{line.nameKo}</p>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            구간 {line.branches.length}개 · 정차역 {formatNumber(countRouteStops(line))}개
          </p>
        </div>

        <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {line.canonicalKey}
        </span>
      </div>
    </button>
  );
}

function SelectedStationPanel({
  station,
  servingBranches,
  onSelectServingBranch,
  onClear,
}: SelectedStationPanelProps) {
  const uniqueLineCount = new Set(servingBranches.map((branch) => branch.canonicalLineId)).size;
  const visibleBranches = servingBranches.slice(0, 8);

  return (
    <section className="border border-slate-200 bg-white p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-wide text-amber-600 uppercase">선택 역</p>
          <h2 className="mt-0.5 truncate text-sm font-bold text-slate-950">{station.nameKo}</h2>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            노선 {formatNumber(uniqueLineCount)}개 · 구간 {formatNumber(servingBranches.length)}개
          </p>
        </div>
        <button
          type="button"
          className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
          onClick={onClear}
        >
          닫기
        </button>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5 text-xs">
        <MetricMini label="노선" value={uniqueLineCount} />
        <MetricMini label="구간" value={servingBranches.length} />
        <MetricMini label="좌표" value={station.lat && station.lng ? `${station.lat.toFixed(3)}, ${station.lng.toFixed(3)}` : "-"} />
      </div>

      {servingBranches.length > 0 ? (
        <div className="mt-2">
          <p className="text-[10px] font-bold tracking-wide text-slate-400 uppercase">정차 노선</p>
          <div className="mt-1.5 grid gap-1.5">
            {visibleBranches.map((branch) => (
              <button
                type="button"
                key={`${branch.branchId}:${branch.sequence}`}
                className="flex items-start gap-2 rounded border border-slate-200 bg-white px-2 py-1.5 text-left hover:border-sky-200 hover:bg-sky-50/70"
                onClick={() => onSelectServingBranch(branch)}
              >
                <span
                  className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm border border-white"
                  style={{ backgroundColor: branch.colorHex }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-bold text-slate-900">{branch.lineNameKo}</span>
                    <span className="shrink-0 text-[10px] font-semibold text-slate-400">{branch.sequence}번째</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                    {branch.sourceLineName} · {formatBranchRole(branch.role)} · {branch.firstStopName} → {branch.lastStopName}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {servingBranches.length > visibleBranches.length ? (
            <p className="mt-1 text-[11px] font-medium text-slate-400">외 {servingBranches.length - visibleBranches.length}개 구간</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SelectedLinePanel({
  selectedLine,
  selectedBranchId,
  selectedBranch,
  onSelectBranch,
  onClearBranch,
  compact = false,
}: SelectedLinePanelProps & { compact?: boolean }) {
  if (!selectedLine) {
    return (
      <section className="border border-slate-200 bg-white p-2.5">
        <h2 className="text-[13px] font-bold">선택 노선</h2>
        <p className="mt-1.5 text-xs leading-5 text-slate-500">
          지도에서 확인할 노선을 선택하세요. PC에서는 좌측 목록, 모바일에서는 아래 목록에서 바로 선택할 수 있습니다.
        </p>
      </section>
    );
  }

  return (
    <section className="border border-slate-200 bg-white p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-sm border border-white"
              style={{ backgroundColor: selectedLine.colorHex }}
            />
            <h2 className="truncate text-[13px] font-bold">{selectedLine.nameKo}</h2>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            {selectedLine.canonicalKey} · 권역 {selectedLine.mreaWideCd} · lnCd {selectedLine.lnCd}
          </p>
        </div>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {selectedBranch ? "구간" : "전체"}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
        <MetricMini label="구간" value={selectedLine.branches.length} />
        <MetricMini label="정차역" value={countRouteStops(selectedLine)} />
      </div>

      {selectedBranch ? (
        <div className="mt-2 border border-slate-200 bg-slate-50 px-2 py-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-slate-900">{selectedBranch.sourceLineName}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {selectedBranch.origin ?? getFirstStop(selectedBranch)} → {selectedBranch.terminal ?? getLastStop(selectedBranch)}
              </p>
            </div>
            <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
              {formatNumber(selectedBranch.routeStops.length)}역
            </span>
          </div>
        </div>
      ) : null}

      <div className="mt-2">
        <p className="text-[11px] font-bold tracking-wide text-slate-400 uppercase">구간 선택</p>
        <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5">
          <BranchChip active={selectedBranchId === null} onClick={onClearBranch}>
            전체
          </BranchChip>
          {selectedLine.branches.map((branch) => (
            <BranchChip
              key={branch.id}
              active={selectedBranchId === branch.id}
              onClick={() => onSelectBranch(branch.id)}
            >
              {branch.sourceLineName}
            </BranchChip>
          ))}
        </div>
      </div>

      {selectedBranch ? <RouteStopList branch={selectedBranch} compact={compact} /> : null}

      <BranchTable
        line={selectedLine}
        selectedBranchId={selectedBranchId}
        onSelectBranch={onSelectBranch}
        onClearBranch={onClearBranch}
        compact={compact}
      />
    </section>
  );
}

function BranchChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        active
          ? "shrink-0 rounded bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white"
          : "shrink-0 rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function RouteStopList({ branch, compact = false }: { branch: CanonicalBranch; compact?: boolean }) {
  const stops = compact ? branch.routeStops.slice(0, 12) : branch.routeStops.slice(0, 18);

  return (
    <div className="mt-2 border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-2 py-1.5">
        <p className="text-[11px] font-bold tracking-wide text-slate-400 uppercase">정차역</p>
        <p className="text-[11px] font-semibold text-slate-500">
          {formatNumber(branch.routeStops.length)}개
        </p>
      </div>
      <ol className="max-h-40 overflow-y-auto px-2 py-1">
        {stops.map((stop) => (
          <li key={stop.id} className="flex items-center gap-2 py-0.5 text-[11px]">
            <span className="w-5 shrink-0 text-right font-semibold text-slate-400">{stop.sequence}</span>
            <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{stop.displayNameKo}</span>
          </li>
        ))}
      </ol>
      {branch.routeStops.length > stops.length ? (
        <p className="border-t border-slate-100 px-2 py-1 text-[11px] font-medium text-slate-400">
          외 {formatNumber(branch.routeStops.length - stops.length)}개 역
        </p>
      ) : null}
    </div>
  );
}


function BranchTable({
  line,
  selectedBranchId,
  onSelectBranch,
  onClearBranch,
  compact = false,
}: {
  line: CanonicalLine;
  selectedBranchId: string | null;
  onSelectBranch: (branchId: string) => void;
  onClearBranch: () => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="mt-2 grid gap-2">
        {line.branches.map((branch) => {
          const isSelected = selectedBranchId === branch.id;

          return (
            <button
              type="button"
              key={branch.id}
              className={
                isSelected
                  ? "rounded border border-sky-300 bg-sky-50 p-2 text-left ring-1 ring-sky-100"
                  : "rounded border border-slate-200 bg-white p-2 text-left"
              }
              onClick={() => (isSelected ? onClearBranch() : onSelectBranch(branch.id))}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-xs font-bold text-slate-900">
                  {branch.sourceLineName}
                </p>
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                  {formatBranchRole(branch.role)}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {branch.origin ?? getFirstStop(branch)} → {branch.terminal ?? getLastStop(branch)} · {branch.routeStops.length}역
              </p>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mt-2 overflow-hidden border border-slate-200 bg-white">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase">
          <tr>
            <th className="px-2 py-1">구분</th>
            <th className="px-2 py-1">출처</th>
            <th className="px-2 py-1">구간</th>
            <th className="px-2 py-1 text-right">역 수</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {line.branches.map((branch) => {
            const isSelected = selectedBranchId === branch.id;

            return (
              <tr key={branch.id} className={isSelected ? "bg-sky-50" : undefined}>
                <td className="px-2 py-1 align-top">
                  <button
                    type="button"
                    className={
                      isSelected
                        ? "rounded bg-sky-600 px-2 py-1 text-xs font-semibold text-white"
                        : "rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                    }
                    onClick={() => (isSelected ? onClearBranch() : onSelectBranch(branch.id))}
                  >
                    {isSelected ? "선택됨" : formatBranchRole(branch.role)}
                  </button>
                </td>
                <td className="px-2 py-1 align-top">
                  <p className="font-semibold text-slate-900">{branch.sourceLineName}</p>
                  <p className="text-xs text-slate-500">{branch.sourceLineNumber}</p>
                </td>
                <td className="px-2 py-1 align-top text-slate-600">
                  {branch.origin ?? getFirstStop(branch)} → {branch.terminal ?? getLastStop(branch)}
                </td>
                <td className="px-2 py-1 text-right align-top font-semibold">
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
    <div className="rounded bg-slate-50 px-2 py-1">
      <p className="text-xs font-bold text-slate-400 uppercase">{label}</p>
      <p className="mt-0.5 text-xs font-bold text-slate-950">{value}</p>
    </div>
  );
}
