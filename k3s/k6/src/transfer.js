import { sleep } from "k6";
import { deployAndCheck, getValidAfterBlockNumber, transferTerm } from "./lib/deploy.js";

const NODE_URL = __ENV.NODE_URL || "http://validator1-0.validator1.asi-chain.svc.cluster.local:40403";
const PRIVATE_KEY = __ENV.PRIVATE_KEY || "";
const SHARD_ID = __ENV.SHARD_ID || "root";
const FROM_ADDR = __ENV.FROM_ADDR || "";
const TO_ADDR = __ENV.TO_ADDR || "";
const AMOUNT = __ENV.AMOUNT ? parseInt(__ENV.AMOUNT) : 1;

export const options = {
  vus: __ENV.VUS ? parseInt(__ENV.VUS) : 5,
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<8000"],
  },
};

export function setup() {
  if (!FROM_ADDR || !TO_ADDR) {
    console.error("setup: FROM_ADDR and TO_ADDR must be set via --env");
  }
  const blockNumber = getValidAfterBlockNumber(NODE_URL);
  console.log(`setup: validAfterBlockNumber=${blockNumber}, from=${FROM_ADDR}, to=${TO_ADDR}, amount=${AMOUNT}`);
  return { validAfterBlockNumber: blockNumber };
}

export default function ({ validAfterBlockNumber }) {
  deployAndCheck(NODE_URL, transferTerm(FROM_ADDR, TO_ADDR, AMOUNT), validAfterBlockNumber, PRIVATE_KEY, SHARD_ID, "transfer");
  sleep(1);
}
