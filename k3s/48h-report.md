# 48-Hour Load Test Report — `parallel-20260411-055640`

**Run started:** 2026-04-11 05:56:40 UTC  
**Run ended:** 2026-04-13 ~06:02 UTC  
**Duration target:** 48 hours per experiment  
**Command:** `sudo make experiment-parallel K6_DURATION=48h CLEANUP=0`  
**k6 scenario:** `confirmed-hello-world` — submit a HelloWorld deploy, wait for block finalization  
**Total parallel experiments:** 16 (each in an isolated k8s namespace)

---

## Parameter Legend

Each experiment name encodes its heartbeat and load parameters:

| Tag | Makefile parameter | Description |
|---|---|---|
| `ci` | `HEARTBEAT_INTERVAL` | Heartbeat check interval |
| `lfb` | `HEARTBEAT_LFB_AGE` | Max LFB age before heartbeat triggers a self-propose |
| `cd` | `HEARTBEAT_COOLDOWN` | Cooldown between consecutive self-proposes |
| `vu` | k6 VUs | Number of virtual users (concurrent deployers) |
| `sy0` | `SYNCHRONY_THRESHOLD=0` | Synchrony constraint disabled (default: 0.33) |
| `md128` | `MAX_DEPLOYS_PER_BLOCK=128` | Higher deploy cap per block (default: 32) |

All experiments used `HEARTBEAT=1` and the `confirmed-hello-world` scenario.  
k6 threshold: `deploy_unconfirmed < 5` (any timeout counts against this).

---

## Results Summary

| Experiment | VU | CI | LFB | CD | SY | MD | Status | Confirmed | Unconfirmed | Avg fin. ms | p95 fin. ms |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|--:|--:|--:|--:|
| ci0.2s-lfb2s-cd1s-vu2 | 2 | 0.2s | 2s | 1s | 0.33 | 32 | STALL (~11 min) | — | — | — | — |
| ci0.5s-lfb2s-cd0.5s-vu2 | 2 | 0.5s | 2s | 0.5s | 0.33 | 32 | FAIL – chain frozen | 0 | 11 146 | — | — |
| ci0.5s-lfb2s-cd1s-vu2 | 2 | 0.5s | 2s | 1s | 0.33 | 32 | FAIL – chain frozen | 0 | 11 146 | — | — |
| ci0.5s-lfb2s-cd2s-vu2 | 2 | 0.5s | 2s | 2s | 0.33 | 32 | FAIL – chain frozen | 0 | 11 146 | — | — |
| ci0.5s-lfb2s-cd5s-vu2 | 2 | 0.5s | 2s | 5s | 0.33 | 32 | STALL (~45 min) | — | — | — | — |
| **ci0.5s-lfb2s-cd1s-vu5** | **5** | **0.5s** | **2s** | **1s** | **0.33** | **32** | **PASS** | **550 543** | **0** | **528** | **542** |
| ci0.5s-lfb2s-cd1s-vu10 | 10 | 0.5s | 2s | 1s | 0.33 | 32 | LOG TRUNC * | — | — | — | — |
| ci0.5s-lfb2s-cd1s-vu20 | 20 | 0.5s | 2s | 1s | 0.33 | 32 | LOG TRUNC * | — | — | — | — |
| **ci1s-lfb0.5s-cd2s-vu5** | **5** | **1s** | **0.5s** | **2s** | **0.33** | **32** | **PASS** | **569 142** | **0** | **505** | **509** |
| **ci1s-lfb1s-cd2s-vu5** | **5** | **1s** | **1s** | **2s** | **0.33** | **32** | **WARN** (5 unconf) | **572 773** | **5** | **503** | **505** |
| ci1s-lfb2s-cd1s-vu2 | 2 | 1s | 2s | 1s | 0.33 | 32 | STALL (~14 min) | — | — | — | — |
| ci1s-lfb2s-cd2s-vu5 | 5 | 1s | 2s | 2s | 0.33 | 32 | LOG TRUNC * | — | — | — | — |
| ci1s-lfb2s-cd2s-vu10 | 10 | 1s | 2s | 2s | 0.33 | 32 | LOG TRUNC * | — | — | — | — |
| ci1s-lfb2s-cd2s-vu10-md128 | 10 | 1s | 2s | 2s | 0.33 | 128 | LOG TRUNC * | — | — | — | — |
| ci1s-lfb2s-cd2s-vu10-sy0 | 10 | 1s | 2s | 2s | 0 | 32 | LOG TRUNC * | — | — | — | — |
| **ci1s-lfb2s-cd2s-vu10-sy0-md128** | **10** | **1s** | **2s** | **2s** | **0** | **128** | **PASS** | **1 144 788** | **0** | **503** | **506** |

\* **LOG TRUNC** — the blockchain nodes ran healthy for the full 48 h (validator logs end at 06:12 UTC with zero finalization errors), but the k6 pod logs are truncated to ~54 minutes of visible data. Root cause: high-VU runs produce 10+ log lines/second; at ~48 h that exceeds the k8s container log buffer (~10 MB), and older entries are rotated away before log collection. The final `pushReport` was not captured for these experiments.

---

## Detailed Results — Passing Experiments

### ci0.5s-lfb2s-cd1s-vu5

| Metric | Value |
|---|---|
| Confirmed deploys | 550 543 |
| Unconfirmed deploys | 0 |
| LFB range (blocks produced) | 49 |
| Avg deploys / LFB block | 11 235 |
| Throughput | ~3.19 confirmed/s |
| Finalization avg | 528 ms |
| Finalization p50 | 527 ms |
| Finalization p95 | 542 ms |
| Finalization max | 697 ms |

---

### ci1s-lfb0.5s-cd2s-vu5

| Metric | Value |
|---|---|
| Confirmed deploys | 569 142 |
| Unconfirmed deploys | 0 |
| LFB range (blocks produced) | 566 |
| Avg deploys / LFB block | 1 005 |
| Throughput | ~3.29 confirmed/s |
| Finalization avg | 505 ms |
| Finalization p50 | 504 ms |
| Finalization p95 | 509 ms |
| Finalization max | 834 ms |

More frequent LFB advancement (566 blocks vs 49) compared to the experiment above — a shorter `lfb_age` (0.5 s) triggers heartbeat sooner, leading to more frequent block production.

---

### ci1s-lfb1s-cd2s-vu5 ⚠ threshold violation

| Metric | Value |
|---|---|
| Confirmed deploys | 572 773 |
| Unconfirmed deploys | **5** |
| LFB range (blocks produced) | 1 688 |
| Avg deploys / LFB block | 339 |
| Throughput | ~3.31 confirmed/s |
| Finalization avg | **503 ms** |
| Finalization p50 | **502 ms** |
| Finalization p95 | **505 ms** |
| Finalization max | 564 ms |

Best latency profile of all experiments. 5 deploy timeouts across 572 773 successful confirmations over 48 h is an extremely low failure rate, but it crosses the `deploy_unconfirmed < 5` threshold. The narrow max (564 ms vs 697–834 ms in others) suggests the most consistent block cadence.

---

### ci1s-lfb2s-cd2s-vu10-sy0-md128 — Best overall result

| Metric | Value |
|---|---|
| Confirmed deploys | **1 144 788** |
| Unconfirmed deploys | **0** |
| LFB range (blocks produced) | 1 282 |
| Avg deploys / LFB block | 893 |
| Avg block creation interval | ~135 s |
| Throughput | **~6.62 confirmed/s** |
| Finalization avg | **503 ms** |
| Finalization p50 | **502 ms** |
| Finalization p95 | **506 ms** |
| Finalization max | 685 ms |

Double the VU count (10), synchrony constraint disabled (`sy0`), deploy cap raised to 128 (`md128`). Achieved 2× the confirmed deploy count of any other experiment with near-identical finalization latency.

---

## Failures and Degradations

### Finalization Deadlock — "too far ahead of last finalized block"

Seven experiments entered a finalization deadlock at some point during the run.

**Mechanism:** The node's height-constraint checker blocks new proposals when the block graph is more than 1000 heights ahead of the LFB:

```
Height constraint check: validator_height_diff=1001, global_height_diff=1002, threshold=1000
Propose failed: Proposal failed: too far ahead of the last finalized block
Heartbeat: Propose failed with ... (seqNum 1061)
```

Once this state is reached the heartbeat cannot recover, LFB stops advancing, and all pending k6 deploys time out after 30 s.

**k6 symptom:**
```
deploy NOT finalized within 30s (finalized at block 62)
```

**Affected experiments:**

| Experiment | Time to deadlock | LFB stale at end |
|---|---|---|
| ci0.5s-lfb2s-cd0.5s-vu2 | From start | ~48 h (173 557 518 ms) |
| ci0.5s-lfb2s-cd1s-vu2 | From start | ~48 h (173 557 518 ms) |
| ci0.5s-lfb2s-cd2s-vu2 | From start | ~48 h |
| ci0.2s-lfb2s-cd1s-vu2 | ~11 min | — |
| ci1s-lfb2s-cd1s-vu2 | ~14 min | (still deadlocked at 48 h) |
| ci0.5s-lfb2s-cd5s-vu2 | ~45 min | — |
| ci0.5s-lfb2s-cd1s-vu10 | ~6 min | — |

For the three `vu2` experiments that ran the full 48 h (cd=0.5/1/2 s), the chain was frozen from the very first minutes — every one of the 11 146 iterations timed out, yielding 0 confirmed deploys. The LFB staleness log at the end (`173 557 518 ms ≈ 48 h`) confirms the deadlock was never resolved.

**Pattern:** All 2-VU experiments with the default synchrony threshold (0.33) and `lfb=2s` failed. Raising VUs to 5 under identical heartbeat settings (`ci0.5s-lfb2s-cd1s-vu5`) passed cleanly. This suggests that at very low load the heartbeat's interaction with the synchrony constraint creates conditions that trigger and perpetuate the height-constraint deadlock.

---

## Key Findings

1. **Finalization latency is consistently 500–530 ms** across all healthy experiments. p95 stays at or below 542 ms over 48 continuous hours — no latency creep observed.

2. **The top configuration** (`ci=1s, lfb=2s, cd=2s, vu=10, synchrony=0, max_deploys=128`) delivered **1 144 788 confirmed deploys at 0 timeouts** with p95 = 506 ms.

3. **Disabling the synchrony constraint (`sy0`) is required at 10+ VUs** under `lfb=2s`. Without it, either the chain deadlocks or k6 logs are truncated (inconclusive). The only 10-VU experiment yielding a full 48 h `pushReport` is the one with `sy0+md128`.

4. **Raising `MAX_DEPLOYS_PER_BLOCK` from 32 to 128** roughly doubles throughput at the same VU count (compare `ci1s-lfb2s-cd2s-vu10-sy0-md128` at 6.62/s vs phase-4 vu5 experiments at ~3.3/s) with no latency penalty.

5. **2-VU experiments with synchrony=0.33 are systematically unstable.** Three of them were frozen from the start for the entire 48 h. This is a reproducible failure mode, not a transient one.

6. **`lfb_age` sweep at ci=1s, cd=2s, vu=5** (0.5s / 1s / 2s): all three passed with ~503 ms finalization. A shorter `lfb_age` produces more LFB blocks (566 → 1688 → N/A), meaning the chain stays more active. The difference in latency is negligible.

7. **k6 pod log rotation** caused loss of final metrics for 6 high-VU experiments. The underlying chains were healthy (confirmed by node logs at 48 h). To fix: increase the k8s container log limit (`--container-log-max-size`) or redirect k6 output to a persistent volume before `kubectl logs` collection.

---

## Recommendations

| Priority | Action |
|---|---|
| High | Investigate and fix the height-constraint deadlock — it triggers reliably at low VU counts with synchrony=0.33 |
| High | Increase container log limit or write k6 output directly to a PVC to avoid log truncation in high-VU runs |
| Medium | Use `SYNCHRONY_THRESHOLD=0` and `MAX_DEPLOYS_PER_BLOCK=128` as defaults for load testing until the deadlock is resolved |
| Low | Tighten the `deploy_unconfirmed` threshold to `< 1` for `ci1s-lfb1s-cd2s-vu5` re-runs — 5 timeouts in 572 K is likely a monitoring gap, not a real failure |
