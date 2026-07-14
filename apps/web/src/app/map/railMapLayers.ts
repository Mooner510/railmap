import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import {
  isTransferDetailVisible,
  RAIL_MAP_EMPHASIS_POLICY,
  RAIL_MAP_VISUAL_POLICY,
} from "@repo/ui/map/renderPolicy";

type RailFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon,
  GeoJSON.GeoJsonProperties
>;

export const RAIL_MAP_SOURCE_IDS = {
  branchLines: "branch-preview-lines",
  lineBranchLines: "line-branch-lines",
  routeLines: "route-result-lines",
  routeTransfers: "route-result-transfer-lines",
  transferAreas: "transfer-group-areas",
  transferIcons: "transfer-group-icons",
  stations: "branch-preview-stations",
} as const;

export const RAIL_MAP_INTERACTIVE_LAYER_IDS = {
  branchLine: "branch-preview-lines",
  selectedBranchLine: "branch-preview-lines-selected",
  stationHit: "branch-preview-stations-hit",
  transferArea: "transfer-group-areas-fill",
  transferCollapsed: "transfer-group-collapsed-hit",
} as const;

const EMPTY_FEATURE_COLLECTION: RailFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const MAP_RENDER_POLICY = {
  branchLineWidth: RAIL_MAP_VISUAL_POLICY.baseLineWidth,
  branchLineCasingWidth: RAIL_MAP_VISUAL_POLICY.lineCasingWidth,
  selectedBranchLineWidth: RAIL_MAP_VISUAL_POLICY.selectedLineWidth,
  lineBranchLineWidth: RAIL_MAP_VISUAL_POLICY.baseLineWidth,
  lineBranchCasingWidth: RAIL_MAP_VISUAL_POLICY.lineCasingWidth,
  transferGroupHitRadius: 22,
  transferGroupIconSize: 0.0469,
  transferGroupSelectedIconSize: 0.0524,
  stationRadius: 4.5,
  selectedStationRadius: 7,
  stationCasingRadius: 6,
  selectedStationCasingRadius: 10,
  stationStrokeWidth: 1.5,
  selectedStationStrokeWidth: 3,
} as const;

interface RegisterRailMapLayersOptions {
  map: MapLibreMap;
  branchFeatures: RailFeatureCollection;
  lineBranchFeatures: RailFeatureCollection;
  routeFeatures: RailFeatureCollection;
  routeTransferFeatures: RailFeatureCollection;
  transferAreaFeatures: RailFeatureCollection;
  transferIconFeatures: RailFeatureCollection;
  stationFeatures: RailFeatureCollection;
  hasHighlightedRoute: boolean;
}

export function registerRailMapSourcesAndLayers({
  map,
  branchFeatures,
  lineBranchFeatures,
  routeFeatures,
  routeTransferFeatures,
  transferAreaFeatures,
  transferIconFeatures,
  stationFeatures,
  hasHighlightedRoute,
}: RegisterRailMapLayersOptions) {
  map.addSource("branch-preview-lines", {
    type: "geojson",
    data: branchFeatures,
  });

  map.addSource("line-branch-lines", {
    type: "geojson",
    data: lineBranchFeatures,
  });

  map.addSource("route-result-lines", {
    type: "geojson",
    data: routeFeatures,
  });

  map.addSource("route-result-transfer-lines", {
    type: "geojson",
    data: routeTransferFeatures,
  });

  map.addLayer({
    id: "branch-preview-lines-casing",
    type: "line",
    source: "branch-preview-lines",
    paint: {
      "line-color": "#ffffff",
      "line-width": MAP_RENDER_POLICY.branchLineCasingWidth,
      "line-opacity": 0,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  map.addLayer({
    id: "branch-preview-lines",
    type: "line",
    source: "branch-preview-lines",
    paint: {
      "line-color": ["coalesce", ["get", "colorHex"], "#0284c7"],
      "line-width": MAP_RENDER_POLICY.branchLineWidth,
      "line-opacity": hasHighlightedRoute
        ? RAIL_MAP_EMPHASIS_POLICY.line.contextOnRoute
        : RAIL_MAP_EMPHASIS_POLICY.line.idle,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  map.addLayer({
    id: "branch-preview-lines-selected",
    type: "line",
    source: "branch-preview-lines",
    filter: ["==", ["get", "id"], ""],
    paint: {
      "line-color": ["coalesce", ["get", "colorHex"], "#0369a1"],
      "line-width": MAP_RENDER_POLICY.selectedBranchLineWidth,
      "line-opacity": RAIL_MAP_EMPHASIS_POLICY.line.selected,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  map.addLayer({
    id: "line-branch-lines-casing",
    type: "line",
    source: "line-branch-lines",
    paint: {
      "line-color": "#ffffff",
      "line-width": MAP_RENDER_POLICY.lineBranchCasingWidth,
      "line-opacity": 0,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });

  map.addLayer({
    id: "line-branch-lines",
    type: "line",
    source: "line-branch-lines",
    paint: {
      "line-color": ["get", "colorHex"],
      "line-width": MAP_RENDER_POLICY.lineBranchLineWidth,
      "line-opacity": hasHighlightedRoute
        ? RAIL_MAP_EMPHASIS_POLICY.line.contextOnRoute
        : RAIL_MAP_EMPHASIS_POLICY.line.idle,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });

  map.addLayer({
    id: "route-result-transfer-lines",
    type: "line",
    source: "route-result-transfer-lines",
    paint: {
      "line-color": "#64748b",
      "line-width": 3.2,
      "line-opacity": 0.86,
      "line-dasharray": [0.18, 1.05],
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  map.addLayer({
    id: "route-result-lines-casing",
    type: "line",
    source: "route-result-lines",
    paint: {
      "line-color": "#ffffff",
      "line-width": 8.4,
      "line-opacity": 0.98,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  map.addLayer({
    id: "route-result-lines",
    type: "line",
    source: "route-result-lines",
    paint: {
      "line-color": ["coalesce", ["get", "colorHex"], "#10b981"],
      "line-width": 5.2,
      "line-opacity": 0.98,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  map.addSource("transfer-group-areas", {
    type: "geojson",
    data: isTransferDetailVisible(map.getZoom())
      ? transferAreaFeatures
      : EMPTY_FEATURE_COLLECTION,
  });

  map.addSource("transfer-group-icons", {
    type: "geojson",
    data: isTransferDetailVisible(map.getZoom())
      ? EMPTY_FEATURE_COLLECTION
      : transferIconFeatures,
  });

  map.addLayer({
    id: "transfer-group-areas-fill",
    type: "fill",
    source: "transfer-group-areas",
    paint: {
      "fill-color": [
        "case",
        ["==", ["get", "isSelected"], true],
        "#2563eb",
        "#0f172a",
      ],
      "fill-opacity": [
        "case",
        ["==", ["get", "isSelected"], true], 0.34,
        ["==", ["get", "isContext"], true], 0.22,
        0.06,
      ],
    },
  });

  map.addLayer({
    id: "transfer-group-areas-outline",
    type: "line",
    source: "transfer-group-areas",
    paint: {
      "line-color": [
        "case",
        ["==", ["get", "isSelected"], true],
        "#2563eb",
        "#64748b",
      ],
      "line-width": ["case", ["==", ["get", "isSelected"], true], 3.4, 2.2],
      "line-opacity": ["case", ["==", ["get", "isContext"], true], 0.9, 0.16],
    },
  });

  map.addLayer({
    id: "transfer-group-collapsed-hit",
    type: "circle",
    source: "transfer-group-icons",
    paint: {
      "circle-radius": MAP_RENDER_POLICY.transferGroupHitRadius,
      "circle-color": "rgba(0,0,0,0)",
      "circle-opacity": 0,
      "circle-stroke-opacity": 0,
    },
  });

  map.addLayer({
    id: "transfer-group-collapsed-icon",
    type: "symbol",
    source: "transfer-group-icons",
    layout: {
      "icon-image": "transfer-icon",
      "icon-size": [
        "case",
        ["==", ["get", "isSelected"], true],
        MAP_RENDER_POLICY.transferGroupSelectedIconSize,
        MAP_RENDER_POLICY.transferGroupIconSize,
      ],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-opacity": ["case", ["==", ["get", "isContext"], true], 1, 0.18],
    },
  });

  map.addLayer({
    id: "transfer-group-collapsed-label",
    type: "symbol",
    source: "transfer-group-icons",
    minzoom: RAIL_MAP_VISUAL_POLICY.stationLabelMinZoom,
    layout: {
      "text-field": ["get", "nameKo"],
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-size": RAIL_MAP_VISUAL_POLICY.stationLabelTextSize,
      "text-offset": [0, 1.45],
      "text-anchor": "top",
      "text-allow-overlap": false,
      "text-ignore-placement": false,
    },
    paint: {
      "text-color": "#0f172a",
      "text-halo-color": "#ffffff",
      "text-halo-width": RAIL_MAP_VISUAL_POLICY.stationLabelHaloWidth,
      "text-opacity": [
        "case",
        ["==", ["get", "isContext"], true],
        RAIL_MAP_EMPHASIS_POLICY.transfer.context,
        RAIL_MAP_EMPHASIS_POLICY.transfer.labelBackground,
      ],
    },
  });

  map.addSource("branch-preview-stations", {
    type: "geojson",
    data: stationFeatures,
  });

  map.addLayer({
    id: "branch-preview-stations-hit",
    type: "circle",
    source: "branch-preview-stations",
    paint: {
      "circle-radius": 12,
      "circle-color": "rgba(0,0,0,0)",
      "circle-opacity": 0,
      "circle-stroke-opacity": 0,
    },
  });

  map.addLayer({
    id: "branch-preview-stations-casing",
    type: "circle",
    source: "branch-preview-stations",
    paint: {
      "circle-color": "#ffffff",
      "circle-radius": [
        "case",
        ["==", ["get", "isEmphasized"], true],
        MAP_RENDER_POLICY.selectedStationCasingRadius,
        MAP_RENDER_POLICY.stationCasingRadius,
      ],
      "circle-opacity": [
        "case",
        ["==", ["get", "isEmphasized"], true],
        RAIL_MAP_EMPHASIS_POLICY.station.casingEmphasized,
        ["==", ["get", "isContextStation"], true],
        RAIL_MAP_EMPHASIS_POLICY.station.casingContext,
        RAIL_MAP_EMPHASIS_POLICY.station.casingBackground,
      ],
    },
  });

  map.addLayer({
    id: "branch-preview-stations-dot",
    type: "circle",
    source: "branch-preview-stations",
    paint: {
      "circle-color": ["coalesce", ["get", "colorHex"], "#64748b"],
      "circle-radius": [
        "case",
        ["==", ["get", "isEmphasized"], true],
        MAP_RENDER_POLICY.selectedStationRadius,
        MAP_RENDER_POLICY.stationRadius,
      ],
      "circle-stroke-color": [
        "case",
        ["==", ["get", "isSelected"], true],
        "#111827",
        "#ffffff",
      ],
      "circle-stroke-width": [
        "case",
        ["==", ["get", "isSelected"], true],
        MAP_RENDER_POLICY.selectedStationStrokeWidth,
        MAP_RENDER_POLICY.stationStrokeWidth,
      ],
      "circle-stroke-opacity": [
        "case",
        ["==", ["get", "isEmphasized"], true],
        RAIL_MAP_EMPHASIS_POLICY.station.emphasized,
        ["==", ["get", "isContextStation"], true],
        RAIL_MAP_EMPHASIS_POLICY.station.context,
        RAIL_MAP_EMPHASIS_POLICY.station.strokeBackground,
      ],
      "circle-opacity": [
        "case",
        ["==", ["get", "isEmphasized"], true],
        RAIL_MAP_EMPHASIS_POLICY.station.emphasized,
        ["==", ["get", "isContextStation"], true],
        RAIL_MAP_EMPHASIS_POLICY.station.context,
        RAIL_MAP_EMPHASIS_POLICY.station.background,
      ],
    },
  });

  map.addLayer({
    id: "branch-preview-station-labels",
    type: "symbol",
    source: "branch-preview-stations",
    minzoom: RAIL_MAP_VISUAL_POLICY.stationLabelMinZoom,
    filter: ["!=", ["get", "isEmphasized"], true],
    layout: {
      "text-field": ["get", "labelNameKo"],
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-size": RAIL_MAP_VISUAL_POLICY.stationLabelTextSize,
      "text-offset": [0, -1.15],
      "text-anchor": "bottom",
      "text-allow-overlap": false,
      "text-ignore-placement": false,
    },
    paint: {
      "text-color": "#0f172a",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.4,
      "text-opacity": [
        "case",
        ["==", ["get", "isRouteStation"], true],
        RAIL_MAP_EMPHASIS_POLICY.station.labelContext,
        ["==", ["get", "isContextStation"], true],
        RAIL_MAP_EMPHASIS_POLICY.station.labelContext,
        RAIL_MAP_EMPHASIS_POLICY.station.labelBackground,
      ],
    },
  });

  map.addLayer({
    id: "branch-preview-station-labels-emphasized",
    type: "symbol",
    source: "branch-preview-stations",
    minzoom: RAIL_MAP_VISUAL_POLICY.stationLabelMinZoom,
    filter: ["==", ["get", "isEmphasized"], true],
    layout: {
      "text-field": ["get", "labelNameKo"],
      "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      "text-size": RAIL_MAP_VISUAL_POLICY.selectedStationLabelTextSize,
      "text-offset": [0, -1.35],
      "text-anchor": "bottom",
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#0f172a",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.6,
      "text-opacity": 1,
    },
  });

  for (const layerId of [
    "transfer-group-collapsed-hit",
    "transfer-group-collapsed-icon",
    "transfer-group-collapsed-label",
  ]) {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  }
}

export function setRailMapSourceData(
  map: MapLibreMap,
  sourceId: string,
  data: RailFeatureCollection,
) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  source?.setData(data);
}

export function emptyRailFeatureCollection(): RailFeatureCollection {
  return EMPTY_FEATURE_COLLECTION;
}
