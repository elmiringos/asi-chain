import http from "k6/http";

const PUSHGATEWAY_URL =
  __ENV.PUSHGATEWAY_URL || "http://pushgateway.monitoring.svc.cluster.local:9091";
const PROMETHEUS_URL =
  __ENV.PROMETHEUS_URL || "http://prometheus.monitoring.svc.cluster.local:9090";

/**
 * Fetches the last `count` blocks from the node.
 * Returns blocks with startBlock <= blockNumber <= endBlock, sorted ascending.
 * Used only for block timestamps (deployCount from the API is unreliable).
 */
function fetchBlocks(nodeUrl, startBlock, endBlock, count) {
  const res = http.get(`${nodeUrl}/api/blocks/${count}`);
  if (res.status !== 200) {
    console.warn(`fetchBlocks: status=${res.status}`);
    return [];
  }
  const raw = res.json();
  if (!Array.isArray(raw)) return [];

  const seen = new Map();
  for (const b of raw) {
    if (b.blockNumber >= startBlock && b.blockNumber <= endBlock && !seen.has(b.blockNumber)) {
      seen.set(b.blockNumber, b);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.blockNumber - b.blockNumber);
}

/**
 * Queries Prometheus for per-block k6 deploy counts.
 * Source: Counter "block_deploys" pushed via k6 remote write during the test.
 * Each VU increments block_deploys{block_number="N"} by 1 per confirmed deploy.
 *
 * Returns [{block: N, count: C}, ...] sorted by block number.
 */
function queryBlockDeploys(testid) {
  // Counter "block_deploys" → Prometheus metric "k6_block_deploys_total"
  const query = `k6_block_deploys_total{testid="${testid}"}`;
  const res = http.get(
    `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`,
    { timeout: "10s" },
  );
  if (res.status !== 200) {
    console.warn(`queryBlockDeploys: Prometheus returned ${res.status}`);
    return [];
  }
  const body = res.json();
  if (body?.status !== "success") {
    console.warn(`queryBlockDeploys: unexpected response status=${body?.status}`);
    return [];
  }
  const result = body.data.result
    .map((r) => ({ block: parseInt(r.metric.block_number), count: parseFloat(r.value[1]) }))
    .filter((r) => !isNaN(r.block) && r.count > 0)
    .sort((a, b) => a.block - b.block);

  console.log(
    `queryBlockDeploys: ${result.length} blocks — ${result.map((r) => `${r.block}:${r.count}`).join(" ")}`,
  );
  return result;
}

/**
 * Pushes a final test report to Prometheus Pushgateway.
 *
 * Per-block deploy counts come from Prometheus (k6 remote write during test).
 * Block creation times come from the node's block API (timestamps are reliable).
 * Counts (confirmed/unconfirmed) and timing come from k6 summary data.
 *
 * Metrics pushed (all gauges, labeled with testid via Pushgateway URL):
 *   k6_test_confirmed_total              — confirmed deploys
 *   k6_test_unconfirmed_total            — unconfirmed (timed-out) deploys
 *   k6_test_blocks_produced              — blocks produced during test
 *   k6_test_avg_deploys_per_block        — avg k6 deploys per block
 *   k6_test_max_deploys_per_block        — max k6 deploys in one block
 *   k6_test_avg_block_creation_time_ms   — avg ms between consecutive blocks
 *   k6_test_confirmation_p95_ms          — p95 confirmation time
 *   k6_test_payload_bytes_avg            — avg deploy payload size
 *   k6_test_block_deploy_count{block="N"} — per-block k6 deploy count (barchart)
 *
 * @param {Object} data       - k6 handleSummary data
 * @param {string} scriptName - scenario name used in Pushgateway job label
 * @param {string} nodeUrl    - blockchain node URL for block timestamp queries
 */
export function pushReport(data, scriptName, nodeUrl) {
  const testid = __ENV.TESTID || scriptName;
  const m = data.metrics;

  // --- Block range from k6 Gauge ---
  const startBlock = m["blockchain_block_number"]?.values?.min ?? 0;
  const endBlock = m["blockchain_block_number"]?.values?.max ?? 0;
  const blocksProduced = Math.max(0, endBlock - startBlock);

  // --- Per-block deploy counts from Prometheus (k6 remote write) ---
  const blockDeploys = queryBlockDeploys(testid);
  const maxDeploys = blockDeploys.length > 0 ? Math.max(...blockDeploys.map((b) => b.count)) : 0;
  // avg = total confirmed / blocks that received at least one deploy
  const confirmed = m["deploy_confirmed"]?.values?.count ?? 0;
  const avgDeploys = blockDeploys.length > 0 ? confirmed / blockDeploys.length : 0;

  // --- Block creation time from node API timestamps ---
  // Request enough blocks to cover the range regardless of how far the chain advanced
  const currentBlockRes = http.get(`${nodeUrl}/api/blocks/1`);
  const currentBlock =
    currentBlockRes.status === 200
      ? (currentBlockRes.json()?.[0]?.blockNumber ?? endBlock)
      : endBlock;
  const fetchCount = Math.min(currentBlock - startBlock + 20, 500);
  const blocks = fetchCount > 0 ? fetchBlocks(nodeUrl, startBlock, endBlock, fetchCount) : [];

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

  // --- k6 summary metrics ---
  const unconfirmed = m["deploy_unconfirmed"]?.values?.count ?? 0;
  const confirmP95 = m["deploy_confirmation_ms"]?.values?.["p(95)"] ?? 0;
  const payloadAvg = m["deploy_payload_bytes"]?.values?.avg ?? 0;

  // --- Build Prometheus text exposition ---
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
    "# HELP k6_test_avg_deploys_per_block Average k6 deploys per block",
    "# TYPE k6_test_avg_deploys_per_block gauge",
    `k6_test_avg_deploys_per_block ${avgDeploys.toFixed(2)}`,

    "",
    "# HELP k6_test_max_deploys_per_block Max k6 deploys in a single block",
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

  if (blockDeploys.length > 0) {
    lines.push(
      "",
      "# HELP k6_test_block_deploy_count k6 deploys confirmed per block",
      "# TYPE k6_test_block_deploy_count gauge",
    );
    for (const b of blockDeploys) {
      lines.push(`k6_test_block_deploy_count{block="${b.block}"} ${b.count}`);
    }
  }

  const payload = lines.join("\n") + "\n";
  const url = `${PUSHGATEWAY_URL}/metrics/job/k6-${scriptName}/testid/${encodeURIComponent(testid)}`;
  const pushRes = http.post(url, payload, { headers: { "Content-Type": "text/plain" } });

  if (pushRes.status !== 200 && pushRes.status !== 202) {
    console.warn(`pushReport: Pushgateway returned ${pushRes.status} — ${pushRes.body}`);
  } else {
    console.log(
      `pushReport: report pushed — blocks=${blocksProduced}, confirmed=${confirmed}, unconfirmed=${unconfirmed}, blockDeploys=${blockDeploys.length}`,
    );
  }
}
