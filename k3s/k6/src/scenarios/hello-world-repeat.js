/**
 * Scenario: HelloWorld repeated deployments.
 *
 * Deploys HelloWorld N times per VU iteration without sleep,
 * useful for measuring raw throughput and node acceptance rate.
 *
 * Env vars:
 *   NODE_URL       — target validator (default: validator1, port 40403)
 *   PRIVATE_KEY    — hex-encoded private key
 *   SHARD_ID       — shard id (default: root)
 *   REPEAT         — deploys per VU iteration (default: 5)
 *   VUS            — virtual users (default: 3)
 *   DURATION       — test duration (default: 60s)
 */
import { deployAndCheck, getValidAfterBlockNumber, HELLO_WORLD_TERM } from "../lib/deploy.js";
import { annotateTestRun } from "../lib/summary.js";

const NODE_URL = __ENV.NODE_URL || "http://validator1-0.validator1.asi-chain.svc.cluster.local:40403";
const PRIVATE_KEY = __ENV.PRIVATE_KEY || "";
const SHARD_ID = __ENV.SHARD_ID || "root";
const REPEAT = __ENV.REPEAT ? parseInt(__ENV.REPEAT) : 5;

export const options = {
  vus: __ENV.VUS ? parseInt(__ENV.VUS) : 3,
  duration: __ENV.DURATION || "60s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<10000"],
  },
};

export function setup() {
  const blockNumber = getValidAfterBlockNumber(NODE_URL);
  console.log(`hello-world-repeat: blockNumber=${blockNumber}, repeat=${REPEAT}`);
  return { validAfterBlockNumber: blockNumber };
}

export default function ({ validAfterBlockNumber }) {
  for (let i = 0; i < REPEAT; i++) {
    deployAndCheck(NODE_URL, HELLO_WORLD_TERM, validAfterBlockNumber, PRIVATE_KEY, SHARD_ID, `hw-${i + 1}`);
  }
}

export function handleSummary(data) {
  annotateTestRun(data, "hello-world-repeat");
  return {};
}
