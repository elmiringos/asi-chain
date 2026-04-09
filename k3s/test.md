# ASI Chain — Test Overview

**Date:** 2026-04-08

---

## 1. Node Repository (`as-chain/node`)

### 1.1 Unit Tests (Rust / `cargo test`)

| Crate | Location | Frameworks | Coverage |
|-------|----------|------------|----------|
| `casper` | `casper/tests/` | cargo, proptest, serial_test | Consensus (Casper CBC), block creation, finalization, merging, synchronization, API |
| `rspace++` | `rspace++/tests/` | cargo, proptest, rstest | State storage, export/import, replay determinism |
| `block-storage` | `block-storage/tests/` | cargo | Block DAG operations |
| `node` | `node/tests/` | cargo, serial_test | Transaction API, trie traversal |
| `comm` | `comm/tests/` | cargo, proptest | P2P network, peer discovery, transport, URI parsing |
| `crypto` | `crypto/tests/` | cargo, proptest | DER conversion, TLS certificates |
| `models` | `models/tests/` | cargo, proptest | Data model validation |
| `shared` | `shared/src/test/` | cargo | Shared utilities |
| `rholang` | `rholang/tests/` | cargo | Rholang term parsing and validation |
| `graphz` | `graphz/tests/` | cargo | Graph operations |

**Casper test structure** (largest suite):
- `batch1/`, `batch2/` — multi-parent consensus scenarios: communication, deploy, finalization, merge, rholang, bonding, smoke
- `add_block/` — block addition logic
- `api/` — gRPC/HTTP API validation
- `engine/` — consensus engine operations
- `genesis/` — genesis block generation
- `blocks/` — block creation and processing
- `sync/` — synchronization protocol
- `block_creator_memory_profile_spec.rs` — memory profiling under load
- `compute_parents_post_state_regression_spec.rs` — regression tests

**Run:**
```bash
cargo test --release                      # full workspace
cargo test -p casper --release            # single crate
cargo test -p casper --release -- --nocapture  # with output
```

**CI flags:** `RUSTFLAGS="-C target-feature=+aes,+sse2 -D warnings"`, `RUST_BACKTRACE=1`

---

### 1.2 Latency Benchmark (Shell / `scripts/ci/`)

Полноценный load test: запускает Docker Compose шард, заливает деплои в течение фиксированного времени и собирает latency-метрики с Prometheus-эндпоинтов валидаторов.

**Files:**
- `scripts/ci/run-latency-benchmark.sh` — основной скрипт (5 шагов: init SLA → warm-up → endpoint readiness → fixed-duration deploy flood → latency profile)
- `scripts/ci/run-latency-benchmark-mode.sh` — запуск в конкретном режиме
- `scripts/ci/run-latency-benchmark-nightly.sh` — nightly вариант

**Параметры:**
| Variable | Default | Description |
|----------|---------|-------------|
| `COMPOSE_FILE` | `docker/shard-with-autopropose.yml` | Compose файл шарда |
| `DURATION_SECONDS` | `90` | Длительность flood-фазы |
| `DEPLOY_INTERVAL_SECONDS` | `1` | Интервал между деплоями |
| `PROPOSE_EVERY` | `1` | Propose после каждого N-го деплоя |
| `PRELOAD_RETRY_RATIO_MAX` | `2.50` | Max block retry ratio (quality gate) |
| `POSTLOAD_RETRY_RATIO_MAX` | — | Post-load quality gate (опционально) |

**Что измеряет:**
- deploy success/failure rate и attempt rate (deploys/s)
- propose ok / transient / bug_error / fail counts
- block retry ratio (block_requests_retries / block_requests_total) — quality gate
- casper latency profile (через `profile-casper-latency.sh`)

**Run:**
```bash
./scripts/ci/run-latency-benchmark.sh docker/shard-with-autopropose.yml 90 /tmp/results
```

**Output:** `load-summary.txt` + `profile/summary.txt` в OUT_DIR

---

### 1.3 Benchmarks (Scala / rspace-bench)

| Benchmark | Location |
|-----------|----------|
| BasicBench | `rspace-bench/src/test/scala/.../bench/` |
| EvalBench | same |
| RSpaceBench | same |
| ReplayRSpaceBench | same |
| WideBench, KeyBench, LoopContractBench | same |
| LMDBOpsBench, TraceEventCreationBench | same |

**Run:** `sbt rspace-bench/test`

---

### 1.3 Smoke Tests (CI only)

| Job | Type | What it checks |
|-----|------|----------------|
| `smoke_docker_standalone` | Docker | Single-node startup, HTTP API, 10 finalized blocks |
| `smoke_docker_shard` | Docker | Multi-node shard (bootstrap + 3 validators + readonly), monitoring stack |
| `smoke_local_standalone` | Binary | Native binary extracted from Docker image |

**CI file:** `.github/workflows/build-test-and-deploy.yml`

CI matrix: 10 parallel crate jobs × 2 architectures (amd64, arm64)

---

## 2. System Integration Repository (`system-integration`)

### 2.1 Integration / E2E Tests (Python / pytest)

**Framework:** pytest 7.0+, pytest-xdist (parallel), pytest-timeout, pyf1r3fly (gRPC client)

**Run:**
```bash
# Full suite (3 parallel workers)
poetry run pytest integration-tests/test/ -v --tb=short \
  -n 3 --dist=loadgroup --timeout=600

# Single test
poetry run pytest integration-tests/test/test_wallets.py::test_validator1_pay_validator2 -v

# Via shardctl
poetry run shardctl test --rust          # default image
poetry run shardctl test --image mynode:dev  # custom image
```

### 2.2 Test Files

| File | Lines | Coverage |
|------|-------|----------|
| `test_shard_degradation.py` | 544 | Network degradation, node failure, recovery |
| `test_slash.py` | 438 | Validator slashing penalties |
| `test_heartbeat.py` | 330 | Auto-block-proposal via heartbeat |
| `test_wallets.py` | 316 | Wallet creation, transfers, vault balance |
| `test_replay_determinism.py` | 289 | Replay determinism, state recovery after restart |
| `test_asymmetric_bonds.py` | 272 | Asymmetric bonding, stake distribution |
| `test_bonding_validators.py` | 239 | Validator bonding deposits |
| `test_storage.py` | 228 | State storage read/write |
| `test_propose.py` | 199 | Block proposal mechanics |
| `test_trim_state.py` | 199 | State pruning, garbage collection |
| `test_bridge_admin.py` | 211 | Bridge admin, cross-chain operations |
| `test_dag_correctness.py` | 216 | DAG integrity |
| `test_synchrony_constraint.py` | 195 | Synchrony timing constraints |
| `test_web_api.py` | 185 | HTTP/gRPC API endpoints |
| `test_unbond.py` | 172 | Validator unbonding, stake withdrawal |
| `test_finalization.py` | 124 | Block finalization, LFB progression |
| `test_consensus_health.py` | 127 | Log-based consensus error detection (runs last) |
| `test_genesis_ceremony.py` | 118 | Genesis block creation, initial state |
| `test_deployment.py` | 91 | Contract deployment and execution |

### 2.3 Test Environments

| Environment | Topology | Ports | Lifecycle |
|-------------|----------|-------|-----------|
| **Shard** | bootstrap + validator1 + validator2 + validator3 + readonly | 40400–40455 | Session-scoped (shared across tests) |
| **Standalone** | single rnode | 40400–40455 | Per-test (fresh) |
| **Custom** | boot + validators + joiner (configurable) | 40500–40545 | Per-test (fresh) |

### 2.4 Test Resources (Rholang contracts)

| Resource | Purpose |
|----------|---------|
| `bridge.rho`, `contract.rho`, `invalid.rho` | Contract deployment tests |
| `contract_1.rho` – `contract_5.rho` | Cost benchmarks |
| `bond.rho`, `unbond.rho` | Validator bonding/unbonding |
| `transfer_funds.rho`, `get_vault_balance.rho` | Wallet operations |
| `store-data.rho`, `read-data.rho` | Storage tests |

### 2.5 CI Smoke Tests

**CI file:** `.github/workflows/smoke-test.yml`

| Job | Node Type | Checks | Timeout |
|-----|-----------|--------|---------|
| `rust-shard` | Rust (latest) | Startup + 10 finalized blocks + monitoring | 20m |
| `scala-shard` | Scala (latest) | Startup + 10 finalized blocks + monitoring | 20m |
| `rust-standalone` | Rust | Startup + 10 finalized blocks | 10m |
| `scala-standalone` | Scala | Startup + 10 finalized blocks | 10m |
| `rust-observer` | Rust | Observer sync + log verification | 15m |
| `scala-observer` | Scala | Observer sync + log verification | 15m |

---

## 3. What is NOT covered by existing tests

| Gap | Notes |
|-----|-------|
| **Block capacity / throughput** | Max deploys per block and block size limits not covered — addressed by our k6 capacity tests in `k3s/k6/`. Latency benchmark in `node/scripts/ci/` measures deploy rate and latency but not per-block limits. |
| **Adaptive deploy cap behavior** | Not tested in either repo |
| **Transfer deploy capacity** | Transfer-specific block limits not measured |
| **k3s deployment** | No tests for the Kubernetes/k3s deployment itself |
| **Long-running stability** | No multi-hour or multi-day stability tests |

---

## 4. How tests relate to each other

```
node/                          system-integration/
  cargo test (unit)    →  covers consensus logic, crypto, storage internals
  smoke tests          →  covers single-node/shard Docker startup

  system-integration   →  covers multi-node behavior: bonding, slashing,
                           wallets, DAG, API — uses Docker Compose
                           pyf1r3fly gRPC client to drive the chain

k3s/k6/                        (our tests)
  capacity-single      →  covers block throughput, deploy limits, propose timing
  confirmed-hello/transfer →  covers end-to-end deploy confirmation latency
```
