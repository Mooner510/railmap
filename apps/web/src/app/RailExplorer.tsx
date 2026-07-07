"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import RailMap, {
  type RailMapBranch,
  type RailMapStation,
  type RailMapTransferGroup,
} from "./RailMap";
import {
  countRouteStops,
  formatAreaName,
  formatBranchRole,
  formatRailLineCategory,
  formatRailServiceType,
  RAIL_LINE_CATEGORIES,
  isRailLineCategory,
  formatNumber,
  normalizeSearchText,
  getFirstStop,
  getLastStop,
  type CanonicalBranch,
  type CanonicalBundle,
  type CanonicalLine,
  type ManualLineBranchOverride,
  type ManualServicePattern,
  type ManualTrainRun,
  type ManualTrainPerformance,
  type ManualTransferEdge,
  type RailLineCategory,
  type RailServiceType,
} from "./railExplorerModel";

interface PublicDataVersionManifest {
  schemaVersion: number;
  generatedAt: string;
  acquiredDate?: string;
  versions?: {
    bundle?: { generatedAt?: string | null; acquiredDate?: string | null; bytes?: number | null };
    manualOverlay?: { bytes?: number | null; mtimeMs?: number | null };
  };
}

interface RailExplorerProps {
  bundle: CanonicalBundle;
  dataVersionManifest: PublicDataVersionManifest | null;
  mapStations: RailMapStation[];
  mapBranches: RailMapBranch[];
  lineBranchOverrides: ManualLineBranchOverride[];
  transferGroups: RailMapTransferGroup[];
  servicePatterns: ManualServicePattern[];
  trainRuns: ManualTrainRun[];
}

type MobilePanelMode = "search" | "selected" | "lines";
type DesktopPanelMode = "search" | "lines";
type RoutePointRole = "origin" | "destination";

const MIN_STATION_SEARCH_LENGTH = 1;
const MAX_LINE_SEARCH_RESULTS = 8;
const MAX_STATION_SEARCH_RESULTS = 12;
const SAME_LINE_BRANCH_CHANGE_PENALTY = 2;
const ROUTE_TRANSFER_PENALTY = 16;
const MANUAL_TRANSFER_PENALTY = 7;
const RIDE_EDGE_FALLBACK_MINUTES = 2;
const TIMETABLE_EDGE_PRIORITY_BONUS = 0.75;
const ROUTE_STOP_STEP_PENALTY = 0.03;
const FEWEST_TRANSFER_SCORE_WEIGHT = 100_000;
const ROUTE_EQUIVALENT_TIME_GAP_MINUTES = 3;
const ROUTE_DOMINANT_TIME_GAP_MINUTES = 8;

interface FilterControlsProps {
  areaCodes: string[];
  selectedArea: string;
  selectedCategory: RailLineCategory | "all";
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
  onSelectCategory: (category: RailLineCategory | "all") => void;
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
  kind: "ride" | "manual-transfer" | "timetable";
  transferMinutes?: number | null;
  departureMinutes?: number | null;
  arrivalMinutes?: number | null;
  durationMinutes?: number | null;
  distanceMeters?: number | null;
  trainNumber?: string | null;
}

interface TimetableRouteGraphEdge {
  id: string;
  fromStationId: string;
  toStationId: string;
  patternId: string;
  trainRunId?: string | null;
  serviceType: string;
  trainNumber?: string | null;
  departureMinutes?: number | null;
  arrivalMinutes?: number | null;
  durationMinutes?: number | null;
}

interface TimetableRouteGraph {
  nodes: Set<string>;
  patternEdges: TimetableRouteGraphEdge[];
  timedEdges: TimetableRouteGraphEdge[];
  edgesByStationId: Map<string, TimetableRouteGraphEdge[]>;
}

type RouteSearchCriterion = "fastest" | "fewest-transfers" | "timetable-priority";
type RouteSearchPreference = "balanced" | RouteSearchCriterion;

interface RouteSearchResult {
  stationIds: string[];
  edges: RouteGraphEdge[];
  transferCount: number;
  totalMinutes: number;
  totalDistanceMeters: number;
  criterion: RouteSearchCriterion;
  label: string;
}

interface SelectedLinePanelProps {
  selectedLine: CanonicalLine | null;
  selectedBranchId: string | null;
  selectedBranch: CanonicalBranch | null;
  servicePatterns: ManualServicePattern[];
  trainRuns: ManualTrainRun[];
  stationById: Map<string, RailMapStation>;
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

interface SelectedTransferGroupPanelProps {
  group: RailMapTransferGroup;
  stations: RailMapStation[];
  servingBranchIndex: Map<string, StationServingBranch[]>;
  routeOriginStationId: string | null;
  routeDestinationStationId: string | null;
  onSelectStation: (stationId: string) => void;
  onSetRoutePoint: (role: RoutePointRole, stationId: string) => void;
  onClear: () => void;
  compact?: boolean;
}

export default function RailExplorer({
  bundle,
  dataVersionManifest,
  mapStations,
  mapBranches,
  lineBranchOverrides,
  transferGroups,
  servicePatterns,
  trainRuns,
}: RailExplorerProps) {
  const areaCodes = useMemo(
    () => [...new Set(bundle.lines.map((line) => line.mreaWideCd))].sort(),
    [bundle.lines],
  );

  const [selectedArea, setSelectedArea] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<RailLineCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(
    null,
  );
  const [selectedTransferGroupId, setSelectedTransferGroupId] = useState<
    string | null
  >(null);
  const [routeOriginStationId, setRouteOriginStationId] = useState<
    string | null
  >(null);
  const [routeDestinationStationId, setRouteDestinationStationId] = useState<
    string | null
  >(null);
  const [routeSearchMessage, setRouteSearchMessage] = useState<string | null>(
    null,
  );
  const [routeSearchResults, setRouteSearchResults] =
    useState<RouteSearchResult[]>([]);
  const [selectedRouteResultIndex, setSelectedRouteResultIndex] = useState(0);
  const [routeSearchPreference, setRouteSearchPreference] =
    useState<RouteSearchPreference>("balanced");
  const [isHydratedFromUrl, setIsHydratedFromUrl] = useState(false);
  const [copiedShareUrl, setCopiedShareUrl] = useState(false);
  const [mapFocusVersion, setMapFocusVersion] = useState(0);
  const [showMapLines, setShowMapLines] = useState(true);
  const [showMapStations, setShowMapStations] = useState(true);
  const [mobilePanelMode, setMobilePanelMode] =
    useState<MobilePanelMode>("search");
  const [desktopPanelMode, setDesktopPanelMode] =
    useState<DesktopPanelMode>("search");
  const [isSearchResultsOpen, setIsSearchResultsOpen] = useState(false);

  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const area = params.get("area");
    const q = params.get("q");
    const category = params.get("category");
    const line = params.get("line");
    const branch = params.get("branch");
    const station = params.get("station");
    const transferGroup = params.get("transferGroup");

    if (area) setSelectedArea(area);
    if (q) setSearchQuery(q);
    if (isRailLineCategory(category)) {
      setSelectedCategory(category);
    }
    if (line) setSelectedLineKey(line);
    if (branch) setSelectedBranchId(branch);
    if (station) setSelectedStationId(station);
    if (transferGroup) setSelectedTransferGroupId(transferGroup);

    setIsHydratedFromUrl(true);
  }, []);

  useEffect(() => {
    if (!isHydratedFromUrl) return;

    const params = new URLSearchParams();

    if (selectedArea !== "all") params.set("area", selectedArea);
    if (selectedCategory !== "all") params.set("category", selectedCategory);
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (selectedLineKey) params.set("line", selectedLineKey);
    if (selectedBranchId) params.set("branch", selectedBranchId);
    if (selectedStationId) params.set("station", selectedStationId);
    if (selectedTransferGroupId)
      params.set("transferGroup", selectedTransferGroupId);

    const query = params.toString();
    const nextUrl = query
      ? `${window.location.pathname}?${query}`
      : window.location.pathname;

    window.history.replaceState(null, "", nextUrl);
  }, [
    isHydratedFromUrl,
    searchQuery,
    selectedArea,
    selectedBranchId,
    selectedCategory,
    selectedLineKey,
    selectedStationId,
    selectedTransferGroupId,
  ]);

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
              formatRailLineCategory(line.category),
              ...line.serviceTypes.map(formatRailServiceType),
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
          normalizeSearchText(
            `${station.nameKo} ${station.id} ${station.lineNameKo ?? ""}`,
          ),
        ]),
      ),
    [mapStations],
  );

  const filteredLines = useMemo(() => {
    const query = normalizeSearchText(deferredSearchQuery);
    const shouldFilterBySearch = query.length > 0;

    return sortedLines.filter((line) => {
      if (selectedArea !== "all" && line.mreaWideCd !== selectedArea)
        return false;
      if (selectedCategory !== "all" && line.category !== selectedCategory)
        return false;
      if (!shouldFilterBySearch) return true;

      return lineSearchIndex.get(line.canonicalKey)?.includes(query) ?? false;
    });
  }, [deferredSearchQuery, lineSearchIndex, selectedArea, selectedCategory, sortedLines]);

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
        exactNameMatches.length +
        similarNameMatches.length +
        metadataMatches.length;

      if (collected >= MAX_STATION_SEARCH_RESULTS * 3) break;
    }

    return [
      ...exactNameMatches,
      ...similarNameMatches,
      ...metadataMatches,
    ].slice(0, MAX_STATION_SEARCH_RESULTS);
  }, [deferredSearchQuery, mapStations, stationSearchIndex]);

  const lineSearchResults = useMemo(() => {
    const query = normalizeSearchText(deferredSearchQuery);
    if (!query) return [];

    const results: CanonicalLine[] = [];

    for (const line of sortedLines) {
      if (selectedArea !== "all" && line.mreaWideCd !== selectedArea) continue;
      if (selectedCategory !== "all" && line.category !== selectedCategory) continue;
      if (!(lineSearchIndex.get(line.canonicalKey)?.includes(query) ?? false))
        continue;

      results.push(line);

      if (results.length >= MAX_LINE_SEARCH_RESULTS) break;
    }

    return results;
  }, [deferredSearchQuery, lineSearchIndex, selectedArea, selectedCategory, sortedLines]);

  const selectedLine = useMemo(
    () =>
      bundle.lines.find((line) => line.canonicalKey === selectedLineKey) ??
      null,
    [bundle.lines, selectedLineKey],
  );

  const selectedBranch = useMemo(() => {
    if (!selectedLine || !selectedBranchId) return null;

    return (
      selectedLine.branches.find((branch) => branch.id === selectedBranchId) ??
      null
    );
  }, [selectedBranchId, selectedLine]);

  const selectedStation = useMemo(
    () =>
      mapStations.find((station) => station.id === selectedStationId) ?? null,
    [mapStations, selectedStationId],
  );
  const stationById = useMemo(
    () => new Map(mapStations.map((station) => [station.id, station])),
    [mapStations],
  );

  const selectedTransferGroup = useMemo(
    () =>
      transferGroups.find((group) => group.id === selectedTransferGroupId) ??
      null,
    [selectedTransferGroupId, transferGroups],
  );

  const selectedTransferGroupStations = useMemo(
    () =>
      selectedTransferGroup
        ? selectedTransferGroup.stationIds
            .map((stationId) => stationById.get(stationId))
            .filter((station): station is RailMapStation => Boolean(station))
        : [],
    [selectedTransferGroup, stationById],
  );

  const routeOriginStation = useMemo(
    () =>
      mapStations.find((station) => station.id === routeOriginStationId) ??
      null,
    [mapStations, routeOriginStationId],
  );

  const routeDestinationStation = useMemo(
    () =>
      mapStations.find((station) => station.id === routeDestinationStationId) ??
      null,
    [mapStations, routeDestinationStationId],
  );

  const activeRouteSearchResult = routeSearchResults[selectedRouteResultIndex] ?? routeSearchResults[0] ?? null;

  const routeGraph = useMemo(
    () =>
      buildRouteGraph(
        bundle.lines,
        bundle.manualTransferEdges ?? [],
        lineBranchOverrides,
        servicePatterns,
        trainRuns,
        mapBranches,
      ),
    [bundle.lines, bundle.manualTransferEdges, lineBranchOverrides, servicePatterns, trainRuns, mapBranches],
  );
  const routeResultStationIds = useMemo(
    () => activeRouteSearchResult?.stationIds ?? [],
    [activeRouteSearchResult],
  );

  const routeResultBranchIds = useMemo(
    () => activeRouteSearchResult?.edges.map((edge) => edge.branchId) ?? [],
    [activeRouteSearchResult],
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
          lastStopName:
            branch.routeStops[branch.routeStops.length - 1]?.displayNameKo ??
            "-",
        };

        const items = index.get(stationId);
        if (items) {
          items.push(item);
        } else {
          index.set(stationId, [item]);
        }
      }
    }

    return index;
  }, [mapBranches]);

  const selectedStationServingBranches = useMemo<StationServingBranch[]>(
    () =>
      selectedStationId
        ? (stationServingIndex.get(selectedStationId) ?? [])
        : [],
    [selectedStationId, stationServingIndex],
  );

  useEffect(() => {
    if (!selectedLineKey) return;
    if (bundle.lines.some((line) => line.canonicalKey === selectedLineKey))
      return;

    setSelectedLineKey(null);
    setSelectedBranchId(null);
  }, [bundle.lines, selectedLineKey]);

  useEffect(() => {
    if (!selectedLine || !selectedBranchId) return;
    if (selectedLine.branches.some((branch) => branch.id === selectedBranchId))
      return;

    setSelectedBranchId(null);
  }, [selectedBranchId, selectedLine]);

  useEffect(() => {
    if (!selectedStationId) return;
    if (mapStations.some((station) => station.id === selectedStationId)) return;

    setSelectedStationId(null);
  }, [mapStations, selectedStationId]);

  useEffect(() => {
    if (!selectedTransferGroupId) return;
    if (transferGroups.some((group) => group.id === selectedTransferGroupId))
      return;

    setSelectedTransferGroupId(null);
  }, [selectedTransferGroupId, transferGroups]);

  useEffect(() => {
    if (
      routeOriginStationId &&
      !mapStations.some((station) => station.id === routeOriginStationId)
    ) {
      setRouteOriginStationId(null);
    }

    if (
      routeDestinationStationId &&
      !mapStations.some((station) => station.id === routeDestinationStationId)
    ) {
      setRouteDestinationStationId(null);
    }
  }, [mapStations, routeDestinationStationId, routeOriginStationId]);

  useEffect(() => {
    if (
      selectedLineKey ||
      selectedBranchId ||
      selectedStationId ||
      selectedTransferGroupId
    ) {
      setMobilePanelMode("selected");
    }
  }, [
    selectedBranchId,
    selectedLineKey,
    selectedStationId,
    selectedTransferGroupId,
  ]);

  useEffect(() => {
    if (searchQuery.trim()) {
      setMobilePanelMode("search");
    }
  }, [searchQuery]);

  const visibleLineKeys = useMemo(
    () =>
      new Set(
        sortedLines
          .filter(
            (line) =>
              selectedArea === "all" || line.mreaWideCd === selectedArea,
          )
          .map((line) => line.canonicalKey),
      ),
    [selectedArea, sortedLines],
  );

  const visibleMapBranches = useMemo(
    () =>
      mapBranches.filter((branch) =>
        visibleLineKeys.has(branch.canonicalLineId),
      ),
    [mapBranches, visibleLineKeys],
  );

  const visibleStationIds = useMemo(() => {
    const ids = new Set<string>();

    for (const branch of visibleMapBranches) {
      for (const stop of branch.routeStops) {
        if (stop.station?.id) ids.add(stop.station.id);
      }
    }

    for (const stationId of activeRouteSearchResult?.stationIds ?? []) {
      ids.add(stationId);
    }

    return ids;
  }, [activeRouteSearchResult, visibleMapBranches]);

  const visibleMapStations = useMemo(
    () => mapStations.filter((station) => visibleStationIds.has(station.id)),
    [mapStations, visibleStationIds],
  );

  const resetFilters = () => {
    setSelectedArea("all");
    setSelectedCategory("all");
    setSearchQuery("");
    setIsSearchResultsOpen(false);
    setSelectedLineKey(null);
    setSelectedBranchId(null);
    setSelectedStationId(null);
    setSelectedTransferGroupId(null);
    setRouteOriginStationId(null);
    setRouteDestinationStationId(null);
    setRouteSearchMessage(null);
    setDesktopPanelMode("search");
  };

  const clearSelection = () => {
    setSelectedLineKey(null);
    setSelectedBranchId(null);
    setSelectedStationId(null);
    setSelectedTransferGroupId(null);
    setMobilePanelMode("lines");
    setDesktopPanelMode("lines");
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
    setRouteSearchResults([]);
    setSelectedRouteResultIndex(0);
    setSelectedStationId(stationId);
    setSelectedTransferGroupId(null);
    setMobilePanelMode("selected");
  };

  const clearRoutePoint = (role: RoutePointRole) => {
    if (role === "origin") {
      setRouteOriginStationId(null);
    } else {
      setRouteDestinationStationId(null);
    }

    setRouteSearchMessage(null);
    setRouteSearchResults([]);
    setSelectedRouteResultIndex(0);
  };

  const swapRoutePoints = () => {
    setRouteOriginStationId(routeDestinationStationId);
    setRouteDestinationStationId(routeOriginStationId);
    setRouteSearchMessage(null);
    setRouteSearchResults([]);
    setSelectedRouteResultIndex(0);
    setMobilePanelMode("selected");
  };

  const changeRouteSearchPreference = (preference: RouteSearchPreference) => {
    setRouteSearchPreference(preference);
    setRouteSearchResults([]);
    setSelectedRouteResultIndex(0);
    setRouteSearchMessage(null);
  };

  const submitRouteSearch = () => {
    if (!routeOriginStationId || !routeDestinationStationId) {
      setRouteSearchResults([]);
      setSelectedRouteResultIndex(0);
      setRouteSearchMessage("출발역과 도착역을 모두 지정해 주세요.");
      setMobilePanelMode("selected");
      setMapFocusVersion((version) => version + 1);
      return;
    }

    if (routeOriginStationId === routeDestinationStationId) {
      setRouteSearchResults([]);
      setSelectedRouteResultIndex(0);
      setRouteSearchMessage(
        "출발역과 도착역이 같습니다. 다른 역을 선택해 주세요.",
      );
      setMobilePanelMode("selected");
      setMapFocusVersion((version) => version + 1);
      return;
    }

    const results = findRouteResults(
      routeGraph,
      routeOriginStationId,
      routeDestinationStationId,
      routeSearchPreference,
    );

    if (results.length === 0) {
      setRouteSearchResults([]);
      setSelectedRouteResultIndex(0);
      setRouteSearchMessage(
        "경로를 찾지 못했습니다. 현재 정적 노선 데이터에서 두 역을 연결할 수 없습니다.",
      );
      setMobilePanelMode("selected");
      setMapFocusVersion((version) => version + 1);
      return;
    }

    setSelectedStationId(null);
    setSelectedTransferGroupId(null);
    setRouteSearchResults(results);
    setSelectedRouteResultIndex(0);
    setRouteSearchMessage(null);
    setMobilePanelMode("selected");
    setMapFocusVersion((version) => version + 1);
  };

  const focusSelection = () => {
    setMapFocusVersion((version) => version + 1);
  };

  const hasSelection = Boolean(
    selectedLineKey ||
    selectedBranchId ||
    selectedStationId ||
    selectedTransferGroupId,
  );
  const focusSelectionLabel = selectedTransferGroupId
    ? "환승역 보기"
    : selectedStationId
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
    setSelectedTransferGroupId(null);
    setMobilePanelMode("lines");
  };

  const selectCategory = (category: RailLineCategory | "all") => {
    setSelectedCategory(category);
    setSelectedLineKey(null);
    setSelectedBranchId(null);
    setSelectedStationId(null);
    setSelectedTransferGroupId(null);
    setMobilePanelMode("lines");
  };

  const search = (query: string) => {
    setSearchQuery(query);
    setIsSearchResultsOpen(Boolean(query.trim()));
    setMobilePanelMode(query.trim() ? "search" : "lines");
    setDesktopPanelMode("search");
  };

  const selectLine = (lineKey: string) => {
    setSelectedLineKey(lineKey);
    setSelectedBranchId(null);
    setSelectedStationId(null);
    setSelectedTransferGroupId(null);
    setIsSearchResultsOpen(false);
    setMobilePanelMode("selected");
    setDesktopPanelMode("lines");
  };

  const selectMapBranch = (branch: RailMapBranch) => {
    setSelectedLineKey(branch.canonicalLineId);
    setSelectedBranchId(branch.id);
    setSelectedStationId(null);
    setSelectedTransferGroupId(null);
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
    setSelectedStationId(station.id);
    setSelectedTransferGroupId(null);
    setIsSearchResultsOpen(false);
    setMobilePanelMode("selected");
  };

  const selectMapTransferGroup = (group: RailMapTransferGroup) => {
    setSelectedTransferGroupId(group.id);
    setSelectedStationId(null);
    setSelectedLineKey(null);
    setSelectedBranchId(null);
    setIsSearchResultsOpen(false);
    setMobilePanelMode("selected");
  };

  const selectStationFromSearch = (stationId: string) => {
    setSelectedStationId(stationId);
    setSelectedTransferGroupId(null);
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
          <DataVersionBadge manifest={dataVersionManifest} />
          <DesktopPanelTabs
            activeMode={desktopPanelMode}
            resultCount={stationSearchResults.length + lineSearchResults.length}
            lineCount={filteredLines.length}
            onChange={setDesktopPanelMode}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {desktopPanelMode === "search" ? (
            <div className="h-full overflow-y-auto p-2">
              <FilterControls
                areaCodes={areaCodes}
                selectedArea={selectedArea}
                selectedCategory={selectedCategory}
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
                onToggleMapStations={() =>
                  setShowMapStations((value) => !value)
                }
                onSelectArea={selectArea}
                onSelectCategory={selectCategory}
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
          ) : null}

          {desktopPanelMode === "lines" ? (
            <LineList
              lines={filteredLines}
              selectedLineKey={selectedLineKey}
              onSelectLine={selectLine}
            />
          ) : null}
        </div>
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
          transferGroups={transferGroups}
          lineBranchOverrides={lineBranchOverrides}
          selectedTransferGroupId={selectedTransferGroupId}
          focusVersion={mapFocusVersion}
          showBranches={showMapLines}
          showStations={showMapStations}
          onSelectBranch={selectMapBranch}
          onSelectStation={selectMapStation}
          onSelectTransferGroup={selectMapTransferGroup}
          onClearStation={() => {
            setSelectedStationId(null);
            setSelectedTransferGroupId(null);
          }}
        />

        <MapStatusHud
          visibleBranchCount={visibleMapBranches.length}
          visibleStationCount={visibleMapStations.length}
          transferGroupCount={transferGroups.length}
          showMapLines={showMapLines}
          showMapStations={showMapStations}
          hasSelection={hasSelection}
          copiedShareUrl={copiedShareUrl}
          focusSelectionLabel={focusSelectionLabel}
          onToggleMapLines={() => setShowMapLines((value) => !value)}
          onToggleMapStations={() => setShowMapStations((value) => !value)}
          onFocusSelection={focusSelection}
          onClearSelection={clearSelection}
          onCopyUrl={copyUrl}
        />

        {selectedLine ||
        selectedStation ||
        selectedTransferGroup ||
        routeOriginStation ||
        routeDestinationStation ? (
          <div className="pointer-events-none absolute right-3 top-3 z-10 hidden w-[280px] max-w-[calc(100vw-24px)] lg:block">
            <div className="pointer-events-auto grid min-w-0 w-full max-w-full max-h-[calc(100dvh-24px)] gap-2 overflow-x-hidden overflow-y-auto [overflow-wrap:anywhere] rounded-2xl border border-white/70 bg-white/95 p-2 shadow-xl shadow-slate-950/12 backdrop-blur">
              {routeOriginStation || routeDestinationStation ? (
                <RouteDraftCard
                  originStation={routeOriginStation}
                  destinationStation={routeDestinationStation}
                  message={routeSearchMessage}
                  results={routeSearchResults}
                  activeResultIndex={selectedRouteResultIndex}
                  stationById={stationById}
                  allStations={mapStations}
                  onSelectResult={setSelectedRouteResultIndex}
                  routeSearchPreference={routeSearchPreference}
                  onRouteSearchPreferenceChange={changeRouteSearchPreference}
                  onSetRoutePoint={setRoutePoint}
                  onClearOrigin={() => clearRoutePoint("origin")}
                  onClearDestination={() => clearRoutePoint("destination")}
                  onSwap={swapRoutePoints}
                  onSubmit={submitRouteSearch}
                />
              ) : null}

              {selectedTransferGroup ? (
                <SelectedTransferGroupPanel
                  group={selectedTransferGroup}
                  stations={selectedTransferGroupStations}
                  servingBranchIndex={stationServingIndex}
                  routeOriginStationId={routeOriginStationId}
                  routeDestinationStationId={routeDestinationStationId}
                  onSelectStation={selectStationFromSearch}
                  onSetRoutePoint={setRoutePoint}
                  onClear={() => setSelectedTransferGroupId(null)}
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
                  servicePatterns={servicePatterns}
                  trainRuns={trainRuns}
                  stationById={stationById}
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
              <DataVersionBadge manifest={dataVersionManifest} compact />
              <MobilePanelTabs
                activeMode={mobilePanelMode}
                hasSelection={hasSelection}
                resultCount={
                  stationSearchResults.length + lineSearchResults.length
                }
                lineCount={filteredLines.length}
                onChange={setMobilePanelMode}
              />
            </div>

            <div className="max-h-[calc(56dvh-82px)] overflow-y-auto px-2.5 pb-4 pt-2">
              {mobilePanelMode === "search" ? (
                <FilterControls
                  areaCodes={areaCodes}
                  selectedArea={selectedArea}
                  selectedCategory={selectedCategory}
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
                  onToggleMapStations={() =>
                    setShowMapStations((value) => !value)
                  }
                  onSelectArea={selectArea}
                  onSelectCategory={selectCategory}
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
                      results={routeSearchResults}
                      activeResultIndex={selectedRouteResultIndex}
                      stationById={stationById}
                      allStations={mapStations}
                      onSelectResult={setSelectedRouteResultIndex}
                      routeSearchPreference={routeSearchPreference}
                      onRouteSearchPreferenceChange={changeRouteSearchPreference}
                      onSetRoutePoint={setRoutePoint}
                      onClearOrigin={() => clearRoutePoint("origin")}
                      onClearDestination={() => clearRoutePoint("destination")}
                      onSwap={swapRoutePoints}
                      onSubmit={submitRouteSearch}
                      compact
                    />
                  ) : null}

                  {selectedTransferGroup ? (
                    <SelectedTransferGroupPanel
                      group={selectedTransferGroup}
                      stations={selectedTransferGroupStations}
                      servingBranchIndex={stationServingIndex}
                      routeOriginStationId={routeOriginStationId}
                      routeDestinationStationId={routeDestinationStationId}
                      onSelectStation={selectStationFromSearch}
                      onSetRoutePoint={setRoutePoint}
                      onClear={() => setSelectedTransferGroupId(null)}
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
                    servicePatterns={servicePatterns}
                    trainRuns={trainRuns}
                    stationById={stationById}
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


function MapStatusHud({
  visibleBranchCount,
  visibleStationCount,
  transferGroupCount,
  showMapLines,
  showMapStations,
  hasSelection,
  copiedShareUrl,
  focusSelectionLabel,
  onToggleMapLines,
  onToggleMapStations,
  onFocusSelection,
  onClearSelection,
  onCopyUrl,
}: {
  visibleBranchCount: number;
  visibleStationCount: number;
  transferGroupCount: number;
  showMapLines: boolean;
  showMapStations: boolean;
  hasSelection: boolean;
  copiedShareUrl: boolean;
  focusSelectionLabel: string;
  onToggleMapLines: () => void;
  onToggleMapStations: () => void;
  onFocusSelection: () => void;
  onClearSelection: () => void;
  onCopyUrl: () => void;
}) {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 hidden max-w-[calc(100vw-24px)] lg:block">
      <div className="pointer-events-auto flex max-w-[560px] flex-wrap items-center gap-1.5 rounded-2xl border border-white/70 bg-white/92 px-2 py-2 shadow-xl shadow-slate-950/10 backdrop-blur">
        <div className="mr-1 grid gap-0.5 px-1">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-600">
            Live map
          </p>
          <p className="text-[11px] font-bold text-slate-700">
            {formatNumber(visibleBranchCount)}구간 · {formatNumber(visibleStationCount)}역 · 환승 {formatNumber(transferGroupCount)}
          </p>
        </div>
        <HudToggle active={showMapLines} onClick={onToggleMapLines}>
          노선
        </HudToggle>
        <HudToggle active={showMapStations} onClick={onToggleMapStations}>
          역
        </HudToggle>
        {hasSelection ? (
          <>
            <button
              type="button"
              className="h-7 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 active:scale-[0.99]"
              onClick={onFocusSelection}
            >
              {focusSelectionLabel}
            </button>
            <button
              type="button"
              className="h-7 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-500 transition hover:bg-slate-50 active:scale-[0.99]"
              onClick={onClearSelection}
            >
              해제
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="h-7 rounded-full bg-slate-950 px-2.5 text-[11px] font-bold text-white transition hover:bg-slate-800 active:scale-[0.99]"
          onClick={onCopyUrl}
        >
          {copiedShareUrl ? "복사됨" : "공유"}
        </button>
      </div>
    </div>
  );
}

function HudToggle({
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
          ? "h-7 rounded-full border border-sky-200 bg-sky-50 px-2.5 text-[11px] font-black text-sky-700"
          : "h-7 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-500 transition hover:bg-slate-50"
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function DesktopPanelTabs({
  activeMode,
  resultCount,
  lineCount,
  onChange,
}: {
  activeMode: DesktopPanelMode;
  resultCount: number;
  lineCount: number;
  onChange: (mode: DesktopPanelMode) => void;
}) {
  const items: Array<{
    mode: DesktopPanelMode;
    label: string;
    badge?: number;
  }> = [
    { mode: "search", label: "검색", badge: resultCount || undefined },
    { mode: "lines", label: "노선 목록", badge: lineCount },
  ];

  return (
    <div className="mt-2 grid grid-cols-2 gap-1 rounded bg-slate-100 p-0.5">
      {items.map((item) => {
        const active = activeMode === item.mode;

        return (
          <button
            key={item.mode}
            type="button"
            className={
              active
                ? "h-7 rounded bg-white px-2 text-[11px] font-bold text-slate-950 shadow-sm"
                : "h-7 rounded px-2 text-[11px] font-semibold text-slate-500 hover:bg-white/70"
            }
            onClick={() => onChange(item.mode)}
          >
            {item.label}
            {item.badge ? (
              <span className="ml-1 text-[10px] text-slate-400">
                {formatNumber(item.badge)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
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
  const items: Array<{
    mode: MobilePanelMode;
    label: string;
    badge?: number;
    disabled?: boolean;
  }> = [
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
            {item.badge ? (
              <span className="ml-1 text-[10px] text-slate-400">
                {formatNumber(item.badge)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function DataVersionBadge({
  manifest,
  compact = false,
}: {
  manifest: PublicDataVersionManifest | null;
  compact?: boolean;
}) {
  const bundleGeneratedAt = manifest?.versions?.bundle?.generatedAt ?? manifest?.generatedAt ?? null;
  const label = manifest
    ? `데이터 ${manifest.acquiredDate ?? manifest.versions?.bundle?.acquiredDate ?? "버전 확인"}`
    : "데이터 버전 없음";
  const title = bundleGeneratedAt
    ? `bundle generatedAt: ${bundleGeneratedAt}`
    : "data-version.json을 찾지 못했습니다.";

  return (
    <div className={compact ? "mt-1" : "mt-2"}>
      <span
        className="inline-flex max-w-full items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500"
        title={title}
      >
        {label}
      </span>
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
      <p className="text-[10px] font-bold tracking-[0.14em] text-sky-600 uppercase">
        Korea Rail Map
      </p>
      <h1
        className={
          compact
            ? "mt-0.5 text-[13px] font-bold"
            : "mt-1 text-[13px] font-bold"
        }
      >
        철도 노선 지도
      </h1>
      <p className="mt-1 text-[11px] leading-4 text-slate-500">
        {formatNumber(filteredLineCount)}개 노선 ·{" "}
        {formatNumber(visibleBranchCount)}개 구간 · 지도 역{" "}
        {formatNumber(visibleStationCount)}개
      </p>
    </div>
  );
}

function FilterControls({
  areaCodes,
  selectedArea,
  selectedCategory,
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
  onSelectCategory,
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
        <FilterChip
          active={selectedArea === "all"}
          onClick={() => onSelectArea("all")}
        >
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

      <div className="flex flex-wrap gap-1.5">
        <FilterChip
          active={selectedCategory === "all"}
          onClick={() => onSelectCategory("all")}
        >
          전체 유형
        </FilterChip>
        {RAIL_LINE_CATEGORIES.map((category) => (
          <FilterChip
            key={category}
            active={selectedCategory === category}
            onClick={() => onSelectCategory(category)}
          >
            {formatRailLineCategory(category)}
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

function HighlightText({
  text,
  query,
}: {
  text: string;
  query: string;
}): ReactNode {
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
      <mark className="rounded-sm bg-amber-100 px-0.5 font-black text-amber-900">
        {match}
      </mark>
      {after}
    </>
  );
}

function SearchResults({
  query,
  selectedStationId,
  stations,
  lines,
  selectedLineKey,
  onSelectStation,
  onSelectLine,
}: {
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

  if (
    normalizedQuery.length < MIN_STATION_SEARCH_LENGTH &&
    stations.length === 0 &&
    lines.length === 0
  ) {
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
            <p className="text-[10px] font-bold tracking-wide text-slate-400 uppercase">
              노선
            </p>
            <p className="text-[10px] font-semibold text-slate-400">
              상위 {formatNumber(lines.length)}개
            </p>
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
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: line.colorHex }}
                    />
                    <span className="truncate">
                      <HighlightText text={line.nameKo} query={query} />
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[10px] font-medium text-slate-400">
                    {formatAreaName(line.mreaWideCd)} ·{" "}
                    {formatNumber(countRouteStops(line))}역
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
            <p className="text-[10px] font-bold tracking-wide text-slate-400 uppercase">
              역
            </p>
            <p className="text-[10px] font-semibold text-slate-400">
              상위 {formatNumber(stations.length)}개
            </p>
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
                  <span className="block truncate">
                    <HighlightText text={station.nameKo} query={query} />
                  </span>
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

function LineList({
  lines,
  selectedLineKey,
  onSelectLine,
  compact = false,
}: LineListProps & { compact?: boolean }) {
  if (lines.length === 0) {
    return (
      <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
        <p className="text-xs font-semibold text-slate-900">검색 결과 없음</p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          검색어 또는 권역 필터를 조정하세요.
        </p>
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

function LineCard({
  line,
  selected,
  onClick,
}: {
  line: CanonicalLine;
  selected: boolean;
  onClick: () => void;
}) {
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
            <p className="truncate text-[13px] font-bold text-slate-950">
              {line.nameKo}
            </p>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            {formatRailLineCategory(line.category)} · {line.serviceTypes.map(formatRailServiceType).join("/")} · 구간 {line.branches.length}개 · 정차역{" "}
            {formatNumber(countRouteStops(line))}개
          </p>
        </div>

        <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {formatAreaName(line.mreaWideCd)}
        </span>
        <span className="shrink-0 rounded bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
          {formatRailLineCategory(line.category)}
        </span>
      </div>
    </button>
  );
}

interface TrainPerformanceProfile {
  accelerationMps2: number;
  decelerationMps2: number;
  maxSpeedKph: number;
}

const DEFAULT_TRAIN_PERFORMANCE_BY_SERVICE: Partial<Record<RailServiceType, TrainPerformanceProfile>> = {
  subway: { accelerationMps2: 0.8, decelerationMps2: 0.9, maxSpeedKph: 80 },
  gtx: { accelerationMps2: 0.9, decelerationMps2: 1.0, maxSpeedKph: 180 },
  airport_rail: { accelerationMps2: 0.65, decelerationMps2: 0.75, maxSpeedKph: 110 },
  ktx: { accelerationMps2: 0.45, decelerationMps2: 0.55, maxSpeedKph: 300 },
  srt: { accelerationMps2: 0.45, decelerationMps2: 0.55, maxSpeedKph: 300 },
  itx: { accelerationMps2: 0.55, decelerationMps2: 0.65, maxSpeedKph: 180 },
  saemaeul: { accelerationMps2: 0.5, decelerationMps2: 0.6, maxSpeedKph: 150 },
  mugunghwa: { accelerationMps2: 0.45, decelerationMps2: 0.55, maxSpeedKph: 120 },
  nuriro: { accelerationMps2: 0.55, decelerationMps2: 0.65, maxSpeedKph: 120 },
};

function getFallbackTrainPerformanceProfile(line: CanonicalLine): TrainPerformanceProfile {
  for (const serviceType of line.serviceTypes ?? []) {
    const profile = DEFAULT_TRAIN_PERFORMANCE_BY_SERVICE[serviceType];
    if (profile) return profile;
  }

  if (line.category === "high_speed_rail") return { accelerationMps2: 0.45, decelerationMps2: 0.55, maxSpeedKph: 300 };
  if (line.category === "gtx") return { accelerationMps2: 0.9, decelerationMps2: 1.0, maxSpeedKph: 180 };
  if (line.category === "conventional_rail") return { accelerationMps2: 0.45, decelerationMps2: 0.55, maxSpeedKph: 120 };
  return { accelerationMps2: 0.8, decelerationMps2: 0.9, maxSpeedKph: 80 };
}

function getTrainPerformanceProfile(line: CanonicalLine): TrainPerformanceProfile {
  const fallback = getFallbackTrainPerformanceProfile(line);
  const override = line.trainPerformance;
  return {
    accelerationMps2: typeof override?.accelerationMps2 === "number" && override.accelerationMps2 > 0 ? override.accelerationMps2 : fallback.accelerationMps2,
    decelerationMps2: typeof override?.decelerationMps2 === "number" && override.decelerationMps2 > 0 ? override.decelerationMps2 : fallback.decelerationMps2,
    maxSpeedKph: typeof override?.maxSpeedKph === "number" && override.maxSpeedKph > 0 ? override.maxSpeedKph : fallback.maxSpeedKph,
  };
}

function calculateRideDurationMinutes(distanceMeters: number | null, profile: TrainPerformanceProfile): number | null {
  if (!distanceMeters || distanceMeters <= 0) return null;
  const acceleration = Math.max(0.05, profile.accelerationMps2);
  const deceleration = Math.max(0.05, profile.decelerationMps2);
  const maxSpeedMps = Math.max(1, profile.maxSpeedKph / 3.6);
  const accelDistance = (maxSpeedMps * maxSpeedMps) / (2 * acceleration);
  const decelDistance = (maxSpeedMps * maxSpeedMps) / (2 * deceleration);

  let seconds: number;
  if (distanceMeters >= accelDistance + decelDistance) {
    seconds = maxSpeedMps / acceleration + maxSpeedMps / deceleration + (distanceMeters - accelDistance - decelDistance) / maxSpeedMps;
  } else {
    const peakSpeed = Math.sqrt((2 * distanceMeters * acceleration * deceleration) / (acceleration + deceleration));
    seconds = peakSpeed / acceleration + peakSpeed / deceleration;
  }

  return Math.max(1, Math.ceil(seconds / 60));
}

function distanceLngLatMeters(left: [number, number], right: [number, number]) {
  const lat = ((left[1] + right[1]) / 2) * Math.PI / 180;
  const dx = (right[0] - left[0]) * 111_320 * Math.cos(lat);
  const dy = (right[1] - left[1]) * 110_540;
  return Math.sqrt(dx * dx + dy * dy);
}

function nearestCoordinateIndex(coordinates: Array<[number, number]>, target: [number, number]) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < coordinates.length; index += 1) {
    const distance = distanceLngLatMeters(coordinates[index] ?? target, target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function estimateBranchSegmentDistanceMeters(branch: RailMapBranch | undefined, fromStationId: string, toStationId: string): number | null {
  const fromStop = branch?.routeStops.find((stop) => stop.station?.id === fromStationId);
  const toStop = branch?.routeStops.find((stop) => stop.station?.id === toStationId);
  const fromStation = fromStop?.station;
  const toStation = toStop?.station;
  if (typeof fromStation?.lng !== "number" || typeof fromStation.lat !== "number" || typeof toStation?.lng !== "number" || typeof toStation.lat !== "number") return null;

  const fallbackDistance = distanceLngLatMeters([fromStation.lng, fromStation.lat], [toStation.lng, toStation.lat]);
  const coordinates = branch?.geometryOverrideCoordinates;
  if (!coordinates || coordinates.length < 2) return fallbackDistance;

  const fromIndex = nearestCoordinateIndex(coordinates, [fromStation.lng, fromStation.lat]);
  const toIndex = nearestCoordinateIndex(coordinates, [toStation.lng, toStation.lat]);
  if (fromIndex === toIndex) return fallbackDistance;

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  let total = 0;
  for (let index = start; index < end; index += 1) {
    const current = coordinates[index];
    const next = coordinates[index + 1];
    if (!current || !next) continue;
    total += distanceLngLatMeters(current, next);
  }

  return total > 0 ? total : fallbackDistance;
}

function buildRouteGraph(
  lines: CanonicalLine[],
  manualTransferEdges: ManualTransferEdge[] = [],
  lineBranchOverrides: ManualLineBranchOverride[] = [],
  servicePatterns: ManualServicePattern[] = [],
  trainRuns: ManualTrainRun[] = [],
  mapBranches: RailMapBranch[] = [],
): Map<string, RouteGraphEdge[]> {
  const graph = new Map<string, RouteGraphEdge[]>();
  const branchContextById = new Map<
    string,
    { branch: CanonicalBranch; line: CanonicalLine }
  >();
  const mapBranchById = new Map(mapBranches.map((branch) => [branch.id, branch]));

  const addEdge = (fromStationId: string, edge: RouteGraphEdge) => {
    const edges = graph.get(fromStationId) ?? [];
    edges.push(edge);
    graph.set(fromStationId, edges);
  };

  for (const line of lines) {
    for (const branch of line.branches) {
      branchContextById.set(branch.id, { branch, line });

      for (let index = 0; index < branch.routeStops.length - 1; index += 1) {
        const current = branch.routeStops[index];
        const next = branch.routeStops[index + 1];

        if (
          !current?.stationId ||
          !next?.stationId ||
          current.stationId === next.stationId
        )
          continue;

        const distanceMeters = estimateBranchSegmentDistanceMeters(
          mapBranchById.get(branch.id),
          current.stationId,
          next.stationId,
        );
        const durationMinutes = calculateRideDurationMinutes(
          distanceMeters,
          getTrainPerformanceProfile(line),
        );
        const edge: Omit<RouteGraphEdge, "toStationId"> = {
          branchId: branch.id,
          lineNameKo: line.nameKo,
          sourceLineName: branch.sourceLineName,
          colorHex: line.colorHex,
          kind: "ride",
          durationMinutes,
          distanceMeters,
        };

        addEdge(current.stationId, { ...edge, toStationId: next.stationId });
        addEdge(next.stationId, { ...edge, toStationId: current.stationId });
      }
    }
  }

  for (const override of lineBranchOverrides) {
    if (override.enabled === false) continue;

    const parentContext = branchContextById.get(override.parentBranchId);
    if (!parentContext || !override.anchorStationId) continue;

    const targetStationId =
      override.mode === "add-station"
        ? override.branchStationId
        : override.connectedEndpointStationId;
    if (!targetStationId || targetStationId === override.anchorStationId)
      continue;

    const edge: Omit<RouteGraphEdge, "toStationId"> = {
      branchId: override.id,
      lineNameKo: parentContext.line.nameKo,
      sourceLineName:
        override.mode === "connect-line"
          ? "지선 노선 결합"
          : parentContext.branch.sourceLineName,
      colorHex: parentContext.line.colorHex,
      kind: "ride",
    };
    const geometryStationIds = (override.geometry ?? [])
      .map((point) =>
        point.kind === "station" && point.stationId ? point.stationId : null,
      )
      .filter((stationId): stationId is string => Boolean(stationId));
    const stationIds =
      geometryStationIds.length >= 2
        ? geometryStationIds
        : [override.anchorStationId, targetStationId];

    for (let index = 0; index < stationIds.length - 1; index += 1) {
      const fromStationId = stationIds[index];
      const toStationId = stationIds[index + 1];
      if (!fromStationId || !toStationId || fromStationId === toStationId)
        continue;

      addEdge(fromStationId, {
        ...edge,
        toStationId,
      });
      addEdge(toStationId, {
        ...edge,
        toStationId: fromStationId,
      });
    }
  }

  for (const transfer of manualTransferEdges) {
    if (!transfer.enabled) continue;
    if (
      !transfer.fromStationId ||
      !transfer.toStationId ||
      transfer.fromStationId === transfer.toStationId
    )
      continue;

    const baseEdge: Omit<RouteGraphEdge, "toStationId"> = {
      branchId: `manual-transfer:${transfer.id}`,
      lineNameKo: transfer.labelKo ?? "환승",
      sourceLineName: "환승",
      colorHex: "#64748b",
      kind: "manual-transfer",
      transferMinutes: transfer.transferMinutes ?? null,
    };

    addEdge(transfer.fromStationId, {
      ...baseEdge,
      toStationId: transfer.toStationId,
    });

    if (transfer.bidirectional !== false) {
      addEdge(transfer.toStationId, {
        ...baseEdge,
        toStationId: transfer.fromStationId,
      });
    }
  }

  const patternById = new Map(servicePatterns.map((pattern) => [pattern.id, pattern]));
  for (const timedEdge of buildTimetableRouteGraph(servicePatterns, trainRuns).timedEdges) {
    const pattern = patternById.get(timedEdge.patternId);
    const line = pattern?.lineId
      ? lines.find((candidate) => candidate.id === pattern.lineId || candidate.canonicalKey === pattern.lineId)
      : null;
    addEdge(timedEdge.fromStationId, {
      toStationId: timedEdge.toStationId,
      branchId: `timetable:${timedEdge.trainRunId ?? timedEdge.patternId}`,
      lineNameKo: line?.nameKo ?? formatRailServiceType(timedEdge.serviceType as RailServiceType),
      sourceLineName: timedEdge.trainNumber ? `열차 ${timedEdge.trainNumber}` : "시간표",
      colorHex: line?.colorHex ?? "#2563eb",
      kind: "timetable",
      departureMinutes: timedEdge.departureMinutes ?? null,
      arrivalMinutes: timedEdge.arrivalMinutes ?? null,
      durationMinutes: timedEdge.durationMinutes ?? null,
      trainNumber: timedEdge.trainNumber ?? null,
    });
  }

  return graph;
}

function findRouteResults(
  graph: Map<string, RouteGraphEdge[]>,
  originStationId: string,
  destinationStationId: string,
  preference: RouteSearchPreference = "balanced",
): RouteSearchResult[] {
  const criteria: RouteSearchCriterion[] =
    preference === "balanced"
      ? ["fastest", "fewest-transfers"]
      : [preference];
  const results = criteria
    .map((criterion) => findRoute(graph, originStationId, destinationStationId, criterion))
    .filter((result): result is RouteSearchResult => result !== null);
  const deduped: RouteSearchResult[] = [];
  const signatures = new Set<string>();

  for (const result of results) {
    const signature = `${result.stationIds.join(">")}|${result.edges.map((edge) => `${edge.kind}:${edge.branchId}:${edge.toStationId}`).join(">")}`;
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    deduped.push(result);
  }

  if (deduped.length <= 1) return deduped;

  const [first, second] = deduped;
  if (first && second) {
    const minutesGap = Math.abs(first.totalMinutes - second.totalMinutes);
    const transferGap = Math.abs(first.transferCount - second.transferCount);
    if (transferGap === 0 && minutesGap <= ROUTE_EQUIVALENT_TIME_GAP_MINUTES) {
      return [first.totalMinutes <= second.totalMinutes ? first : second];
    }
    if (isClearlyDominantRoute(first, second)) return [first];
    if (isClearlyDominantRoute(second, first)) return [second];
  }

  return deduped.slice(0, 2).sort(
    (a, b) =>
      a.transferCount - b.transferCount ||
      a.totalMinutes - b.totalMinutes ||
      a.stationIds.length - b.stationIds.length,
  );
}

function getRouteEdgeDurationMinutes(edge: RouteGraphEdge): number {
  if (edge.kind === "manual-transfer") {
    return Math.max(1, edge.transferMinutes ?? MANUAL_TRANSFER_PENALTY);
  }

  if (typeof edge.durationMinutes === "number" && Number.isFinite(edge.durationMinutes) && edge.durationMinutes > 0) {
    return Math.max(0.5, edge.durationMinutes);
  }

  if (edge.kind === "ride") return RIDE_EDGE_FALLBACK_MINUTES;
  return 1;
}

function isClearlyDominantRoute(left: RouteSearchResult, right: RouteSearchResult): boolean {
  return (
    left.transferCount <= right.transferCount &&
    left.totalMinutes <= right.totalMinutes &&
    (left.transferCount < right.transferCount ||
      right.totalMinutes - left.totalMinutes >= ROUTE_DOMINANT_TIME_GAP_MINUTES)
  );
}

function findRoute(
  graph: Map<string, RouteGraphEdge[]>,
  originStationId: string,
  destinationStationId: string,
  criterion: RouteSearchCriterion,
): RouteSearchResult | null {
  const originKey = makeRouteStateKey(originStationId, null);
  const open: Array<{
    stationId: string;
    previousBranchId: string | null;
    previousLineNameKo: string | null;
    score: number;
    stopCount: number;
    transferCount: number;
    totalMinutes: number;
  }> = [
    {
      stationId: originStationId,
      previousBranchId: null,
      previousLineNameKo: null,
      score: 0,
      stopCount: 0,
      transferCount: 0,
      totalMinutes: 0,
    },
  ];
  const bestScore = new Map<string, number>([[originKey, 0]]);
  const previous = new Map<
    string,
    { previousKey: string; stationId: string; edge: RouteGraphEdge }
  >();
  let destinationKey: string | null = null;

  while (open.length > 0) {
    open.sort(
      (a, b) =>
        a.score - b.score ||
        a.totalMinutes - b.totalMinutes ||
        a.transferCount - b.transferCount ||
        a.stopCount - b.stopCount,
    );

    const current = open.shift();
    if (!current) break;

    const currentKey = makeRouteStateKey(
      current.stationId,
      current.previousBranchId,
    );
    if ((bestScore.get(currentKey) ?? Number.POSITIVE_INFINITY) < current.score)
      continue;

    if (current.stationId === destinationStationId) {
      destinationKey = currentKey;
      break;
    }

    for (const edge of graph.get(current.stationId) ?? []) {
      const isManualTransfer = edge.kind === "manual-transfer";
      const isBranchChange = Boolean(
        current.previousBranchId && current.previousBranchId !== edge.branchId,
      );
      const isLineChange = Boolean(
        current.previousLineNameKo && current.previousLineNameKo !== edge.lineNameKo,
      );
      const isTransfer = isManualTransfer || (isBranchChange && isLineChange);
      const branchChangePenalty = !isBranchChange
        ? 0
        : isLineChange
          ? ROUTE_TRANSFER_PENALTY
          : SAME_LINE_BRANCH_CHANGE_PENALTY;
      const durationMinutes = getRouteEdgeDurationMinutes(edge);
      const transferCount = current.transferCount + (isTransfer ? 1 : 0);
      const totalMinutes = current.totalMinutes + durationMinutes + (isManualTransfer ? 0 : branchChangePenalty);
      const timetablePriority = edge.kind === "timetable" ? TIMETABLE_EDGE_PRIORITY_BONUS : 0;
      const fallbackRidePenalty = edge.kind === "ride" && (!edge.distanceMeters || !edge.durationMinutes) ? 4 : 0;
      const longTransferPenalty = edge.kind === "manual-transfer" && (edge.transferMinutes ?? MANUAL_TRANSFER_PENALTY) >= 20 ? 2 : 0;
      const dataQualityPenalty = fallbackRidePenalty + longTransferPenalty;
      const nextScore = criterion === "fewest-transfers"
        ? transferCount * FEWEST_TRANSFER_SCORE_WEIGHT + totalMinutes + dataQualityPenalty + current.stopCount * ROUTE_STOP_STEP_PENALTY
        : criterion === "timetable-priority"
          ? totalMinutes - timetablePriority * 6 + transferCount * 3 + dataQualityPenalty + current.stopCount * ROUTE_STOP_STEP_PENALTY
          : totalMinutes - timetablePriority + dataQualityPenalty + current.stopCount * ROUTE_STOP_STEP_PENALTY;
      const nextPreviousBranchId = isManualTransfer ? null : edge.branchId;
      const nextPreviousLineNameKo = isManualTransfer ? null : edge.lineNameKo;
      const nextKey = makeRouteStateKey(edge.toStationId, nextPreviousBranchId);

      if (nextScore >= (bestScore.get(nextKey) ?? Number.POSITIVE_INFINITY))
        continue;

      bestScore.set(nextKey, nextScore);
      previous.set(nextKey, {
        previousKey: currentKey,
        stationId: current.stationId,
        edge,
      });
      open.push({
        stationId: edge.toStationId,
        previousBranchId: nextPreviousBranchId,
        previousLineNameKo: nextPreviousLineNameKo,
        score: nextScore,
        stopCount: current.stopCount + 1,
        transferCount,
        totalMinutes,
      });
    }
  }

  if (!destinationKey) return null;

  const stationIds = [destinationStationId];
  const edges: RouteGraphEdge[] = [];
  let currentKey = destinationKey;

  while (currentKey !== originKey) {
    const item = previous.get(currentKey);
    if (!item) return null;

    edges.unshift(item.edge);
    stationIds.unshift(item.stationId);
    currentKey = item.previousKey;
  }

  let transferCount = 0;
  let previousBranchId: string | null = null;
  let totalMinutes = 0;
  let totalDistanceMeters = 0;

  let previousLineNameKo: string | null = null;

  for (const edge of edges) {
    const isManualTransfer = edge.kind === "manual-transfer";
    const isBranchChange = Boolean(previousBranchId && edge.branchId !== previousBranchId);
    const isLineChange = Boolean(previousLineNameKo && edge.lineNameKo !== previousLineNameKo);
    const branchChangePenalty = !isBranchChange
      ? 0
      : isLineChange
        ? ROUTE_TRANSFER_PENALTY
        : SAME_LINE_BRANCH_CHANGE_PENALTY;

    totalMinutes += getRouteEdgeDurationMinutes(edge) + (isManualTransfer ? 0 : branchChangePenalty);
    totalDistanceMeters += edge.distanceMeters ?? 0;

    if (isManualTransfer) {
      transferCount += 1;
      previousBranchId = null;
      previousLineNameKo = null;
      continue;
    }

    if (isBranchChange && isLineChange) transferCount += 1;
    previousBranchId = edge.branchId;
    previousLineNameKo = edge.lineNameKo;
  }

  return {
    stationIds,
    edges,
    transferCount,
    totalMinutes: Math.ceil(totalMinutes),
    totalDistanceMeters,
    criterion,
    label: criterion === "fewest-transfers" ? "환승 적게" : criterion === "timetable-priority" ? "시간표 우선" : "빠른 경로",
  };
}

function makeRouteStateKey(stationId: string, branchId: string | null) {
  return `${stationId}::${branchId ?? "origin"}`;
}

function RouteResultSummary({
  results,
  activeResultIndex,
  stationById,
  onSelectResult,
}: {
  results: RouteSearchResult[];
  activeResultIndex: number;
  stationById: Map<string, RailMapStation>;
  onSelectResult: (index: number) => void;
}) {
  const result = results[activeResultIndex] ?? results[0];
  if (!result) return null;

  const originName =
    stationById.get(result.stationIds[0] ?? "")?.nameKo ?? "출발";
  const destinationName =
    stationById.get(result.stationIds[result.stationIds.length - 1] ?? "")
      ?.nameKo ?? "도착";
  const timedEdgeCount = result.edges.filter((edge) => edge.kind === "timetable").length;
  const rideEdgeCount = result.edges.filter((edge) => edge.kind === "ride").length;
  const transferEdgeCount = result.edges.filter((edge) => edge.kind === "manual-transfer").length;
  const totalMinutesLabel = `${Math.ceil(result.totalMinutes).toLocaleString("ko-KR")}분`;
  const distanceLabel = result.totalDistanceMeters >= 1000
    ? `${(result.totalDistanceMeters / 1000).toFixed(result.totalDistanceMeters >= 10_000 ? 0 : 1)}km`
    : `${Math.round(result.totalDistanceMeters).toLocaleString("ko-KR")}m`;

  const segments: Array<{
    branchId: string;
    lineNameKo: string;
    sourceLineName: string;
    colorHex: string;
    fromStationId: string;
    toStationId: string;
    edgeCount: number;
    kind: RouteGraphEdge["kind"];
    transferMinutes?: number | null;
    durationMinutes?: number | null;
  }> = [];

  for (let index = 0; index < result.edges.length; index += 1) {
    const edge = result.edges[index];
    if (!edge) continue;

    const fromStationId = result.stationIds[index];
    const toStationId = result.stationIds[index + 1];
    if (!fromStationId || !toStationId) continue;

    const last = segments[segments.length - 1];

    if (last && last.branchId === edge.branchId && edge.kind === "ride") {
      last.toStationId = toStationId;
      last.edgeCount += 1;
      last.durationMinutes = (last.durationMinutes ?? 0) + (edge.durationMinutes ?? 0);
    } else {
      segments.push({
        branchId: edge.branchId,
        lineNameKo: edge.lineNameKo,
        sourceLineName: edge.sourceLineName,
        colorHex: edge.colorHex,
        fromStationId,
        toStationId,
        edgeCount: 1,
        kind: edge.kind,
        transferMinutes: edge.transferMinutes ?? null,
        durationMinutes: edge.durationMinutes ?? null,
      });
    }
  }

  return (
    <div className="mt-3 min-w-0 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-lg shadow-slate-950/8">
      <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-sky-50/60 px-3 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-wide text-emerald-600 uppercase">
              추천 경로
            </p>
            <p className="mt-1 break-words text-sm font-semibold leading-5 text-slate-950">
              {originName} → {destinationName}
            </p>
          </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <div className="rounded-2xl bg-slate-950 px-2.5 py-2 text-white">
            <span className="block text-[10px] font-medium text-white/60">예상</span>
            <strong className="mt-0.5 block text-sm font-semibold">{totalMinutesLabel}</strong>
          </div>
          <div className="rounded-2xl bg-slate-100 px-2.5 py-2 text-slate-700">
            <span className="block text-[10px] font-medium text-slate-400">환승</span>
            <strong className="mt-0.5 block text-sm font-semibold">{result.transferCount.toLocaleString("ko-KR")}회</strong>
          </div>
          <div className="rounded-2xl bg-slate-100 px-2.5 py-2 text-slate-700">
            <span className="block text-[10px] font-medium text-slate-400">거리</span>
            <strong className="mt-0.5 block text-sm font-semibold">{distanceLabel}</strong>
          </div>
        </div>
          <div className="shrink-0 rounded-2xl bg-emerald-600 px-3 py-1.5 text-right text-white shadow-sm shadow-emerald-900/15">
            <p className="text-[10px] font-medium opacity-80">예상</p>
            <p className="text-sm font-semibold">{formatNumber(result.totalMinutes)}분</p>
          </div>
        </div>

        {results.length > 1 ? (
          <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-2xl bg-emerald-100/60 p-1">
            {results.map((candidate, index) => (
              <button
                key={`${candidate.criterion}:${index}`}
                type="button"
                className={`rounded-xl px-2 py-1.5 text-[11px] font-semibold transition ${index === activeResultIndex ? "bg-white text-emerald-700 shadow-sm" : "text-emerald-700/70 hover:bg-white/60"}`}
                onClick={() => onSelectResult(index)}
              >
                {candidate.label} · {formatNumber(candidate.totalMinutes)}분
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <RouteMetric label="역" value={`${formatNumber(result.stationIds.length)}개`} />
          <RouteMetric label="환승" value={`${formatNumber(result.transferCount)}회`} />
          <RouteMetric label="거리" value={formatDistance(result.totalDistanceMeters)} />
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          <RouteMetric label="이동" value={`${formatNumber(rideEdgeCount)}구간`} />
          <RouteMetric label="시간표" value={`${formatNumber(timedEdgeCount)}구간`} />
          <RouteMetric label="환승" value={`${formatNumber(transferEdgeCount)}회`} />
        </div>
        <RouteQualityReviewPanel result={result} />
      </div>

      <div className="border-b border-slate-100 px-3 py-2">
        <RouteCalculationDebugPanel result={result} stationById={stationById} />
      </div>

      <div className="grid min-w-0 gap-2.5 px-3 py-3">
        {segments.map((segment, index) => {
          const fromName =
            stationById.get(segment.fromStationId)?.nameKo ?? "이전 역";
          const toName =
            stationById.get(segment.toStationId)?.nameKo ?? "다음 역";
          const isTransfer = index > 0;

          if (segment.kind === "manual-transfer") {
            return (
              <RouteTransferConnection
                key={`${segment.branchId}:${index}:${segment.fromStationId}:${segment.toStationId}`}
                fromStationName={fromName}
                toStationName={toName}
                transferMinutes={segment.transferMinutes}
              />
            );
          }

          if (segment.kind === "timetable") {
            return (
              <RouteTimedSegment
                key={`${segment.branchId}:${index}:${segment.fromStationId}:${segment.toStationId}`}
                colorHex={segment.colorHex}
                lineName={segment.lineNameKo}
                sourceLineName={segment.sourceLineName}
                fromStationName={fromName}
                toStationName={toName}
                durationMinutes={segment.durationMinutes}
              />
            );
          }

          return (
            <div
              key={`${segment.branchId}:${index}:${segment.fromStationId}:${segment.toStationId}`}
              className="min-w-0"
            >
              {isTransfer ? <RouteTransferStep stationName={fromName} /> : null}
              <RouteRoadmapSegment
                colorHex={segment.colorHex}
                lineName={segment.lineNameKo}
                sourceLineName={segment.sourceLineName}
                fromStationName={fromName}
                toStationName={toName}
                stationCount={segment.edgeCount + 1}
                durationMinutes={segment.durationMinutes}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RouteQualityReviewPanel({ result }: { result: RouteSearchResult }) {
  const fallbackRideCount = result.edges.filter(
    (edge) => edge.kind === "ride" && (!edge.distanceMeters || !edge.durationMinutes),
  ).length;
  const timetableCount = result.edges.filter((edge) => edge.kind === "timetable").length;
  const transferCount = result.edges.filter((edge) => edge.kind === "manual-transfer").length;
  const geometryRideCount = result.edges.filter(
    (edge) => edge.kind === "ride" && Boolean(edge.distanceMeters && edge.durationMinutes),
  ).length;
  const longTransferCount = result.edges.filter(
    (edge) => edge.kind === "manual-transfer" && (edge.transferMinutes ?? MANUAL_TRANSFER_PENALTY) >= 20,
  ).length;
  const noDistanceRideCount = result.edges.filter(
    (edge) => edge.kind === "ride" && !edge.distanceMeters,
  ).length;
  const qualityLevel = fallbackRideCount > 0 || noDistanceRideCount > 0
    ? "확인 필요"
    : longTransferCount > 0
      ? "주의"
      : "양호";
  const qualityTone = qualityLevel === "양호"
    ? "border-emerald-100 bg-emerald-50/70 text-emerald-800"
    : qualityLevel === "주의"
      ? "border-amber-100 bg-amber-50/70 text-amber-800"
      : "border-rose-100 bg-rose-50/70 text-rose-800";
  const qualityItems = [
    timetableCount > 0 ? `${formatNumber(timetableCount)}개 시간표 구간` : null,
    geometryRideCount > 0 ? `${formatNumber(geometryRideCount)}개 선형 거리 계산` : null,
    fallbackRideCount > 0 ? `${formatNumber(fallbackRideCount)}개 기본 시간 보정` : null,
    transferCount > 0 ? `${formatNumber(transferCount)}회 환승` : null,
    longTransferCount > 0 ? `${formatNumber(longTransferCount)}개 긴 환승 시간` : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <div className={`mt-2 rounded-2xl border px-3 py-2 ${qualityTone}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold">품질 점검</p>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold shadow-sm shadow-slate-950/5">
          {qualityLevel}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {qualityItems.map((item) => (
          <span
            key={item}
            className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-medium shadow-sm shadow-slate-950/5"
          >
            {item}
          </span>
        ))}
      </div>
      {fallbackRideCount > 0 ? (
        <p className="mt-1.5 text-[10px] font-medium opacity-75">
          선형 거리나 성능값이 부족한 구간은 기본 시간으로 계산했습니다.
        </p>
      ) : null}
    </div>
  );
}

function RouteMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/75 px-2 py-1.5 text-center shadow-sm shadow-slate-950/5">
      <p className="text-[10px] font-medium text-slate-400">{label}</p>
      <p className="mt-0.5 text-xs font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function RouteCalculationDebugPanel({
  result,
  stationById,
}: {
  result: RouteSearchResult;
  stationById: Map<string, RailMapStation>;
}) {
  const rideDistanceMeters = result.edges.reduce(
    (sum, edge) => sum + (edge.kind === "ride" ? (edge.distanceMeters ?? 0) : 0),
    0,
  );
  const timetableMinutes = result.edges.reduce(
    (sum, edge) => sum + (edge.kind === "timetable" ? (edge.durationMinutes ?? 0) : 0),
    0,
  );
  const transferMinutes = result.edges.reduce(
    (sum, edge) =>
      sum +
      (edge.kind === "manual-transfer"
        ? (edge.transferMinutes ?? MANUAL_TRANSFER_PENALTY)
        : 0),
    0,
  );
  const debugRows = result.edges.map((edge, index) => {
    const fromName = stationById.get(result.stationIds[index] ?? "")?.nameKo ?? "출발";
    const toName = stationById.get(edge.toStationId)?.nameKo ?? "도착";
    const duration = edge.kind === "manual-transfer"
      ? (edge.transferMinutes ?? MANUAL_TRANSFER_PENALTY)
      : (edge.durationMinutes ?? 1);

    return {
      key: `${edge.kind}:${edge.branchId}:${edge.toStationId}:${index}`,
      title: edge.kind === "timetable"
        ? `${edge.lineNameKo} · ${edge.trainNumber ? `열차 ${edge.trainNumber}` : "시간표"}`
        : edge.kind === "manual-transfer"
          ? "환승"
          : edge.lineNameKo,
      fromName,
      toName,
      duration,
      distanceMeters: edge.distanceMeters ?? null,
      source: edge.kind === "timetable"
        ? "시간표"
        : edge.kind === "manual-transfer"
          ? "환승 시간"
          : edge.distanceMeters
            ? "선형 거리 + 성능값"
            : "기본 이동 시간",
    };
  });

  return (
    <details className="group rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-semibold text-slate-700">
        <span>계산 근거</span>
        <span className="text-[10px] font-medium text-slate-400 group-open:hidden">열기</span>
        <span className="hidden text-[10px] font-medium text-slate-400 group-open:inline">닫기</span>
      </summary>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <RouteMetric label="선형거리" value={formatDistance(rideDistanceMeters)} />
        <RouteMetric label="시간표" value={`${formatNumber(Math.ceil(timetableMinutes))}분`} />
        <RouteMetric label="환승" value={`${formatNumber(Math.ceil(transferMinutes))}분`} />
      </div>

      <div className="mt-2 grid gap-1.5">
        {debugRows.slice(0, 8).map((row) => (
          <div
            key={row.key}
            className="rounded-xl border border-white bg-white px-2 py-1.5 shadow-sm shadow-slate-950/5"
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[11px] font-semibold text-slate-800">
                {row.title}
              </p>
              <p className="shrink-0 text-[10px] font-semibold text-slate-500">
                약 {formatNumber(Math.ceil(row.duration))}분
              </p>
            </div>
            <p className="mt-0.5 truncate text-[10px] font-medium text-slate-400">
              {row.fromName} → {row.toName} · {row.source}
              {row.distanceMeters ? ` · ${formatDistance(row.distanceMeters)}` : ""}
            </p>
          </div>
        ))}
        {debugRows.length > 8 ? (
          <p className="text-center text-[10px] font-medium text-slate-400">
            외 {formatNumber(debugRows.length - 8)}개 구간
          </p>
        ) : null}
      </div>
    </details>
  );
}

function formatDistance(distanceMeters: number) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return "-";
  if (distanceMeters >= 1000) return `${formatNumber(Math.round(distanceMeters / 100) / 10)}km`;
  return `${formatNumber(Math.round(distanceMeters))}m`;
}

function RouteTimedSegment({
  colorHex,
  lineName,
  sourceLineName,
  fromStationName,
  toStationName,
  durationMinutes,
}: {
  colorHex: string;
  lineName: string;
  sourceLineName: string;
  fromStationName: string;
  toStationName: string;
  durationMinutes?: number | null;
}) {
  return (
    <div className="min-w-0 rounded border border-blue-100 bg-blue-50 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorHex }} />
        <p className="min-w-0 break-words text-[11px] font-semibold leading-4 text-slate-800">
          {lineName} · {sourceLineName}
        </p>
      </div>
      <p className="mt-1 text-[10px] text-slate-500">
        {fromStationName} → {toStationName}
        {typeof durationMinutes === "number" ? ` · ${formatNumber(durationMinutes)}분` : ""}
      </p>
    </div>
  );
}

function RouteTransferConnection({
  fromStationName,
  toStationName,
  transferMinutes,
}: {
  fromStationName: string;
  toStationName: string;
  transferMinutes?: number | null;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-dashed border-slate-300 bg-slate-50/85 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-white">
          환승
        </span>
        <p className="min-w-0 break-words text-[11px] font-bold leading-4 text-slate-700">
          {fromStationName === toStationName
            ? `${fromStationName}에서 갈아타기`
            : `${fromStationName} ↔ ${toStationName}`}
        </p>
      </div>
      {typeof transferMinutes === "number" ? (
        <p className="mt-1 text-[10px] font-semibold text-slate-500">
          약 {formatNumber(transferMinutes)}분 환승
        </p>
      ) : null}
    </div>
  );
}

function RouteTransferStep({ stationName }: { stationName: string }) {
  return (
    <div className="mb-1.5 flex min-w-0 items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50/85 px-3 py-2">
      <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white">
        환승
      </span>
      <p className="min-w-0 break-words text-[11px] font-bold leading-4 text-slate-700">
        {stationName}에서 갈아타기
      </p>
    </div>
  );
}

function RouteRoadmapSegment({
  colorHex,
  lineName,
  sourceLineName,
  fromStationName,
  toStationName,
  stationCount,
  durationMinutes,
}: {
  colorHex: string;
  lineName: string;
  sourceLineName: string;
  fromStationName: string;
  toStationName: string;
  stationCount: number;
  durationMinutes?: number | null;
}) {
  const lineLabel =
    sourceLineName && sourceLineName !== lineName
      ? `${lineName} · ${sourceLineName}`
      : lineName;

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
      <div className="flex min-w-0 items-center gap-2 border-b border-slate-100 bg-slate-50 px-2 py-1.5">
        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: colorHex }}
        />
        <p className="min-w-0 break-words text-xs font-semibold leading-4 text-slate-950">
          {lineLabel}
        </p>
      </div>

      <div className="grid min-w-0 grid-cols-[18px_minmax(0,1fr)] px-2 py-2">
        <RouteRoadmapStationDot colorHex={colorHex} />
        <p className="min-w-0 break-words text-xs font-semibold leading-4 text-slate-950">
          {fromStationName}
        </p>

        <div
          className="mx-auto min-h-7 w-0.5"
          style={{ backgroundColor: colorHex }}
        />
        <div className="flex min-w-0 items-center py-1">
          <p className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
            {formatNumber(Math.max(1, stationCount - 1))}개 구간
            {typeof durationMinutes === "number" && durationMinutes > 0 ? ` · 약 ${formatNumber(Math.ceil(durationMinutes))}분` : ""}
          </p>
        </div>

        <RouteRoadmapStationDot colorHex={colorHex} />
        <p className="min-w-0 break-words text-xs font-semibold leading-4 text-slate-950">
          {toStationName}
        </p>
      </div>
    </div>
  );
}

function RouteRoadmapStationDot({ colorHex }: { colorHex: string }) {
  return (
    <span
      className="mt-0.5 h-3.5 w-3.5 rounded-full border-2 border-white shadow-sm"
      style={{ backgroundColor: colorHex }}
    />
  );
}

function RouteDraftCard({
  originStation,
  destinationStation,
  message,
  results,
  activeResultIndex,
  stationById,
  allStations,
  onSelectResult,
  routeSearchPreference,
  onRouteSearchPreferenceChange,
  onSetRoutePoint,
  onClearOrigin,
  onClearDestination,
  onSwap,
  onSubmit,
  compact = false,
}: {
  originStation: RailMapStation | null;
  destinationStation: RailMapStation | null;
  message: string | null;
  results: RouteSearchResult[];
  activeResultIndex: number;
  stationById: Map<string, RailMapStation>;
  allStations: RailMapStation[];
  onSelectResult: (index: number) => void;
  routeSearchPreference: RouteSearchPreference;
  onRouteSearchPreferenceChange: (preference: RouteSearchPreference) => void;
  onSetRoutePoint: (role: RoutePointRole, stationId: string) => void;
  onClearOrigin: () => void;
  onClearDestination: () => void;
  onSwap: () => void;
  onSubmit: () => void;
  compact?: boolean;
}) {
  const [originQuery, setOriginQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const hasBothStations = Boolean(originStation && destinationStation);
  const isSameStation = Boolean(
    originStation &&
    destinationStation &&
    originStation.id === destinationStation.id,
  );
  const canSubmit = hasBothStations && !isSameStation;
  const statusText = isSameStation
    ? "출발역과 도착역이 같습니다."
    : (message ?? "출발역과 도착역을 지정해 주세요.");

  return (
    <section
      className={
        compact
          ? "min-w-0 overflow-visible rounded-2xl border border-white/70 bg-white/95 p-2 shadow-sm shadow-slate-950/5"
          : "min-w-0 overflow-visible rounded-[22px] border border-white/70 bg-white/95 p-3 shadow-lg shadow-slate-950/10 backdrop-blur"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
            경로 검색
          </p>
          <p className="mt-0.5 line-clamp-2 break-words text-[11px] font-medium leading-4 text-slate-500">
            {statusText}
          </p>
        </div>
        <button
          type="button"
          className="h-7 shrink-0 rounded-full border border-slate-200 bg-white px-2.5 text-[10px] font-semibold text-slate-600 transition duration-150 ease-out hover:bg-slate-50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onSwap}
          disabled={!originStation && !destinationStation}
        >
          전환
        </button>
      </div>

      <div className="mt-2 grid gap-2">
        <RoutePointPicker
          label="출발"
          accent="sky"
          station={originStation}
          query={originQuery}
          allStations={allStations}
          onQueryChange={setOriginQuery}
          onSelect={(stationId) => {
            onSetRoutePoint("origin", stationId);
            setOriginQuery("");
          }}
          onClear={onClearOrigin}
        />
        <RoutePointPicker
          label="도착"
          accent="amber"
          station={destinationStation}
          query={destinationQuery}
          allStations={allStations}
          onQueryChange={setDestinationQuery}
          onSelect={(stationId) => {
            onSetRoutePoint("destination", stationId);
            setDestinationQuery("");
          }}
          onClear={onClearDestination}
        />
      </div>

      <RouteSearchPreferenceControl
        value={routeSearchPreference}
        onChange={onRouteSearchPreferenceChange}
      />

      {results.length > 0 ? (
        <RouteResultSummary
          results={results}
          activeResultIndex={activeResultIndex}
          stationById={stationById}
          onSelectResult={onSelectResult}
        />
      ) : null}

      <button
        type="button"
        className="mt-2 h-9 w-full rounded-full bg-slate-950 px-3 text-xs font-semibold text-white transition duration-150 ease-out hover:bg-slate-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300"
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        경로 검색
      </button>
    </section>
  );
}

function RouteSearchPreferenceControl({
  value,
  onChange,
}: {
  value: RouteSearchPreference;
  onChange: (value: RouteSearchPreference) => void;
}) {
  const options: Array<{ value: RouteSearchPreference; label: string; hint: string }> = [
    { value: "balanced", label: "균형", hint: "최단 시간과 환승 적게를 함께 비교" },
    { value: "fastest", label: "빠른 경로", hint: "예상 시간이 가장 짧은 경로" },
    { value: "fewest-transfers", label: "환승 적게", hint: "환승 수를 우선 줄인 경로" },
    { value: "timetable-priority", label: "시간표 우선", hint: "실제 시간표가 있는 구간을 조금 더 우선" },
  ];

  return (
    <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-1.5">
      <div className="grid grid-cols-2 gap-1">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`rounded-xl px-2 py-1.5 text-left transition duration-150 ease-out ${selected ? "bg-white text-slate-950 shadow-sm shadow-slate-950/5" : "text-slate-500 hover:bg-white/70 hover:text-slate-800"}`}
              onClick={() => onChange(option.value)}
              title={option.hint}
            >
              <span className="block text-[11px] font-semibold">{option.label}</span>
              <span className="mt-0.5 block truncate text-[9px] font-medium opacity-70">{option.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RoutePointPicker({
  label,
  accent,
  station,
  query,
  allStations,
  onQueryChange,
  onSelect,
  onClear,
}: {
  label: string;
  accent: "sky" | "amber";
  station: RailMapStation | null;
  query: string;
  allStations: RailMapStation[];
  onQueryChange: (value: string) => void;
  onSelect: (stationId: string) => void;
  onClear: () => void;
}) {
  const labelClass = accent === "sky" ? "text-sky-600" : "text-amber-600";
  const ringClass = accent === "sky" ? "focus:border-sky-300 focus:ring-sky-100" : "focus:border-amber-300 focus:ring-amber-100";
  const normalizedQuery = normalizeSearchText(query);
  const results = normalizedQuery
    ? allStations
        .filter((candidate) => normalizeSearchText(candidate.nameKo).includes(normalizedQuery))
        .slice(0, 8)
    : [];

  return (
    <div className="relative rounded-2xl border border-slate-200 bg-slate-50/70 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className={`text-[10px] font-semibold ${labelClass}`}>{label}</p>
        {station ? (
          <button
            type="button"
            className="h-5 shrink-0 rounded-full px-1.5 text-[10px] font-medium text-slate-400 transition duration-150 ease-out hover:bg-white hover:text-slate-700 active:scale-[0.99]"
            onClick={onClear}
          >
            삭제
          </button>
        ) : null}
      </div>
      <p className="mt-0.5 truncate text-xs font-semibold text-slate-900">
        {station?.nameKo ?? "미지정"}
      </p>
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={`${label}역 검색`}
        className={`mt-1.5 h-8 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 outline-none transition focus:ring-4 ${ringClass}`}
      />
      {results.length > 0 ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white/98 shadow-2xl shadow-slate-950/15 backdrop-blur">
          {results.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-slate-50"
              onClick={() => onSelect(candidate.id)}
            >
              <span className="min-w-0 truncate text-xs font-semibold text-slate-900">
                {candidate.nameKo}
              </span>
              {candidate.lineNameKo ? (
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                  {candidate.lineNameKo}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
        <p className="mt-0.5 truncate text-xs font-bold text-slate-900">
          {station?.nameKo ?? "미지정"}
        </p>
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

function SelectedTransferGroupPanel({
  group,
  stations,
  servingBranchIndex,
  routeOriginStationId,
  routeDestinationStationId,
  onSelectStation,
  onSetRoutePoint,
  onClear,
  compact = false,
}: SelectedTransferGroupPanelProps) {
  return (
    <section className="overflow-hidden rounded border border-sky-200 bg-sky-50/95 shadow-sm">
      <div className="flex items-start justify-between gap-2 border-b border-sky-100 px-3 py-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-600">
            Transfer group
          </p>
          <h2 className="mt-0.5 truncate text-sm font-bold text-slate-950">
            {group.nameKo}
          </h2>
          <p className="mt-0.5 text-[11px] font-medium text-slate-500">
            {stations.length}개 하위 역 · {group.note || "메모 없음"}
          </p>
        </div>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-sm font-black text-slate-400 hover:bg-white hover:text-slate-700"
          onClick={onClear}
          aria-label="환승 그룹 선택 해제"
        >
          ×
        </button>
      </div>

      <div className={compact ? "grid gap-1 p-2" : "grid gap-1.5 p-2"}>
        {stations.map((station) => (
          <TransferStationRailCard
            key={station.id}
            station={station}
            groupName={group.nameKo}
            servingBranches={servingBranchIndex.get(station.id) ?? []}
            isOrigin={routeOriginStationId === station.id}
            isDestination={routeDestinationStationId === station.id}
            onSelect={() => onSelectStation(station.id)}
            onSetOrigin={() => onSetRoutePoint("origin", station.id)}
            onSetDestination={() => onSetRoutePoint("destination", station.id)}
          />
        ))}
      </div>
    </section>
  );
}


function TransferStationRailCard({
  station,
  groupName,
  servingBranches,
  isOrigin,
  isDestination,
  onSelect,
  onSetOrigin,
  onSetDestination,
}: {
  station: RailMapStation;
  groupName: string;
  servingBranches: StationServingBranch[];
  isOrigin: boolean;
  isDestination: boolean;
  onSelect: () => void;
  onSetOrigin: () => void;
  onSetDestination: () => void;
}) {
  const primaryBranch = servingBranches[0];
  const colorHex = primaryBranch?.colorHex ?? "#0ea5e9";
  const branchLabel = servingBranches.length
    ? servingBranches.map((branch) => branch.sourceLineName).join(" · ")
    : (station.lineNameKo ?? "노선 정보 없음");

  return (
    <div className="rounded-xl border border-white/80 bg-white/90 p-2 shadow-sm shadow-slate-950/5">
      <button
        type="button"
        className="grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 text-left"
        onClick={onSelect}
      >
        <span className="relative flex h-10 items-center justify-center">
          <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-slate-200" />
          <span
            className="relative size-3.5 rounded-full border-2 border-white shadow-sm"
            style={{ backgroundColor: colorHex }}
          />
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-xs font-black text-slate-900">
            {station.nameKo}
          </strong>
          <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-500">
            {groupName} · {branchLabel}
          </span>
        </span>
        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-black text-sky-700">
          보기
        </span>
      </button>
      <div className="mt-1.5 grid grid-cols-2 gap-1">
        <button
          type="button"
          className={
            isOrigin
              ? "h-7 rounded-lg bg-sky-600 px-2 text-[11px] font-black text-white"
              : "h-7 rounded-lg border border-sky-200 bg-sky-50 px-2 text-[11px] font-black text-sky-700 hover:bg-sky-100"
          }
          onClick={onSetOrigin}
        >
          출발
        </button>
        <button
          type="button"
          className={
            isDestination
              ? "h-7 rounded-lg bg-slate-950 px-2 text-[11px] font-black text-white"
              : "h-7 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-black text-slate-600 hover:bg-slate-50"
          }
          onClick={onSetDestination}
        >
          도착
        </button>
      </div>
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
          <p className="text-[10px] font-bold tracking-wide text-amber-600 uppercase">
            선택 역
          </p>
          <h2 className="mt-0.5 truncate text-sm font-bold text-slate-950">
            {station.nameKo}
          </h2>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            노선 {formatNumber(uniqueLineCount)}개 · 구간{" "}
            {formatNumber(servingBranches.length)}개
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
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: line.colorHex }}
              />
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

      <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
        <MetricMini label="노선" value={uniqueLineCount} />
        <MetricMini label="구간" value={servingBranches.length} />
      </div>

      <DetailDisclosure>
        <span>stationId: {station.id}</span>
        <span>
          좌표:{" "}
          {station.lat && station.lng
            ? `${station.lat.toFixed(5)}, ${station.lng.toFixed(5)}`
            : "-"}
        </span>
      </DetailDisclosure>

      {servingBranches.length > 0 ? (
        <div className="mt-2">
          <p className="text-[10px] font-bold tracking-wide text-slate-400 uppercase">
            정차 구간
          </p>
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
                    <span className="truncate text-xs font-bold text-slate-900">
                      {branch.lineNameKo}
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold text-slate-400">
                      {branch.sequence}번째
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                    {branch.sourceLineName} · {formatBranchRole(branch.role)} ·{" "}
                    {branch.firstStopName} → {branch.lastStopName}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {servingBranches.length > visibleBranches.length ? (
            <p className="mt-1 text-[11px] font-medium text-slate-400">
              외 {servingBranches.length - visibleBranches.length}개 구간
            </p>
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
  servicePatterns,
  trainRuns,
  stationById,
  onSelectBranch,
  onClearBranch,
  compact = false,
}: SelectedLinePanelProps & { compact?: boolean }) {
  if (!selectedLine) {
    return (
      <section className="border border-slate-200 bg-white p-2.5">
        <h2 className="text-[13px] font-bold">선택 노선</h2>
        <p className="mt-1.5 text-xs leading-5 text-slate-500">
          지도에서 확인할 노선을 선택하세요. PC에서는 좌측 목록, 모바일에서는
          아래 목록에서 바로 선택할 수 있습니다.
        </p>
      </section>
    );
  }

  const lineServicePatterns = servicePatterns.filter(
    (pattern) => pattern.enabled !== false && (pattern.lineId === selectedLine.id || pattern.lineId === selectedLine.canonicalKey),
  );
  const linePatternIds = new Set(lineServicePatterns.map((pattern) => pattern.id));
  const lineTrainRuns = trainRuns.filter(
    (run) => run.enabled !== false && run.patternId && linePatternIds.has(run.patternId),
  );
  const patternStationCount = lineServicePatterns.reduce(
    (sum, pattern) => sum + pattern.stops.length,
    0,
  );
  const firstTrainRun = lineTrainRuns[0] ?? null;

  return (
    <section className="border border-slate-200 bg-white p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-sm border border-white"
              style={{ backgroundColor: selectedLine.colorHex }}
            />
            <h2 className="truncate text-[13px] font-bold">
              {selectedLine.nameKo}
            </h2>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            {formatAreaName(selectedLine.mreaWideCd)} · {formatRailLineCategory(selectedLine.category)} · {selectedLine.serviceTypes.map(formatRailServiceType).join("/")} · 구간{" "}
            {formatNumber(selectedLine.branches.length)}개 · 정차역{" "}
            {formatNumber(countRouteStops(selectedLine))}개
          </p>
        </div>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {selectedBranch ? "구간" : "전체"}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
        <MetricMini label="구간" value={selectedLine.branches.length} />
        <MetricMini label="정차역" value={countRouteStops(selectedLine)} />
        <MetricMini label="패턴 정차" value={patternStationCount} />
        <MetricMini label="열차" value={lineTrainRuns.length} />
      </div>

      <LineRoutePreview
        line={selectedLine}
        branch={selectedBranch ?? selectedLine.branches[0] ?? null}
      />

      <LineServicePatternSummary
        patterns={lineServicePatterns}
        trainRuns={lineTrainRuns}
        stationById={stationById}
      />

      {selectedBranch ? (
        <div className="mt-2 border border-slate-200 bg-slate-50 px-2 py-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-slate-900">
                {selectedBranch.sourceLineName}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {selectedBranch.origin ?? getFirstStop(selectedBranch)} →{" "}
                {selectedBranch.terminal ?? getLastStop(selectedBranch)}
              </p>
            </div>
            <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
              {formatNumber(selectedBranch.routeStops.length)}역
            </span>
          </div>
        </div>
      ) : null}

      <div className="mt-2">
        <p className="text-[11px] font-bold tracking-wide text-slate-400 uppercase">
          구간 선택
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <BranchChip
            active={selectedBranchId === null}
            onClick={onClearBranch}
          >
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
        <span>철도 유형: {formatRailLineCategory(selectedLine.category)}</span>
        <span>서비스 타입: {selectedLine.serviceTypes.map(formatRailServiceType).join(", ")}</span>
        {selectedBranch ? (
          <span>sourceLineNumber: {selectedBranch.sourceLineNumber}</span>
        ) : null}
      </DetailDisclosure>

      {selectedBranch ? (
        <RouteStopList branch={selectedBranch} compact={compact} />
      ) : null}

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


function formatPatternDirectionLabel(direction: string | null | undefined) {
  switch (direction) {
    case "up":
      return "상행";
    case "down":
      return "하행";
    case "loop":
      return "순환";
    default:
      return "미정";
  }
}

function formatOperatingDays(days: string[] | undefined) {
  if (!days || days.length === 0) return "운행일 미지정";
  if (days.length > 3) return `${days.slice(0, 3).join(", ")} 외 ${days.length - 3}`;
  return days.join(", ");
}

function getTrainRunPrimaryTime(run: ManualTrainRun) {
  const first = run.stopTimes
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .find((stop) => stop.departureTime || stop.arrivalTime);
  return first?.departureTime ?? first?.arrivalTime ?? "시각 미정";
}

interface TimetableGraphSummary {
  nodeCount: number;
  patternSegmentCount: number;
  timedEdgeCount: number;
  runCount: number;
}

function parseTimetableMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 47 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function getTrainStopDepartureMinutes(stop: ManualTrainRun["stopTimes"][number]): number | null {
  return parseTimetableMinutes(stop.departureTime) ?? parseTimetableMinutes(stop.arrivalTime);
}

function getTrainStopArrivalMinutes(stop: ManualTrainRun["stopTimes"][number]): number | null {
  return parseTimetableMinutes(stop.arrivalTime) ?? parseTimetableMinutes(stop.departureTime);
}

function buildTimetableRouteGraph(
  patterns: ManualServicePattern[],
  trainRuns: ManualTrainRun[],
): TimetableRouteGraph {
  const nodes = new Set<string>();
  const patternEdges: TimetableRouteGraphEdge[] = [];
  const timedEdges: TimetableRouteGraphEdge[] = [];
  const edgesByStationId = new Map<string, TimetableRouteGraphEdge[]>();

  const addEdge = (edge: TimetableRouteGraphEdge, timed: boolean) => {
    nodes.add(edge.fromStationId);
    nodes.add(edge.toStationId);
    if (timed) timedEdges.push(edge);
    else patternEdges.push(edge);
    const list = edgesByStationId.get(edge.fromStationId) ?? [];
    list.push(edge);
    edgesByStationId.set(edge.fromStationId, list);
  };

  for (const pattern of patterns) {
    if (pattern.enabled === false) continue;
    const stops = pattern.stops
      .filter((stop) => stop.stationId)
      .slice()
      .sort((a, b) => a.sequence - b.sequence);

    for (const stop of stops) nodes.add(stop.stationId);

    for (let index = 0; index < stops.length - 1; index += 1) {
      const from = stops[index]?.stationId;
      const to = stops[index + 1]?.stationId;
      if (!from || !to || from === to) continue;
      addEdge(
        {
          id: `pattern:${pattern.id}:${index}`,
          fromStationId: from,
          toStationId: to,
          patternId: pattern.id,
          trainRunId: null,
          serviceType: pattern.serviceType,
          trainNumber: null,
          departureMinutes: null,
          arrivalMinutes: null,
          durationMinutes: null,
        },
        false,
      );
    }
  }

  for (const run of trainRuns) {
    if (run.enabled === false || !run.patternId) continue;
    const stops = run.stopTimes
      .filter((stop) => stop.stationId)
      .slice()
      .sort((a, b) => a.sequence - b.sequence);

    for (const stop of stops) nodes.add(stop.stationId);

    for (let index = 0; index < stops.length - 1; index += 1) {
      const from = stops[index];
      const to = stops[index + 1];
      if (!from?.stationId || !to?.stationId || from.stationId === to.stationId) continue;
      const departureMinutes = getTrainStopDepartureMinutes(from);
      const arrivalMinutes = getTrainStopArrivalMinutes(to);
      const durationMinutes =
        departureMinutes !== null && arrivalMinutes !== null && arrivalMinutes >= departureMinutes
          ? arrivalMinutes - departureMinutes
          : null;
      addEdge(
        {
          id: `run:${run.id}:${index}`,
          fromStationId: from.stationId,
          toStationId: to.stationId,
          patternId: run.patternId,
          trainRunId: run.id,
          serviceType: run.serviceType,
          trainNumber: run.trainNumber ?? run.nameKo ?? null,
          departureMinutes,
          arrivalMinutes,
          durationMinutes,
        },
        true,
      );
    }
  }

  return { nodes, patternEdges, timedEdges, edgesByStationId };
}

function buildTimetableGraphSummary(
  patterns: ManualServicePattern[],
  trainRuns: ManualTrainRun[],
): TimetableGraphSummary {
  const graph = buildTimetableRouteGraph(patterns, trainRuns);

  return {
    nodeCount: graph.nodes.size,
    patternSegmentCount: graph.patternEdges.length,
    timedEdgeCount: graph.timedEdges.length,
    runCount: trainRuns.length,
  };
}

function formatPatternStopNames(
  stops: ManualServicePattern["stops"],
  stationById: Map<string, RailMapStation>,
) {
  const sortedStops = stops.slice().sort((a, b) => a.sequence - b.sequence);
  const names = sortedStops
    .map((stop) => stationById.get(stop.stationId)?.nameKo ?? stop.stationId)
    .filter(Boolean);
  if (names.length <= 6) return names.join(" → ");
  return `${names.slice(0, 3).join(" → ")} → ... → ${names.slice(-2).join(" → ")}`;
}

function formatTrainRunStopTimePreview(run: ManualTrainRun) {
  const stops = run.stopTimes.slice().sort((a, b) => a.sequence - b.sequence);
  const first = stops.find((stop) => stop.departureTime || stop.arrivalTime);
  const last = stops.slice().reverse().find((stop) => stop.arrivalTime || stop.departureTime);
  const firstTime = first?.departureTime ?? first?.arrivalTime ?? "--:--";
  const lastTime = last?.arrivalTime ?? last?.departureTime ?? "--:--";
  return `${firstTime} → ${lastTime}`;
}

function LineServicePatternSummary({
  patterns,
  trainRuns,
  stationById,
}: {
  patterns: ManualServicePattern[];
  trainRuns: ManualTrainRun[];
  stationById: Map<string, RailMapStation>;
}) {
  if (patterns.length === 0 && trainRuns.length === 0) return null;

  const graphSummary = buildTimetableGraphSummary(patterns, trainRuns);
  const runsByPatternId = new Map<string, ManualTrainRun[]>();
  for (const run of trainRuns) {
    if (!run.patternId) continue;
    const runs = runsByPatternId.get(run.patternId) ?? [];
    runs.push(run);
    runsByPatternId.set(run.patternId, runs);
  }

  return (
    <section className="mt-2 border border-slate-200 bg-white px-2 py-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-900">운행 패턴과 시간표</h3>
        <span className="text-[11px] text-slate-400">
          패턴 {formatNumber(patterns.length)} · 열차 {formatNumber(trainRuns.length)}
        </span>
      </div>
      <div className="mt-1.5 rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
        그래프 준비: 역 {formatNumber(graphSummary.nodeCount)} · 패턴 구간 {formatNumber(graphSummary.patternSegmentCount)} · 시간 간선 {formatNumber(graphSummary.timedEdgeCount)}
      </div>
      <div className="mt-1.5 grid gap-1.5">
        {patterns.slice(0, 4).map((pattern) => {
          const runs = (runsByPatternId.get(pattern.id) ?? [])
            .slice()
            .sort((a, b) => getTrainRunPrimaryTime(a).localeCompare(getTrainRunPrimaryTime(b)));
          return (
            <div key={pattern.id} className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-900">{pattern.nameKo}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {formatRailServiceType(pattern.serviceType)} · {formatPatternDirectionLabel(pattern.direction)} · 정차 {formatNumber(pattern.stops.length)}역
                  </p>
                </div>
                <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                  열차 {formatNumber(runs.length)}
                </span>
              </div>
              <p className="mt-1.5 break-words text-[11px] leading-4 text-slate-500">
                {formatPatternStopNames(pattern.stops, stationById)}
              </p>
              {runs.length > 0 ? (
                <div className="mt-1.5 grid gap-1">
                  {runs.slice(0, 4).map((run) => (
                    <div key={run.id} className="flex items-center justify-between gap-2 rounded bg-white px-1.5 py-1 text-[10px] text-slate-600">
                      <span className="truncate font-medium">{run.trainNumber || run.nameKo || "열차"}</span>
                      <span className="shrink-0 text-slate-400">{formatTrainRunStopTimePreview(run)} · {formatOperatingDays(run.operatingDays)}</span>
                    </div>
                  ))}
                  {runs.length > 4 ? (
                    <p className="text-[10px] text-slate-400">외 {formatNumber(runs.length - 4)}개 열차</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {patterns.length > 4 ? (
        <p className="mt-1.5 text-[11px] text-slate-400">
          외 {formatNumber(patterns.length - 4)}개 패턴
        </p>
      ) : null}
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


function LineRoutePreview({
  line,
  branch,
}: {
  line: CanonicalLine;
  branch: CanonicalBranch | null;
}) {
  if (!branch || branch.routeStops.length === 0) return null;

  const stops = branch.routeStops.slice(0, 6);
  const firstName = getFirstStop(branch);
  const lastName = getLastStop(branch);
  const hiddenCount = Math.max(0, branch.routeStops.length - stops.length);

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-black text-slate-800">
          {branch.sourceLineName}
        </p>
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 shadow-sm">
          {("isCircular" in branch && branch.isCircular) ? "순환" : `${firstName} → ${lastName}`}
        </span>
      </div>
      <div className="mt-2 flex min-w-0 items-center overflow-hidden px-1">
        {stops.map((stop, index) => (
          <div key={stop.id} className="flex min-w-0 flex-1 items-center">
            <div className="grid min-w-0 justify-items-center gap-1">
              <span
                className="size-3 rounded-full border-2 border-white shadow-sm"
                style={{ backgroundColor: line.colorHex }}
              />
              <span className="max-w-12 truncate text-[9px] font-bold text-slate-600">
                {stop.displayNameKo}
              </span>
            </div>
            {index < stops.length - 1 ? (
              <span
                className="mx-1 h-1 min-w-5 flex-1 rounded-full"
                style={{ backgroundColor: line.colorHex }}
              />
            ) : null}
          </div>
        ))}
        {hiddenCount > 0 ? (
          <span className="ml-1 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
            +{formatNumber(hiddenCount)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RouteStopList({
  branch,
  compact = false,
}: {
  branch: CanonicalBranch;
  compact?: boolean;
}) {
  const stops = compact
    ? branch.routeStops.slice(0, 10)
    : branch.routeStops.slice(0, 14);

  return (
    <div className="mt-2 border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-2 py-1.5">
        <p className="text-[11px] font-bold tracking-wide text-slate-400 uppercase">
          정차역
        </p>
        <p className="text-[11px] font-semibold text-slate-500">
          {formatNumber(branch.routeStops.length)}개
        </p>
      </div>
      <ol className="max-h-40 overflow-y-auto px-2 py-1">
        {stops.map((stop) => (
          <li
            key={stop.id}
            className="flex items-center gap-2 py-0.5 text-[11px]"
          >
            <span className="w-5 shrink-0 text-right font-semibold text-slate-400">
              {stop.sequence}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
              {stop.displayNameKo}
            </span>
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
            onClick={() =>
              isSelected ? onClearBranch() : onSelectBranch(branch.id)
            }
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-slate-900">
                  {branch.sourceLineName}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                  {branch.origin ?? getFirstStop(branch)} →{" "}
                  {branch.terminal ?? getLastStop(branch)}
                </p>
              </div>
              <span
                className={
                  isSelected
                    ? "shrink-0 rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                    : "shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600"
                }
              >
                {isSelected ? "선택" : formatBranchRole(branch.role)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-slate-400">
              <span>{formatNumber(branch.routeStops.length)}개 역</span>
              {branch.sourceLineName !== line.nameKo ? (
                <span>· {line.nameKo}</span>
              ) : null}
            </div>
          </button>
        );
      })}

      {line.branches.length > visibleBranches.length ? (
        <p className="px-1 text-[11px] font-medium text-slate-400">
          외 {formatNumber(line.branches.length - visibleBranches.length)}개
          구간은 노선 선택 후 더 넓은 화면에서 확인할 수 있습니다.
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

function MetricMini({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded bg-slate-50 px-2 py-1">
      <p className="text-xs font-bold text-slate-400 uppercase">{label}</p>
      <p className="mt-0.5 text-xs font-bold text-slate-950">{value}</p>
    </div>
  );
}
