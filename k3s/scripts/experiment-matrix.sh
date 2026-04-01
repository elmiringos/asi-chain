#!/usr/bin/env bash
# Run the full experiment matrix across three phases.
# Results appear in Grafana k6 Perf Report
#
# Total runtime estimate: ~40 min (10 runs × ~4 min each)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN="${SCRIPT_DIR}/experiment.sh"

echo "========================================"
echo "  Experiment Matrix"
echo "  Goal: find config giving ~1-2s block time"
echo "========================================"

# Phase 1: check-interval sweep
# Hypothesis: lower interval → faster block proposals
# Fixed: max-lfb-age=5s, cooldown=5000ms
echo ""
echo "--- Phase 1: heartbeat check-interval sweep ---"
for interval in 1 2 5; do
  bash "$RUN" $interval 5 5000
done

# Phase 2: self-propose cooldown sweep
# Hypothesis: lower cooldown → more proposals per validator → faster blocks
# Fixed: check-interval=1s (best from Phase 1), max-lfb-age=5s
echo ""
echo "--- Phase 2: self-propose cooldown sweep ---"
for cooldown in 2000 5000 10000 15000; do
  bash "$RUN" 1 5 $cooldown
done

# Phase 3: max-lfb-age sweep
# Hypothesis: lower max-lfb-age → more aggressive heartbeat recovery
# Fixed: check-interval=1s, cooldown=5000ms
echo ""
echo "--- Phase 3: max-lfb-age sweep ---"
for lfb in 2 5 10; do
  bash "$RUN" 1 $lfb 5000
done

echo ""
echo "========================================"
echo "  Matrix complete!"
echo "  Open Grafana → k6 Perf Report"
echo "  Testid format: ci<interval>s-lfb<lfb>s-cd<cooldown>"
echo "  Compare: k6_test_avg_block_creation_time_ms across runs"
echo "========================================"
