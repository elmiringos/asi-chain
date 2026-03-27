/**
 * Scenario: confirmed-deploy
 *
 * Sends a HelloWorld deploy and waits until a new block is produced,
 * confirming the deploy was actually included in the blockchain.
 *
 * Custom metrics (exported to Prometheus via remote write):
 *   deploy_confirmation_ms  — time from HTTP 200 to new block (Trend)
 *   deploy_confirmed_total  — deploys confirmed in a block (Counter)
 *   deploy_unconfirmed_total — deploys that timed out waiting for a block (Counter)
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
import { Trend, Counter } from "k6/metrics";
import { waitForBlock } from "k6/x/asichain";
import { sendDeploy, getValidAfterBlockNumber, HELLO_WORLD_TERM } from "../lib/deploy.js";

const NODE_URL = __ENV.NODE_URL || "http://validator1-0.validator1.asi-chain.svc.cluster.local:40403";
const PRIVATE_KEY = __ENV.PRIVATE_KEY || "";
const SHARD_ID = __ENV.SHARD_ID || "root";
const CONFIRM_TIMEOUT = __ENV.CONFIRM_TIMEOUT ? parseInt(__ENV.CONFIRM_TIMEOUT) : 30;

const confirmationTime = new Trend("deploy_confirmation_ms", true);
const confirmedCounter = new Counter("deploy_confirmed_total");
const unconfirmedCounter = new Counter("deploy_unconfirmed_total");

export const options = {
  vus: __ENV.VUS ? parseInt(__ENV.VUS) : 2,
  duration: __ENV.DURATION || "120s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<10000"],
    deploy_confirmation_ms: ["p(95)<30000"],
    deploy_unconfirmed_total: ["count<5"],
  },
};

export function setup() {
  const blockNumber = getValidAfterBlockNumber(NODE_URL);
  console.log(`confirmed-deploy: setup blockNumber=${blockNumber}, timeout=${CONFIRM_TIMEOUT}s`);
  return { validAfterBlockNumber: blockNumber, currentBlockNumber: blockNumber };
}

export default function ({ validAfterBlockNumber, currentBlockNumber }) {
  const res = sendDeploy(NODE_URL, HELLO_WORLD_TERM, validAfterBlockNumber, PRIVATE_KEY, SHARD_ID);

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
    console.log(`deploy confirmed in block=${newBlock}, confirmation_ms=${elapsed}`);
  } else {
    unconfirmedCounter.add(1);
    console.warn(`deploy NOT confirmed within ${CONFIRM_TIMEOUT}s (still at block ${currentBlockNumber})`);
  }

  sleep(1);
}
