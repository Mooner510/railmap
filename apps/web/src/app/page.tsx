import fs from "node:fs";
import path from "node:path";
import RailExplorer from "./RailExplorer";
import {
  type RailMapBranch,
  type RailMapStation,
  type RailMapTransferGroup,
} from "./RailMap";

type MatchConfidence = "high" | "medium" | "low" | "none" | string;

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
  confidence: MatchConfidence;
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

interface CanonicalStation {
  id: string;
  stationNumber: string;
  nameKo: string;
  nameEn?: string | null;
  lineNumber: string;
  lineNameKo: string;
  lat: number | null;
  lng: number | null;
  operatorNameKo?: string | null;
  sourceCandidateId: string;
}

interface ManualStationOverride {
  stationId: string;
  nameKo?: string;
  stationNumber?: string;
  lineNameKo?: string;
  lineNumber?: string;
  colorHex?: string | null;
  lat?: number | null;
  lng?: number | null;
  enabled: boolean;
  note?: string | null;
}

interface ManualGeometryOverridePoint {
  lng: number;
  lat: number;
  kind: "station" | "control";
  stationId?: string;
}

interface ManualGeometryOverride {
  branchId: string;
  points: ManualGeometryOverridePoint[];
  enabled: boolean;
  note?: string | null;
}

interface ManualBranchStationExclusion {
  id: string;
  branchId: string;
  stationId: string;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

interface ManualBranchRouteOverride {
  id: string;
  branchId: string;
  stationIds: string[];
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

interface ManualLineBranchGeometryPoint {
  lng: number;
  lat: number;
  kind: "station" | "control";
  stationId?: string;
}

interface ManualLineBranchOverride {
  id: string;
  mode: "add-station" | "connect-line";
  parentBranchId: string;
  anchorStationId: string;
  branchStationId?: string;
  connectedBranchId?: string;
  connectedEndpointStationId?: string;
  geometry?: ManualLineBranchGeometryPoint[];
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

interface ManualTransferGroup {
  id: string;
  nameKo: string;
  stationIds: string[];
  transferMinutesByPair: Record<string, number | null>;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
}

interface ManualTransferEdge {
  id: string;
  fromStationId: string;
  toStationId: string;
  labelKo?: string | null;
  transferMinutes?: number | null;
  bidirectional?: boolean;
  enabled: boolean;
  source?: "manual" | "editor" | string;
  note?: string | null;
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
  manualTransferGroups?: ManualTransferGroup[];
  manualTransferEdges?: ManualTransferEdge[];
  stations: CanonicalStation[];
  routeStops: CanonicalRouteStop[];
  skippedRouteStops: unknown[];
  missingCanonicalLines: string[];
}

interface ManualOverlays {
  schemaVersion: 1;
  manualTransferGroups: ManualTransferGroup[];
  manualTransferEdges: ManualTransferEdge[];
  nonTransferStationIds?: string[];
  stationOverrides: ManualStationOverride[];
  branchStationExclusions: ManualBranchStationExclusion[];
  branchRouteOverrides: ManualBranchRouteOverride[];
  lineBranchOverrides: ManualLineBranchOverride[];
  geometryOverrides: ManualGeometryOverride[];
}

function makeTransferPairKey(stationIdA: string, stationIdB: string) {
  return [stationIdA, stationIdB].slice().sort().join("<->");
}

function deriveTransferEdgesFromGroups(
  groups: ManualTransferGroup[],
): ManualTransferEdge[] {
  const edges: ManualTransferEdge[] = [];

  for (const group of groups) {
    const stationIds = [...new Set(group.stationIds)].filter(Boolean);
    if (stationIds.length < 2) continue;

    for (let i = 0; i < stationIds.length - 1; i += 1) {
      for (let j = i + 1; j < stationIds.length; j += 1) {
        const fromStationId = stationIds[i];
        const toStationId = stationIds[j];
        if (!fromStationId || !toStationId || fromStationId === toStationId)
          continue;

        const pairKey = makeTransferPairKey(fromStationId, toStationId);

        edges.push({
          id: `${group.id}:${pairKey}`,
          fromStationId,
          toStationId,
          labelKo: group.nameKo || "수동 환승",
          transferMinutes: group.transferMinutesByPair?.[pairKey] ?? null,
          bidirectional: true,
          enabled: true,
          source: "editor-group",
          note: group.note ?? null,
        });
      }
    }
  }

  return edges;
}

function readManualOverlays(): ManualOverlays {
  const candidates = [
    path.join(process.cwd(), "public/data/manual-overlays.json"),
    path.join(process.cwd(), "../../data/manual/manual-overlays.json"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;

    const parsed = JSON.parse(
      fs.readFileSync(candidate, "utf8"),
    ) as Partial<ManualOverlays>;

    const manualTransferGroups = Array.isArray(parsed.manualTransferGroups)
      ? parsed.manualTransferGroups
      : [];
    const legacyEdges = Array.isArray(parsed.manualTransferEdges)
      ? parsed.manualTransferEdges.filter(
          (edge) => edge.source !== "editor-group",
        )
      : [];

    return {
      schemaVersion: 1,
      manualTransferGroups,
      manualTransferEdges: [
        ...legacyEdges,
        ...deriveTransferEdgesFromGroups(manualTransferGroups),
      ],
      nonTransferStationIds: Array.isArray(parsed.nonTransferStationIds)
        ? parsed.nonTransferStationIds
        : [],
      stationOverrides: Array.isArray(parsed.stationOverrides)
        ? parsed.stationOverrides
        : [],
      branchStationExclusions: Array.isArray((parsed as { branchStationExclusions?: unknown }).branchStationExclusions)
        ? ((parsed as { branchStationExclusions: ManualBranchStationExclusion[] }).branchStationExclusions)
        : [],
      branchRouteOverrides: Array.isArray((parsed as { branchRouteOverrides?: unknown }).branchRouteOverrides)
        ? ((parsed as { branchRouteOverrides: ManualBranchRouteOverride[] }).branchRouteOverrides)
        : [],
      lineBranchOverrides: Array.isArray((parsed as { lineBranchOverrides?: unknown }).lineBranchOverrides)
        ? ((parsed as { lineBranchOverrides: ManualLineBranchOverride[] }).lineBranchOverrides)
        : [],
      geometryOverrides: Array.isArray(parsed.geometryOverrides)
        ? parsed.geometryOverrides
        : [],
    };
  }

  return {
    schemaVersion: 1,
    manualTransferGroups: [],
    manualTransferEdges: [],
    nonTransferStationIds: [],
    stationOverrides: [],
    branchStationExclusions: [],
    branchRouteOverrides: [],
    lineBranchOverrides: [],
    geometryOverrides: [],
  };
}


function makeLineScopedStationId(stationId: string, lineKey: string) {
  const safeLineKey = lineKey.trim().replace(/[^\w가-힣:.-]+/g, "_") || "unknown";
  return `${stationId}::line:${safeLineKey}`;
}

function getLineKey(line: CanonicalLine, branch: CanonicalBranch) {
  return line.canonicalKey ?? line.id ?? branch.sourceLineNumber ?? line.nameKo;
}

type StationLineUsage = {
  lineKey: string;
  lineNameKo: string;
  sourceLineNumber: string;
  sourceLineName: string;
};

function getPrimaryStationLineKey(
  station: CanonicalStation | undefined,
  usages: StationLineUsage[] | undefined,
) {
  if (!station || !usages || usages.length < 1) return null;

  return (
    usages.find(
      (usage) =>
        station.lineNumber &&
        usage.sourceLineNumber &&
        station.lineNumber === usage.sourceLineNumber,
    ) ??
    usages.find(
      (usage) =>
        station.lineNameKo &&
        (station.lineNameKo === usage.lineNameKo ||
          station.lineNameKo === usage.sourceLineName),
    ) ??
    usages[0] ??
    null
  )?.lineKey ?? null;
}

function normalizeSingleLineStationMappings(bundle: CanonicalBundle): CanonicalBundle {
  const stationById = new Map(bundle.stations.map((station) => [station.id, station]));
  const usageByStationId = new Map<string, Map<string, StationLineUsage>>();

  for (const line of bundle.lines) {
    for (const branch of line.branches) {
      const lineKey = getLineKey(line, branch);
      for (const stop of branch.routeStops) {
        const usages = usageByStationId.get(stop.stationId) ?? new Map<string, StationLineUsage>();
        usages.set(lineKey, {
          lineKey,
          lineNameKo: line.nameKo,
          sourceLineNumber: branch.sourceLineNumber,
          sourceLineName: branch.sourceLineName,
        });
        usageByStationId.set(stop.stationId, usages);
      }
    }
  }

  const nextStationById = new Map(bundle.stations.map((station) => [station.id, station]));
  const primaryLineKeyByStationId = new Map(
    [...usageByStationId.entries()].map(([stationId, usages]) => [
      stationId,
      getPrimaryStationLineKey(stationById.get(stationId), [...usages.values()]),
    ]),
  );

  const lines = bundle.lines.map((line) => ({
    ...line,
    branches: line.branches.map((branch) => {
      const lineKey = getLineKey(line, branch);
      return {
        ...branch,
        routeStops: branch.routeStops.map((stop) => {
          const station = stationById.get(stop.stationId);
          const stationUsageCount = usageByStationId.get(stop.stationId)?.size ?? 0;
          const primaryLineKey = primaryLineKeyByStationId.get(stop.stationId);

          if (!station || stationUsageCount <= 1 || lineKey === primaryLineKey) {
            return stop;
          }

          const scopedStationId = makeLineScopedStationId(stop.stationId, lineKey);
          if (!nextStationById.has(scopedStationId)) {
            nextStationById.set(scopedStationId, {
              ...station,
              id: scopedStationId,
              stationNumber: stop.sourceStationCode || station.stationNumber,
              lineNumber: branch.sourceLineNumber || station.lineNumber,
              lineNameKo: line.nameKo || branch.sourceLineName || station.lineNameKo,
            });
          }

          return {
            ...stop,
            stationId: scopedStationId,
          };
        }),
      };
    }),
  }));

  const routeStops = lines.flatMap((line) => line.branches.flatMap((branch) => branch.routeStops));
  const referencedStationIds = new Set(routeStops.map((stop) => stop.stationId));

  return {
    ...bundle,
    stations: [...nextStationById.values()].filter(
      (station) => referencedStationIds.has(station.id) || !usageByStationId.has(station.id),
    ),
    lines,
    routeStops,
  };
}

function buildBranchStationExclusionIndex(exclusions: ManualBranchStationExclusion[]) {
  const index = new Map<string, Set<string>>();

  for (const exclusion of exclusions) {
    if (exclusion.enabled === false) continue;
    const set = index.get(exclusion.branchId) ?? new Set<string>();
    set.add(exclusion.stationId);
    index.set(exclusion.branchId, set);
  }

  return index;
}

function filterBranchRouteStops(branch: CanonicalBranch, exclusionIndex: Map<string, Set<string>>) {
  const excludedStationIds = exclusionIndex.get(branch.id);
  if (!excludedStationIds || excludedStationIds.size === 0) return branch.routeStops;
  return branch.routeStops.filter((stop) => !excludedStationIds.has(stop.stationId));
}

function applyBranchStationExclusions(bundle: CanonicalBundle, exclusions: ManualBranchStationExclusion[]): CanonicalBundle {
  const exclusionIndex = buildBranchStationExclusionIndex(exclusions);
  if (exclusionIndex.size === 0) return bundle;

  const lines = bundle.lines.map((line) => ({
    ...line,
    branches: line.branches.map((branch) => ({
      ...branch,
      routeStops: filterBranchRouteStops(branch, exclusionIndex),
    })),
  }));

  return {
    ...bundle,
    lines,
    routeStops: lines.flatMap((line) => line.branches.flatMap((branch) => branch.routeStops)),
  };
}

function applyBranchRouteOverrides(
  bundle: CanonicalBundle,
  overrides: ManualBranchRouteOverride[],
): CanonicalBundle {
  const stationById = new Map(bundle.stations.map((station) => [station.id, station]));
  const overrideByBranchId = new Map(
    overrides
      .filter((override) => override.enabled !== false && override.stationIds.length >= 2)
      .map((override) => [override.branchId, override]),
  );
  if (overrideByBranchId.size === 0) return bundle;

  const lines = bundle.lines.map((line) => ({
    ...line,
    branches: line.branches.map((branch) => {
      const override = overrideByBranchId.get(branch.id);
      if (!override) return branch;

      const stopByStationId = new Map(
        branch.routeStops.map((stop) => [stop.stationId, stop] as const),
      );
      return {
        ...branch,
        routeStops: override.stationIds.map((stationId, index) => {
          const existing = stopByStationId.get(stationId);
          const station = stationById.get(stationId);
          if (existing) return { ...existing, sequence: index + 1 };

          return {
            id: `${branch.id}:manual-route:${index + 1}:${stationId}`,
            canonicalLineId: line.canonicalKey,
            branchId: branch.id,
            sourceLineNumber: branch.sourceLineNumber,
            sourceLineName: branch.sourceLineName,
            role: branch.role,
            sequence: index + 1,
            stationId,
            sourceStationCode: station?.stationNumber ?? "",
            displayNameKo: station?.nameKo ?? stationId,
            matchStatus: "manual",
            confidence: "manual",
            sourceCandidateId: stationId,
            diagnostics: ["manual-branch-route-override"],
          } satisfies CanonicalRouteStop;
        }),
      };
    }),
  }));

  return {
    ...bundle,
    lines,
    routeStops: lines.flatMap((line) =>
      line.branches.flatMap((branch) => branch.routeStops),
    ),
  };
}

function createManualStationFromOverride(
  override: ManualStationOverride,
): CanonicalStation | null {
  if (override.enabled === false) return null;
  if (!override.nameKo?.trim()) return null;
  if (typeof override.lng !== "number" || typeof override.lat !== "number") return null;
  if (!Number.isFinite(override.lng) || !Number.isFinite(override.lat)) return null;

  return {
    id: override.stationId,
    stationNumber: override.stationNumber?.trim() || "MANUAL",
    nameKo: override.nameKo.trim(),
    nameEn: null,
    lineNumber: override.lineNumber?.trim() || "manual",
    lineNameKo: override.lineNameKo?.trim() || "수동 추가 역",
    lat: override.lat,
    lng: override.lng,
    operatorNameKo: null,
    sourceCandidateId: override.stationId,
  };
}

function applyStationOverrides(
  stations: CanonicalStation[],
  overrides: ManualStationOverride[],
): CanonicalStation[] {
  const overrideByStationId = new Map(
    overrides
      .filter((override) => override.enabled !== false)
      .map((override) => [override.stationId, override]),
  );
  const baseStationIds = new Set(stations.map((station) => station.id));

  const updatedStations = stations.map((station) => {
    const override = overrideByStationId.get(station.id);
    if (!override) return station;

    return {
      ...station,
      nameKo: override.nameKo?.trim() || station.nameKo,
      stationNumber: override.stationNumber?.trim() || station.stationNumber,
      lineNameKo: override.lineNameKo?.trim() || station.lineNameKo,
      lineNumber: override.lineNumber?.trim() || station.lineNumber,
      lat:
        typeof override.lat === "number" && Number.isFinite(override.lat)
          ? override.lat
          : station.lat,
      lng:
        typeof override.lng === "number" && Number.isFinite(override.lng)
          ? override.lng
          : station.lng,
    };
  });

  const manualStations = overrides
    .filter((override) => !baseStationIds.has(override.stationId))
    .map(createManualStationFromOverride)
    .filter((station): station is CanonicalStation => station !== null);

  return [...updatedStations, ...manualStations];
}

function readBundle(): CanonicalBundle {
  const bundlePath = path.join(
    process.cwd(),
    "public/data/kric-canonical-app-bundle.json",
  );

  const bundle = JSON.parse(
    fs.readFileSync(bundlePath, "utf8"),
  ) as CanonicalBundle;
  const manualOverlays = readManualOverlays();

  const stations = applyStationOverrides(
    bundle.stations,
    manualOverlays.stationOverrides,
  );

  return normalizeSingleLineStationMappings(
    applyBranchStationExclusions(
      applyBranchRouteOverrides(
        {
          ...bundle,
          stations,
          manualTransferGroups: manualOverlays.manualTransferGroups,
          manualTransferEdges: [
            ...(bundle.manualTransferEdges ?? []),
            ...manualOverlays.manualTransferEdges,
          ].filter((edge) => edge.enabled),
        },
        manualOverlays.branchRouteOverrides,
      ),
      manualOverlays.branchStationExclusions,
    ),
  );
}

function toMapStations(stations: CanonicalStation[]): RailMapStation[] {
  return stations.map((station) => ({
    id: station.id,
    nameKo: station.nameKo,
    lineNameKo: station.lineNameKo,
    lat: station.lat,
    lng: station.lng,
  }));
}

function buildMapStationIndex(stations: RailMapStation[]) {
  return new Map(stations.map((station) => [station.id, station]));
}

function resolveGeometryPointStationAnchors<
  TPoint extends { lng: number; lat: number; kind: string; stationId?: string },
>(points: TPoint[], stationById: Map<string, RailMapStation>): TPoint[] {
  return points.map((point) => {
    if (point.kind !== "station" || !point.stationId) return point;
    const station = stationById.get(point.stationId);
    if (
      !station ||
      typeof station.lng !== "number" ||
      typeof station.lat !== "number" ||
      !Number.isFinite(station.lng) ||
      !Number.isFinite(station.lat)
    ) {
      return point;
    }

    return {
      ...point,
      lng: station.lng,
      lat: station.lat,
    };
  });
}

function toMapLineBranchOverrides(
  overrides: ManualLineBranchOverride[],
  stationById: Map<string, RailMapStation>,
): ManualLineBranchOverride[] {
  return overrides.map((override) =>
    override.geometry?.length
      ? {
          ...override,
          geometry: resolveGeometryPointStationAnchors(
            override.geometry,
            stationById,
          ),
        }
      : override,
  );
}

function toMapBranches(
  bundle: CanonicalBundle,
  geometryOverrides: ManualGeometryOverride[],
  branchStationExclusions: ManualBranchStationExclusion[],
  stationById: Map<string, RailMapStation>,
): RailMapBranch[] {
  const exclusionByBranchId = buildBranchStationExclusionIndex(branchStationExclusions);
  const overrideByBranchId = new Map(
    geometryOverrides
      .filter(
        (override) => override.enabled !== false && override.points.length >= 2,
      )
      .map((override) => [override.branchId, override]),
  );

  return bundle.lines.flatMap((line) =>
    line.branches.map((branch) => {
      const override = overrideByBranchId.get(branch.id);

      return {
        id: branch.id,
        canonicalLineId: line.canonicalKey,
        canonicalLineNameKo: line.nameKo,
        colorHex: line.colorHex,
        role: branch.role,
        sourceLineNumber: branch.sourceLineNumber,
        sourceLineName: branch.sourceLineName,
        geometryOverrideCoordinates: override
          ? resolveGeometryPointStationAnchors(
              override.points.filter(
                (point) =>
                  !exclusionByBranchId.get(branch.id)?.has(
                    point.stationId ?? "",
                  ),
              ),
              stationById,
            )
              .filter(
                (point) =>
                  Number.isFinite(point.lng) && Number.isFinite(point.lat),
              )
              .map((point) => [point.lng, point.lat] as [number, number])
          : undefined,
        routeStops: branch.routeStops.map((stop) => ({
          id: stop.id,
          sequence: stop.sequence,
          displayNameKo: stop.displayNameKo,
          station: stationById.get(stop.stationId) ?? null,
          confidence: stop.confidence,
        })),
      };
    }),
  );
}

function toMapTransferGroups(
  groups: ManualTransferGroup[],
): RailMapTransferGroup[] {
  return groups
    .filter((group) => group.enabled !== false && group.stationIds.length >= 2)
    .map((group) => ({
      id: group.id,
      nameKo: group.nameKo,
      stationIds: group.stationIds,
      enabled: group.enabled,
      note: group.note ?? null,
    }));
}

export default function Home() {
  const bundle = readBundle();
  const manualOverlays = readManualOverlays();
  const mapStations = toMapStations(bundle.stations);
  const mapStationById = buildMapStationIndex(mapStations);

  return (
    <main className="h-[100dvh] overflow-hidden bg-slate-950 text-slate-950">
      <RailExplorer
        bundle={bundle}
        mapStations={mapStations}
        mapBranches={toMapBranches(
          bundle,
          manualOverlays.geometryOverrides,
          manualOverlays.branchStationExclusions,
          mapStationById,
        )}
        lineBranchOverrides={toMapLineBranchOverrides(
          manualOverlays.lineBranchOverrides,
          mapStationById,
        )}
        transferGroups={toMapTransferGroups(
          manualOverlays.manualTransferGroups,
        )}
      />
    </main>
  );
}
