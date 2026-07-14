import { isTransferDetailVisible } from "@repo/ui/map/renderPolicy";
import type { Map as MapLibreMap } from "maplibre-gl";
import type {
  RailMapBranch,
  RailMapStation,
  RailMapTransferGroup,
} from "../RailMap";
import { RAIL_MAP_INTERACTIVE_LAYER_IDS } from "./railMapLayers";

interface BindRailMapInteractionsOptions {
  map: MapLibreMap;
  getBranchById: (branchId: string) => RailMapBranch | undefined;
  getStationById: (stationId: string) => RailMapStation | undefined;
  getTransferGroupById: (groupId: string) => RailMapTransferGroup | undefined;
  onSelectBranch: (branch: RailMapBranch) => void;
  onSelectStation: (station: RailMapStation) => void;
  onSelectTransferGroup: (group: RailMapTransferGroup) => void;
  onClearSelection: () => void;
}

function setPointerCursor(map: MapLibreMap, active: boolean) {
  map.getCanvas().style.cursor = active ? "pointer" : "";
}

export function bindRailMapInteractions({
  map,
  getBranchById,
  getStationById,
  getTransferGroupById,
  onSelectBranch,
  onSelectStation,
  onSelectTransferGroup,
  onClearSelection,
}: BindRailMapInteractionsOptions) {
  const {
    branchLine,
    selectedBranchLine,
    stationHit,
    transferArea,
    transferCollapsed,
  } = RAIL_MAP_INTERACTIVE_LAYER_IDS;

  map.on("mouseenter", branchLine, () => setPointerCursor(map, true));
  map.on("mouseleave", branchLine, () => setPointerCursor(map, false));

  map.on("click", branchLine, (event) => {
    const stationHits = map.queryRenderedFeatures(event.point, {
      layers: map.getLayer(stationHit) ? [stationHit] : [],
    });
    if (stationHits.length > 0) return;

    const properties = event.features?.[0]?.properties as
      | Record<string, unknown>
      | undefined;
    const branch = getBranchById(String(properties?.id ?? ""));
    if (branch) onSelectBranch(branch);
  });

  for (const layerId of [transferCollapsed, transferArea, stationHit]) {
    map.on("mouseenter", layerId, () => setPointerCursor(map, true));
    map.on("mouseleave", layerId, () => setPointerCursor(map, false));
  }

  const selectTransferGroup = (
    feature: { properties?: Record<string, unknown> | null } | undefined,
  ) => {
    const group = getTransferGroupById(String(feature?.properties?.id ?? ""));
    if (group) onSelectTransferGroup(group);
  };

  map.on("click", transferCollapsed, (event) => {
    selectTransferGroup(event.features?.[0]);
  });
  map.on("click", transferArea, (event) => {
    selectTransferGroup(event.features?.[0]);
  });
  map.on("click", stationHit, (event) => {
    const properties = event.features?.[0]?.properties as
      | Record<string, unknown>
      | undefined;
    const station = getStationById(String(properties?.id ?? ""));
    if (station) onSelectStation(station);
  });

  map.on("click", (event) => {
    const transferDetailVisible = isTransferDetailVisible(map.getZoom());
    const interactiveLayers = [
      branchLine,
      selectedBranchLine,
      ...(transferDetailVisible
        ? [transferArea, stationHit]
        : [transferCollapsed, stationHit]),
    ].filter((layerId) => map.getLayer(layerId));

    const interactiveFeatures = interactiveLayers.length
      ? map.queryRenderedFeatures(event.point, { layers: interactiveLayers })
      : [];

    if (interactiveFeatures.length === 0) onClearSelection();
  });
}
