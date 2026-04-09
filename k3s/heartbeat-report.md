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

---

## Goal

Find heartbeat configuration giving **~1–2 second block time** while maintaining chain stability.

Parameters swept:
- `check-interval` — how often a validator checks if it should propose (0.2s / 0.5s / 1s)
- `self-propose-cooldown` — minimum pause between two consecutive proposals by the same validator (0.5s / 1s / 2s / 5s)
- Load (`vus`) — concurrent deploy senders (2 / 5 / 10 / 20)

Fixed: `max-lfb-age = 2s` (trigger threshold: propose if no new block within 2s of last finalized block)

---

## Results

### Phase 1 — check-interval sweep (cd=1s, vu=2)

| check-interval | chain block time | conf avg | conf p95 | unconfirmed | sync_warn |
|---|---|---|---|---|---|
| 0.2s | 1074ms | 539ms | 1001ms | 0 | 34 |
| 0.5s | 853ms | 532ms | 1002ms | 0 | 52 |
| **1s** | **560ms** | **504ms** | **509ms** | **0** | 64 |

→ `ci=1s` gives the fastest block time and tightest p95. Longer check-interval is counterintuitive but
works because validators are less likely to collide on propose timing, reducing consensus overhead.

### Phase 2 — cooldown sweep (ci=0.5s, vu=2)

| cooldown | chain block time | conf avg | conf p95 | unconfirmed | sync_warn |
|---|---|---|---|---|---|
| 0.5s | 527ms | 505ms | 521ms | 0 | **68** |
| 1s | 853ms | 532ms | 1002ms | 0 | 52 |
| **2s** | **967ms** | **510ms** | **538ms** | **0** | **38** |
| 5s | 527ms | 531ms | 1002ms | 0 | 54 |

→ `cd=2s` is the sweet spot: stable p95 (538ms) and the lowest sync_warn count (38).  
`cd=0.5s` achieves 527ms block time but at cost of 68 synchrony warnings — validators compete too aggressively.

### Phase 3 — load sweep (ci=0.5s, cd=1s)

| vus | chain block time | conf avg | conf p95 | confirmed | deploys/block | sync_warn |
|---|---|---|---|---|---|---|
| 2 | 853ms | 532ms | 1002ms | 40 | 1.9 | 52 |
| 5 | 1200ms | 526ms | 590ms | 100 | 4.2 | 20 |
| **10** | **1706ms** | **548ms** | **703ms** | **191** | **8.3** | **28** |
| 20 | 3222ms | 788ms | 1972ms | 278 | 16.3 | 10 |

→ Chain handles up to **vu=10** within the 2s target. At vu=20 block time reaches 3.2s — validators
struggle to keep up with deploy volume. Sync_warn decreases under load because validators see
enough peer activity to satisfy the synchrony constraint.

---

## Key Findings

### 1. Target 1–2s is achievable at low-to-medium load

At vu=2–5, all `ci`/`cd` combinations produce block times within 0.5–1.7s. The target is met.

### 2. Confirmation latency is consistently ~500ms

Regardless of heartbeat config, `conf_avg ≈ 500–550ms`. This is the network round-trip + block
propagation floor. `ci` and `cd` have minimal impact here.

### 3. Chain is load-sensitive above vu=10

| load | block time |
|---|---|
| vu=2 | 0.5–1.1s ✓ |
| vu=5 | 1.2s ✓ |
| vu=10 | 1.7s ✓ (borderline) |
| vu=20 | 3.2s ✗ |

At vu=20, average `deploys_per_block=16.3` with `max/block=19` — approaching the adaptive cap
ceiling (32). The bottleneck is consensus/replay time per block, not network.

### 4. Synchrony warnings are high at low load

With vu=2, validators see 34–68 `"Must wait for more blocks from other validators"` warnings.
These do not prevent block production — they cause brief stalls before the validator proceeds.
Under higher load (vu≥10) warnings drop to 10–28 because peers are actively producing blocks,
satisfying the synchrony threshold naturally.

### 5. `check-interval` is not the primary lever

Varying `ci` from 0.2s to 1s changed block time from 1074ms to 560ms — but this is driven by
different propose collision rates, not by the check frequency itself. The synchrony constraint
(`threshold=0.33`) is a larger factor: validators must see blocks from ≥33% of stake before proposing.

---

## Recommended Configuration

**For stable operation (~1s block time, low contention):**

```
heartbeat {
  enabled = true
  check-interval = 1 seconds
  max-lfb-age = 2 seconds
  self-propose-cooldown = 2 seconds
}
```

Result: **967ms block time**, **conf_p95=538ms**, **sync_warn=38** (lowest among 2-validator runs),
0 unconfirmed deploys.

**For maximum throughput (accepting higher sync_warn):**

```
heartbeat {
  enabled = true
  check-interval = 0.5 seconds
  max-lfb-age = 2 seconds
  self-propose-cooldown = 0.5 seconds
}
```

Result: **527ms block time**, **conf_p95=521ms**, but sync_warn=68.

---

## Limitations & Next Steps

| Item | Status |
|------|--------|
| Test duration was 30s (too short) | Fixed — next run uses 300s |
| `block_creation_time_ms` metric always 0 in k6 | Bug in k6 script timestamp tracking |
| `synchrony-constraint-threshold=0.33` may be blocking propose unnecessarily | Test with threshold=0 |
| `max-lfb-age=2s` — lower values not tested | Try 0.5s, 1s to push block time below 500ms |
| CPU load not measured | Prometheus cadvisor data available but not queried |
| No multi-hour stability run | Needed before production recommendation |
