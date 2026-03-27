import { sleep } from "k6";
import { deployAndCheck, getValidAfterBlockNumber, HELLO_WORLD_TERM } from "./lib/deploy.js";

const NODE_URL = __ENV.NODE_URL || "http://validator1-0.validator1.asi-chain.svc.cluster.local:40403";
const PRIVATE_KEY = __ENV.PRIVATE_KEY || "";
const SHARD_ID = __ENV.SHARD_ID || "root";

export const options = {
  vus: __ENV.VUS ? parseInt(__ENV.VUS) : 5,
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<8000"],
  },
};

export function setup() {
  const blockNumber = getValidAfterBlockNumber(NODE_URL);
  console.log(`setup: validAfterBlockNumber=${blockNumber}`);
  return { validAfterBlockNumber: blockNumber };
}

export default function ({ validAfterBlockNumber }) {
  deployAndCheck(NODE_URL, HELLO_WORLD_TERM, validAfterBlockNumber, PRIVATE_KEY, SHARD_ID, "hello-world");
  sleep(1);
}
