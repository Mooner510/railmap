import { buildKricCanonicalAppBundle } from "./canonical/build-canonical-app-bundle.js";
import { collectKricLines } from "./kric/collect-lines.js";
import { collectKricStations } from "./kric/collect-stations.js";
import { diagnoseKricRouteStopStationMatch } from "./kric/diagnose-route-stop-station-match.js";
import { writeKricRouteStopStationReviewCsv } from "./kric/write-route-stop-station-review-csv.js";
import { writeKricCanonicalDiagnostics } from "./canonical/write-canonical-diagnostics.js";
import { validateStationLineIdentity } from "./canonical/validate-station-line-identity.js";
import { validateManualOverlayPipeline } from "./canonical/validate-manual-overlay-pipeline.js";

console.log("[collector] railmap collector start");

collectKricLines();
collectKricStations();
await diagnoseKricRouteStopStationMatch();
writeKricRouteStopStationReviewCsv();
buildKricCanonicalAppBundle();
validateStationLineIdentity();
validateManualOverlayPipeline();
writeKricCanonicalDiagnostics();

console.log("[collector] OK");
