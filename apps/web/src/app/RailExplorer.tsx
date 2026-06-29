"use client";

import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import RailMap, { type RailMapBranch, type RailMapStation } from "./RailMap";
import {
  countRouteStops,
  formatAreaName,
  formatBranchRole,
  formatNumber,
  normalizeSearchText,
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

type MobilePanelMode = "search" | "selected" | "lines";
type RoutePointRole = "origin" | "destination";

const MIN_STATION_SEARCH_LENGTH = 1;
const MAX_LINE_SEARCH_RESULTS = 8;
const MAX_STATION_SEARCH_RESULTS = 12;

interface FilterControlsProps {
  areaCodes: string[];
  selectedArea: string;
  searchQuery: string;
  copiedShareUrl: boolean;
  stationResults: RailMapStation[];
  lineResults: CanonicalLine[];
  selectedStationId: string | null;
  selectedLineKey: string | null;
  hasSelection: boolean;
  showSearchResults: boolean;
  focusSelectionLabel: string;
  showMapLines: boolean;
  showMapStations: boolean;
  onToggleMapLines: () => void;
  onToggleMapStations: () => void;
  onSelectArea: (area: string) => void;
  onSearch: (query: string) => void;
  onClearSearch: () => void;
  onSelectStation: (stationId: string) => void;
  onSelectLine: (lineKey: string) => void;
  onClearSelection: () => void;
  onReset: () => void;
  onFocusSelection: () => void;
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

interface RouteGraphEdge {
  toStationId: string;
  branchId: string;
  lineNameKo: string;
  sourceLineName: string;
  colorHex: string;
}

interface RouteSearchResult {
  stationIds: string[];
  edges: RouteGraphEdge[];
  transferCount: number;
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
  routeOriginStationId: string | null;
  routeDestinationStationId: string | null;
  onSelectServingBranch: (branch: StationServingBranch) => void;
  onSetRoutePoint: (role: RoutePointRole, stationId: string) => void;
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
  const [routeOriginStationId, setRouteOriginStationId] = useState<string | null>(null);
  const [routeDestinationStationId, setRouteDestinationStationId] = useState<string | null>(null);
  const [routeSearchMessage, setRouteSearchMessage] = useState<string | null>(null);
  const [routeSearchResult, setRouteSearchResult] = useState<RouteSearchResult | null>(null);
  const [isHydratedFromUrl, setIsHydratedFromUrl] = useState(false);
  const [copiedShareUrl, setCopiedShareUrl] = useState(false);
  const [mapFocusVersion, setMapFocusVersion] = useState(0);
  const [showMapLines, setShowMapLines] = useState(true);
  const [showMapStations, setShowMapStations] = useState(true);
  const [mobilePanelMode, setMobilePanelMode] = useState<MobilePanelMode>("search");
  const [isSearchResultsOpen, setIsSearchResultsOpen] = useState(false);

  const deferredSearchQuery = useDeferredValue(searchQuery);

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

  const lineSearchIndex = useMemo(
    () =>
      new Map(
        sortedLines.map((line) => [
          line.canonicalKey,
          normalizeSearchText(
            [
              line.nameKo,
              formatAreaName(line.mreaWideCd),
              line.canonicalKey,
              line.lnCd,
              ...line.sourceLineNumbers,
              ...line.branches.map((branch) => branch.sourceLineName),
              ...line.branches.map((branch) => branch.sourceLineNumber),
            ].join(" "),
          ),
        ]),
      ),
    [sortedLines],
  );

  const stationSearchIndex = useMemo(
    () =>
      new Map(
        mapStations.map((station) => [
          station.id,
          normalizeSearchText(`${station.nameKo} ${station.id} ${station.lineNameKo ?? ""}`),
        ]),
      ),
    [mapStations],
  );

  const filteredLines = useMemo(() => {
    const query = normalizeSearchText(deferredSearchQuery);
    const shouldFilterBySearch = query.length > 0;

    return sortedLines.filter((line) => {
      if (selectedArea !== "all" && line.mreaWideCd !== selectedArea) return false;
      if (!shouldFilterBySearch) return true;

      return lineSearchIndex.get(line.canonicalKey)?.includes(query) ?? false;
    });
  }, [deferredSearchQuery, lineSearchIndex, selectedArea, sortedLines]);

  const stationSearchResults = useMemo(() => {
    const query = normalizeSearchText(deferredSearchQuery);
    if (query.length < MIN_STATION_SEARCH_LENGTH) return [];

    const exactNameMatches: RailMapStation[] = [];
    const similarNameMatches: RailMapStation[] = [];
    const metadataMatches: RailMapStation[] = [];

    for (const station of mapStations) {
      const name = normalizeSearchText(station.nameKo);
      const searchable = stationSearchIndex.get(station.id) ?? "";

      if (!searchable.includes(query)) continue;

      if (name === query) {
        exactNameMatches.push(station);
      } else if (name.includes(query)) {
        similarNameMatches.push(station);
      } else {
        metadataMatches.push(station);
      }

      const collected =
        exactNameMatches.length + similarNameMatches.length + metadataMatches.length;

      if (collected >= MAX_STATION_SEARCH_RESULTS * 3) break;
    }

    return [...exactNameMatches, ...similarNameMatches, ...metadataMatches].slice(
      0,
      MAX_STATION_SEARCH_RESULTS,
    );
  }, [deferredSearchQuery, mapStations, stationSearchIndex]);

  const lineSearchResults = useMemo(() => {
    const query = normalizeSearchText(deferredSearchQuery);
    if (!query) return [];

    const results: CanonicalLine[] = [];

    for (const line of sortedLines) {
      if (selectedArea !== "all" && line.mreaWideCd !== selectedArea) continue;
      if (!(lineSearchIndex.get(line.canonicalKey)?.includes(query) ?? false)) continue;

      results.push(line);

      if (results.length >= MAX_LINE_SEARCH_RESULTS) break;
    }

    return results;
  }, [deferredSearchQuery, lineSearchIndex, selectedArea, sortedLines]);

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

  const routeOriginStation = useMemo(
    () => mapStations.find((station) => station.id === routeOriginStationId) ?? null,
    [mapStations, routeOriginStationId],
  );

  const routeDestinationStation = useMemo(
    () => mapStations.find((station) => station.id === routeDestinationStationId) ?? null,
    [mapStations, routeDestinationStationId],
  );

  const routeGraph = useMemo(() => buildRouteGraph(bundle.lines), [bundle.lines]);
  const stationById = useMemo(() => new Map(mapStations.map((station) => [station.id, station])), [mapStations]);

  const routeResultStationIds = useMemo(
    () => routeSearchResult?.stationIds ?? [],
    [routeSearchResult],
  );

  const routeResultBranchIds = useMemo(
    () => routeSearchResult?.edges.map((edge) => edge.branchId) ?? [],
    [routeSearchResult],
  );

  const stationServingIndex = useMemo(() => {
    const index = new Map<string, StationServingBranch[]>();

    for (const branch of mapBranches) {
      for (const stop of branch.routeStops) {
        const stationId = stop.station?.id;
        if (!stationId) continue;

        const item: StationServingBranch = {
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
        };

        index.set(stationId, [...(index.get(stationId) ?? []), item]);
      }
    }

    return index;
  }, [mapBranches]);

  const selectedStationServingBranches = useMemo<StationServingBranch[]>(
    () => (selectedStationId ? stationServingIndex.get(selectedStationId) ?? [] : []),
    [selectedStationId, stationServingIndex],
  );

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

  useEffect(() => {
    if (routeOriginStationId && !mapStations.some((station) => station.id === routeOriginStationId)) {
      setRouteOriginStationId(null);
    }

    if (routeDestinationStationId && !mapStations.some((station) => station.id === routeDestinationStationId)) {
      setRouteDestinationStationId(null);
    }
  }, [mapStations, routeDestinationStationId, routeOriginStationId]);

  useEffect(() => {
    if (selectedLineKey || selectedBranchId || selectedStationId) {
      setMobilePanelMode("selected");
    }
  }, [selectedBranchId, selectedLineKey, selectedStationId]);

  useEffect(() => {
    if (searchQuery.trim()) {
      setMobilePanelMode("search");
    }
  }, [searchQuery]);

  const visibleLineKeys = useMemo(
    () =>
      new Set(
        sortedLines
          .filter((line) => selectedArea === "all" || line.mreaWideCd === selectedArea)
          .map((line) => line.canonicalKey),
      ),
    [selectedArea, sortedLines],
  );

  const visibleMapBranches = useMemo(
    () =>
      mapBranches.filter((branch) => {
        if (!visibleLineKeys.has(branch.canonicalLineId)) return false;

        if (routeSearchResult) {
          return routeSearchResult.edges.some((edge) => edge.branchId === branch.id);
        }

        if (selectedBranch) return branch.id === selectedBranch.id;
        if (selectedLine) return branch.canonicalLineId === selectedLine.canonicalKey;
        return true;
      }),
    [mapBranches, routeSearchResult, selectedBranch, selectedLine, visibleLineKeys],
  );

  const visibleStationIds = useMemo(() => {
    const ids = new Set<string>();

    for (const branch of visibleMapBranches) {
      for (const stop of branch.routeStops) {
        if (stop.station?.id) ids.add(stop.station.id);
      }
    }

    for (const stationId of routeSearchResult?.stationIds ?? []) {
      ids.add(stationId);
    }

    return ids;
  }, [routeSearchResult, visibleMapBranches]);

  const visibleMapStations = useMemo(
    () => mapStations.filter((station) => visibleStationIds.has(station.id)),
    [mapStations, visibleStationIds],
  );

  const resetFilters = () => {
    setSelectedArea("all");
    setSearchQuery("");
    setIsSearchResultsOpen(false);
    setSelectedLineKey(null);
    setSelectedBranchId(null);
    setSelectedStationId(null);
    setRouteOriginStationId(null);
    setRouteDestinationStationId(null);
    setRouteSearchMessage(null);
  };

  const clearSelection = () => {
    setSelectedLineKey(null);
    setSelectedBranchId(null);
    setSelectedStationId(null);
    setMobilePanelMode("lines");
  };

  const clearSearch = () => {
    setSearchQuery("");
    setIsSearchResultsOpen(false);
  };

  const setRoutePoint = (role: RoutePointRole, stationId: string) => {
    if (role === "origin") {
      setRouteOriginStationId(stationId);
    } else {
      setRouteDestinationStationId(stationId);
    }

    setRouteSearchMessage(null);
    setRouteSearchResult(null);
    setSelectedLineKey(null);
    setSelectedBranchId(null);
    setSelectedStationId(stationId);
    setMobilePanelMode("selected");
  };

  const clearRoutePoint = (role: RoutePointRole) => {
    if (role === "origin") {
      setRouteOriginStationId(null);
    } else {
      setRouteDestinationStationId(null);
    }

    setRouteSearchMessage(null);
    setRouteSearchResult(null);
  };

  const swapRoutePoints = () => {
    setRouteOriginStationId(routeDestinationStationId);
    setRouteDestinationStationId(routeOriginStationId);
    setRouteSearchMessage(null);
    setRouteSearchResult(null);
    setMobilePanelMode("selected");
  };

  const submitRouteSearch = () => {
    if (!routeOriginStationId || !routeDestinationStationId) {
      setRouteSearchResult(null);
      setRouteSearchMessage("출발역과 도착역을 모두 지정해 주세요.");
      setMobilePanelMode("selected");
      setMapFocusVersion((version) => version + 1);
      return;
    }

    if (routeOriginStationId === routeDestinationStationId) {
      setRouteSearchResult(null);
      setRouteSearchMessage("출발역과 도착역이 같습니다. 다른 역을 선택해 주세요.");
      setMobilePanelMode("selected");
      setMapFocusVersion((version) => version + 1);
      return;
    }

    const result = findRoute(routeGraph, routeOriginStationId, routeDestinationStationId);

    setSelectedLineKey(null);
    setSelectedBranchId(null);

    if (!result) {
      setRouteSearchResult(null);
      setRouteSearchMessage("경로를 찾지 못했습니다. 현재 정적 노선 데이터에서 두 역을 연결할 수 없습니다.");
      setMobilePanelMode("selected");
      setMapFocusVersion((version) => version + 1);
      return;
    }

    setSelectedStationId(null);
    setRouteSearchResult(result);
    setRouteSearchMessage(null);
    setMobilePanelMode("selected");
    setMapFocusVersion((version) => version + 1);
  };

  const focusSelection = () => {
    setMapFocusVersion((version) => version + 1);
  };

  const hasSelection = Boolean(selectedLineKey || selectedBranchId || selectedStationId);
  const focusSelectionLabel = selectedStationId
    ? "역으로 이동"
    : selectedBranchId
      ? "구간 보기"
      : selectedLineKey
        ? "노선 보기"
        : "선택 이동";

  const selectArea = (area: string) => {
    setSelectedArea(area);
    setSelectedLineKey(null);
    setSelectedBranchId(null);
    setSelectedStationId(null);
    setMobilePanelMode("lines");
  };

  const search = (query: string) => {
    setSearchQuery(query);
    setIsSearchResultsOpen(Boolean(query.trim()));
    setMobilePanelMode(query.trim() ? "search" : "lines");
  };

  const selectLine = (lineKey: string) => {
    setSelectedLineKey(lineKey);
    setSelectedBranchId(null);
    setSelectedStationId(null);
    setIsSearchResultsOpen(false);
    setMobilePanelMode("selected");
  };

  const selectMapBranch = (branch: RailMapBranch) => {
    setSelectedLineKey(branch.canonicalLineId);
    setSelectedBranchId(branch.id);
    setSelectedStationId(null);
    setIsSearchResultsOpen(false);
    setMobilePanelMode("selected");
  };

  const selectServingBranch = (branch: StationServingBranch) => {
    setSelectedLineKey(branch.canonicalLineId);
    setSelectedBranchId(branch.branchId);
    setIsSearchResultsOpen(false);
    setMobilePanelMode("selected");
  };

  const selectMapStation = (station: RailMapStation) => {
    setSelectedLineKey(null);
    setSelectedBranchId(null);
    setSelectedStationId(station.id);
    setIsSearchResultsOpen(false);
    setMobilePanelMode("selected");
  };

  const selectStationFromSearch = (stationId: string) => {
    setSelectedLineKey(null);
    setSelectedBranchId(null);
    setSelectedStationId(stationId);
    setIsSearchResultsOpen(false);
    setMapFocusVersion((version) => version + 1);
    setMobilePanelMode("selected");
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
              stationResults={stationSearchResults}
              lineResults={lineSearchResults}
              selectedStationId={selectedStationId}
              selectedLineKey={selectedLineKey}
              hasSelection={hasSelection}
              showSearchResults={isSearchResultsOpen}
              focusSelectionLabel={focusSelectionLabel}
              showMapLines={showMapLines}
              showMapStations={showMapStations}
              onToggleMapLines={() => setShowMapLines((value) => !value)}
              onToggleMapStations={() => setShowMapStations((value) => !value)}
              onSelectArea={selectArea}
              onSearch={search}
              onClearSearch={clearSearch}
              onSelectStation={selectStationFromSearch}
              onSelectLine={selectLine}
              onClearSelection={clearSelection}
              onReset={resetFilters}
              onFocusSelection={focusSelection}
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
          highlightedRouteStationIds={routeResultStationIds}
          highlightedRouteBranchIds={routeResultBranchIds}
          focusVersion={mapFocusVersion}
          showBranches={showMapLines}
          showStations={showMapStations}
          onSelectBranch={selectMapBranch}
          onSelectStation={selectMapStation}
          onClearStation={() => setSelectedStationId(null)}
        />

        {selectedLine || selectedStation ? (
          <div className="pointer-events-none absolute right-3 top-3 z-10 hidden w-[280px] max-w-[calc(100vw-24px)] lg:block">
            <div className="pointer-events-auto grid min-w-0 w-full max-w-full max-h-[calc(100dvh-24px)] gap-1.5 overflow-x-hidden overflow-y-auto [overflow-wrap:anywhere] border border-slate-200 bg-white/95 p-1.5 shadow-sm shadow-slate-950/10 backdrop-blur">
              {routeOriginStation || routeDestinationStation ? (
                <RouteDraftCard
                  originStation={routeOriginStation}
                  destinationStation={routeDestinationStation}
                  message={routeSearchMessage}
                  result={routeSearchResult}
                  stationById={stationById}
                  onClearOrigin={() => clearRoutePoint("origin")}
                  onClearDestination={() => clearRoutePoint("destination")}
                  onSwap={swapRoutePoints}
                  onSubmit={submitRouteSearch}
                />
              ) : null}

              {selectedStation ? (
                <SelectedStationPanel
                  station={selectedStation}
                  servingBranches={selectedStationServingBranches}
                  routeOriginStationId={routeOriginStationId}
                  routeDestinationStationId={routeDestinationStationId}
                  onSelectServingBranch={selectServingBranch}
                  onSetRoutePoint={setRoutePoint}
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
          <div className="pointer-events-auto max-h-[56dvh] overflow-hidden border-t border-slate-200 bg-white/97 shadow-md shadow-slate-950/10 backdrop-blur">
            <div className="mx-auto mt-1.5 h-0.5 w-8 rounded bg-slate-300" />

            <div className="border-b border-slate-200 px-2.5 pb-2 pt-1.5">
              <ExplorerTitle
                filteredLineCount={filteredLines.length}
                visibleBranchCount={visibleMapBranches.length}
                visibleStationCount={visibleMapStations.length}
                compact
              />
              <MobilePanelTabs
                activeMode={mobilePanelMode}
                hasSelection={hasSelection}
                resultCount={stationSearchResults.length + lineSearchResults.length}
                lineCount={filteredLines.length}
                onChange={setMobilePanelMode}
              />
            </div>

            <div className="max-h-[calc(56dvh-82px)] overflow-y-auto px-2.5 pb-4 pt-2">
              {mobilePanelMode === "search" ? (
                <FilterControls
                  areaCodes={areaCodes}
                  selectedArea={selectedArea}
                  searchQuery={searchQuery}
                  copiedShareUrl={copiedShareUrl}
                  stationResults={stationSearchResults}
                  lineResults={lineSearchResults}
                  selectedStationId={selectedStationId}
                  selectedLineKey={selectedLineKey}
                  hasSelection={hasSelection}
                  showSearchResults={isSearchResultsOpen}
                  focusSelectionLabel={focusSelectionLabel}
                  showMapLines={showMapLines}
                  showMapStations={showMapStations}
                  onToggleMapLines={() => setShowMapLines((value) => !value)}
                  onToggleMapStations={() => setShowMapStations((value) => !value)}
                  onSelectArea={selectArea}
                  onSearch={search}
                  onClearSearch={clearSearch}
                  onSelectStation={selectStationFromSearch}
                  onSelectLine={selectLine}
                  onClearSelection={clearSelection}
                  onReset={resetFilters}
                  onFocusSelection={focusSelection}
                  onCopyUrl={copyUrl}
                  compact
                />
              ) : null}

              {mobilePanelMode === "selected" ? (
                <div className="grid gap-1.5">
                  {routeOriginStation || routeDestinationStation ? (
                    <RouteDraftCard
                      originStation={routeOriginStation}
                      destinationStation={routeDestinationStation}
                      message={routeSearchMessage}
                      result={routeSearchResult}
                      stationById={stationById}
                      onClearOrigin={() => clearRoutePoint("origin")}
                      onClearDestination={() => clearRoutePoint("destination")}
                      onSwap={swapRoutePoints}
                      onSubmit={submitRouteSearch}
                      compact
                    />
                  ) : null}

                  {selectedStation ? (
                    <SelectedStationPanel
                      station={selectedStation}
                      servingBranches={selectedStationServingBranches}
                      routeOriginStationId={routeOriginStationId}
                      routeDestinationStationId={routeDestinationStationId}
                      onSelectServingBranch={selectServingBranch}
                      onSetRoutePoint={setRoutePoint}
                      onClear={() => setSelectedStationId(null)}
                      compact
                    />
                  ) : null}

                  <SelectedLinePanel
                    selectedLine={selectedLine}
                    selectedBranchId={selectedBranchId}
                    selectedBranch={selectedBranch}
                    onSelectBranch={setSelectedBranchId}
                    onClearBranch={() => setSelectedBranchId(null)}
                    compact
                  />
                </div>
              ) : null}

              {mobilePanelMode === "lines" ? (
                <LineList
                  lines={filteredLines}
                  selectedLineKey={selectedLineKey}
                  onSelectLine={selectLine}
                  compact
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


function MobilePanelTabs({
  activeMode,
  hasSelection,
  resultCount,
  lineCount,
  onChange,
}: {
  activeMode: MobilePanelMode;
  hasSelection: boolean;
  resultCount: number;
  lineCount: number;
  onChange: (mode: MobilePanelMode) => void;
}) {
  const items: Array<{ mode: MobilePanelMode; label: string; badge?: number; disabled?: boolean }> = [
    { mode: "search", label: "검색", badge: resultCount || undefined },
    { mode: "selected", label: "선택", disabled: !hasSelection },
    { mode: "lines", label: "노선", badge: lineCount },
  ];

  return (
    <div className="mt-1.5 grid grid-cols-3 gap-1 rounded bg-slate-100 p-0.5">
      {items.map((item) => {
        const active = activeMode === item.mode;

        return (
          <button
            key={item.mode}
            type="button"
            className={
              active
                ? "h-7 rounded bg-white px-2 text-[11px] font-bold text-slate-950 shadow-sm"
                : "h-7 rounded px-2 text-[11px] font-semibold text-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
            }
            disabled={item.disabled}
            onClick={() => onChange(item.mode)}
          >
            {item.label}
            {item.badge ? <span className="ml-1 text-[10px] text-slate-400">{formatNumber(item.badge)}</span> : null}
          </button>
        );
      })}
    </div>
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
  stationResults,
  lineResults,
  selectedStationId,
  selectedLineKey,
  hasSelection,
  showSearchResults,
  focusSelectionLabel,
  showMapLines,
  showMapStations,
  onToggleMapLines,
  onToggleMapStations,
  onSelectArea,
  onSearch,
  onClearSearch,
  onSelectStation,
  onSelectLine,
  onClearSelection,
  onReset,
  onFocusSelection,
  onCopyUrl,
  compact = false,
}: FilterControlsProps & { compact?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          className="h-8 w-full rounded border border-slate-200 bg-white px-2.5 pr-8 text-xs font-medium text-slate-800 outline-none placeholder:text-slate-400 focus:border-sky-300 focus:ring-1 focus:ring-sky-100"
          value={searchQuery}
          placeholder="노선명, 역명, 코드 검색"
          onChange={(event) => onSearch(event.target.value)}
        />
        {searchQuery.trim() ? (
          <button
            type="button"
            className="absolute right-1 top-1 h-6 rounded px-2 text-[11px] font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={onClearSearch}
          >
            ×
          </button>
        ) : null}
      </div>

      {showSearchResults ? (
        <SearchResults
          compact={compact}
          query={searchQuery}
          selectedStationId={selectedStationId}
          selectedLineKey={selectedLineKey}
          stations={stationResults}
          lines={lineResults}
          onSelectStation={onSelectStation}
          onSelectLine={onSelectLine}
        />
      ) : null}

      <MapDisplayToggles
        showMapLines={showMapLines}
        showMapStations={showMapStations}
        onToggleMapLines={onToggleMapLines}
        onToggleMapStations={onToggleMapStations}
      />

      {hasSelection ? (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 transition duration-150 ease-out hover:bg-slate-50 active:scale-[0.99]"
            onClick={onFocusSelection}
          >
            {focusSelectionLabel}
          </button>
          <button
            type="button"
            className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 transition duration-150 ease-out hover:bg-slate-50 active:scale-[0.99]"
            onClick={onClearSelection}
          >
            선택 해제
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={selectedArea === "all"} onClick={() => onSelectArea("all")}>
          전체
        </FilterChip>
        {areaCodes.map((areaCode) => (
          <FilterChip
            key={areaCode}
            active={selectedArea === areaCode}
            onClick={() => onSelectArea(areaCode)}
          >
            {formatAreaName(areaCode)}
          </FilterChip>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          className="h-7 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition duration-150 ease-out hover:bg-slate-50 active:scale-[0.99]"
          onClick={onReset}
        >
          전체 보기
        </button>
        <button
          type="button"
          className="h-7 rounded bg-slate-950 px-2.5 text-xs font-semibold text-white transition duration-150 ease-out hover:bg-slate-800 active:scale-[0.99]"
          onClick={onCopyUrl}
        >
          {copiedShareUrl ? "복사됨" : compact ? "공유" : "URL 복사"}
        </button>
      </div>
    </div>
  );
}

function MapDisplayToggles({
  showMapLines,
  showMapStations,
  onToggleMapLines,
  onToggleMapStations,
}: {
  showMapLines: boolean;
  showMapStations: boolean;
  onToggleMapLines: () => void;
  onToggleMapStations: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <ToggleButton active={showMapLines} onClick={onToggleMapLines}>
        구간선
      </ToggleButton>
      <ToggleButton active={showMapStations} onClick={onToggleMapStations}>
        역 표시
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        active
          ? "h-7 rounded border border-sky-200 bg-sky-50 px-2 text-xs font-bold text-sky-700"
          : "h-7 rounded border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-500 hover:bg-slate-50"
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function HighlightText({ text, query }: { text: string; query: string }): ReactNode {
  const keyword = query.trim();

  if (!keyword) return text;

  const textLower = text.toLocaleLowerCase("ko-KR");
  const keywordLower = keyword.toLocaleLowerCase("ko-KR");
  const index = textLower.indexOf(keywordLower);

  if (index < 0) return text;

  const before = text.slice(0, index);
  const match = text.slice(index, index + keyword.length);
  const after = text.slice(index + keyword.length);

  return (
    <>
      {before}
      <mark className="rounded-sm bg-amber-100 px-0.5 font-black text-amber-900">{match}</mark>
      {after}
    </>
  );
}

function SearchResults({
  compact,
  query,
  selectedStationId,
  stations,
  lines,
  selectedLineKey,
  onSelectStation,
  onSelectLine,
}: {
  compact: boolean;
  query: string;
  selectedStationId: string | null;
  selectedLineKey: string | null;
  stations: RailMapStation[];
  lines: CanonicalLine[];
  onSelectStation: (stationId: string) => void;
  onSelectLine: (lineKey: string) => void;
}) {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) return null;

  if (normalizedQuery.length < MIN_STATION_SEARCH_LENGTH && stations.length === 0 && lines.length === 0) {
    return (
      <div className="border border-dashed border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-medium text-slate-500">
        검색 결과를 표시하려면 역명이나 노선명을 입력하세요.
      </div>
    );
  }

  if (stations.length === 0 && lines.length === 0) {
    return (
      <div className="border border-dashed border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-medium text-slate-500">
        일치하는 역이나 노선이 없습니다.
      </div>
    );
  }

  return (
    <div className="border border-slate-200 bg-slate-50 p-1.5">
      {lines.length > 0 ? (
        <div>
          <div className="flex items-center justify-between gap-2 px-0.5">
            <p className="text-[10px] font-bold tracking-wide text-slate-400 uppercase">노선</p>
            <p className="text-[10px] font-semibold text-slate-400">상위 {formatNumber(lines.length)}개</p>
          </div>
          <div className="mt-1 grid gap-1">
            {lines.map((line) => {
              const isSelected = selectedLineKey === line.canonicalKey;

              return (
                <button
                  key={line.canonicalKey}
                  type="button"
                  className={
                    isSelected
                      ? "rounded border border-sky-300 bg-sky-50 px-2 py-1 text-left text-[11px] font-bold text-sky-900 transition duration-150 ease-out"
                      : "rounded border border-slate-200 bg-white px-2 py-1 text-left text-[11px] font-semibold text-slate-700 transition duration-150 ease-out hover:border-sky-200 hover:bg-sky-50 active:scale-[0.995]"
                  }
                  onClick={() => onSelectLine(line.canonicalKey)}
                >
                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: line.colorHex }} />
                    <span className="truncate"><HighlightText text={line.nameKo} query={query} /></span>
                  </span>
                  <span className="mt-0.5 block text-[10px] font-medium text-slate-400">
                    {formatAreaName(line.mreaWideCd)} · {formatNumber(countRouteStops(line))}역
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {stations.length > 0 ? (
        <div className={lines.length > 0 ? "mt-2" : undefined}>
          <div className="flex items-center justify-between gap-2 px-0.5">
            <p className="text-[10px] font-bold tracking-wide text-slate-400 uppercase">역</p>
            <p className="text-[10px] font-semibold text-slate-400">상위 {formatNumber(stations.length)}개</p>
          </div>
          <div className="mt-1 grid gap-1">
            {stations.map((station) => {
          const isSelected = selectedStationId === station.id;

          return (
            <button
              key={station.id}
              type="button"
              className={
                isSelected
                  ? "rounded border border-amber-300 bg-amber-50 px-2 py-1 text-left text-[11px] font-bold text-amber-900 transition duration-150 ease-out"
                  : "rounded border border-slate-200 bg-white px-2 py-1 text-left text-[11px] font-semibold text-slate-700 transition duration-150 ease-out hover:border-sky-200 hover:bg-sky-50 active:scale-[0.995]"
              }
              onClick={() => onSelectStation(station.id)}
            >
              <span className="block truncate"><HighlightText text={station.nameKo} query={query} /></span>
              {station.lineNameKo ? (
                <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-400">
                  {station.lineNameKo}
                </span>
              ) : null}
            </button>
          );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
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
          ? "rounded border border-sky-300 bg-sky-50 p-2 text-left ring-1 ring-sky-100 transition duration-150 ease-out"
          : "rounded border border-slate-200 bg-white p-2 text-left transition duration-150 ease-out hover:border-sky-200 hover:bg-sky-50/60 active:scale-[0.995]"
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
          {formatAreaName(line.mreaWideCd)}
        </span>
      </div>
    </button>
  );
}

function buildRouteGraph(lines: CanonicalLine[]): Map<string, RouteGraphEdge[]> {
  const graph = new Map<string, RouteGraphEdge[]>();

  const addEdge = (fromStationId: string, edge: RouteGraphEdge) => {
    const edges = graph.get(fromStationId) ?? [];
    edges.push(edge);
    graph.set(fromStationId, edges);
  };

  for (const line of lines) {
    for (const branch of line.branches) {
      for (let index = 0; index < branch.routeStops.length - 1; index += 1) {
        const current = branch.routeStops[index];
        const next = branch.routeStops[index + 1];

        if (!current?.stationId || !next?.stationId || current.stationId === next.stationId) continue;

        const edge: Omit<RouteGraphEdge, "toStationId"> = {
          branchId: branch.id,
          lineNameKo: line.nameKo,
          sourceLineName: branch.sourceLineName,
          colorHex: line.colorHex,
        };

        addEdge(current.stationId, { ...edge, toStationId: next.stationId });
        addEdge(next.stationId, { ...edge, toStationId: current.stationId });
      }
    }
  }

  return graph;
}

function findRoute(
  graph: Map<string, RouteGraphEdge[]>,
  originStationId: string,
  destinationStationId: string,
): RouteSearchResult | null {
  const queue = [originStationId];
  const visited = new Set([originStationId]);
  const previous = new Map<string, { stationId: string; edge: RouteGraphEdge }>();

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const stationId = queue[cursor]!;
    if (stationId === destinationStationId) break;

    for (const edge of graph.get(stationId) ?? []) {
      if (visited.has(edge.toStationId)) continue;

      visited.add(edge.toStationId);
      previous.set(edge.toStationId, { stationId, edge });
      queue.push(edge.toStationId);
    }
  }

  if (!visited.has(destinationStationId)) return null;

  const stationIds = [destinationStationId];
  const edges: RouteGraphEdge[] = [];
  let currentStationId = destinationStationId;

  while (currentStationId !== originStationId) {
    const item = previous.get(currentStationId);
    if (!item) return null;

    edges.unshift(item.edge);
    stationIds.unshift(item.stationId);
    currentStationId = item.stationId;
  }

  let transferCount = 0;
  let previousBranchId = edges[0]?.branchId ?? null;

  for (const edge of edges.slice(1)) {
    if (previousBranchId && edge.branchId !== previousBranchId) transferCount += 1;
    previousBranchId = edge.branchId;
  }

  return { stationIds, edges, transferCount };
}

function RouteResultSummary({
  result,
  stationById,
}: {
  result: RouteSearchResult;
  stationById: Map<string, RailMapStation>;
}) {
  const originName = stationById.get(result.stationIds[0] ?? "")?.nameKo ?? "출발";
  const destinationName = stationById.get(result.stationIds[result.stationIds.length - 1] ?? "")?.nameKo ?? "도착";
  const routeStationNames = result.stationIds
    .map((stationId) => stationById.get(stationId)?.nameKo)
    .filter((name): name is string => Boolean(name));

  const segments: Array<{ branchId: string; lineNameKo: string; colorHex: string; stationCount: number }> = [];

  for (const edge of result.edges) {
    const last = segments[segments.length - 1];

    if (last && last.branchId === edge.branchId) {
      last.stationCount += 1;
    } else {
      segments.push({
        branchId: edge.branchId,
        lineNameKo: edge.lineNameKo,
        colorHex: edge.colorHex,
        stationCount: 1,
      });
    }
  }

  return (
    <div className="mt-2 min-w-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="shrink-0 text-[10px] font-bold tracking-wide text-emerald-700 uppercase">검색 결과</p>
        <p className="min-w-0 truncate text-[10px] font-semibold text-emerald-700">
          {formatNumber(result.stationIds.length)}역 · 환승 {formatNumber(result.transferCount)}회
        </p>
      </div>

      <p className="mt-1 truncate text-xs font-bold text-slate-900">
        {originName} → {destinationName}
      </p>

      <div className="mt-1.5 grid min-w-0 gap-1">
        {segments.slice(0, 4).map((segment, index) => (
          <div key={`${segment.branchId}:${index}`} className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-slate-700">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: segment.colorHex }} />
            <span className="min-w-0 truncate">{segment.lineNameKo}</span>
            <span className="shrink-0 text-[10px] font-medium text-slate-400">{formatNumber(segment.stationCount + 1)}역</span>
          </div>
        ))}
        {segments.length > 4 ? (
          <p className="text-[10px] font-semibold text-slate-400">외 {formatNumber(segments.length - 4)}개 구간</p>
        ) : null}
      </div>

      {routeStationNames.length > 2 ? (
        <p className="mt-1.5 line-clamp-3 break-words text-[10px] font-medium leading-4 text-slate-500">
          {routeStationNames.slice(0, 10).join(" → ")}{routeStationNames.length > 10 ? " → ..." : ""}
        </p>
      ) : null}

      <p className="mt-1 text-[10px] font-semibold text-emerald-700">지도에 경로가 강조 표시됩니다.</p>
    </div>
  );
}

function RouteDraftCard({
  originStation,
  destinationStation,
  message,
  result,
  stationById,
  onClearOrigin,
  onClearDestination,
  onSwap,
  onSubmit,
  compact = false,
}: {
  originStation: RailMapStation | null;
  destinationStation: RailMapStation | null;
  message: string | null;
  result: RouteSearchResult | null;
  stationById: Map<string, RailMapStation>;
  onClearOrigin: () => void;
  onClearDestination: () => void;
  onSwap: () => void;
  onSubmit: () => void;
  compact?: boolean;
}) {
  const hasBothStations = Boolean(originStation && destinationStation);
  const isSameStation = Boolean(
    originStation && destinationStation && originStation.id === destinationStation.id,
  );
  const canSubmit = hasBothStations && !isSameStation;
  const statusText = isSameStation
    ? "출발역과 도착역이 같습니다."
    : message ?? "출발역과 도착역을 지정해 주세요.";

  return (
    <section className={compact ? "min-w-0 overflow-hidden border border-slate-200 bg-slate-50 p-2" : "min-w-0 overflow-hidden border border-slate-200 bg-slate-50 p-2.5"}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-wide text-slate-400 uppercase">경로 검색</p>
          <p className="mt-0.5 line-clamp-2 break-words text-[11px] font-medium leading-4 text-slate-500">{statusText}</p>
        </div>
        <button
          type="button"
          className="h-6 shrink-0 rounded border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-600 transition duration-150 ease-out hover:bg-slate-50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onSwap}
          disabled={!originStation && !destinationStation}
        >
          전환
        </button>
      </div>

      <div className="mt-2 grid gap-1.5">
        <RoutePointSlot
          label="출발"
          accent="sky"
          station={originStation}
          onClear={onClearOrigin}
        />
        <RoutePointSlot
          label="도착"
          accent="amber"
          station={destinationStation}
          onClear={onClearDestination}
        />
      </div>

      {result ? <RouteResultSummary result={result} stationById={stationById} /> : null}

      <button
        type="button"
        className="mt-2 h-8 w-full rounded bg-slate-950 px-3 text-xs font-bold text-white transition duration-150 ease-out hover:bg-slate-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300"
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        경로 검색
      </button>
    </section>
  );
}

function RoutePointSlot({
  label,
  accent,
  station,
  onClear,
}: {
  label: string;
  accent: "sky" | "amber";
  station: RailMapStation | null;
  onClear: () => void;
}) {
  const labelClass = accent === "sky" ? "text-sky-600" : "text-amber-600";

  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1.5">
      <div className="min-w-0">
        <p className={`text-[10px] font-bold ${labelClass}`}>{label}</p>
        <p className="mt-0.5 truncate text-xs font-bold text-slate-900">{station?.nameKo ?? "미지정"}</p>
      </div>
      {station ? (
        <button
          type="button"
          className="h-6 shrink-0 rounded px-1.5 text-[10px] font-semibold text-slate-400 transition duration-150 ease-out hover:bg-slate-100 hover:text-slate-700 active:scale-[0.99]"
          onClick={onClear}
        >
          삭제
        </button>
      ) : null}
    </div>
  );
}

function SelectedStationPanel({
  station,
  servingBranches,
  routeOriginStationId,
  routeDestinationStationId,
  onSelectServingBranch,
  onSetRoutePoint,
  onClear,
  compact = false,
}: SelectedStationPanelProps) {
  const lineChips = useMemo(() => {
    const lines = new Map<string, { name: string; colorHex: string }>();

    for (const branch of servingBranches) {
      if (!lines.has(branch.canonicalLineId)) {
        lines.set(branch.canonicalLineId, {
          name: branch.lineNameKo,
          colorHex: branch.colorHex,
        });
      }
    }

    return [...lines.values()];
  }, [servingBranches]);

  const uniqueLineCount = lineChips.length;
  const visibleLineChips = lineChips.slice(0, compact ? 4 : 6);
  const visibleBranches = servingBranches.slice(0, compact ? 5 : 8);
  const isOrigin = routeOriginStationId === station.id;
  const isDestination = routeDestinationStationId === station.id;

  return (
    <section className="min-w-0 overflow-hidden border border-slate-200 bg-white p-2.5 transition duration-150 ease-out">
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
          className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition duration-150 ease-out hover:bg-slate-50 active:scale-[0.99]"
          onClick={onClear}
        >
          닫기
        </button>
      </div>

      {visibleLineChips.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {visibleLineChips.map((line) => (
            <span
              key={line.name}
              className="inline-flex max-w-full items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: line.colorHex }} />
              <span className="truncate">{line.name}</span>
            </span>
          ))}
          {lineChips.length > visibleLineChips.length ? (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
              +{lineChips.length - visibleLineChips.length}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          className={
            isOrigin
              ? "h-7 rounded bg-sky-600 px-2 text-xs font-bold text-white transition duration-150 ease-out active:scale-[0.99]"
              : "h-7 rounded border border-sky-200 bg-sky-50 px-2 text-xs font-bold text-sky-700 transition duration-150 ease-out hover:bg-sky-100 active:scale-[0.99]"
          }
          onClick={() => onSetRoutePoint("origin", station.id)}
        >
          {isOrigin ? "출발 선택됨" : "출발로 설정"}
        </button>
        <button
          type="button"
          className={
            isDestination
              ? "h-7 rounded bg-amber-500 px-2 text-xs font-bold text-white transition duration-150 ease-out active:scale-[0.99]"
              : "h-7 rounded border border-amber-200 bg-amber-50 px-2 text-xs font-bold text-amber-700 transition duration-150 ease-out hover:bg-amber-100 active:scale-[0.99]"
          }
          onClick={() => onSetRoutePoint("destination", station.id)}
        >
          {isDestination ? "도착 선택됨" : "도착으로 설정"}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
        <MetricMini label="노선" value={uniqueLineCount} />
        <MetricMini label="구간" value={servingBranches.length} />
      </div>

      <DetailDisclosure>
        <span>stationId: {station.id}</span>
        <span>좌표: {station.lat && station.lng ? `${station.lat.toFixed(5)}, ${station.lng.toFixed(5)}` : "-"}</span>
      </DetailDisclosure>

      {servingBranches.length > 0 ? (
        <div className="mt-2">
          <p className="text-[10px] font-bold tracking-wide text-slate-400 uppercase">정차 구간</p>
          <div className="mt-1.5 grid gap-1.5">
            {visibleBranches.map((branch) => (
              <button
                type="button"
                key={`${branch.branchId}:${branch.sequence}`}
                className="flex min-w-0 items-start gap-2 rounded border border-slate-200 bg-white px-2 py-1.5 text-left transition duration-150 ease-out hover:border-sky-200 hover:bg-sky-50/70 active:scale-[0.995]"
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
            {formatAreaName(selectedLine.mreaWideCd)} · 구간 {formatNumber(selectedLine.branches.length)}개 · 정차역 {formatNumber(countRouteStops(selectedLine))}개
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
        <div className="mt-1.5 flex flex-wrap gap-1.5">
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

      <DetailDisclosure>
        <span>canonicalKey: {selectedLine.canonicalKey}</span>
        <span>lnCd: {selectedLine.lnCd}</span>
        <span>권역 코드: {selectedLine.mreaWideCd}</span>
        {selectedBranch ? <span>sourceLineNumber: {selectedBranch.sourceLineNumber}</span> : null}
      </DetailDisclosure>

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
  children: string;
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
  const stops = compact ? branch.routeStops.slice(0, 10) : branch.routeStops.slice(0, 14);

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
  const visibleBranches = compact ? line.branches.slice(0, 8) : line.branches;

  return (
    <div className="mt-2 grid gap-1.5">
      {visibleBranches.map((branch) => {
        const isSelected = selectedBranchId === branch.id;

        return (
          <button
            type="button"
            key={branch.id}
            className={
              isSelected
                ? "group rounded border border-sky-300 bg-sky-50 p-2 text-left ring-1 ring-sky-100 transition duration-150 ease-out"
                : "group rounded border border-slate-200 bg-white p-2 text-left transition duration-150 ease-out hover:border-sky-200 hover:bg-sky-50/60 active:scale-[0.995]"
            }
            onClick={() => (isSelected ? onClearBranch() : onSelectBranch(branch.id))}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-slate-900">{branch.sourceLineName}</p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                  {branch.origin ?? getFirstStop(branch)} → {branch.terminal ?? getLastStop(branch)}
                </p>
              </div>
              <span className={
                isSelected
                  ? "shrink-0 rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                  : "shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600"
              }>
                {isSelected ? "선택" : formatBranchRole(branch.role)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-slate-400">
              <span>{formatNumber(branch.routeStops.length)}개 역</span>
              {branch.sourceLineName !== line.nameKo ? <span>· {line.nameKo}</span> : null}
            </div>
          </button>
        );
      })}

      {line.branches.length > visibleBranches.length ? (
        <p className="px-1 text-[11px] font-medium text-slate-400">
          외 {formatNumber(line.branches.length - visibleBranches.length)}개 구간은 노선 선택 후 더 넓은 화면에서 확인할 수 있습니다.
        </p>
      ) : null}
    </div>
  );
}

function DetailDisclosure({
  title = "상세 정보",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <details className="mt-2 border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500">
      <summary className="cursor-pointer select-none font-semibold text-slate-600 transition hover:text-slate-900">
        {title}
      </summary>
      <div className="mt-1.5 grid gap-1 leading-4">{children}</div>
    </details>
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
