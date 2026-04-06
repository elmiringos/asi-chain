/**
 * Scenario: capacity-single
 *
 * Goal: find the maximum number of deploys of a single type that fit in one block.
 *
 * Mirrors the deployer-bot cycle: flood deploys → propose block → observe result.
 * Unlike burst-block (which relies on autopropose timing), this test explicitly
 * triggers block creation after each flood round via POST /api/propose, making
 * the results deterministic regardless of casper-loop-interval.
 *
 * Strategy (1 VU, N rounds):
 *   Each iteration = 1 round:
 *     1. Sign DEPLOYS_PER_ROUND deploys upfront (rotating through PRIVATE_KEYS).
 *     2. Send all of them in one http.batch() call — maximum concurrency, minimum latency spread.
 *     3. Sleep PROPOSE_DELAY seconds to let the mempool settle.
 *     4. Call POST /api/propose to trigger block creation (deployer-bot style).
 *     5. Wait for the new block and read its deployCount from GET /api/blocks/1.
 *     6. Track the maximum deployCount across all rounds.
 *
 * Recommended chain config (run before this scenario):
 *   make start AUTOPROPOSE=0 HEARTBEAT=0 SYNCHRONY_THRESHOLD=0 MAX_DEPLOYS_PER_BLOCK=10000 ADAPTIVE_DEPLOY_CAP=false
 *     — AUTOPROPOSE=0: disables casper-loop auto-propose so only our explicit POST /api/propose
 *       creates blocks; without this the loop races our propose and returns NoNewDeploys
 *     — HEARTBEAT=0: no empty heartbeat blocks between rounds
 *     — SYNCHRONY_THRESHOLD=0: validator can propose without waiting for peers
 *     — MAX_DEPLOYS_PER_BLOCK=10000: raises per-user cap so the real limit is the block size
 *     — ADAPTIVE_DEPLOY_CAP=false: disables the EMA-based adaptive cap (default: true) which
 *       automatically reduces deploys/block to maintain a 1-second latency target; without this
 *       the cap ratchets down to its backlog floor max (default 8) during test floods
 *
 * Env vars:
 *   NODE_URL          — target validator (default: validator1, port 40403)
 *   PRIVATE_KEY       — hex-encoded private key (single key)
 *   PRIVATE_KEYS      — comma-separated keys (overrides PRIVATE_KEY; deploys round-robin)
 *   DEPLOY_TYPE       — "hello-world" (default) or "transfer"
 *   FROM_ADDR         — sender wallet address  (required for transfer)
 *   TO_ADDR           — recipient wallet address (required for transfer)
 *   AMOUNT            — transfer amount tokens (default: 1)
 *   SHARD_ID          — shard id (default: root)
 *   TOTAL_DEPLOYS     — deploys to batch per round (default: 64)
 *   PHLO_LIMIT        — phlo (gas) per deploy (default: 500000); lower = more deploys per block
 *   ROUNDS            — number of flood→propose rounds (default: 3)
 *   CONFIRM_TIMEOUT   — seconds to wait for block after propose (default: 15)
 *   PROPOSE_DELAY     — seconds to wait after flood before proposing (default: 0)
 *                       http.batch() is synchronous — deploys are already in the mempool
 *                       when all 200 responses are received, so no settle time is needed
 */
import { check, sleep } from "k6";
import http from "k6/http";
import { Counter, Gauge, Trend } from "k6/metrics";
import { signDeploy, helloWorldTerm, transferTerm as _transferTerm, waitForBlock } from "k6/x/asichain";
import {
  sendPropose,
  adminUrl,
  getValidAfterBlockNumber,
  getLatestBlockInfo,
  estimateDeployProtoSize,
} from "../lib/deploy.js";
import { annotateTestRun } from "../lib/summary.js";
import { pushReport } from "../lib/report.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

const NODE_URL        = __ENV.NODE_URL        || "http://validator1-0.validator1.asi-chain.svc.cluster.local:40403";
// ADMIN_NODE_URL: admin API port (40405) for POST /api/propose.
// With autopropose=false, propose is only available on the admin port.
const ADMIN_NODE_URL  = __ENV.ADMIN_NODE_URL  || adminUrl(NODE_URL);
const SHARD_ID        = __ENV.SHARD_ID        || "root";
const DEPLOY_TYPE     = __ENV.DEPLOY_TYPE      || "hello-world";
const FROM_ADDR       = __ENV.FROM_ADDR        || "";
const TO_ADDR         = __ENV.TO_ADDR          || "";
const AMOUNT          = __ENV.AMOUNT           ? parseInt(__ENV.AMOUNT) : 1;
const CONFIRM_TIMEOUT = __ENV.CONFIRM_TIMEOUT  ? parseInt(__ENV.CONFIRM_TIMEOUT) : 15;
const PROPOSE_DELAY   = __ENV.PROPOSE_DELAY    ? parseInt(__ENV.PROPOSE_DELAY) : 0;
const ROUNDS          = __ENV.ROUNDS           ? parseInt(__ENV.ROUNDS) : 3;
// TOTAL_DEPLOYS is the job.yaml convention for "deploys per round".
const DEPLOYS_PER_ROUND = __ENV.TOTAL_DEPLOYS  ? parseInt(__ENV.TOTAL_DEPLOYS) : 64;
const PHLO_LIMIT        = __ENV.PHLO_LIMIT      ? parseInt(__ENV.PHLO_LIMIT)   : 500_000;

const PRIVATE_KEYS = (__ENV.PRIVATE_KEYS || __ENV.PRIVATE_KEY || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

// --- Metrics ---
const deployedCounter  = new Counter("deploy_confirmed");
const rejectedCounter  = new Counter("deploy_unconfirmed");
const blockNumberGauge = new Gauge("blockchain_block_number");
const deployPayload    = new Trend("deploy_payload_bytes", true);
const confirmationTime = new Trend("deploy_confirmation_ms", true);

// Per-VU state — safe with vus: 1.
// NOTE: handleSummary runs in a separate JS runtime so these are NOT accessible there.
// Use the k6 Gauge metric (blockchain_block_number range + node API) for final reporting.
let _maxDeployCount = 0;
let _roundResults   = [];

// maxDuration = (CONFIRM_TIMEOUT per round + 10s overhead) × ROUNDS, minimum 90s
const MAX_DURATION_S = Math.max(90, (CONFIRM_TIMEOUT + 10) * ROUNDS);

// 1 VU, ROUNDS iterations — each iteration is a full flood→propose→confirm round.
export const options = {
  scenarios: {
    capacity: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: ROUNDS,
      maxDuration: `${MAX_DURATION_S}s`,
    },
  },
  thresholds: {
    http_req_failed:   ["rate<0.05"],
    deploy_unconfirmed: ["count<10"],
  },
};

export function setup() {
  const blockNumber = getValidAfterBlockNumber(NODE_URL);
  const label = DEPLOY_TYPE === "transfer"
    ? `transfer from=${FROM_ADDR} to=${TO_ADDR} amount=${AMOUNT}`
    : "hello-world";
  console.log(
    `capacity-single: type=${DEPLOY_TYPE}, deploys/round=${DEPLOYS_PER_ROUND}, rounds=${ROUNDS}, startBlock=${blockNumber}, keys=${PRIVATE_KEYS.length}`
  );
  console.log(`  deploy url  : ${NODE_URL}`);
  console.log(`  propose url : ${ADMIN_NODE_URL} (admin port 40405)`);
  console.log(`  deploy type : ${label}`);
  blockNumberGauge.add(blockNumber);
  return { startBlock: blockNumber };
}

/**
 * Builds a signed deploy request body for http.batch().
 */
function buildDeployRequest(term, validAfterBlockNumber, privateKey, index) {
  const deployData = {
    term,
    phloLimit: PHLO_LIMIT,
    phloPrice: 1,
    validAfterBlockNumber,
    // Add index offset so timestamps are unique across the batch.
    timestamp: Date.now() + index,
    shardId: SHARD_ID,
  };
  const signed = signDeploy(deployData, privateKey);
  const body = JSON.stringify({
    data: {
      term:                    deployData.term,
      timestamp:               deployData.timestamp,
      phloPrice:               deployData.phloPrice,
      phloLimit:               deployData.phloLimit,
      validAfterBlockNumber:   deployData.validAfterBlockNumber,
      shardId:                 deployData.shardId,
    },
    sigAlgorithm: signed.sigAlgorithm,
    signature:    signed.sig,
    deployer:     signed.deployer,
  });
  return {
    method:  "POST",
    url:     `${NODE_URL}/api/deploy`,
    body,
    params:  { headers: JSON_HEADERS },
  };
}

export default function () {
  const roundIndex   = __ITER;
  const currentBlock = getValidAfterBlockNumber(NODE_URL);

  // --- 1. Sign + prepare all deploy requests ---
  const requests = [];
  for (let i = 0; i < DEPLOYS_PER_ROUND; i++) {
    const privateKey = PRIVATE_KEYS[i % PRIVATE_KEYS.length];
    const term = DEPLOY_TYPE === "transfer" && FROM_ADDR && TO_ADDR
      ? _transferTerm(FROM_ADDR, TO_ADDR, AMOUNT)
      : helloWorldTerm();
    requests.push(buildDeployRequest(term, currentBlock, privateKey, i));
  }

  // --- 2. Flood: batch-send all deploys simultaneously ---
  const responses = http.batch(requests);
  let accepted = 0;
  for (const r of responses) {
    const ok = check(r, { "deploy accepted (200)": (res) => res.status === 200 });
    if (ok) {
      accepted++;
      deployedCounter.add(1);
      if (r.request && r.request.body) {
        try { deployPayload.add(estimateDeployProtoSize(JSON.parse(r.request.body))); } catch (_) {}
      }
    } else {
      rejectedCounter.add(1);
      console.warn(`[round ${roundIndex}] deploy rejected: status=${r.status} body=${r.body}`);
    }
  }
  console.log(`[round ${roundIndex}] flood: sent=${DEPLOYS_PER_ROUND}, accepted=${accepted}, block=${currentBlock}`);

  // --- 3. Optionally wait for mempool to settle (default 0 — batch is synchronous) ---
  if (PROPOSE_DELAY > 0) sleep(PROPOSE_DELAY);

  // --- 4. Propose (deployer-bot style: explicit block creation) ---
  const proposeRes = sendPropose(ADMIN_NODE_URL, CONFIRM_TIMEOUT * 1000);
  if (proposeRes.status === 200) {
    console.log(`[round ${roundIndex}] propose OK`);
  } else {
    const body = proposeRes.body || "";
    // "NoNewDeploys" means autopropose beat us — deploys already included, not an error.
    // This happens when AUTOPROPOSE=1; use AUTOPROPOSE=0 to make propose deterministic.
    const noNewDeploys = body.includes("NoNewDeploys");
    if (noNewDeploys) {
      console.warn(`[round ${roundIndex}] propose: NoNewDeploys — deploys already included by autopropose`);
    } else {
      console.warn(`[round ${roundIndex}] propose failed: status=${proposeRes.status} body=${body}`);
      check(proposeRes, { "propose accepted": () => false });
    }
  }

  // --- 5. Wait for the new block ---
  const confirmStart = Date.now();
  const newBlock     = waitForBlock(NODE_URL, currentBlock, CONFIRM_TIMEOUT);

  if (newBlock > currentBlock) {
    confirmationTime.add(Date.now() - confirmStart);
    blockNumberGauge.add(newBlock);

    const info = getLatestBlockInfo(NODE_URL);
    const dc   = info.deployCount || 0;
    if (dc > _maxDeployCount) _maxDeployCount = dc;
    _roundResults.push({ round: roundIndex, block: newBlock, sent: accepted, deployCount: dc });
    console.log(`[round ${roundIndex}] confirmed: block=${newBlock}, deployCount=${dc}, maxSoFar=${_maxDeployCount}`);
  } else {
    console.warn(`[round ${roundIndex}] block not confirmed within ${CONFIRM_TIMEOUT}s`);
  }
}

export function handleSummary(data) {
  // _maxDeployCount and _roundResults are NOT available here (separate JS runtime).
  // The ground-truth max is computed by pushReport from the node API (k6_test_max_deploys_in_block).
  const m = data.metrics;
  const startBlock  = m["blockchain_block_number"]?.values?.min ?? 0;
  const endBlock    = m["blockchain_block_number"]?.values?.max ?? 0;
  const confirmed   = m["deploy_confirmed"]?.values?.count ?? 0;
  const unconfirmed = m["deploy_unconfirmed"]?.values?.count ?? 0;

  console.log("=== capacity-single results ===");
  console.log(`  deploy type         : ${DEPLOY_TYPE}`);
  console.log(`  deploys / round     : ${DEPLOYS_PER_ROUND}`);
  console.log(`  blocks produced     : ${endBlock - startBlock}`);
  console.log(`  deploys accepted    : ${confirmed}`);
  console.log(`  deploys rejected    : ${unconfirmed}`);
  console.log(`  max deploys/block   : see k6_test_max_deploys_in_block in Grafana`);
  console.log("================================");

  annotateTestRun(data, "capacity-single");
  pushReport(data, "capacity-single", NODE_URL);
  return {};
}
