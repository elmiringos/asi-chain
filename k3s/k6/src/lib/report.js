import http from "k6/http";

const PUSHGATEWAY_URL =
  __ENV.PUSHGATEWAY_URL || "http://pushgateway.monitoring.svc.cluster.local:9091";

/**
 * Fetches blocks from the node API in range [startBlock, endBlock], sorted ascending.
 * Used for block creation time computation (timestamps are reliable; deployCount is not).
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
 * Pushes a final test report to Prometheus Pushgateway.
 *
 * All metrics come from k6 summary data and the node block API (timestamps).
 * No dependency on k6 Prometheus remote write streaming.
 *
 * Metrics pushed (all gauges, labeled with testid via Pushgateway URL):
 *   k6_test_confirmed_total            — confirmed deploys
 *   k6_test_unconfirmed_total          — unconfirmed (timed-out) deploys
 *   k6_test_blocks_produced            — blocks produced during test
 *   k6_test_avg_deploys_per_block      — confirmed / blocks_produced
 *   k6_test_avg_block_creation_time_ms — avg ms between consecutive blocks
 *   k6_test_confirmation_p95_ms        — p95 confirmation time
 *   k6_test_payload_bytes_avg          — avg deploy payload size
 *
 * @param {Object} data       - k6 handleSummary data
 * @param {string} scriptName - scenario name used in Pushgateway job label
 * @param {string} nodeUrl    - blockchain node URL for block timestamp queries
 */
export function pushReport(data, scriptName, nodeUrl) {
  const testid = __ENV.TESTID || scriptName;
  const m = data.metrics;

  // Block range from k6 Gauge
  const startBlock = m["blockchain_block_number"]?.values?.min ?? 0;
  const endBlock = m["blockchain_block_number"]?.values?.max ?? 0;
  const blocksProduced = Math.max(0, endBlock - startBlock);

  // Block creation time from node API timestamps
  const currentBlockRes = http.get(`${nodeUrl}/api/blocks/1`);
  const currentBlock =
    currentBlockRes.status === 200
      ? (currentBlockRes.json()?.[0]?.blockNumber ?? endBlock)
      : endBlock;
  const fetchCount = Math.min(currentBlock - startBlock + 20, 500);
  const blocks = fetchCount > 0 ? fetchBlocks(nodeUrl, startBlock, endBlock, fetchCount) : [];

  const testDurationSec = (data.state?.testRunDurationMs ?? 0) / 1000;
  const testEndMs = blocks.length > 0 ? blocks[blocks.length - 1].timestamp : 0;
  const testStartMs = testEndMs - testDurationSec * 1000;
  const testBlocks = blocks.filter(b => b.timestamp >= testStartMs);

  const creationTimes = [];
  for (let i = 1; i < testBlocks.length; i++) {
    const dt = testBlocks[i].timestamp - testBlocks[i - 1].timestamp;
    const db = testBlocks[i].blockNumber - testBlocks[i - 1].blockNumber;
    if (dt > 0 && db > 0) creationTimes.push(dt / db);
  }
  const avgCreationTime =
    creationTimes.length > 0
      ? creationTimes.reduce((s, v) => s + v, 0) / creationTimes.length
      : 0;

  // Max deploys in a single block (from node API deployCount field)
  const maxDeploys = testBlocks.reduce((max, b) => Math.max(max, b.deployCount || 0), 0);

  // k6 summary metrics
  const confirmed = m["deploy_confirmed"]?.values?.count ?? 0;
  const unconfirmed = m["deploy_unconfirmed"]?.values?.count ?? 0;
  const confirmP95 = m["deploy_confirmation_ms"]?.values?.["p(95)"] ?? 0;
  const payloadAvg = m["deploy_payload_bytes"]?.values?.avg ?? 0;
  const avgDeploys = blocksProduced > 0 ? confirmed / blocksProduced : 0;
  const throughput = testDurationSec > 0 ? confirmed / testDurationSec : 0;

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
    "# HELP k6_test_avg_deploys_per_block Average confirmed deploys per block",
    "# TYPE k6_test_avg_deploys_per_block gauge",
    `k6_test_avg_deploys_per_block ${avgDeploys.toFixed(2)}`,

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

    "",
    "# HELP k6_test_deploy_throughput_per_sec Confirmed deploys per second (confirmed / test duration)",
    "# TYPE k6_test_deploy_throughput_per_sec gauge",
    `k6_test_deploy_throughput_per_sec ${throughput.toFixed(3)}`,

    "",
    "# HELP k6_test_max_deploys_in_block Maximum deploys observed in a single block",
    "# TYPE k6_test_max_deploys_in_block gauge",
    `k6_test_max_deploys_in_block ${maxDeploys}`,
  ];

  const payload = lines.join("\n") + "\n";
  const url = `${PUSHGATEWAY_URL}/metrics/job/k6-${scriptName}/testid/${encodeURIComponent(testid)}`;
  const pushRes = http.post(url, payload, { headers: { "Content-Type": "text/plain" } });

  if (pushRes.status !== 200 && pushRes.status !== 202) {
    console.warn(`pushReport: Pushgateway returned ${pushRes.status} — ${pushRes.body}`);
  } else {
    console.log(
      `pushReport: report pushed — blocks=${blocksProduced}, confirmed=${confirmed}, unconfirmed=${unconfirmed}, avg=${avgDeploys.toFixed(1)}, max_in_block=${maxDeploys}`,
    );
  }
}
