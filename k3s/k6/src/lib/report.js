import http from "k6/http";

const PUSHGATEWAY_URL =
  __ENV.PUSHGATEWAY_URL || "http://pushgateway.monitoring.svc.cluster.local:9091";

/**
 * Fetches the last `count` blocks from the node and returns those
 * with startBlock <= blockNumber <= endBlock, sorted ascending.
 */
function fetchBlocks(nodeUrl, startBlock, endBlock, count) {
  const res = http.get(`${nodeUrl}/api/blocks/${count}`);
  if (res.status !== 200) {
    console.warn(`fetchBlocks: status=${res.status}`);
    return [];
  }
  const raw = res.json();
  if (!Array.isArray(raw)) return [];

  // Log a sample to diagnose field names in the API response
  if (raw.length > 0) {
    const sample = raw[0];
    console.log(`fetchBlocks sample: keys=${Object.keys(sample).join(",")}, blockNumber=${sample.blockNumber}, deployCount=${sample.deployCount}`);
  }

  // API may return duplicate block entries — keep first occurrence per blockNumber
  const seen = new Map();
  for (const b of raw) {
    if (b.blockNumber >= startBlock && b.blockNumber <= endBlock && !seen.has(b.blockNumber)) {
      seen.set(b.blockNumber, b);
    }
  }
  const result = Array.from(seen.values()).sort((a, b) => a.blockNumber - b.blockNumber);
  console.log(`fetchBlocks: range=[${startBlock}..${endBlock}], matched=${result.length}, deployCounts=${result.map((b) => `${b.blockNumber}:${b.deployCount}`).join(" ")}`);
  return result;
}

/**
 * Pushes a final test report to Prometheus Pushgateway.
 *
 * Queries the blockchain API for per-block data and combines it with
 * k6 summary metrics (confirmed/unconfirmed counts, confirmation p95).
 *
 * Metrics pushed (all gauges, labeled with testid):
 *   k6_test_confirmed_total         — confirmed deploys
 *   k6_test_unconfirmed_total       — unconfirmed (timed-out) deploys
 *   k6_test_blocks_produced         — blocks produced during test
 *   k6_test_avg_deploys_per_block   — avg deploys per block (from chain)
 *   k6_test_max_deploys_per_block   — max deploys in one block (from chain)
 *   k6_test_avg_block_creation_time_ms — avg ms between blocks (from chain)
 *   k6_test_confirmation_p95_ms     — p95 confirmation time
 *   k6_test_payload_bytes_avg       — avg deploy payload size
 *   k6_test_block_deploy_count{block="N"} — per-block deploy count (barchart)
 *
 * @param {Object} data       - k6 handleSummary data
 * @param {string} scriptName - scenario name used in Pushgateway job label
 * @param {string} nodeUrl    - blockchain node URL for block API queries
 */
export function pushReport(data, scriptName, nodeUrl) {
  const testid = __ENV.TESTID || scriptName;
  const m = data.metrics;

  // Block range recorded by the blockchain_block_number Gauge
  const startBlock = m["blockchain_block_number"]?.values?.min ?? 0;
  const endBlock = m["blockchain_block_number"]?.values?.max ?? 0;
  const blocksProduced = Math.max(0, endBlock - startBlock);

  // Fetch per-block data from chain (add buffer to handle forks/skipped blocks)
  const fetchCount = blocksProduced > 0 ? blocksProduced + 20 : 0;
  const blocks = fetchCount > 0 ? fetchBlocks(nodeUrl, startBlock, endBlock, fetchCount) : [];

  // Block statistics from chain data
  const deployCounts = blocks.map((b) => b.deployCount || 0);
  const maxDeploys = deployCounts.length > 0 ? Math.max(...deployCounts) : 0;
  const avgDeploys =
    deployCounts.length > 0
      ? deployCounts.reduce((s, v) => s + v, 0) / deployCounts.length
      : 0;

  const creationTimes = [];
  for (let i = 1; i < blocks.length; i++) {
    const dt = blocks[i].timestamp - blocks[i - 1].timestamp;
    const db = blocks[i].blockNumber - blocks[i - 1].blockNumber;
    if (dt > 0 && db > 0) creationTimes.push(dt / db);
  }
  const avgCreationTime =
    creationTimes.length > 0
      ? creationTimes.reduce((s, v) => s + v, 0) / creationTimes.length
      : 0;

  // k6 summary metrics
  const confirmed = m["deploy_confirmed"]?.values?.count ?? 0;
  const unconfirmed = m["deploy_unconfirmed"]?.values?.count ?? 0;
  const confirmP95 = m["deploy_confirmation_ms"]?.values?.["p(95)"] ?? 0;
  const payloadAvg = m["deploy_payload_bytes"]?.values?.avg ?? 0;

  // Build Prometheus text exposition
  const lines = [
    "# HELP k6_test_confirmed_total Confirmed deploys in test run",
    "# TYPE k6_test_confirmed_total gauge",
    `k6_test_confirmed_total ${confirmed}`,

    "",
    "# HELP k6_test_unconfirmed_total Unconfirmed (timed-out) deploys",
    "# TYPE k6_test_unconfirmed_total gauge",
    `k6_test_unconfirmed_total ${unconfirmed}`,

    "",
    "# HELP k6_test_blocks_produced Blocks produced during test run",
    "# TYPE k6_test_blocks_produced gauge",
    `k6_test_blocks_produced ${blocksProduced}`,

    "",
    "# HELP k6_test_avg_deploys_per_block Average deploys per block",
    "# TYPE k6_test_avg_deploys_per_block gauge",
    `k6_test_avg_deploys_per_block ${avgDeploys.toFixed(2)}`,

    "",
    "# HELP k6_test_max_deploys_per_block Max deploys in a single block",
    "# TYPE k6_test_max_deploys_per_block gauge",
    `k6_test_max_deploys_per_block ${maxDeploys}`,

    "",
    "# HELP k6_test_avg_block_creation_time_ms Average time between consecutive blocks in ms",
    "# TYPE k6_test_avg_block_creation_time_ms gauge",
    `k6_test_avg_block_creation_time_ms ${Math.round(avgCreationTime)}`,

    "",
    "# HELP k6_test_confirmation_p95_ms p95 deploy confirmation time in ms",
    "# TYPE k6_test_confirmation_p95_ms gauge",
    `k6_test_confirmation_p95_ms ${Math.round(confirmP95)}`,

    "",
    "# HELP k6_test_payload_bytes_avg Average deploy payload size in bytes",
    "# TYPE k6_test_payload_bytes_avg gauge",
    `k6_test_payload_bytes_avg ${Math.round(payloadAvg)}`,
  ];

  if (blocks.length > 0) {
    lines.push(
      "",
      "# HELP k6_test_block_deploy_count Deploys included in each block",
      "# TYPE k6_test_block_deploy_count gauge",
    );
    for (const b of blocks) {
      lines.push(`k6_test_block_deploy_count{block="${b.blockNumber}"} ${b.deployCount || 0}`);
    }
  }

  const payload = lines.join("\n") + "\n";
  const url = `${PUSHGATEWAY_URL}/metrics/job/k6-${scriptName}/testid/${encodeURIComponent(testid)}`;

  const res = http.post(url, payload, { headers: { "Content-Type": "text/plain" } });

  if (res.status !== 200 && res.status !== 202) {
    console.warn(`pushReport: Pushgateway returned ${res.status} — ${res.body}`);
  } else {
    console.log(
      `pushReport: report pushed — blocks=${blocksProduced}, confirmed=${confirmed}, unconfirmed=${unconfirmed}`,
    );
  }
}
