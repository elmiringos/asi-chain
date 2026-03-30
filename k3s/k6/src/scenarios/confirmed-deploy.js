/**
 * Scenario: confirmed-deploy
 *
 * Sends a HelloWorld deploy and waits until a new block is produced,
 * confirming the deploy was actually included in the blockchain.
 *
 * Custom metrics (exported to Prometheus via remote write):
 *   deploy_confirmation_ms    — time from HTTP 200 to new block (Trend)
 *   deploy_confirmed_total    — deploys confirmed in a block (Counter; k6 name: deploy_confirmed)
 *   deploy_unconfirmed_total  — deploys that timed out (Counter; k6 name: deploy_unconfirmed)
 *   blockchain_block_number   — current block number observed (Gauge); max-min = blocks produced
 *   block_deploy_count        — deploys per confirmed block (Trend); p50/p95/max
 *   deploy_payload_bytes      — HTTP payload size of one deploy (Trend)
 *   block_creation_time_ms    — time between consecutive blocks by timestamp (Trend)
 *
 * Env vars:
 *   NODE_URL         — target validator (default: validator1, port 40403)
 *   PRIVATE_KEY      — hex-encoded private key
 *   SHARD_ID         — shard id (default: root)
 *   CONFIRM_TIMEOUT  — seconds to wait for block confirmation (default: 30)
 *   VUS              — virtual users (default: 2)
 *   DURATION         — test duration (default: 120s)
 */
import { check, sleep } from "k6";
import { Trend, Counter, Gauge } from "k6/metrics";
import { waitForBlock } from "k6/x/asichain";
import { sendDeploy, getValidAfterBlockNumber, getLatestBlockInfo, HELLO_WORLD_TERM } from "../lib/deploy.js";
import { annotateTestRun } from "../lib/summary.js";

const NODE_URL = __ENV.NODE_URL || "http://validator1-0.validator1.asi-chain.svc.cluster.local:40403";
const PRIVATE_KEY = __ENV.PRIVATE_KEY || "";
const SHARD_ID = __ENV.SHARD_ID || "root";
const CONFIRM_TIMEOUT = __ENV.CONFIRM_TIMEOUT ? parseInt(__ENV.CONFIRM_TIMEOUT) : 30;

const confirmationTime = new Trend("deploy_confirmation_ms", true);
const confirmedCounter = new Counter("deploy_confirmed");
const unconfirmedCounter = new Counter("deploy_unconfirmed");
const blockDeployCount = new Trend("block_deploy_count", true);
const blockNumberGauge = new Gauge("blockchain_block_number");
const deployPayloadBytes = new Trend("deploy_payload_bytes", true);
const blockCreationTime = new Trend("block_creation_time_ms", true);

// per-VU state for block creation time tracking
let _lastBlockNumber = 0;
let _lastBlockTimestamp = 0;

export const options = {
  vus: __ENV.VUS ? parseInt(__ENV.VUS) : 2,
  duration: __ENV.DURATION || "120s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<10000"],
    deploy_confirmation_ms: ["p(95)<30000"],
    deploy_unconfirmed: ["count<5"],
  },
};

export function setup() {
  const blockNumber = getValidAfterBlockNumber(NODE_URL);
  console.log(`confirmed-deploy: setup blockNumber=${blockNumber}, timeout=${CONFIRM_TIMEOUT}s`);
  blockNumberGauge.add(blockNumber);
  return { validAfterBlockNumber: blockNumber, currentBlockNumber: blockNumber };
}

export default function ({ validAfterBlockNumber, currentBlockNumber }) {
  const res = sendDeploy(NODE_URL, HELLO_WORLD_TERM, validAfterBlockNumber, PRIVATE_KEY, SHARD_ID);

  if (res.request && res.request.body) {
    deployPayloadBytes.add(res.request.body.length);
  }

  const accepted = check(res, {
    "deploy accepted (200)": (r) => r.status === 200,
    "deploy has body": (r) => !!r.body && r.body.length > 0,
  });

  if (!accepted) {
    sleep(1);
    return;
  }

  const start = Date.now();
  const newBlock = waitForBlock(NODE_URL, currentBlockNumber, CONFIRM_TIMEOUT);

  if (newBlock > currentBlockNumber) {
    const elapsed = Date.now() - start;
    confirmationTime.add(elapsed);
    confirmedCounter.add(1);
    const info = getLatestBlockInfo(NODE_URL);
    if (info.blockNumber === newBlock) {
      blockDeployCount.add(info.deployCount, { block_number: String(newBlock) });
    }
    blockNumberGauge.add(newBlock);
    if (_lastBlockNumber > 0 && info.blockNumber > _lastBlockNumber && info.timestamp > 0 && _lastBlockTimestamp > 0) {
      const timeDiff = info.timestamp - _lastBlockTimestamp;
      const blocksDiff = info.blockNumber - _lastBlockNumber;
      blockCreationTime.add(timeDiff / blocksDiff);
    }
    _lastBlockNumber = info.blockNumber;
    _lastBlockTimestamp = info.timestamp;
    console.log(`deploy confirmed in block=${newBlock}, confirmation_ms=${elapsed}, deploys_in_block=${info.deployCount}, block_time_ms=${info.timestamp - _lastBlockTimestamp}`);
  } else {
    unconfirmedCounter.add(1);
    console.warn(`deploy NOT confirmed within ${CONFIRM_TIMEOUT}s (still at block ${currentBlockNumber})`);
  }

  sleep(1);
}

export function handleSummary(data) {
  annotateTestRun(data, "confirmed-deploy");
  return {};
}
