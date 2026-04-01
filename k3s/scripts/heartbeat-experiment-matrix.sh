#!/usr/bin/env bash
# Run the full experiment matrix across three phases.
# Results appear in Grafana k6 Perf Report
#
# Total runtime estimate: ~40 min (10 runs × ~4 min each)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN="${SCRIPT_DIR}/heartbeat-experiment.sh"

echo "========================================"
echo "  Experiment Matrix"
echo "  Goal: find config giving ~1-2s block time"
echo "========================================"

# Phase 1: aggressive check-interval sweep
# Previous runs showed ~1s block time regardless of interval ≥ 1s
# Now testing sub-second values to find where consensus becomes unstable
# Fixed: max-lfb-age=2s, cooldown=1000ms
echo ""
echo "--- Phase 1: sub-second check-interval sweep ---"
for interval in 0.2 0.5 1; do
  bash "$RUN" $interval 2 1000
done

# Phase 2: aggressive cooldown sweep
# Lower cooldown → validators propose more frequently → potential fork pressure
# Fixed: check-interval=0.5s (from Phase 1), max-lfb-age=2s
echo ""
echo "--- Phase 2: aggressive cooldown sweep ---"
for cooldown in 500 1000 2000 5000; do
  bash "$RUN" 0.5 2 $cooldown
done

# Phase 3: VU pressure — more concurrent deploys, fixed best heartbeat config
# Goal: find at what load blocks start overflowing (deploys/block > 1)
# Fixed: check-interval=0.5s, max-lfb-age=2s, cooldown=1000ms
echo ""
echo "--- Phase 3: VU load pressure sweep ---"
for vus in 2 5 10 20; do
  bash "$RUN" 0.5 2 1000 $vus
done

echo ""
echo "========================================"
echo "  Matrix complete!"
echo "  Open Grafana → k6 Perf Report"
echo "  Testid format: hb-ci<interval>s-lfb<lfb>s-cd<cooldown>ms"
echo "  Compare: k6_test_avg_block_creation_time_ms across runs"
echo "========================================"
