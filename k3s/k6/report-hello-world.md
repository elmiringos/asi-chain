# Block Capacity Report: Hello World Deploys

## 1. Summary

| Metric | Value |
|--------|-------|
| Deploy type | Hello World |
| Single deploy size (proto-encoded) | ~246 bytes |
| **Maximum deploys confirmed in one block** | **256** |
| Block creation time at 256 deploys (p50) | ~769 ms (after propose completes) |
| Propose HTTP call duration at 256 deploys | ~60–120 s |
| Estimated block data at 256 deploys | ~61.5 KB |
| First failure point | 384 deploys (node EOF / crash) |

---

## 2. Configuration Variables That Affect Block Capacity

### 2.1 Adaptive Deploy Cap (most impactful — enabled by default)

The node dynamically reduces the per-block deploy cap using an EMA controller to keep block creation time close to a target. **This is the primary reason why default deployCount is low.**

| Variable | Default | Description |
|----------|---------|-------------|
| `F1R3_ADAPTIVE_DEPLOY_CAP_ENABLED` | `true` | Enables the EMA-based adaptive controller |
| `F1R3_ADAPTIVE_DEPLOY_CAP_TARGET_MS` | `1000` | Target block creation time in ms |
| `F1R3_ADAPTIVE_DEPLOY_CAP_MIN` | `1` | Minimum cap floor (absolute minimum deploys/block) |
| `F1R3_ADAPTIVE_DEPLOY_CAP_BACKLOG_FLOOR_ENABLED` | `true` | Enables backlog floor mechanism |
| `F1R3_ADAPTIVE_DEPLOY_CAP_BACKLOG_TRIGGER` | `2` | Pending deploys threshold that activates backlog floor |
| `F1R3_ADAPTIVE_DEPLOY_CAP_BACKLOG_MAX` | **`8`** | **Maximum cap imposed by backlog floor — root cause of stuck deployCount=8** |
| `F1R3_ADAPTIVE_DEPLOY_CAP_BACKLOG_MIN` | `2` | Minimum cap imposed by backlog floor |
| `F1R3_ADAPTIVE_DEPLOY_CAP_BACKLOG_DIVISOR` | `2` | Divisor used to scale backlog floor |
| `F1R3_ADAPTIVE_DEPLOY_CAP_SMALL_BATCH_BYPASS` | `3` | Batches ≤ this size bypass the adaptive cap entirely |

> **Key discovery:** When a large batch of deploys (>2) is in the mempool, the backlog floor mechanism kicks in and caps deploys at `BACKLOG_MAX=8`. This caused `deployCount=8` consistently during all initial tests regardless of `MAX_DEPLOYS_PER_BLOCK` or `PHLO_LIMIT` settings.

### 2.2 Per-User Deploy Cap

| Variable | Default | Description |
|----------|---------|-------------|
| `F1R3_MAX_USER_DEPLOYS_PER_BLOCK` | `32` | Maximum deploys per wallet address per block |

Controlled via Makefile: `make start MAX_DEPLOYS_PER_BLOCK=10000`

### 2.3 Block Propagation Limit

| Setting | Default | Description |
|---------|---------|-------------|
| `grpc-max-recv-stream-message-size` | `256M` | Maximum gRPC message size for block propagation between validators. A block exceeding this size cannot be received by peers and will not be finalized. |
| `F1R3_BLOCK_PROTO_DECODE_BUFFER_BYTES` | `65536` (64 KB) | Internal buffer for decoding block protobuf. Not a hard limit but affects memory allocation. |

Theoretical maximum from gRPC limit: `256 MB / 246 bytes ≈ 1,096,000 deploys`  
The practical limit is far lower due to Rholang execution time (see §4).

### 2.4 Proposal Behavior

| Setting | Default | Description |
|---------|---------|-------------|
| `--autopropose` flag | enabled | Casper loop auto-proposes blocks at `casper-loop-interval`. When enabled, it races with explicit POST /api/propose calls, causing `NoNewDeploys` errors. |
| `casper-loop-interval` | `1s` | Interval between automatic block proposals |
| `--heartbeat` | enabled | Produces empty heartbeat blocks between rounds. Adds noise to block count metrics. |
| `F1R3_SYNCHRONY_CONSTRAINT_THRESHOLD` | `0.33` | Fraction of peers a validator must observe before proposing. Must be set to `0` when heartbeat is disabled. |

### 2.5 Admin vs Main HTTP Port

| Port | Description |
|------|-------------|
| `40403` | Main HTTP API. POST `/api/propose` only works when `--autopropose` is enabled. |
| `40405` | Admin HTTP API. POST `/api/propose` **always** works regardless of autopropose setting. |

Capacity tests use port `40405` to trigger explicit block creation.

---

## 3. Test Results

### 3.1 Baseline (default settings)

**Chain config:** All defaults (`AUTOPROPOSE=1`, `MAX_DEPLOYS_PER_BLOCK=32`, `ADAPTIVE_DEPLOY_CAP=true`)

| Deploys sent | Deploys in block | Observation |
|-------------|-----------------|-------------|
| 128 | 8 | `BACKLOG_MAX=8` cap activated — consistent regardless of phlo_limit |
| 128 | 8 | Lowering `PHLO_LIMIT` from 500,000 to 50,000 had no effect |

> Default configuration limits practical throughput to **8 deploys per block** when a backlog exists.

### 3.2 Capacity test (adaptive cap disabled)

**Chain config:**
```
AUTOPROPOSE=0  HEARTBEAT=0  SYNCHRONY_THRESHOLD=0
MAX_DEPLOYS_PER_BLOCK=10000  ADAPTIVE_DEPLOY_CAP=false
```

| Deploys sent | Deploys in block | Propose result | Block creation | Notes |
|-------------|-----------------|----------------|----------------|-------|
| 128 | 128 | OK | ~30s | Stable, all rounds confirmed |
| 256 | 256 | HTTP timeout (~120s), then EOF | ~120s | Block confirmed after timeout |
| 384 | 0 | **EOF after ~555s** | N/A | Node crashed — block not created |
| 512 | 0 | **EOF** | N/A | Node crashed — block not created |

### 3.3 Deploy payload measurements

Measured via proto-encoded size estimation (`estimateDeployProtoSize`):

| Field | Size |
|-------|------|
| Single Hello World deploy (min) | 243 bytes |
| Single Hello World deploy (avg) | ~246 bytes |
| Single Hello World deploy (max) | 247 bytes |
| Estimated block data at 256 deploys | ~61.5 KB |

### 3.4 Block creation time at 256 deploys

| Metric | Value |
|--------|-------|
| Confirmation p50 (waitForBlock) | 769 ms |
| Confirmation p95 | 1,224 ms |
| Confirmation max | 1,275 ms |
| Propose HTTP call duration | ~60–120 s |

> Note: confirmation time measures only the polling delay after the propose call returns. The propose call itself blocks synchronously while the node creates the block.

---

## 4. Why 384 Deploys Fails (EOF)

The `/api/propose` HTTP handler is **synchronous** — it blocks until block creation completes (all Rholang terms are evaluated sequentially). At 384 deploys:

- The node processes ~555 seconds before the TCP connection is closed with `EOF`
- `EOF` indicates the node process panicked, ran out of memory (k8s limit: 2 Gi), or the HTTP server was forcefully terminated
- The block is never created; deploys remain in the mempool

This is the **true practical limit** on the current hardware: the node cannot sustain block creation with >256 Hello World deploys before exhausting resources.

The gRPC 256 MB limit is not the bottleneck — 256 deploys × 246 bytes = ~61.5 KB, far below the limit.

---

## 5. How to Run the Tests

### Prerequisites

```bash
# Generate keys (once)
make gen

# Start chain with capacity test settings
make start AUTOPROPOSE=0 HEARTBEAT=0 SYNCHRONY_THRESHOLD=0 \
           MAX_DEPLOYS_PER_BLOCK=10000 ADAPTIVE_DEPLOY_CAP=false

# Build k6 image
make k6-build
```

### Find the maximum (geometric search)

```bash
# Step 1: find the order of magnitude
sudo make k6-capacity K6_CAPACITY_DEPLOYS=128  K6_CAPACITY_ROUNDS=3 K6_CONFIRM_TIMEOUT=120
sudo make k6-capacity K6_CAPACITY_DEPLOYS=256  K6_CAPACITY_ROUNDS=3 K6_CONFIRM_TIMEOUT=120
sudo make k6-capacity K6_CAPACITY_DEPLOYS=384  K6_CAPACITY_ROUNDS=1 K6_CONFIRM_TIMEOUT=600
sudo make k6-capacity K6_CAPACITY_DEPLOYS=512  K6_CAPACITY_ROUNDS=1 K6_CONFIRM_TIMEOUT=600

# Step 2: binary search in the found range (e.g. 256–384)
sudo make k6-capacity K6_CAPACITY_DEPLOYS=320  K6_CAPACITY_ROUNDS=1 K6_CONFIRM_TIMEOUT=300

# Clean up between runs
sudo make k6-clean
```

### Interpret results

| Log line | Meaning |
|----------|---------|
| `[round N] confirmed: block=X, deployCount=Y` | Y deploys included in block — success |
| `[round N] propose failed: status=0 body=` (EOF) | Node crashed — hard limit reached |
| `[round N] block not confirmed within Xs` | Block creation exceeded timeout — increase `K6_CONFIRM_TIMEOUT` |
| `propose: NoNewDeploys` | Autopropose beat explicit propose — use `AUTOPROPOSE=0` |

### Key Makefile variables

| Variable | Default | Description |
|----------|---------|-------------|
| `K6_CAPACITY_DEPLOYS` | `16` | Deploys per round |
| `K6_CAPACITY_ROUNDS` | `3` | Number of flood→propose→confirm rounds |
| `K6_CONFIRM_TIMEOUT` | `60` | Seconds to wait for block after propose |
| `K6_DEPLOY_TYPE` | `hello-world` | `hello-world` or `transfer` |
| `K6_PHLO_LIMIT` | `500000` | Phlo (gas) per deploy |
| `ADAPTIVE_DEPLOY_CAP` | `true` | Set to `false` for capacity testing |
| `MAX_DEPLOYS_PER_BLOCK` | `32` | Per-user cap (set to `10000` for capacity testing) |

---

## 6. Recommendations

### 6.1 For capacity testing

- Always run `make k6-clean` between tests to avoid leftover jobs mixing logs
- Use `ROUNDS=1` for large deploy counts (384+) to prevent mempool accumulation between rounds
- The propose HTTP call is synchronous — set `K6_CONFIRM_TIMEOUT` to at least 2× the expected block creation time
- Use a fresh chain (`make restart`) between test series to reset the adaptive cap EMA state
