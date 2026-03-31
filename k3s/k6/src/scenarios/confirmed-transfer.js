/**
 * Scenario: confirmed-transfer
 *
 * Sends a Transfer deploy and waits until a new block is produced,
 * confirming the deploy was actually included in the blockchain.
 *
 * Custom metrics (exported to Prometheus via remote write):
 *   deploy_confirmation_ms    — time from HTTP 200 to new block (Trend)
 *   deploy_confirmed          — deploys confirmed in a block (Counter)
 *   deploy_unconfirmed        — deploys that timed out (Counter)
 *   blockchain_block_number   — current block number observed (Gauge)
 *   block_deploys             — k6 deploys per block (Counter, tagged block_number)
 *   deploy_payload_bytes      — protobuf payload size of one deploy (Trend)
 *   block_creation_time_ms    — time between consecutive blocks (Trend)
 *
 * Env vars:
 *   NODE_URL         — target validator (default: validator1, port 40403)
 *   PRIVATE_KEY      — hex-encoded private key
 *   FROM_ADDR        — sender address
 *   TO_ADDR          — recipient address
 *   AMOUNT           — transfer amount (default: 1)
 *   SHARD_ID         — shard id (default: root)
 *   CONFIRM_TIMEOUT  — seconds to wait for block confirmation (default: 30)
 *   VUS              — virtual users (default: 2)
 *   DURATION         — test duration (default: 120s)
 */
import { check, sleep } from "k6";
import { Trend, Counter, Gauge } from "k6/metrics";
import { waitForBlock } from "k6/x/asichain";
import {
  sendDeploy,
  getValidAfterBlockNumber,
  getLatestBlockInfo,
  transferTerm,
  estimateDeployProtoSize,
} from "../lib/deploy.js";
import { annotateTestRun } from "../lib/summary.js";
import { pushReport } from "../lib/report.js";

const NODE_URL = __ENV.NODE_URL || "http://validator1-0.validator1.asi-chain.svc.cluster.local:40403";
const PRIVATE_KEY = __ENV.PRIVATE_KEY || "";
const FROM_ADDR = __ENV.FROM_ADDR || "";
const TO_ADDR = __ENV.TO_ADDR || "";
const AMOUNT = __ENV.AMOUNT ? parseInt(__ENV.AMOUNT) : 1;
const SHARD_ID = __ENV.SHARD_ID || "root";
const CONFIRM_TIMEOUT = __ENV.CONFIRM_TIMEOUT ? parseInt(__ENV.CONFIRM_TIMEOUT) : 30;

const confirmationTime = new Trend("deploy_confirmation_ms", true);
const confirmedCounter = new Counter("deploy_confirmed");
const unconfirmedCounter = new Counter("deploy_unconfirmed");
const blockNumberGauge = new Gauge("blockchain_block_number");
const deployPayloadBytes = new Trend("deploy_payload_bytes", true);
const blockCreationTime = new Trend("block_creation_time_ms", true);

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
  if (!FROM_ADDR || !TO_ADDR) {
    console.error("confirmed-transfer: FROM_ADDR and TO_ADDR must be set via --env");
  }
  const blockNumber = getValidAfterBlockNumber(NODE_URL);
  console.log(`confirmed-transfer: setup blockNumber=${blockNumber}, timeout=${CONFIRM_TIMEOUT}s, from=${FROM_ADDR}`);
  blockNumberGauge.add(blockNumber);
  return { validAfterBlockNumber: blockNumber, currentBlockNumber: blockNumber };
}

export default function ({ validAfterBlockNumber, currentBlockNumber }) {
  const res = sendDeploy(
    NODE_URL,
    transferTerm(FROM_ADDR, TO_ADDR, AMOUNT),
    validAfterBlockNumber,
    PRIVATE_KEY,
    SHARD_ID,
  );

  if (res.request && res.request.body) {
    deployPayloadBytes.add(estimateDeployProtoSize(JSON.parse(res.request.body)));
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
    blockNumberGauge.add(newBlock);
    if (_lastBlockNumber > 0 && info.blockNumber > _lastBlockNumber && info.timestamp > 0 && _lastBlockTimestamp > 0) {
      const timeDiff = info.timestamp - _lastBlockTimestamp;
      const blocksDiff = info.blockNumber - _lastBlockNumber;
      blockCreationTime.add(timeDiff / blocksDiff);
    }
    _lastBlockNumber = info.blockNumber;
    _lastBlockTimestamp = info.timestamp;
    console.log(`transfer confirmed in block=${newBlock}, confirmation_ms=${elapsed}`);
  } else {
    unconfirmedCounter.add(1);
    console.warn(`transfer NOT confirmed within ${CONFIRM_TIMEOUT}s (still at block ${currentBlockNumber})`);
  }

  sleep(1);
}

export function handleSummary(data) {
  annotateTestRun(data, "confirmed-transfer");
  pushReport(data, "confirmed-transfer", NODE_URL);
  return {};
}
