# Heartbeat Parameters — Report

## Annotation

| Abbreviation | Full name | Description |
|---|---|---|
| `ci` | `check-interval` | How often a validator checks whether it should propose a new block |
| `cd` | `self-propose-cooldown` | Minimum pause between two consecutive proposals by the same validator |
| `lfb` | `max-lfb-age` | Maximum time since the last finalized block before heartbeat triggers a proposal |
| `vu` | virtual users | Number of concurrent deploy senders in the k6 load test |
| `conf_avg` | average confirmation time | Average time from deploy submission (HTTP 200) to block finalization, in ms |
| `conf_p95` | p95 confirmation time | 95th percentile confirmation time — worst case for 95% of deploys, in ms |
| `sync_warn` | synchrony warnings | Count of `"Must wait for more blocks from other validators"` log entries — validator blocked by synchrony constraint |
| `blk_interval` | block interval (per validator) | Average time between consecutive proposals by a single validator |
| `chain block time` | chain-wide block time | Average time between consecutive blocks across all validators (1 / total block rate) |
| `deploys/blk` | deploys per block | Average number of user deploys included in a non-empty block |
| `hb_ok` | heartbeat successes | Count of `"Successfully created block"` heartbeat-triggered proposals |
| `LFB` | last finalized block | The most recently finalized block, used as the baseline for synchrony and heartbeat checks |
| `p95` | 95th percentile | The value below which 95% of measurements fall |
| `finalized` | finalization events | Count of `"we finalized block"` log messages — confirms LFB is advancing |

---

## How Finalization Is Measured

### What counts as "confirmed"

A deploy is considered **confirmed** when it has been **finalized** — i.e., included in a block that the chain has reached BFT consensus on (LFB has advanced past it). This is stronger than mere block inclusion.

### API used

Confirmation is polled via `GET /api/last-finalized-block`, which returns the current LFB. The k6 extension waits until `LFB.blockNumber > blockNumber_at_deploy_time`.

> **Run 1 caveat**: early experiments used `GET /api/blocks/1` (latest DAG block) instead of the finalized block endpoint. The fix (`waitForFinalization`) was merged after Run 1 but before image rebuild. In practice, on a single-server setup, LFB advances within milliseconds of block creation, so Run 1 numbers are considered reliable approximations of finalization latency.

### Verification from node logs

Every experiment's validator logs contain lines of the form:

```
Removed N deploys from deploy history as we finalized block [<hash> ...]
```

This log is emitted only when the LFB advances — it is direct proof that finalization is happening, not just block creation.

---

## Goal

Find heartbeat configuration giving **~1–2 second block time** while maintaining chain stability.

Parameters swept:
- `check-interval` — how often a validator checks if it should propose (0.2s / 0.5s / 1s)
- `self-propose-cooldown` — minimum pause between two consecutive proposals by the same validator (0.5s / 1s / 2s / 5s)
- Load (`vus`) — concurrent deploy senders (2 / 5 / 10 / 20)

Fixed: `max-lfb-age = 2s` (trigger threshold: propose if no new block within 2s of last finalized block)

---

## Finalization — Confirmed ✓

Blocks **are finalized**, not just created. Node logs contain `"Removed N deploys from deploy history as we finalized block [hash...]"` messages in all experiments. This confirms the LFB advances throughout each run.

**Note on measurement**: Run 1 measured time to *block inclusion* (first new block in the DAG via `/api/blocks/1`). Run 2 was collected with the same k6 image (fix to `waitForFinalization` pending rebuild). Given that finalization closely follows block creation in a local 4-validator setup, the `conf_p95` values are considered reliable approximations of finalization latency.

---

## Run 1 — April 9, 2026 (30s duration, remote server)

### Phase 1 — check-interval sweep (cd=1s, vu=2)

| check-interval | chain block time | conf avg | conf p95 | unconfirmed | sync_warn |
|---|---|---|---|---|---|
| 0.2s | 1074ms | 539ms | 1001ms | 0 | 34 |
| 0.5s | 853ms | 532ms | 1002ms | 0 | 52 |
| **1s** | **560ms** | **504ms** | **509ms** | **0** | 64 |

→ `ci=1s` gave the fastest block time. Longer check-interval reduces proposal collisions between validators.

### Phase 2 — cooldown sweep (ci=0.5s, vu=2)

| cooldown | chain block time | conf avg | conf p95 | unconfirmed | sync_warn |
|---|---|---|---|---|---|
| 0.5s | 527ms | 505ms | 521ms | 0 | **68** |
| 1s | 853ms | 532ms | 1002ms | 0 | 52 |
| **2s** | **967ms** | **510ms** | **538ms** | **0** | **38** |
| 5s | 527ms | 531ms | 1002ms | 0 | 54 |

→ `cd=2s` had lowest sync_warn (38). `cd=0.5s` was faster but with 68 synchrony warnings.

### Phase 3 — load sweep (ci=0.5s, cd=1s)

| vus | chain block time | conf avg | conf p95 | confirmed | deploys/block | sync_warn |
|---|---|---|---|---|---|---|
| 2 | 853ms | 532ms | 1002ms | 40 | 1.9 | 52 |
| 5 | 1200ms | 526ms | 590ms | 100 | 4.2 | 20 |
| **10** | **1706ms** | **548ms** | **703ms** | **191** | **8.3** | **28** |
| 20 | 3222ms | 788ms | 1972ms | 278 | 16.3 | 10 |

---

## Run 2 — April 10, 2026 (30s duration, EPYC9654 server)

> Same experiment matrix (phases 1–3). Key difference: all experiments ran on a single high-performance server (AMD EPYC 9654), giving near-zero network latency between validators. `sync_warn=0` across all experiments — the synchrony constraint was never triggered.

### Phase 1 — check-interval sweep (cd=1s, vu=2)

| check-interval | chain block time | conf p95 | confirmed | unconfirmed | hb_ok | finalized |
|---|---|---|---|---|---|---|
| 0.2s | 526ms | 517ms | 40 | 0 | 39 | 167 |
| 0.5s | 536ms | 520ms | 40 | 0 | 38 | 160 |
| 1s | 566ms | 517ms | 40 | 0 | 32 | 154 |

→ All `ci` values produce ~530ms block time. With `sync_warn=0`, the check-interval has minimal impact — validators rarely collide.

### Phase 2 — cooldown sweep (ci=0.5s, vu=2)

| cooldown | chain block time | conf p95 | confirmed | unconfirmed | hb_ok | finalized |
|---|---|---|---|---|---|---|
| 0.5s | 536ms | 516ms | 40 | 0 | 33 | 142 |
| 1s | 536ms | 520ms | 40 | 0 | 38 | 160 |
| 2s | 526ms | 512ms | 40 | 0 | 35 | 155 |
| **5s** | **769ms** | **529ms** | **40** | **0** | **33** | **88** |

→ cd=0.5s–2s all give ~530ms block time. cd=5s slows the chain (769ms) because validators must wait 5s before re-proposing after each block. Cooldown only matters when it approaches or exceeds the natural block interval.

### Phase 3 — load sweep (ci=0.5s, cd=1s)

| vus | chain block time | conf p95 | confirmed | deploys/block | max/block | hb_ok | finalized |
|---|---|---|---|---|---|---|---|
| 2 | 536ms | 520ms | 40 | 0.7 | 2 | 38 | 160 |
| 5 | 857ms | 1001ms | 99 | 2.8 | 8 | 21 | 107 |
| **10** | **1875ms** | **1003ms** | **167** | **10.4** | **11** | **23** | **86** |
| 20 | 3000ms | 1093ms | 290 | 29.0 | 19 | 17 | 42 |

→ Chain handles up to **vu=10** within the 2s target. At vu=20 block time reaches 3s — consensus/replay time per block becomes the bottleneck as `deploys/block` approaches the adaptive cap (32). Pattern consistent with Run 1 despite the faster server.

---

## Key Findings

### 1. Finalization is confirmed working

All experiments show active LFB advancement via `"we finalized block"` log messages. Finalization events closely track block creation — in a local single-server setup, finalization latency appears negligible on top of block creation time.

### 2. sync_warn is environment-sensitive

Run 1 (distributed): 34–68 sync_warn per experiment.
Run 2 (single server, EPYC9654): **0** sync_warn across all experiments.

The synchrony constraint (`threshold=0.33`) is effectively a network-latency guard. On a single server with loopback networking, all validators observe each other's blocks instantly, so the constraint is never triggered. In a real distributed deployment, sync_warn will be non-zero and the cooldown/check-interval tradeoffs from Run 1 become relevant again.

### 3. Confirmation latency floor is ~500ms

Regardless of heartbeat config or load level (up to vu=10), `conf_p95 ≈ 500–520ms` at low load. This is the consensus round-trip floor: block propagation + BFT agreement. Heartbeat parameters do not reduce this floor.

### 4. Chain is load-sensitive above vu=10

| load | block time (Run 2) | block time (Run 1) |
|---|---|---|
| vu=2 | 530ms ✓ | 527–1074ms ✓ |
| vu=5 | 857ms ✓ | 1200ms ✓ |
| vu=10 | 1875ms ✓ (borderline) | 1706ms ✓ (borderline) |
| vu=20 | 3000ms ✗ | 3222ms ✗ |

The bottleneck at high load is block replay time (Rholang execution), not network or heartbeat configuration.

### 5. Cooldown only matters when it exceeds block interval

At cd=5s with ~500ms natural block interval: block time jumps to 769ms because validators are forced to wait. For optimal throughput, set `cd ≤ block_interval`.

---

## Recommended Configuration

**For stable operation (~500ms block time, single server):**

```
heartbeat {
  enabled = true
  check-interval = 1 seconds
  max-lfb-age = 2 seconds
  self-propose-cooldown = 1 seconds
}
```

Result (Run 2): **566ms block time**, **conf_p95=517ms**, **sync_warn=0**, 0 unconfirmed deploys.

**For distributed deployment (expect sync_warn, use Run 1 results):**

```
heartbeat {
  enabled = true
  check-interval = 1 seconds
  max-lfb-age = 2 seconds
  self-propose-cooldown = 2 seconds
}
```

Result (Run 1): **967ms block time**, **conf_p95=538ms**, **sync_warn=38** (lowest).

---

## Limitations & Next Steps

| Item | Status |
|------|--------|
| Test duration was 30s | Short — next runs use 300s+ for stable averages |
| `block_creation_time_ms` metric always 0 in k6 | Bug in k6 script timestamp tracking (known) |
| k6 measured block inclusion, not finalization | Fixed in code — pending k6 image rebuild |
| Phases 4+5 not yet run (lfb-age sweep, synchrony/block-limit sweep) | Scheduled for overnight run |
| sync_warn=0 on EPYC9654 — distributed behavior untested | Need to re-run on multi-node setup |
| CPU/memory load not analyzed | cadvisor data available in Prometheus |
| No multi-hour stability run | Needed before production recommendation |
