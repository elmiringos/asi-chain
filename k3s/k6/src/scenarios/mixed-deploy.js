/**
 * Scenario: mixed-deploy
 *
 * Sends HelloWorld and Transfer deploys in the same test run.
 * Odd-numbered VUs send HelloWorld, even-numbered send Transfer.
 * Both types are confirmed via waitForBlock and tracked separately.
 *
 * Custom metrics:
 *   deploy_confirmation_ms    — confirmation time for all deploy types (Trend)
 *   deploy_confirmed_total    — confirmed deploys (Counter; k6 name: deploy_confirmed)
 *   deploy_unconfirmed_total  — timed-out deploys (Counter; k6 name: deploy_unconfirmed)
 *   block_deploy_count        — deploys per confirmed block (Trend)
 *
 * Env vars:
 *   NODE_URL         — target validator (default: validator1, port 40403)
 *   PRIVATE_KEY      — hex-encoded private key
 *   FROM_ADDR        — sender address for Transfer deploys
 *   TO_ADDR          — recipient address for Transfer deploys
 *   AMOUNT           — transfer amount (default: 1)
 *   SHARD_ID         — shard id (default: root)
 *   CONFIRM_TIMEOUT  — seconds to wait for block confirmation (default: 30)
 */
import { check, sleep } from "k6";
import { Trend, Counter, Gauge } from "k6/metrics";
import { waitForBlock } from "k6/x/asichain";
import {
  sendDeploy,
  getValidAfterBlockNumber,
  getLatestBlockInfo,
  HELLO_WORLD_TERM,
  transferTerm,
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
const blockDeployCount = new Trend("block_deploy_count", true);
const blockNumberGauge = new Gauge("blockchain_block_number");
const deployPayloadBytes = new Trend("deploy_payload_bytes", true);
const blockCreationTime = new Trend("block_creation_time_ms", true);

// per-VU state for block creation time tracking
let _lastBlockNumber = 0;
let _lastBlockTimestamp = 0;

export const options = {
  vus: __ENV.VUS ? parseInt(__ENV.VUS) : 4,
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
    console.warn("setup: FROM_ADDR / TO_ADDR not set — Transfer deploys will be skipped");
  }
  const blockNumber = getValidAfterBlockNumber(NODE_URL);
  console.log(`mixed-deploy: setup blockNumber=${blockNumber}, timeout=${CONFIRM_TIMEOUT}s`);
  blockNumberGauge.add(blockNumber);
  return { validAfterBlockNumber: blockNumber, currentBlockNumber: blockNumber };
}

export default function ({ validAfterBlockNumber, currentBlockNumber }) {
  // Odd VU index → HelloWorld, Even → Transfer
  const isTransfer = __VU % 2 === 0 && FROM_ADDR && TO_ADDR;
  const term = isTransfer ? transferTerm(FROM_ADDR, TO_ADDR, AMOUNT) : HELLO_WORLD_TERM;
  const label = isTransfer ? "transfer" : "hello-world";

  const res = sendDeploy(NODE_URL, term, validAfterBlockNumber, PRIVATE_KEY, SHARD_ID);

  if (res.request && res.request.body) {
    deployPayloadBytes.add(res.request.body.length);
  }

  const accepted = check(res, {
    [`${label} accepted (200)`]: (r) => r.status === 200,
    [`${label} has body`]: (r) => !!r.body && r.body.length > 0,
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
    console.log(`[${label}] confirmed block=${newBlock}, confirmation_ms=${elapsed}, deploys_in_block=${info.deployCount}`);
  } else {
    unconfirmedCounter.add(1);
    console.warn(`[${label}] NOT confirmed within ${CONFIRM_TIMEOUT}s (still at block ${currentBlockNumber})`);
  }

  sleep(1);
}

export function handleSummary(data) {
  annotateTestRun(data, "mixed-deploy");
  pushReport(data, "mixed-deploy", NODE_URL);
  return {};
}
