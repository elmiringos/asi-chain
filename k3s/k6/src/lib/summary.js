import http from "k6/http";

const GRAFANA_URL = "http://grafana.monitoring.svc.cluster.local:3000";
// Basic auth admin:admin
const GRAFANA_AUTH = "Basic YWRtaW46YWRtaW4=";

/**
 * Posts a region annotation to Grafana covering the test run window.
 * Annotations are stored in Grafana's SQLite — persist independently of Prometheus retention.
 *
 * Call from handleSummary(data):
 *   import { annotateTestRun } from "./lib/summary.js";
 *   export function handleSummary(data) {
 *     annotateTestRun(data, "hello-world");
 *     return {};
 *   }
 *
 * @param {Object} data       - k6 handleSummary data object
 * @param {string} scriptName - human-readable script name (e.g. "hello-world")
 * @param {string} [grafanaUrl] - override Grafana URL (default: cluster-internal)
 */
export function annotateTestRun(data, scriptName, grafanaUrl = GRAFANA_URL) {
  const endMs = Date.now();
  // data.state.testRunDuration is in nanoseconds
  const startMs = endMs - Math.ceil(data.state.testRunDuration / 1e6);

  const res = http.post(
    `${grafanaUrl}/api/annotations`,
    JSON.stringify({
      text: `k6: ${scriptName}`,
      tags: ["k6", scriptName],
      time: startMs,
      timeEnd: endMs,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Authorization": GRAFANA_AUTH,
      },
    },
  );

  if (res.status !== 200) {
    console.warn(`annotateTestRun: Grafana API returned ${res.status} — annotation not saved`);
  }
}
