import http from "k6/http";
import { check } from "k6";
import { signDeploy, helloWorldTerm, transferTerm as _transferTerm } from "k6/x/asichain";

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Rholang term for a simple hello-world deploy.
 * Provided by the xk6-asi-chain extension (no JS crypto needed).
 */
export const HELLO_WORLD_TERM = helloWorldTerm();

/**
 * Rholang term for an ASI vault transfer.
 * @param {string} fromAddr
 * @param {string} toAddr
 * @param {number} amount
 */
export function transferTerm(fromAddr, toAddr, amount) {
  return _transferTerm(fromAddr, toAddr, amount);
}

/**
 * Fetches the latest block number from a node.
 * Call once in setup() and pass the result to default().
 */
export function getValidAfterBlockNumber(nodeUrl) {
  const res = http.get(`${nodeUrl}/api/blocks/1`);
  if (res.status !== 200) {
    console.error(`getValidAfterBlockNumber: status=${res.status} from ${nodeUrl}`);
    return 0;
  }
  const blocks = res.json();
  return (blocks && blocks[0] && blocks[0].blockNumber) || 0;
}

/**
 * Returns { blockNumber, deployCount } for the latest block.
 * deployCount comes from LightBlockInfo.deployCount (proto field 18).
 */
export function getLatestBlockInfo(nodeUrl) {
  const res = http.get(`${nodeUrl}/api/blocks/1`);
  if (res.status !== 200) {
    console.error(`getLatestBlockInfo: status=${res.status} from ${nodeUrl}`);
    return { blockNumber: 0, deployCount: 0 };
  }
  const blocks = res.json();
  const b = blocks && blocks[0];
  return {
    blockNumber: (b && b.blockNumber) || 0,
    deployCount: (b && b.deployCount) || 0,
    timestamp: (b && b.timestamp) || 0,
  };
}

/**
 * Signs and sends a deploy to a node's /api/deploy endpoint.
 * Returns the k6 response object.
 */
export function sendDeploy(nodeUrl, term, validAfterBlockNumber, privateKey, shardId = "root") {
  const deployData = {
    term,
    phloLimit: 500_000,
    phloPrice: 1,
    validAfterBlockNumber,
    timestamp: Date.now(),
    shardId,
  };

  const signed = signDeploy(deployData, privateKey);

  return http.post(
    `${nodeUrl}/api/deploy`,
    JSON.stringify({
      data: {
        term: deployData.term,
        timestamp: deployData.timestamp,
        phloPrice: deployData.phloPrice,
        phloLimit: deployData.phloLimit,
        validAfterBlockNumber: deployData.validAfterBlockNumber,
        shardId: deployData.shardId,
      },
      sigAlgorithm: signed.sigAlgorithm,
      signature: signed.sig,
      deployer: signed.deployer,
    }),
    { headers: JSON_HEADERS },
  );
}

/**
 * Estimates the protobuf byte size of a DeployDataProto message.
 *
 * Proto definition (CasperMessage.proto):
 *   deployer(1)=bytes, term(2)=string, timestamp(3)=int64,
 *   sig(4)=bytes, sigAlgorithm(5)=string, phloPrice(7)=int64,
 *   phloLimit(8)=int64, validAfterBlockNumber(10)=int64,
 *   shardId(11)=string, language(12)=string
 *
 * @param {Object} body - parsed JSON body sent to /api/deploy
 * @returns {number} estimated protobuf byte size
 */
export function estimateDeployProtoSize(body) {
  const d = body.data || {};

  // Number of bytes needed to encode n as a protobuf varint
  function varintSize(n) {
    if (!n || n === 0) return 0;
    if (n < 0x80) return 1;
    if (n < 0x4000) return 2;
    if (n < 0x200000) return 3;
    if (n < 0x10000000) return 4;
    if (n < 0x800000000) return 5;
    if (n < 0x40000000000) return 6;
    return 7; // sufficient for JS safe integers
  }

  // tag(1 byte, all our fields are ≤ 15) + varint(len) + bytes
  function strField(s) {
    if (!s || s.length === 0) return 0;
    return 1 + varintSize(s.length) + s.length;
  }

  // tag(1 byte) + varint(byteLen) + bytes; input is hex string
  function bytesField(hex) {
    if (!hex) return 0;
    const byteLen = hex.replace(/^0x/, "").length >> 1;
    if (byteLen === 0) return 0;
    return 1 + varintSize(byteLen) + byteLen;
  }

  // tag(1 byte) + varint(value); proto3 omits field if value is 0
  function int64Field(n) {
    if (!n || n === 0) return 0;
    return 1 + varintSize(n);
  }

  return (
    bytesField(body.deployer) +                  // field  1: deployer
    strField(d.term) +                           // field  2: term (dominant)
    int64Field(d.timestamp) +                    // field  3: timestamp
    bytesField(body.signature) +                 // field  4: sig
    strField(body.sigAlgorithm) +                // field  5: sigAlgorithm
    int64Field(d.phloPrice) +                    // field  7: phloPrice
    int64Field(d.phloLimit) +                    // field  8: phloLimit
    int64Field(d.validAfterBlockNumber) +        // field 10: validAfterBlockNumber
    strField(d.shardId) +                        // field 11: shardId
    9                                            // field 12: language="rholang" (1+1+7)
  );
}

/**
 * Sends a deploy and runs standard checks. Returns true if successful.
 */
export function deployAndCheck(nodeUrl, term, validAfterBlockNumber, privateKey, shardId, label = "deploy") {
  const res = sendDeploy(nodeUrl, term, validAfterBlockNumber, privateKey, shardId);
  return check(res, {
    [`${label} status 200`]: (r) => r.status === 200,
    [`${label} has body`]: (r) => !!r.body && r.body.length > 0,
  });
}

/**
 * Derives the admin API URL from the main node URL by replacing the HTTP port.
 * Main port: 40403  →  Admin port: 40405
 *
 * @param {string} nodeUrl - main node URL (e.g. http://validator1-0...:40403)
 * @returns {string} admin URL (e.g. http://validator1-0...:40405)
 */
export function adminUrl(nodeUrl) {
  return nodeUrl.replace(/:40403(\/|$)/, ":40405$1");
}

/**
 * Triggers block proposal on a node via POST /api/propose on the ADMIN port (40405).
 *
 * The propose endpoint is served exclusively on the admin HTTP port (40405), not the
 * main port (40403). With autopropose=false the main API returns "read-only node", but
 * the admin API always allows propose for validator nodes.
 *
 * Analogous to the deployer-bot's `cargo run -- propose` step.
 *
 * @param {string} adminNodeUrl - admin node URL (port 40405); use adminUrl() to derive it
 * @returns k6 response object
 */
export function sendPropose(adminNodeUrl) {
  return http.post(`${adminNodeUrl}/api/propose`, null, { headers: JSON_HEADERS });
}
