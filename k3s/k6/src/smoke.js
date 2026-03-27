import { sleep } from "k6";
import { deployAndCheck, getValidAfterBlockNumber, HELLO_WORLD_TERM, transferTerm } from "./lib/deploy.js";

const NODE_URL = __ENV.NODE_URL || "http://validator1-0.validator1.asi-chain.svc.cluster.local:40403";
const PRIVATE_KEY = __ENV.PRIVATE_KEY || "";
const SHARD_ID = __ENV.SHARD_ID || "root";
const FROM_ADDR = __ENV.FROM_ADDR || "";
const TO_ADDR = __ENV.TO_ADDR || "";

export const options = {
  vus: 1,
  duration: "60s",
  thresholds: {
    http_req_failed: ["rate<0.1"],
    http_req_duration: ["p(95)<15000"],
  },
};

export function setup() {
  const blockNumber = getValidAfterBlockNumber(NODE_URL);
  console.log(`smoke: node reachable, blockNumber=${blockNumber}`);
  return { validAfterBlockNumber: blockNumber };
}

export default function ({ validAfterBlockNumber }) {
  // 1. HelloWorld deploy
  deployAndCheck(NODE_URL, HELLO_WORLD_TERM, validAfterBlockNumber, PRIVATE_KEY, SHARD_ID, "hello-world");
  sleep(2);

  // 2. Transfer deploy (skip if addresses not configured)
  if (FROM_ADDR && TO_ADDR) {
    deployAndCheck(NODE_URL, transferTerm(FROM_ADDR, TO_ADDR, 1), validAfterBlockNumber, PRIVATE_KEY, SHARD_ID, "transfer");
    sleep(2);
  }
}
