/**
 * Scenario: burst-block
 *
 * Goal: maximize the number of deploys landing in a single block.
 *
 * Strategy: all VUs fire deploys simultaneously using shared-iterations
 * executor. Since all deploys hit the mempool within the same casper-loop
 * interval (~1s), the next block should contain as many as possible
 * (up to F1R3_MAX_USER_DEPLOYS_PER_BLOCK).
 *
 * Key metric: if blocksProduced = 1 after the burst → confirmed = deploys in
 * that one block. Increase VUS to probe the block capacity limit.
 *
 * Env vars:
 *   NODE_URL        — target validator (default: validator1, port 40403)
 *   PRIVATE_KEY     — hex-encoded private key
 *   SHARD_ID        — shard id (default: root)
 *   CONFIRM_TIMEOUT — seconds to wait for block confirmation (default: 30)
 *   VUS             — number of concurrent deploys per burst (default: 32)
 *   BURSTS          — how many burst rounds to run (default: 3)
 */
import { check, sleep } from "k6";
import { Trend, Counter, Gauge } from "k6/metrics";
import { waitForBlock } from "k6/x/asichain";
import {
  sendDeploy,
  getValidAfterBlockNumber,
  getLatestBlockInfo,
  HELLO_WORLD_TERM,
  estimateDeployProtoSize,
} from "../lib/deploy.js";
import { annotateTestRun } from "../lib/summary.js";
import { pushReport } from "../lib/report.js";

const NODE_URL = __ENV.NODE_URL || "http://validator1-0.validator1.asi-chain.svc.cluster.local:40403";
const SHARD_ID = __ENV.SHARD_ID || "root";
const CONFIRM_TIMEOUT = __ENV.CONFIRM_TIMEOUT ? parseInt(__ENV.CONFIRM_TIMEOUT) : 30;
const VUS = __ENV.VUS ? parseInt(__ENV.VUS) : 32;
const BURSTS = __ENV.BURSTS ? parseInt(__ENV.BURSTS) : 3;
// TOTAL_DEPLOYS: total deploys per burst (= MAX_DEPLOYS_PER_BLOCK × num_keys).
// Decoupled from VUS so we can cap VUs without reducing deploy count.
const TOTAL_DEPLOYS = __ENV.TOTAL_DEPLOYS ? parseInt(__ENV.TOTAL_DEPLOYS) : VUS;

// Support multiple private keys (comma-separated) to bypass per-user deploy limit.
// Each VU picks a key by its index: VU 1 → key[0], VU 2 → key[1], etc.
// Falls back to single PRIVATE_KEY for backwards compatibility.
const PRIVATE_KEYS = (__ENV.PRIVATE_KEYS || __ENV.PRIVATE_KEY || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

const confirmationTime = new Trend("deploy_confirmation_ms", true);
const confirmedCounter = new Counter("deploy_confirmed");
const unconfirmedCounter = new Counter("deploy_unconfirmed");
const blockNumberGauge = new Gauge("blockchain_block_number");
const deployPayloadBytes = new Trend("deploy_payload_bytes", true);

// shared-iterations: all VUs start simultaneously → maximum burst density.
// iterations = TOTAL_DEPLOYS * BURSTS so deploy count is independent of VU count.
export const options = {
  scenarios: {
    burst: {
      executor: "shared-iterations",
      vus: VUS,
      iterations: TOTAL_DEPLOYS * BURSTS,
      maxDuration: "120s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    deploy_unconfirmed: ["count<5"],
  },
};

export function setup() {
  const blockNumber = getValidAfterBlockNumber(NODE_URL);
  console.log(`burst-block: setup blockNumber=${blockNumber}, vus=${VUS}, bursts=${BURSTS}, keys=${PRIVATE_KEYS.length}`);
  blockNumberGauge.add(blockNumber);
  return { startBlock: blockNumber };
}

export default function ({ startBlock }) {
  const privateKey = PRIVATE_KEYS[(__VU - 1) % PRIVATE_KEYS.length];
  const currentBlock = getLatestBlockInfo(NODE_URL).blockNumber || startBlock;

  const res = sendDeploy(NODE_URL, HELLO_WORLD_TERM, currentBlock, privateKey, SHARD_ID);

  if (res.request && res.request.body) {
    deployPayloadBytes.add(estimateDeployProtoSize(JSON.parse(res.request.body)));
  }

  const accepted = check(res, {
    "deploy accepted (200)": (r) => r.status === 200,
  });

  if (!accepted) {
    unconfirmedCounter.add(1);
    return;
  }

  const start = Date.now();
  const newBlock = waitForBlock(NODE_URL, currentBlock, CONFIRM_TIMEOUT);

  if (newBlock > currentBlock) {
    confirmedCounter.add(1);
    confirmationTime.add(Date.now() - start);
    blockNumberGauge.add(newBlock);
    console.log(`confirmed in block=${newBlock} (was ${currentBlock}), ms=${Date.now() - start}`);
  } else {
    unconfirmedCounter.add(1);
    console.warn(`NOT confirmed within ${CONFIRM_TIMEOUT}s`);
  }

  // small sleep between bursts so rounds don't bleed into each other
  sleep(2);
}

export function handleSummary(data) {
  annotateTestRun(data, "burst-block");
  pushReport(data, "burst-block", NODE_URL);
}
