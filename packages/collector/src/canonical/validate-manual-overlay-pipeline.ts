import fs from "node:fs";
import path from "node:path";
import { findRepoRoot } from "../shared/fs.js";

type JsonRecord = Record<string, any>;

type IssueSeverity = "error" | "warning";

type ValidationIssue = {
  severity: IssueSeverity;
  code: string;
  where: string;
  message: string;
  cause: string;
  fix: string;
};

type ManualOverlayBundle = {
  schemaVersion?: number;
  manualTransferGroups?: Array<{
    id?: string;
    stationIds?: string[];
    enabled?: boolean;
  }>;
  manualTransferEdges?: Array<{
    id?: string;
    fromStationId?: string;
    toStationId?: string;
    enabled?: boolean;
  }>;
  stationOverrides?: Array<{
    stationId?: string;
    nameKo?: string;
    lineNameKo?: string;
    lineNumber?: string;
    lat?: number | null;
    lng?: number | null;
    enabled?: boolean;
  }>;
  branchStationExclusions?: Array<{
    id?: string;
    branchId?: string;
    stationId?: string;
    enabled?: boolean;
  }>;
  branchRouteOverrides?: Array<{
    id?: string;
    branchId?: string;
    stationIds?: string[];
    circular?: boolean;
    enabled?: boolean;
  }>;
  lineBranchOverrides?: Array<{
    id?: string;
    mode?: string;
    parentBranchId?: string;
    anchorStationId?: string;
    branchStationId?: string;
    connectedBranchId?: string;
    connectedEndpointStationId?: string;
    geometry?: Array<{ lng?: number; lat?: number; kind?: string; stationId?: string }>;
    enabled?: boolean;
  }>;
  geometryOverrides?: Array<{
    branchId?: string;
    enabled?: boolean;
    points?: Array<{ lng?: number; lat?: number; kind?: string; stationId?: string }>;
  }>;
  lineMetadataOverrides?: Array<{
    lineId?: string;
    category?: string;
    serviceTypes?: string[];
    trainPerformance?: { accelerationMps2?: number | null; decelerationMps2?: number | null; maxSpeedKph?: number | null };
    enabled?: boolean;
  }>;
  manualLineDefinitions?: Array<{
    id?: string;
    nameKo?: string;
    colorHex?: string;
    railType?: string;
    serviceTypes?: string[];
    status?: string;
    coverageStatus?: string;
    enabled?: boolean;
  }>;
  manualBranchDefinitions?: Array<{
    id?: string;
    lineId?: string;
    nameKo?: string;
    stationIds?: string[];
    circular?: boolean;
    enabled?: boolean;
  }>;
  manualTransferReviewEvents?: Array<{
    id?: string;
    type?: string;
    transferGroupId?: string | null;
    suggestionKey?: string | null;
    nameKo?: string;
    stationIds?: string[];
    decidedAt?: string;
    reason?: string | null;
  }>;
  manualServicePatterns?: Array<{
    id?: string;
    nameKo?: string;
    lineId?: string | null;
    branchId?: string | null;
    serviceType?: string;
    stops?: Array<{ stationId?: string; sequence?: number }>;
    enabled?: boolean;
  }>;
  manualTrainRuns?: Array<{
    id?: string;
    patternId?: string | null;
    trainNumber?: string | null;
    serviceType?: string;
    stopTimes?: Array<{ stationId?: string; sequence?: number; arrivalTime?: string | null; departureTime?: string | null }>;
    enabled?: boolean;
  }>;
};

const REQUIRED_OVERLAY_ARRAY_KEYS = [
  "manualTransferGroups",
  "manualTransferEdges",
  "stationOverrides",
  "branchStationExclusions",
  "lineBranchOverrides",
  "geometryOverrides",
  "lineMetadataOverrides",
  "manualLineDefinitions",
  "manualBranchDefinitions",
  "manualTransferReviewEvents",
  "manualServicePatterns",
  "manualTrainRuns",
] as const;

function readJson(filePath: string): JsonRecord | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonRecord;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;

  const source = value as JsonRecord;
  return Object.keys(source)
    .sort()
    .reduce<JsonRecord>((result, key) => {
      result[key] = sortJson(source[key]);
      return result;
    }, {});
}

function normalizeCoordinate(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function isValidLngLat(lng: unknown, lat: unknown) {
  const lngValue = normalizeCoordinate(lng);
  const latValue = normalizeCoordinate(lat);
  return (
    lngValue !== null &&
    latValue !== null &&
    lngValue >= 124 &&
    lngValue <= 132 &&
    latValue >= 33 &&
    latValue <= 39
  );
}

function getBaseStationId(stationId: string | undefined) {
  if (!stationId) return null;
  const marker = "::line:";
  const index = stationId.indexOf(marker);
  return index >= 0 ? stationId.slice(0, index) : null;
}

function getStationRecord(stationById: Map<string, JsonRecord>, stationId: string | undefined) {
  if (!stationId) return null;
  return stationById.get(stationId) ?? stationById.get(getBaseStationId(stationId) ?? "") ?? null;
}

function getStationName(stationId: string | undefined, stationById: Map<string, JsonRecord>) {
  if (!stationId) return "-";
  const station = getStationRecord(stationById, stationId);
  if (!station) return stationId;
  return `${station.nameKo ?? stationId}(${station.lineNameKo ?? "-"})`;
}

function addIssue(issues: ValidationIssue[], issue: ValidationIssue) {
  issues.push(issue);
}

function collectDuplicateIds(
  issues: ValidationIssue[],
  items: Array<{ id?: string; enabled?: boolean }> | undefined,
  collectionName: string,
) {
  const seen = new Set<string>();
  for (const item of items ?? []) {
    if (item.enabled === false) continue;
    const id = String(item.id ?? "").trim();
    if (!id) continue;
    if (!seen.has(id)) {
      seen.add(id);
      continue;
    }
    addIssue(issues, {
      severity: "error",
      code: "duplicate-manual-id",
      where: `${collectionName}:${id}`,
      message: "수기 보정 ID가 중복되었습니다.",
      cause: "동일한 override id가 두 번 이상 저장되어 적용 순서가 불명확합니다.",
      fix: "중복 항목 중 하나를 삭제하거나 ID를 새로 생성하세요.",
    });
  }
}

function buildLineById(bundle: JsonRecord) {
  const lineById = new Map<string, JsonRecord>();
  for (const line of (bundle.lines ?? []) as JsonRecord[]) {
    if (typeof line.id === "string") lineById.set(line.id, line);
    if (typeof line.canonicalKey === "string") lineById.set(line.canonicalKey, line);
  }
  return lineById;
}

function addManualLinesToLineIndex(lineById: Map<string, JsonRecord>, overlays: ManualOverlayBundle) {
  for (const line of overlays.manualLineDefinitions ?? []) {
    if (line.enabled === false || !line.id) continue;
    lineById.set(line.id, {
      id: line.id,
      canonicalKey: line.id,
      nameKo: line.nameKo,
      category: line.railType,
      serviceTypes: line.serviceTypes ?? [],
    });
  }
}

function buildBranchById(bundle: JsonRecord) {
  const branchById = new Map<string, JsonRecord & { lineNameKo?: string }>();
  for (const line of (bundle.lines ?? []) as JsonRecord[]) {
    for (const branch of (line.branches ?? []) as JsonRecord[]) {
      const id = String(branch.id ?? "");
      if (!id) continue;
      branchById.set(id, { ...branch, lineNameKo: line.nameKo });
    }
  }
  return branchById;
}

function addManualBranchesToBranchIndex(
  branchById: Map<string, JsonRecord & { lineNameKo?: string }>,
  overlays: ManualOverlayBundle,
) {
  const manualLineById = new Map(
    (overlays.manualLineDefinitions ?? [])
      .filter((line) => line.enabled !== false && line.id)
      .map((line) => [String(line.id), line]),
  );

  for (const branch of overlays.manualBranchDefinitions ?? []) {
    if (branch.enabled === false || !branch.id || !branch.lineId) continue;
    const line = manualLineById.get(branch.lineId);
    if (!line) continue;
    branchById.set(branch.id, {
      id: branch.id,
      canonicalLineId: branch.lineId,
      role: "main",
      sourceLineNumber: branch.lineId,
      sourceLineName: branch.nameKo ?? line.nameKo ?? branch.lineId,
      routeStops: (branch.stationIds ?? []).map((stationId, index) => ({
        stationId,
        sequence: index + 1,
      })),
      lineNameKo: line.nameKo,
    });
  }
}

function buildStationById(bundle: JsonRecord, overlays: ManualOverlayBundle) {
  const stationById = new Map<string, JsonRecord>();
  for (const station of (bundle.stations ?? []) as JsonRecord[]) {
    if (station.id) stationById.set(String(station.id), station);
  }

  for (const override of overlays.stationOverrides ?? []) {
    if (override.enabled === false || !override.stationId) continue;
    const existing = stationById.get(override.stationId) ?? {};
    stationById.set(override.stationId, { ...existing, ...override, id: override.stationId });
  }

  return stationById;
}

function validateStationReference(
  issues: ValidationIssue[],
  stationById: Map<string, JsonRecord>,
  stationId: string | undefined,
  where: string,
  role: string,
) {
  if (!stationId) {
    addIssue(issues, {
      severity: "error",
      code: "missing-station-reference",
      where,
      message: `${role} 역 ID가 비어 있습니다.`,
      cause: "수기 보정 항목이 역을 가리키지 못해 editor/web 적용 결과가 불안정합니다.",
      fix: "대상 역을 다시 선택하거나 해당 수기 보정 항목을 삭제하세요.",
    });
    return;
  }

  if (getStationRecord(stationById, stationId)) return;

  addIssue(issues, {
    severity: "error",
    code: "unknown-station-reference",
    where,
    message: `존재하지 않는 역을 참조합니다: ${stationId}`,
    cause: "canonical bundle 또는 manual station override에 없는 stationId입니다.",
    fix: "새 역이면 stationOverrides에 이름/노선/좌표를 포함해 생성하고, 오타면 올바른 stationId로 교체하세요.",
  });
}

function validateBranchReference(
  issues: ValidationIssue[],
  branchById: Map<string, JsonRecord>,
  branchId: string | undefined,
  where: string,
  role: string,
) {
  if (!branchId) {
    addIssue(issues, {
      severity: "error",
      code: "missing-branch-reference",
      where,
      message: `${role} branch ID가 비어 있습니다.`,
      cause: "수기 보정 항목이 어느 노선/지선에 적용되는지 알 수 없습니다.",
      fix: "대상 branch를 다시 선택하거나 해당 수기 보정 항목을 삭제하세요.",
    });
    return;
  }

  if (branchById.has(branchId)) return;

  addIssue(issues, {
    severity: "error",
    code: "unknown-branch-reference",
    where,
    message: `존재하지 않는 branch를 참조합니다: ${branchId}`,
    cause: "canonical bundle에 없는 branchId입니다. source line map 변경 또는 수기 보정 stale 상태일 수 있습니다.",
    fix: "최신 branchId로 다시 연결하거나 해당 수기 보정 항목을 삭제하세요.",
  });
}

function validateGeometryPoint(
  issues: ValidationIssue[],
  stationById: Map<string, JsonRecord>,
  point: { lng?: number; lat?: number; kind?: string; stationId?: string },
  where: string,
) {
  if (!isValidLngLat(point.lng, point.lat)) {
    addIssue(issues, {
      severity: "error",
      code: "invalid-geometry-coordinate",
      where,
      message: "선형 좌표가 비어 있거나 한국 범위를 벗어났습니다.",
      cause: "NaN/Infinity/잘못된 위경도 또는 좌표 순서 오류일 가능성이 큽니다.",
      fix: "지도에서 위치를 다시 찍거나 control point 좌표를 올바른 lng/lat로 수정하세요.",
    });
  }

  if (point.kind !== "station" && point.kind !== "control") {
    addIssue(issues, {
      severity: "error",
      code: "invalid-geometry-point-kind",
      where,
      message: `선형 point kind가 잘못되었습니다: ${String(point.kind ?? "-")}`,
      cause: "선형 point는 역 기준점(station) 또는 경유점(control)이어야 합니다.",
      fix: "역 아이콘에 붙는 점이면 station, 단순 경유점이면 control로 저장하세요.",
    });
  }

  if (point.kind === "station") {
    validateStationReference(issues, stationById, point.stationId, where, "선형 기준점");
  }
}

function validateBranchGeometryCoverage(
  issues: ValidationIssue[],
  bundle: JsonRecord,
  overlays: ManualOverlayBundle,
  stationById: Map<string, JsonRecord>,
) {
  const geometryOverrideByBranchId = new Map(
    (overlays.geometryOverrides ?? [])
      .filter((override) => override.enabled !== false && override.branchId)
      .map((override) => [String(override.branchId), override]),
  );

  const routeOverrideByBranchId = new Map(
    (overlays.branchRouteOverrides ?? [])
      .filter((override) => override.enabled !== false && override.branchId)
      .map((override) => [String(override.branchId), override]),
  );

  for (const line of (bundle.lines ?? []) as JsonRecord[]) {
    for (const branch of (line.branches ?? []) as JsonRecord[]) {
      const branchId = String(branch.id ?? "");
      if (!branchId) continue;

      const routeOverride = routeOverrideByBranchId.get(branchId);
      const routeStopStationIds = Array.isArray(routeOverride?.stationIds)
        ? routeOverride?.stationIds ?? []
        : ((branch.routeStops ?? []) as JsonRecord[]).map((stop) => String(stop.stationId ?? "")).filter(Boolean);

      const stationCoordinateCount = routeStopStationIds.filter((stationId) => {
        const station = getStationRecord(stationById, stationId);
        return station && isValidLngLat(station.lng, station.lat);
      }).length;

      const geometryOverride = geometryOverrideByBranchId.get(branchId);
      const overridePointCount = (geometryOverride?.points ?? []).filter((point) =>
        isValidLngLat(point.lng, point.lat),
      ).length;

      if (routeStopStationIds.length >= 2 && Math.max(stationCoordinateCount, overridePointCount) < 2) {
        addIssue(issues, {
          severity: "error",
          code: "branch-without-renderable-geometry",
          where: `branch:${branchId}`,
          message: `${line.nameKo ?? branchId} branch가 지도에 그려질 좌표를 충분히 갖고 있지 않습니다.`,
          cause: "정차역은 2개 이상이지만 역 좌표 또는 geometry override 좌표가 부족해 web 지도에서 조용히 누락될 수 있습니다.",
          fix: "역 위치를 보정하거나 editor 검증 탭에서 선형 없음 항목의 개별 해결로 임시 선형을 생성하세요.",
        });
      }
    }
  }
}

function validateCircularConnectionRules(
  issues: ValidationIssue[],
  overlays: ManualOverlayBundle,
  branchById: Map<string, JsonRecord>,
) {
  const circularBranchIds = new Set(
    (overlays.branchRouteOverrides ?? [])
      .filter((override) => override.enabled !== false && override.circular === true && override.branchId)
      .map((override) => String(override.branchId)),
  );

  for (const override of overlays.lineBranchOverrides ?? []) {
    if (override.enabled === false || override.mode !== "connect-line") continue;
    if (!override.parentBranchId || !circularBranchIds.has(override.parentBranchId)) continue;

    const parentBranch = branchById.get(override.parentBranchId);
    addIssue(issues, {
      severity: "error",
      code: "circular-parent-external-connection",
      where: `lineBranchOverrides:${override.id ?? override.parentBranchId}`,
      message: `순환 노선은 외부 노선으로 지선 결합할 수 없습니다: ${parentBranch?.lineNameKo ?? override.parentBranchId}`,
      cause: "순환 노선은 시작/끝 역이 없기 때문에 순환 노선 자체를 source로 외부 결합하면 방향성이 깨집니다.",
      fix: "순환 노선에서 시작한 외부 결합 override를 삭제하세요. 일반 노선이 순환 노선의 특정 역으로 들어오는 결합은 허용됩니다.",
    });
  }
}

function validateManualOverlaySchema(issues: ValidationIssue[], overlays: ManualOverlayBundle) {
  if (overlays.schemaVersion !== 1) {
    addIssue(issues, {
      severity: "error",
      code: "invalid-manual-overlay-schema-version",
      where: "data/manual/manual-overlays.json:schemaVersion",
      message: "manual overlay schemaVersion은 1이어야 합니다.",
      cause: "editor/web/collector가 같은 schema version을 기준으로 동작해야 합니다.",
      fix: "manual overlay 파일을 editor 저장 흐름으로 다시 저장하거나 schemaVersion을 1로 맞추세요.",
    });
  }

  for (const key of REQUIRED_OVERLAY_ARRAY_KEYS) {
    if (Array.isArray((overlays as JsonRecord)[key])) continue;
    addIssue(issues, {
      severity: "error",
      code: "missing-manual-overlay-array",
      where: `data/manual/manual-overlays.json:${key}`,
      message: `${key} 배열이 없습니다.`,
      cause: "manual overlay 파일이 부분적으로 손상되었거나 구버전 구조입니다.",
      fix: "editor에서 수기 보정을 다시 저장해 전체 overlay 구조를 재생성하세요.",
    });
  }
}

function validatePublicExportParity(
  issues: ValidationIssue[],
  repoRoot: string,
  manualOverlays: JsonRecord,
  publicOverlays: JsonRecord | null,
  generatedBundle: JsonRecord,
  publicBundle: JsonRecord | null,
) {
  if (!publicOverlays) {
    addIssue(issues, {
      severity: "error",
      code: "missing-public-manual-overlays",
      where: "apps/web/public/data/manual-overlays.json",
      message: "web public manual overlay export 파일이 없습니다.",
      cause: "collector/build export 단계가 실행되지 않았거나 파일이 삭제되었습니다.",
      fix: "collector를 다시 실행해 data/manual/manual-overlays.json을 public data로 export하세요.",
    });
  } else if (stableStringify(manualOverlays) !== stableStringify(publicOverlays)) {
    addIssue(issues, {
      severity: "error",
      code: "manual-overlay-public-export-mismatch",
      where: "data/manual/manual-overlays.json -> apps/web/public/data/manual-overlays.json",
      message: "수기 보정 원본과 web public export가 서로 다릅니다.",
      cause: "data/manual을 수정한 뒤 public data export가 갱신되지 않았습니다.",
      fix: "collector를 다시 실행하거나 manual-overlays export 단계를 수행하세요.",
    });
  }

  if (!publicBundle) {
    addIssue(issues, {
      severity: "error",
      code: "missing-public-canonical-bundle",
      where: "apps/web/public/data/kric-canonical-app-bundle.json",
      message: "web public canonical bundle 파일이 없습니다.",
      cause: "collector/build export 단계가 실행되지 않았거나 파일이 삭제되었습니다.",
      fix: "collector를 다시 실행해 generated bundle을 public data로 export하세요.",
    });
  } else if (stableStringify(generatedBundle) !== stableStringify(publicBundle)) {
    addIssue(issues, {
      severity: "error",
      code: "canonical-bundle-public-export-mismatch",
      where: "data/generated/.../kric-canonical-app-bundle.json -> apps/web/public/data/kric-canonical-app-bundle.json",
      message: "generated canonical bundle과 web public bundle이 서로 다릅니다.",
      cause: "collector 생성 결과가 public data로 복사되지 않았거나 수동으로 public 파일만 수정되었습니다.",
      fix: "collector를 다시 실행해 generated/public bundle을 같은 결과로 갱신하세요.",
    });
  }

  if (issues.some((issue) => issue.code.includes("public"))) {
    console.error(`[collector] export parity root: ${repoRoot}`);
  }
}

function validateLineMetadataOverrides(
  issues: ValidationIssue[],
  lineById: Map<string, JsonRecord>,
  overlays: ManualOverlayBundle,
) {
  const validCategories = new Set([
    "urban_rail",
    "gtx",
    "conventional_rail",
    "high_speed_rail",
  ]);
  const validServiceTypes = new Set([
    "subway",
    "gtx",
    "ktx",
    "srt",
    "itx",
    "saemaeul",
    "mugunghwa",
    "nuriro",
    "airport_rail",
    "unknown",
  ]);

  for (const override of overlays.lineMetadataOverrides ?? []) {
    if (override.enabled === false) continue;
    const where = `lineMetadataOverrides:${override.lineId ?? "-"}`;
    if (!override.lineId || !lineById.has(override.lineId)) {
      addIssue(issues, {
        severity: "error",
        code: "invalid-line-metadata-line",
        where,
        message: "노선 메타데이터가 존재하지 않는 lineId를 참조합니다.",
        cause: "lineMetadataOverrides.lineId가 canonical line id/canonicalKey와 일치하지 않습니다.",
        fix: "편집기에서 실제 노선을 다시 선택하거나 lineId를 현재 bundle의 canonicalKey로 수정하세요.",
      });
    }
    if (override.category && !validCategories.has(override.category)) {
      addIssue(issues, {
        severity: "error",
        code: "invalid-line-category",
        where,
        message: "지원하지 않는 철도 유형입니다.",
        cause: "category가 허용 enum에 없습니다.",
        fix: "urban_rail, gtx, conventional_rail, high_speed_rail 중 하나로 수정하세요.",
      });
    }
    for (const serviceType of override.serviceTypes ?? []) {
      if (!validServiceTypes.has(serviceType)) {
        addIssue(issues, {
          severity: "error",
          code: "invalid-line-service-type",
          where,
          message: "지원하지 않는 서비스 타입입니다.",
          cause: "serviceTypes에 허용되지 않은 값이 포함되어 있습니다.",
          fix: "subway, gtx, ktx, srt, itx, saemaeul, mugunghwa, nuriro, airport_rail, unknown 중 하나로 수정하세요.",
        });
      }
    }
  }
}

function validateManualLineDefinitions(
  issues: ValidationIssue[],
  overlays: ManualOverlayBundle,
  stationById: Map<string, JsonRecord>,
) {
  const validRailTypes = new Set([
    "high_speed_rail",
    "semi_high_speed_rail",
    "trunk_rail",
    "branch_rail",
    "urban_rail",
  ]);
  const validStatuses = new Set(["open", "construction", "planned", "closed"]);
  const validCoverageStatuses = new Set(["draft", "partial", "complete"]);
  const validServiceTypes = new Set([
    "subway",
    "gtx",
    "ktx",
    "srt",
    "itx",
    "saemaeul",
    "mugunghwa",
    "nuriro",
    "airport_rail",
    "unknown",
  ]);

  const enabledLineIds = new Set<string>();

  for (const line of overlays.manualLineDefinitions ?? []) {
    if (line.enabled === false) continue;
    const where = `manualLineDefinitions:${line.id ?? "-"}`;
    if (!line.id || !line.nameKo) {
      addIssue(issues, {
        severity: "error",
        code: "invalid-manual-line-definition",
        where,
        message: "수기 노선 정의에 id 또는 노선명이 없습니다.",
        cause: "수기 노선은 canonical bundle에 없는 Line을 생성하므로 고유 id와 표시 이름이 필수입니다.",
        fix: "노선 id와 nameKo를 입력하거나 해당 수기 노선 항목을 삭제하세요.",
      });
      continue;
    }
    enabledLineIds.add(line.id);
    if (line.railType && !validRailTypes.has(line.railType)) {
      addIssue(issues, {
        severity: "error",
        code: "invalid-manual-rail-type",
        where,
        message: "지원하지 않는 수기 철도 유형입니다.",
        cause: "railType이 허용 enum에 없습니다.",
        fix: "high_speed_rail, semi_high_speed_rail, trunk_rail, branch_rail, urban_rail 중 하나로 수정하세요.",
      });
    }
    if (line.status && !validStatuses.has(line.status)) {
      addIssue(issues, {
        severity: "error",
        code: "invalid-manual-rail-status",
        where,
        message: "지원하지 않는 수기 노선 운영 상태입니다.",
        cause: "status가 허용 enum에 없습니다.",
        fix: "open, construction, planned, closed 중 하나로 수정하세요.",
      });
    }
    if (line.coverageStatus && !validCoverageStatuses.has(line.coverageStatus)) {
      addIssue(issues, {
        severity: "error",
        code: "invalid-manual-line-coverage-status",
        where,
        message: "지원하지 않는 수기 노선 구축 상태입니다.",
        cause: "coverageStatus가 허용 enum에 없습니다.",
        fix: "draft, partial, complete 중 하나로 수정하세요.",
      });
    }
    for (const serviceType of line.serviceTypes ?? []) {
      if (!validServiceTypes.has(serviceType)) {
        addIssue(issues, {
          severity: "error",
          code: "invalid-manual-line-service-type",
          where,
          message: "수기 노선에 지원하지 않는 서비스 타입이 있습니다.",
          cause: "serviceTypes에 허용되지 않은 값이 포함되어 있습니다.",
          fix: "KTX/SRT/ITX/무궁화 등은 허용 enum 값으로 저장하세요.",
        });
      }
    }
  }

  const branchIds = new Set<string>();
  for (const branch of overlays.manualBranchDefinitions ?? []) {
    if (branch.enabled === false) continue;
    const where = `manualBranchDefinitions:${branch.id ?? "-"}`;
    if (!branch.id || !branch.lineId) {
      addIssue(issues, {
        severity: "error",
        code: "invalid-manual-branch-definition",
        where,
        message: "수기 지선 정의에 id 또는 lineId가 없습니다.",
        cause: "수기 지선은 어떤 수기 노선에 속하는지 명확해야 합니다.",
        fix: "branch id와 lineId를 입력하거나 해당 수기 지선 항목을 삭제하세요.",
      });
      continue;
    }
    if (branchIds.has(branch.id)) {
      addIssue(issues, {
        severity: "error",
        code: "duplicate-manual-branch-definition",
        where,
        message: "수기 지선 id가 중복되었습니다.",
        cause: "동일한 branch id가 여러 번 정의되면 routeStop 병합 결과가 불안정합니다.",
        fix: "중복 branch id 중 하나를 변경하거나 삭제하세요.",
      });
    }
    branchIds.add(branch.id);
    if (!enabledLineIds.has(branch.lineId)) {
      addIssue(issues, {
        severity: "error",
        code: "unknown-manual-branch-line",
        where,
        message: "수기 지선이 존재하지 않는 수기 노선을 참조합니다.",
        cause: "manualBranchDefinitions.lineId가 활성 manualLineDefinitions.id와 일치하지 않습니다.",
        fix: "lineId를 실제 수기 노선 id로 수정하거나 먼저 수기 노선을 생성하세요.",
      });
    }
    if ((branch.stationIds ?? []).length < 2) {
      addIssue(issues, {
        severity: "warning",
        code: "manual-branch-too-few-stations",
        where,
        message: "수기 지선의 정차역이 2개 미만입니다.",
        cause: "노선 지도 선형을 만들려면 최소 2개 역이 필요합니다.",
        fix: "지도에서 시작역과 종착역 이상을 추가한 뒤 저장하세요.",
      });
    }
    for (const stationId of branch.stationIds ?? []) {
      validateStationReference(issues, stationById, stationId, where, "수기 노선 정차역");
    }
  }
}

function validateServicePatternsAndTimetables(
  issues: ValidationIssue[],
  overlays: ManualOverlayBundle,
  stationById: Map<string, JsonRecord>,
  branchById: Map<string, JsonRecord>,
  lineById: Map<string, JsonRecord>,
) {
  const validServiceTypes = new Set([
    "subway",
    "gtx",
    "ktx",
    "srt",
    "itx",
    "saemaeul",
    "mugunghwa",
    "nuriro",
    "airport_rail",
    "unknown",
  ]);

  const patternIds = new Set<string>();

  for (const pattern of overlays.manualServicePatterns ?? []) {
    if (pattern.enabled === false) continue;
    const where = `manualServicePatterns:${pattern.id ?? "-"}`;
    if (!pattern.id || !pattern.nameKo) {
      addIssue(issues, {
        severity: "error",
        code: "invalid-service-pattern",
        where,
        message: "운행 패턴에 id 또는 이름이 없습니다.",
        cause: "정차 패턴은 시간표와 연결되는 기준 데이터라 고유 id와 이름이 필요합니다.",
        fix: "패턴 id/nameKo를 입력하거나 해당 항목을 삭제하세요.",
      });
      continue;
    }
    patternIds.add(pattern.id);
    if (pattern.lineId && !lineById.has(pattern.lineId)) {
      addIssue(issues, {
        severity: "error",
        code: "unknown-service-pattern-line",
        where,
        message: "운행 패턴이 존재하지 않는 lineId를 참조합니다.",
        cause: "lineId가 canonical/manual line에 없습니다.",
        fix: "실제 노선 id로 수정하거나 lineId를 비워 미분류 패턴으로 두세요.",
      });
    }
    if (pattern.branchId && !branchById.has(pattern.branchId)) {
      addIssue(issues, {
        severity: "error",
        code: "unknown-service-pattern-branch",
        where,
        message: "운행 패턴이 존재하지 않는 branchId를 참조합니다.",
        cause: "branchId가 canonical/manual branch에 없습니다.",
        fix: "실제 branch id로 수정하거나 branchId를 비워 노선 단위 패턴으로 두세요.",
      });
    }
    if (pattern.serviceType && !validServiceTypes.has(pattern.serviceType)) {
      addIssue(issues, {
        severity: "error",
        code: "invalid-service-pattern-type",
        where,
        message: "운행 패턴의 서비스 타입이 잘못되었습니다.",
        cause: "serviceType이 허용 enum에 없습니다.",
        fix: "KTX/SRT/ITX/무궁화 등 허용 enum으로 수정하세요.",
      });
    }
    for (const [index, stop] of (pattern.stops ?? []).entries()) {
      validateStationReference(issues, stationById, stop.stationId, `${where}:stops:${index}`, "운행 패턴 정차역");
    }
  }

  for (const run of overlays.manualTrainRuns ?? []) {
    if (run.enabled === false) continue;
    const where = `manualTrainRuns:${run.id ?? "-"}`;
    if (!run.id) {
      addIssue(issues, {
        severity: "error",
        code: "invalid-train-run",
        where,
        message: "열차 시간표에 id가 없습니다.",
        cause: "열차번호/시간표 데이터는 고유 id가 필요합니다.",
        fix: "시간표 id를 입력하거나 해당 항목을 삭제하세요.",
      });
      continue;
    }
    if (run.patternId && !patternIds.has(run.patternId)) {
      addIssue(issues, {
        severity: "error",
        code: "unknown-train-run-pattern",
        where,
        message: "열차 시간표가 존재하지 않는 정차 패턴을 참조합니다.",
        cause: "patternId가 manualServicePatterns.id와 일치하지 않습니다.",
        fix: "정차 패턴을 먼저 만들거나 patternId를 올바르게 수정하세요.",
      });
    }
    if (run.serviceType && !validServiceTypes.has(run.serviceType)) {
      addIssue(issues, {
        severity: "error",
        code: "invalid-train-run-service-type",
        where,
        message: "열차 시간표의 서비스 타입이 잘못되었습니다.",
        cause: "serviceType이 허용 enum에 없습니다.",
        fix: "KTX/SRT/ITX/무궁화 등 허용 enum으로 수정하세요.",
      });
    }
    for (const [index, stop] of (run.stopTimes ?? []).entries()) {
      validateStationReference(issues, stationById, stop.stationId, `${where}:stopTimes:${index}`, "시간표 정차역");
    }
  }
}

function validateReferences(
  issues: ValidationIssue[],
  overlays: ManualOverlayBundle,
  stationById: Map<string, JsonRecord>,
  branchById: Map<string, JsonRecord>,
  lineById: Map<string, JsonRecord>,
) {
  collectDuplicateIds(issues, overlays.manualTransferGroups, "manualTransferGroups");
  collectDuplicateIds(issues, overlays.manualTransferEdges, "manualTransferEdges");
  collectDuplicateIds(issues, overlays.branchStationExclusions, "branchStationExclusions");
  collectDuplicateIds(issues, overlays.branchRouteOverrides, "branchRouteOverrides");
  collectDuplicateIds(issues, overlays.lineBranchOverrides, "lineBranchOverrides");
  validateLineMetadataOverrides(issues, lineById, overlays);
  validateManualLineDefinitions(issues, overlays, stationById);
  validateServicePatternsAndTimetables(issues, overlays, stationById, branchById, lineById);

  for (const override of overlays.stationOverrides ?? []) {
    if (override.enabled === false || !override.stationId) continue;
    const hasRequiredNewStationFields =
      Boolean(override.nameKo) &&
      Boolean(override.lineNameKo || override.lineNumber) &&
      isValidLngLat(override.lng, override.lat);
    const existsInBundle = stationById.has(override.stationId);
    if (!existsInBundle && !hasRequiredNewStationFields) {
      addIssue(issues, {
        severity: "error",
        code: "incomplete-manual-station-override",
        where: `stationOverrides:${override.stationId}`,
        message: "새 역 override에 필요한 이름/노선/좌표가 부족합니다.",
        cause: "canonical bundle에 없는 stationId는 manual station override만으로 editor/web에 표시됩니다.",
        fix: "새 역 이름, 노선명 또는 노선번호, 지도 좌표를 모두 저장하세요.",
      });
    }
  }

  for (const group of overlays.manualTransferGroups ?? []) {
    if (group.enabled === false) continue;
    for (const stationId of group.stationIds ?? []) {
      validateStationReference(issues, stationById, stationId, `manualTransferGroups:${group.id ?? "-"}`, "환승 그룹");
    }
  }

  for (const edge of overlays.manualTransferEdges ?? []) {
    if (edge.enabled === false) continue;
    validateStationReference(issues, stationById, edge.fromStationId, `manualTransferEdges:${edge.id ?? "-"}:from`, "환승 출발");
    validateStationReference(issues, stationById, edge.toStationId, `manualTransferEdges:${edge.id ?? "-"}:to`, "환승 도착");
  }

  for (const exclusion of overlays.branchStationExclusions ?? []) {
    if (exclusion.enabled === false) continue;
    validateBranchReference(issues, branchById, exclusion.branchId, `branchStationExclusions:${exclusion.id ?? "-"}`, "제외 대상");
    validateStationReference(issues, stationById, exclusion.stationId, `branchStationExclusions:${exclusion.id ?? "-"}`, "제외 역");
  }

  for (const routeOverride of overlays.branchRouteOverrides ?? []) {
    if (routeOverride.enabled === false) continue;
    validateBranchReference(issues, branchById, routeOverride.branchId, `branchRouteOverrides:${routeOverride.id ?? routeOverride.branchId ?? "-"}`, "정차 순서 대상");
    for (const stationId of routeOverride.stationIds ?? []) {
      validateStationReference(issues, stationById, stationId, `branchRouteOverrides:${routeOverride.id ?? routeOverride.branchId ?? "-"}`, "정차역");
    }
  }

  for (const lineBranch of overlays.lineBranchOverrides ?? []) {
    if (lineBranch.enabled === false) continue;
    const where = `lineBranchOverrides:${lineBranch.id ?? "-"}`;
    validateBranchReference(issues, branchById, lineBranch.parentBranchId, `${where}:parent`, "parent");
    validateStationReference(issues, stationById, lineBranch.anchorStationId, `${where}:anchor`, "anchor");

    if (lineBranch.mode === "add-station") {
      validateStationReference(issues, stationById, lineBranch.branchStationId, `${where}:branchStation`, "추가 역");
    } else if (lineBranch.mode === "connect-line") {
      validateBranchReference(issues, branchById, lineBranch.connectedBranchId, `${where}:connectedBranch`, "결합 대상");
      validateStationReference(issues, stationById, lineBranch.connectedEndpointStationId, `${where}:connectedEndpoint`, "결합 endpoint");
    } else {
      addIssue(issues, {
        severity: "error",
        code: "invalid-line-branch-mode",
        where,
        message: `lineBranch mode가 잘못되었습니다: ${String(lineBranch.mode ?? "-")}`,
        cause: "지선 override는 add-station 또는 connect-line만 지원합니다.",
        fix: "editor에서 지선 설정을 다시 저장하세요.",
      });
    }

    for (const [index, point] of (lineBranch.geometry ?? []).entries()) {
      validateGeometryPoint(issues, stationById, point, `${where}:geometry:${index}`);
    }
  }

  for (const geometry of overlays.geometryOverrides ?? []) {
    if (geometry.enabled === false) continue;
    validateBranchReference(issues, branchById, geometry.branchId, `geometryOverrides:${geometry.branchId ?? "-"}`, "선형 대상");
    for (const [index, point] of (geometry.points ?? []).entries()) {
      validateGeometryPoint(issues, stationById, point, `geometryOverrides:${geometry.branchId ?? "-"}:${index}`);
    }
  }
}

function formatIssues(issues: ValidationIssue[]) {
  return issues
    .map((issue, index) =>
      [
        `${index + 1}. [${issue.severity.toUpperCase()}] ${issue.code}`,
        `   위치: ${issue.where}`,
        `   문제: ${issue.message}`,
        `   원인: ${issue.cause}`,
        `   해결: ${issue.fix}`,
      ].join("\n"),
    )
    .join("\n");
}

export function validateManualOverlayPipeline() {
  const repoRoot = findRepoRoot(process.cwd());
  const generatedBundlePath = path.join(repoRoot, "data/generated/2026-06-19/app-bundle/kric-canonical-app-bundle.json");
  const publicBundlePath = path.join(repoRoot, "apps/web/public/data/kric-canonical-app-bundle.json");
  const manualOverlayPath = path.join(repoRoot, "data/manual/manual-overlays.json");
  const publicManualOverlayPath = path.join(repoRoot, "apps/web/public/data/manual-overlays.json");

  const generatedBundle = readJson(generatedBundlePath);
  const publicBundle = readJson(publicBundlePath);
  const manualOverlays = readJson(manualOverlayPath) as ManualOverlayBundle | null;
  const publicManualOverlays = readJson(publicManualOverlayPath);

  if (!generatedBundle) {
    throw new Error(`[collector] manual overlay pipeline validation failed: generated bundle missing: ${generatedBundlePath}`);
  }
  if (!manualOverlays) {
    throw new Error(`[collector] manual overlay pipeline validation failed: manual overlays missing: ${manualOverlayPath}`);
  }

  const issues: ValidationIssue[] = [];
  const stationById = buildStationById(generatedBundle, manualOverlays);
  const referenceBundle = publicBundle ?? generatedBundle;
  const branchById = buildBranchById(referenceBundle);
  addManualBranchesToBranchIndex(branchById, manualOverlays);
  const lineById = buildLineById(referenceBundle);
  addManualLinesToLineIndex(lineById, manualOverlays);

  validateManualOverlaySchema(issues, manualOverlays);
  validateReferences(issues, manualOverlays, stationById, branchById, lineById);
  validateCircularConnectionRules(issues, manualOverlays, branchById);
  validateBranchGeometryCoverage(issues, generatedBundle, manualOverlays, stationById);
  validatePublicExportParity(
    issues,
    repoRoot,
    manualOverlays as JsonRecord,
    publicManualOverlays,
    generatedBundle,
    publicBundle,
  );

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  if (errors.length > 0) {
    throw new Error(
      [
        `[collector] manual overlay pipeline validation failed: ${errors.length} error(s), ${warnings.length} warning(s)`,
        "collector/build 결과가 editor와 web에서 동일하게 재현되도록 아래 문제를 먼저 해결하세요.",
        formatIssues(issues.slice(0, 40)),
        issues.length > 40 ? `... ${issues.length - 40} more issue(s)` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  console.log(
    `[collector] manual overlay pipeline validation OK: stations=${stationById.size}, branches=${branchById.size}, warnings=${warnings.length}`,
  );
}
