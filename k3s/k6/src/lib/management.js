import http from "k6/http";
import { check } from "k6";

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Client for the Management API (management-api service).
 *
 * Usage:
 *   import { ManagementApiClient } from "./lib/management.js";
 *   const mgmt = new ManagementApiClient(__ENV.MANAGEMENT_URL);
 */
export class ManagementApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl || "http://management-api.monitoring.svc.cluster.local:8000";
  }

  // --- Validator lifecycle ---

  startValidator(name) {
    const res = http.post(`${this.baseUrl}/validators/${name}/start`, null, { headers: JSON_HEADERS });
    check(res, { [`start ${name} ok`]: (r) => r.status === 200 });
    return res;
  }

  stopValidator(name) {
    const res = http.post(`${this.baseUrl}/validators/${name}/stop`, null, { headers: JSON_HEADERS });
    check(res, { [`stop ${name} ok`]: (r) => r.status === 200 });
    return res;
  }

  restartValidator(name) {
    const res = http.post(`${this.baseUrl}/validators/${name}/restart`, null, { headers: JSON_HEADERS });
    check(res, { [`restart ${name} ok`]: (r) => r.status === 200 });
    return res;
  }

  getValidators() {
    const res = http.get(`${this.baseUrl}/validators`);
    check(res, { "get validators ok": (r) => r.status === 200 });
    return res.status === 200 ? res.json() : null;
  }

  // --- Network partitions ---

  /**
   * @param {string} id        Partition identifier
   * @param {string[]} groupA  Validator names in group A
   * @param {string[]} groupB  Validator names in group B
   */
  createPartition(id, groupA, groupB) {
    const res = http.post(
      `${this.baseUrl}/partitions`,
      JSON.stringify({ id, group_a: groupA, group_b: groupB }),
      { headers: JSON_HEADERS },
    );
    check(res, { [`create partition ${id} ok`]: (r) => r.status === 200 });
    return res;
  }

  deletePartition(id) {
    const res = http.del(`${this.baseUrl}/partitions/${id}`);
    check(res, { [`delete partition ${id} ok`]: (r) => r.status === 200 });
    return res;
  }

  getPartitions() {
    const res = http.get(`${this.baseUrl}/partitions`);
    return res.status === 200 ? res.json() : null;
  }

  // --- Node isolation ---

  isolateNode(name) {
    const res = http.post(`${this.baseUrl}/nodes/${name}/isolate`, null, { headers: JSON_HEADERS });
    check(res, { [`isolate ${name} ok`]: (r) => r.status === 200 });
    return res;
  }

  restoreNode(name) {
    const res = http.del(`${this.baseUrl}/nodes/${name}/isolate`);
    check(res, { [`restore ${name} ok`]: (r) => r.status === 200 });
    return res;
  }

  // --- Resource throttle ---

  throttleNode(name, cpuMillis, memoryMi) {
    const res = http.post(
      `${this.baseUrl}/nodes/${name}/throttle`,
      JSON.stringify({ cpu_millis: cpuMillis, memory_mi: memoryMi }),
      { headers: JSON_HEADERS },
    );
    check(res, { [`throttle ${name} ok`]: (r) => r.status === 200 });
    return res;
  }

  unthrottleNode(name) {
    const res = http.del(`${this.baseUrl}/nodes/${name}/throttle`);
    check(res, { [`unthrottle ${name} ok`]: (r) => r.status === 200 });
    return res;
  }

  // --- Consensus observability ---

  getConsensusHealth() {
    const res = http.get(`${this.baseUrl}/consensus/health`);
    return res.status === 200 ? res.json() : null;
  }

  getConsensusLag() {
    const res = http.get(`${this.baseUrl}/consensus/lag`);
    return res.status === 200 ? res.json() : null;
  }

  getNodeStatus(name) {
    const res = http.get(`${this.baseUrl}/nodes/${name}/status`);
    return res.status === 200 ? res.json() : null;
  }
}
