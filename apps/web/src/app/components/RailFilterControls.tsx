"use client";

import {
  RailActionButton,
  RailChoiceChip,
  RailSearchField,
  RailSearchResultCard,
  RailToggleButton,
} from "@repo/ui/rail-product";
import type { ReactNode } from "react";
import type { RailMapStation } from "../RailMap";
import {
  countRouteStops,
  formatAreaName,
  formatNumber,
  formatRailLineCategory,
  normalizeSearchText,
  RAIL_LINE_CATEGORIES,
  type CanonicalLine,
  type RailLineCategory,
} from "../railExplorerModel";

const MIN_STATION_SEARCH_LENGTH = 1;

export interface RailFilterControlsProps {
  areaCodes: string[];
  selectedArea: string;
  selectedCategory: RailLineCategory | "all";
  searchQuery: string;
  copiedShareUrl: boolean;
  stationResults: RailMapStation[];
  lineResults: CanonicalLine[];
  stationColorById: ReadonlyMap<string, string>;
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

export default function RailFilterControls({
  areaCodes,
  selectedArea,
  selectedCategory,
  searchQuery,
  copiedShareUrl,
  stationResults,
  lineResults,
  stationColorById,
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
}: RailFilterControlsProps & { compact?: boolean }) {
  return (
    <div className="web-filter-controls space-y-2">
      <RailSearchField
        value={searchQuery}
        aria-label="역명 또는 노선명 검색"
        autoComplete="off"
        placeholder="역명 또는 노선명 검색"
        onValueChange={onSearch}
        onClear={onClearSearch}
      />

      {showSearchResults ? (
        <SearchResults
          query={searchQuery}
          selectedStationId={selectedStationId}
          selectedLineKey={selectedLineKey}
          stations={stationResults}
          lines={lineResults}
          stationColorById={stationColorById}
          onSelectStation={onSelectStation}
          onSelectLine={onSelectLine}
        />
      ) : null}

      <div className="web-control-section">
        <div className="web-control-heading">
          <span>지도 표시</span>
          <small>지도에 표시할 정보를 선택하세요</small>
        </div>
        <div className="web-display-toggles grid grid-cols-2 gap-1.5">
          <RailToggleButton active={showMapLines} onClick={onToggleMapLines}>
            구간선
          </RailToggleButton>
          <RailToggleButton active={showMapStations} onClick={onToggleMapStations}>
            역 표시
          </RailToggleButton>
        </div>
      </div>

      {hasSelection ? (
        <div className="grid grid-cols-2 gap-1.5">
          <RailActionButton onClick={onFocusSelection}>
            {focusSelectionLabel}
          </RailActionButton>
          <RailActionButton onClick={onClearSelection}>선택 해제</RailActionButton>
        </div>
      ) : null}

      <ChoiceSection label="권역">
        <RailChoiceChip active={selectedArea === "all"} onClick={() => onSelectArea("all")}>
          전체
        </RailChoiceChip>
        {areaCodes.map((areaCode) => (
          <RailChoiceChip
            key={areaCode}
            active={selectedArea === areaCode}
            onClick={() => onSelectArea(areaCode)}
          >
            {formatAreaName(areaCode)}
          </RailChoiceChip>
        ))}
      </ChoiceSection>

      <ChoiceSection label="철도 유형">
        <RailChoiceChip
          active={selectedCategory === "all"}
          onClick={() => onSelectCategory("all")}
        >
          전체 유형
        </RailChoiceChip>
        {RAIL_LINE_CATEGORIES.map((category) => (
          <RailChoiceChip
            key={category}
            active={selectedCategory === category}
            onClick={() => onSelectCategory(category)}
          >
            {formatRailLineCategory(category)}
          </RailChoiceChip>
        ))}
      </ChoiceSection>

      <div className="web-filter-actions grid grid-cols-2 gap-1.5">
        <RailActionButton onClick={onReset}>전체 보기</RailActionButton>
        <RailActionButton tone="primary" onClick={onCopyUrl}>
          {copiedShareUrl ? "복사됨" : compact ? "공유" : "URL 복사"}
        </RailActionButton>
      </div>
    </div>
  );
}

function ChoiceSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="web-control-section">
      <div className="web-control-heading"><span>{label}</span></div>
      <div className="web-chip-row flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function HighlightText({ text, query }: { text: string; query: string }): ReactNode {
  const keyword = query.trim();
  if (!keyword) return text;

  const textLower = text.toLocaleLowerCase("ko-KR");
  const keywordLower = keyword.toLocaleLowerCase("ko-KR");
  const index = textLower.indexOf(keywordLower);
  if (index < 0) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-amber-100 px-0.5 font-black text-amber-900">
        {text.slice(index, index + keyword.length)}
      </mark>
      {text.slice(index + keyword.length)}
    </>
  );
}

function SearchResults({
  query,
  selectedStationId,
  stations,
  lines,
  stationColorById,
  selectedLineKey,
  onSelectStation,
  onSelectLine,
}: {
  query: string;
  selectedStationId: string | null;
  selectedLineKey: string | null;
  stations: RailMapStation[];
  lines: CanonicalLine[];
  stationColorById: ReadonlyMap<string, string>;
  onSelectStation: (stationId: string) => void;
  onSelectLine: (lineKey: string) => void;
}) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return null;

  const hasResults = stations.length > 0 || lines.length > 0;
  return (
    <div className="web-search-results" role="region" aria-label="검색 결과">
      <div className="web-search-results__summary">
        <strong>검색 결과</strong>
        <span>노선 {formatNumber(lines.length)} · 역 {formatNumber(stations.length)}</span>
      </div>
      <div className="web-search-results__scroll">
        {!hasResults ? (
          <div className="web-search-results__empty">
            <strong>{normalizedQuery.length < MIN_STATION_SEARCH_LENGTH ? "검색어를 조금 더 입력하세요" : "일치하는 결과가 없습니다"}</strong>
            <span>역명, 노선명 또는 역번호를 확인하세요.</span>
          </div>
        ) : null}

        {lines.length > 0 ? (
          <SearchGroup title="노선" count={lines.length}>
            {lines.map((line) => (
              <RailSearchResultCard
                key={line.canonicalKey}
                active={selectedLineKey === line.canonicalKey}
                color={line.colorHex}
                title={<HighlightText text={line.nameKo} query={query} />}
                description={`${formatAreaName(line.mreaWideCd)} · ${formatNumber(countRouteStops(line))}역`}
                trailing="노선"
                onClick={() => onSelectLine(line.canonicalKey)}
              />
            ))}
          </SearchGroup>
        ) : null}

        {stations.length > 0 ? (
          <SearchGroup title="역" count={stations.length}>
            {stations.map((station) => (
              <RailSearchResultCard
                key={station.id}
                active={selectedStationId === station.id}
                color={stationColorById.get(station.id) ?? "#64748b"}
                title={<HighlightText text={station.nameKo} query={query} />}
                description={station.lineNameKo || "역 정보"}
                trailing="역"
                onClick={() => onSelectStation(station.id)}
              />
            ))}
          </SearchGroup>
        ) : null}
      </div>
    </div>
  );
}

function SearchGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="web-search-results__group">
      <div className="web-search-results__group-title">
        <span>{title}</span><small>{formatNumber(count)}</small>
      </div>
      <div className="grid gap-1.5">{children}</div>
    </section>
  );
}
