import { collectKricLines } from "./kric/collect-lines.js";
import { collectKricStations } from "./kric/collect-stations.js";
import { diagnoseKricRouteStopStationMatch } from "./kric/diagnose-route-stop-station-match.js";
import { writeKricRouteStopStationReviewCsv } from "./kric/write-route-stop-station-review-csv.js";
import { buildKricMinimalAppBundle } from "./kric/build-minimal-app-bundle.js";

console.log("[collector] railmap collector start");

collectKricLines();
collectKricStations();
await diagnoseKricRouteStopStationMatch();
writeKricRouteStopStationReviewCsv();
buildKricMinimalAppBundle();

console.log("[collector] OK");
