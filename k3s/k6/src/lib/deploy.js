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
 * Sends a deploy and runs standard checks. Returns true if successful.
 */
export function deployAndCheck(nodeUrl, term, validAfterBlockNumber, privateKey, shardId, label = "deploy") {
  const res = sendDeploy(nodeUrl, term, validAfterBlockNumber, privateKey, shardId);
  return check(res, {
    [`${label} status 200`]: (r) => r.status === 200,
    [`${label} has body`]: (r) => !!r.body && r.body.length > 0,
  });
}
