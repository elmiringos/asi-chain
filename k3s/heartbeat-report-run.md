# Heartbeat Parameters — Run 3 Report


## Annotation

| Abbreviation | Full name | Description |
|---|---|---|
| `ci` | `check-interval` | How often a validator checks whether it should propose a new block |
| `cd` | `self-propose-cooldown` | Minimum pause between two consecutive proposals by the same validator |
| `lfb` | `max-lfb-age` | Maximum time since the last finalized block before heartbeat triggers a proposal |
| `vu` | virtual users | Number of concurrent deploy senders in the k6 load test |
| `conf_p95` | p95 confirmation time | 95th percentile — time from deploy submission (HTTP 200) to block finalization, in ms |
| `sync_warn` | synchrony warnings | Count of `"Must wait for more blocks from other validators"` log entries |
| `chain block time` | chain-wide block time | Average time between consecutive blocks across all validators (30 000ms / blocks_produced) |
| `deploys/blk` | deploys per block | Average number of user deploys included per block |
| `hb_ok` | heartbeat successes | Count of `"Successfully created block"` heartbeat-triggered proposals |
| `LFB` | last finalized block | The most recently finalized block |
| `finalized` | finalization events | Count of `"we finalized block"` log messages in validator nodes |

---

## Setup

- 4 validators + 1 bootstrap + 1 observer, all on single server
- `sync_warn = 0` across all experiments (single-server loopback, synchrony constraint never triggered)
- Confirmation measured as: time from deploy HTTP 200 → next finalized block (`/api/last-finalized-block`)
- Finalization verified via node log: `"Removed N deploys from deploy history as we finalized block"`

---

## Phase 1 — check-interval sweep (lfb=2s, cd=1s, vu=2)

| ci | blocks | chain blk time | conf p50 | conf p95 | confirmed | deploys/blk | max/blk |
|---|---|---|---|---|---|---|---|
| 0.2s | 57 | 526ms | 504ms | 523ms | 40 | 0.7 | 2 |
| 0.5s | 56 | 536ms | 503ms | 512ms | 40 | 0.7 | 1 |
| 1s | 56 | 536ms | 505ms | 521ms | 40 | 0.7 | 1 |

→ All `ci` values are equivalent (~530ms block time, ~505ms p50). Check-interval has no measurable impact on a single-server setup.

---

## Phase 2 — cooldown sweep (ci=0.5s, lfb=2s, vu=2)

| cd | blocks | chain blk time | conf p50 | conf p95 | confirmed | deploys/blk | max/blk |
|---|---|---|---|---|---|---|---|
| 0.5s | 57 | 526ms | 505ms | 527ms | 40 | 0.7 | 2 |
| 1s | 56 | 536ms | 503ms | 512ms | 40 | 0.7 | 1 |
| 2s | 57 | 526ms | 503ms | 526ms | 40 | 0.7 | 2 |
| 5s | 56 | 536ms | 505ms | 515ms | 40 | 0.7 | 1 |

→ All cooldown values produce equivalent results (~530ms block time). With 4 validators, each can propose independently — a cooldown only limits *that validator's* re-proposals, not the chain as a whole. No degradation even at cd=5s (contrast with previous run where cd=5s gave 769ms — likely noise in a 30s test).

---

## Phase 3 — load sweep (ci=0.5s, lfb=2s, cd=1s)

| vu | blocks | chain blk time | conf p50 | conf p95 | confirmed | deploys/blk | max/blk |
|---|---|---|---|---|---|---|---|
| 2 | 56 | 536ms | 503ms | 512ms | 40 | 0.7 | 1 |
| 5 | 21 | 1429ms | 539ms | 623ms | 95 | 4.5 | 9 |
| 10 | 14 | 2143ms | 578ms | 1002ms | 174 | 12.4 | 14 |
| 20 | — | — | — | — | — | — | — |

> vu=20: k6 job started but logs not collected (likely timed out or pod evicted under load).

→ Chain degrades sharply above vu=5. At vu=10, block time reaches 2143ms and p95 hits 1002ms — Rholang replay time per block is the bottleneck.

---

## Phase 4 — max-lfb-age sweep (ci=1s, cd=2s, vu=5)

| lfb | blocks | chain blk time | conf p50 | conf p95 | confirmed | deploys/blk | max/blk |
|---|---|---|---|---|---|---|---|
| 0.5s | 25 | 1200ms | 518ms | 589ms | 100 | 4.0 | 7 |
| 1s | 18 | 1667ms | 522ms | 624ms | 98 | 5.4 | 8 |
| 2s | 26 | 1154ms | 515ms | 565ms | 100 | 3.8 | 6 |

→ Differences are within noise for a 30s test. All three produce 1.2–1.7s block time at vu=5. Confirmation p50 is stable (~515–522ms) regardless of lfb-age — the threshold only affects *when* heartbeat fires, not the consensus latency itself. A longer test is needed to see a meaningful signal here.

---

## Phase 5 — synchrony threshold + block limit sweep (ci=1s, lfb=2s, cd=2s, vu=10)

| sy | md | blocks | chain blk time | conf p50 | conf p95 | confirmed | deploys/blk | max/blk |
|---|---|---|---|---|---|---|---|---|
| 0.33 | 32 | 12 | 2500ms | 578ms | 911ms | 172 | 14.3 | 10 |
| 0 | 32 | — | — | — | — | — | — | — |
| 0 | 128 | — | — | — | — | — | — | — |
| 0.33 | 128 | — | — | — | — | — | — | — |

> sy=0 and md=128 variants: k6 jobs failed (`job not found`). Likely the k6 image hit a TTL or the namespace wasn't ready in time. Need to re-run.

→ Only the baseline (sy=0.33, md=32) completed. At vu=10 with ci=1s+cd=2s, block time is 2500ms — slightly worse than ci=0.5s+cd=1s at vu=10 (2143ms), as expected from the stricter cooldown.

---

## Key Findings

### 1. Confirmation floor is ~505ms

Across all low-load experiments (vu=2), `conf_p50 ≈ 503–505ms`. This is the consensus latency floor — BFT agreement time on a single server. Heartbeat parameters do not affect it.

### 2. Load is the dominant factor

| vu | chain blk time |
|---|---|
| 2 | 530ms ✓ |
| 5 | 1200–1667ms ✓ |
| 10 | 2143–2500ms ✓ borderline |
| 20 | failed to collect |

The bottleneck at high load is Rholang execution/replay, not heartbeat configuration.

### 3. Phase 4 inconclusive at 30s

lfb-age differences (0.5s / 1s / 2s) don't produce a clear signal in a 30s window at vu=5. Block count variance (18–26) is too high relative to the sample. Need 300s+ duration to see a stable signal.

### 4. Phase 5 incomplete

3 out of 4 phase 5 variants failed to produce k6 data. Re-run required with:
- `make experiment-clean` before start
- Longer TTL for k6 jobs or faster startup

---

## Next Steps

| Item | Status |
|------|--------|
| Re-run phase 5 (sy=0, md=128 variants) | Failed this run — k6 jobs not found |
| Re-run with 300s+ duration | 30s is too short for lfb-age and synchrony sweep |
| vu=20 log collection | Job started but logs not saved |
| Distributed multi-node test | sync_warn=0 on single server masks real behavior |
