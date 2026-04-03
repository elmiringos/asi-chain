/**
 * Scenario: capacity-mixed
 *
 * Goal: determine how many alternating HelloWorld + Transfer deploys
 * fit into a single block with the default 256M gRPC stream limit.
 *
 * Strategy:
 *   - 1 VU, sequential iterations (guaranteed alternating order)
 *   - Even iterations → HelloWorld, odd iterations → Transfer
 *   - Deploys are sent as fast as possible (no sleep) to fill the mempool
 *     within a single casper-loop window (~1s)
 *   - Per-block HW and Transfer counts are tracked by detecting block advances
 *   - After the test, max counts are logged to k6 stdout
 *
 * Test Preparations (run before this scenario):
 *   make start HEARTBEAT=0 SYNCHRONY_THRESHOLD=0 MAX_DEPLOYS_PER_BLOCK=10000
 *
 *   IMPORTANT: MAX_DEPLOYS_PER_BLOCK must be set to a large value (e.g. 10000)
 *   so the per-user node limit does not cap results before the real block size
 *   limits (F1R3_BLOCK_PROTO_DECODE_BUFFER_BYTES / gRPC stream size) are hit.
 *
 * Env vars:
 *   NODE_URL         — target validator (default: validator1, port 40403)
 *   PRIVATE_KEY      — hex-encoded private key
 *   FROM_ADDR        — sender address for Transfer deploys
 *   TO_ADDR          — recipient address for Transfer deploys
 *   AMOUNT           — transfer amount (default: 1)
 *   SHARD_ID         — shard id (default: root)
 *   TOTAL_DEPLOYS    — total deploys to send (default: 1000)
 */
import { check } from "k6";
import { Counter, Gauge } from "k6/metrics";
import {
  sendDeploy,
  getValidAfterBlockNumber,
  getLatestBlockInfo,
  HELLO_WORLD_TERM,
  transferTerm,
} from "../lib/deploy.js";

const NODE_URL     = __ENV.NODE_URL     || "http://validator1-0.validator1.asi-chain.svc.cluster.local:40403";
const PRIVATE_KEY  = __ENV.PRIVATE_KEY  || "";
const FROM_ADDR    = __ENV.FROM_ADDR    || "";
const TO_ADDR      = __ENV.TO_ADDR      || "";
const AMOUNT       = __ENV.AMOUNT       ? parseInt(__ENV.AMOUNT) : 1;
const SHARD_ID     = __ENV.SHARD_ID     || "root";
const TOTAL_DEPLOYS = __ENV.TOTAL_DEPLOYS ? parseInt(__ENV.TOTAL_DEPLOYS) : 1000;

const confirmedCounter   = new Counter("deploy_confirmed");
const unconfirmedCounter = new Counter("deploy_unconfirmed");
const blockNumberGauge   = new Gauge("blockchain_block_number");

// Per-VU state (single VU — safe to use module-level vars)
let _currentBlock        = 0;
let _hwInBlock           = 0;
let _transferInBlock     = 0;
let _maxHwInBlock        = 0;
let _maxTransferInBlock  = 0;
let _blocksObserved      = 0;

export const options = {
  scenarios: {
    capacity: {
      executor: "shared-iterations",
      vus: 1,
      iterations: TOTAL_DEPLOYS,
      maxDuration: "5m",
    },
  },
  thresholds: {
    http_req_failed:  ["rate<0.05"],
    deploy_unconfirmed: ["count<10"],
  },
};

export function setup() {
  const blockNumber = getValidAfterBlockNumber(NODE_URL);
  console.log(
    `capacity-mixed: start blockNumber=${blockNumber}, total=${TOTAL_DEPLOYS}, from=${FROM_ADDR}`
  );
  blockNumberGauge.add(blockNumber);
  return { startBlock: blockNumber };
}

export default function ({ startBlock }) {
  const isTransfer = __ITER % 2 === 1 && FROM_ADDR && TO_ADDR;
  const term  = isTransfer ? transferTerm(FROM_ADDR, TO_ADDR, AMOUNT) : HELLO_WORLD_TERM;
  const label = isTransfer ? "transfer" : "hello-world";

  // Init block tracker on first iteration
  if (_currentBlock === 0) {
    _currentBlock = startBlock;
  }

  const res = sendDeploy(NODE_URL, term, _currentBlock, PRIVATE_KEY, SHARD_ID);

  const accepted = check(res, {
    [`${label} accepted (200)`]: (r) => r.status === 200,
  });

  if (!accepted) {
    unconfirmedCounter.add(1);
    return;
  }

  confirmedCounter.add(1);

  // Check if block advanced
  const info = getLatestBlockInfo(NODE_URL);
  if (info.blockNumber > _currentBlock) {
    // Block boundary crossed — save counts for the completed block
    if (_hwInBlock > 0 || _transferInBlock > 0) {
      _blocksObserved++;
      if (_hwInBlock > _maxHwInBlock)           _maxHwInBlock = _hwInBlock;
      if (_transferInBlock > _maxTransferInBlock) _maxTransferInBlock = _transferInBlock;
      console.log(
        `block=${_currentBlock}→${info.blockNumber}: hw=${_hwInBlock}, transfer=${_transferInBlock}, total=${_hwInBlock + _transferInBlock}`
      );
    }
    _hwInBlock       = 0;
    _transferInBlock = 0;
    _currentBlock    = info.blockNumber;
    blockNumberGauge.add(_currentBlock);
  }

  // Count this deploy in the current block window
  if (isTransfer) {
    _transferInBlock++;
  } else {
    _hwInBlock++;
  }
}

export function handleSummary(data) {
  // Flush last in-progress block
  if (_hwInBlock > 0 || _transferInBlock > 0) {
    if (_hwInBlock > _maxHwInBlock)             _maxHwInBlock = _hwInBlock;
    if (_transferInBlock > _maxTransferInBlock)  _maxTransferInBlock = _transferInBlock;
    _blocksObserved++;
  }

  const maxTotal = _maxHwInBlock + _maxTransferInBlock;
  console.log("=== capacity-mixed results ===");
  console.log(`  blocks observed : ${_blocksObserved}`);
  console.log(`  max hw/block    : ${_maxHwInBlock}`);
  console.log(`  max transfer/blk: ${_maxTransferInBlock}`);
  console.log(`  max total/block : ${maxTotal}`);
  console.log("==============================");

  return {};
}
