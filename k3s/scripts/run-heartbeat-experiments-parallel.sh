#!/usr/bin/env bash
# Run the heartbeat experiment matrix with all experiments in parallel.
# Each experiment gets its own isolated k8s namespace so they don't interfere.
#
# Prerequisites:
#   - make gen already run (.env and .certs/ present)
#   - monitoring stack running (make monitoring-start)
#   - k6 image built (make k6-build)
#
# Usage:
#   ./scripts/run-parallel-experiments.sh              # full matrix
#   ./scripts/run-parallel-experiments.sh phase1       # phase 1 only
#   CLEANUP=0 ./scripts/run-parallel-experiments.sh    # keep namespaces after run
#
# Results: Grafana → k6 Perf Report, filter by testid prefix "hb-"
#          Logs: ./logs/parallel-<timestamp>/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
KUBECTL="sudo kubectl"
PHASE="${1:-all}"
CLEANUP="${CLEANUP:-1}"       # set CLEANUP=0 to keep namespaces for debugging
K6_DURATION="${EXP_K6_DURATION:-300s}"  # test duration per experiment (default: 5 min)
LOG_DIR="${ROOT_DIR}/logs/parallel-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"

# ── Helpers ────────────────────────────────────────────────────────────────

# Build a k8s-safe namespace name from a tag (max 63 chars, no dots)
make_ns() {
  local tag="$1"
  echo "exp-$(echo "$tag" | tr '.' 'p' | tr '_' '-' | tr '[:upper:]' '[:lower:]')" | head -c 63
}

log() { echo "[$(date +%H:%M:%S)] $*"; }

# Deploy a chain in a given namespace with given heartbeat params.
# Writes to LOG_DIR/<tag>-deploy.log
deploy_chain() {
  local ns="$1" tag="$2" interval="$3" lfb_age="$4" cooldown="$5" synchrony="$6" max_deploys="$7"
  log "[${tag}] Deploying chain in namespace ${ns}..."
  make -C "$ROOT_DIR" start \
    KUBECTL="sudo kubectl" \
    NAMESPACE="$ns" \
    HEARTBEAT=1 \
    HEARTBEAT_INTERVAL="$interval" \
    HEARTBEAT_LFB_AGE="$lfb_age" \
    HEARTBEAT_COOLDOWN="$cooldown" \
    SYNCHRONY_THRESHOLD="$synchrony" \
    MAX_DEPLOYS_PER_BLOCK="$max_deploys" \
    > "${LOG_DIR}/${tag}-deploy.log" 2>&1
  log "[${tag}] Chain deployed"
}

# Wait until all 4 validators are Ready in the given namespace (up to 5 min).
wait_chain_stable() {
  local ns="$1" tag="$2"
  log "[${tag}] Waiting for chain to stabilize..."
  local deadline=$(( $(date +%s) + 300 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 10
    # Count pods with all containers ready
    local total ready
    total=$($KUBECTL get pods -n "$ns" \
      -l "app=asi-chain" \
      --no-headers 2>/dev/null | wc -l | tr -d ' ')
    ready=$($KUBECTL get pods -n "$ns" \
      -l "app=asi-chain" \
      --no-headers 2>/dev/null | grep -c "Running" || true)
    if [ "$total" -ge 5 ] && [ "$ready" -ge 5 ]; then
      # Extra 30s for genesis ceremony and first blocks
      sleep 30
      log "[${tag}] Chain stable (${ready}/${total} pods running)"
      return 0
    fi
  done
  log "[${tag}] WARNING: chain may not be fully stable (proceeding anyway)"
  return 0
}

# Run the k6 test and wait for it to complete.
run_k6() {
  local ns="$1" tag="$2" vus="$3" scenario="$4"
  log "[${tag}] Starting k6 (vus=${vus}, scenario=${scenario})..."
  local k6_script
  case "$scenario" in
    mixed)         k6_script="scenarios/mixed-deploy" ;;
    confirm-hello) k6_script="scenarios/confirmed-hello-world" ;;
    *)             echo "ERROR: unknown scenario '$scenario'"; return 1 ;;
  esac
  local start_log="${LOG_DIR}/${tag}-k6-start.log"
  make -C "$ROOT_DIR" k6-run \
    KUBECTL="sudo kubectl" \
    NAMESPACE="$ns" \
    K6_SCRIPT="$k6_script" \
    K6_VUS="$vus" \
    K6_DURATION="$K6_DURATION" \
    K6_TAG="$tag" \
    > "$start_log" 2>&1
  # Parse job name from make output: "==> Job k6-<tag>-<runid> started"
  local job
  job=$(grep "^==> Job" "$start_log" | awk '{print $3}' || echo "")
  if [ -z "$job" ]; then
    log "[${tag}] WARNING: could not parse k6 job name from output"
    return 0
  fi
  # Wait timeout = duration + 10 min buffer for startup/teardown
  local duration_sec
  duration_sec=$(echo "$K6_DURATION" | sed 's/s$//' | awk '{
    if ($0 ~ /h/) { split($0, a, "h"); print a[1]*3600 + (a[2]+0)*60 }
    else if ($0 ~ /m/) { split($0, a, "m"); print a[1]*60 + (a[2]+0) }
    else print $0 + 0
  }')
  local wait_timeout=$(( duration_sec + 600 ))s
  log "[${tag}] Waiting for k6 job: ${job} (timeout=${wait_timeout})"
  $KUBECTL wait --for=condition=complete "job/${job}" -n monitoring \
    --timeout="${wait_timeout}" >> "$start_log" 2>&1 || \
    log "[${tag}] WARNING: k6 job ${job} did not complete cleanly"
  # Save k6 pod output to disk
  $KUBECTL logs -n monitoring -l "job-name=${job}" --tail=-1 \
    > "${LOG_DIR}/${tag}-k6.log" 2>/dev/null || true
  log "[${tag}] k6 done: ${tag}"
}

# Save logs from all node pods to disk before teardown.
collect_node_logs() {
  local ns="$1" tag="$2"
  local node_log_dir="${LOG_DIR}/${tag}-nodes"
  mkdir -p "$node_log_dir"
  log "[${tag}] Collecting node logs → ${node_log_dir}/"
  for pod in bootstrap-0 validator1-0 validator2-0 validator3-0 validator4-0 observer-0; do
    $KUBECTL logs "$pod" -n "$ns" \
      > "${node_log_dir}/${pod}.log" 2>/dev/null || true
  done
}

# Tear down the chain namespace.
teardown_chain() {
  local ns="$1" tag="$2"
  collect_node_logs "$ns" "$tag"
  log "[${tag}] Tearing down namespace ${ns}..."
  $KUBECTL delete namespace "$ns" --ignore-not-found \
    >> "${LOG_DIR}/${tag}-deploy.log" 2>&1 || true
}

# ── Experiment matrix ──────────────────────────────────────────────────────
# Format: "interval_s|lfb_age_s|cooldown_s|vus|scenario|synchrony_threshold|max_deploys"
# Defaults when omitted: synchrony_threshold=0.33, max_deploys=32

PHASE1_MATRIX=(
  "0.2|2|1|2|confirm-hello|0.33|32"
  "0.5|2|1|2|confirm-hello|0.33|32"
  "1|2|1|2|confirm-hello|0.33|32"
)

PHASE2_MATRIX=(
  "0.5|2|1|2|confirm-hello|0.33|32"   # baseline
  "0.5|2|0.5|2|confirm-hello|0.33|32"
  "0.5|2|2|2|confirm-hello|0.33|32"
  "0.5|2|5|2|confirm-hello|0.33|32"
)

PHASE3_MATRIX=(
  "0.5|2|1|2|confirm-hello|0.33|32"   # baseline
  "0.5|2|1|5|confirm-hello|0.33|32"
  "0.5|2|1|10|confirm-hello|0.33|32"
  "0.5|2|1|20|confirm-hello|0.33|32"
)

# Phase 4: max-lfb-age sweep — how quickly heartbeat reacts to missing blocks
# Best config from phases 1-2: ci=1s, cd=2s. Fixed: vu=5, threshold=0.33, max_deploys=32
PHASE4_MATRIX=(
  "1|0.5|2|5|confirm-hello|0.33|32"
  "1|1|2|5|confirm-hello|0.33|32"
  "1|2|2|5|confirm-hello|0.33|32"   # baseline
)

# Phase 5: synchrony-threshold + block limit sweep
# Goal: eliminate sync_warn bottleneck and measure throughput ceiling
# Best config: ci=1s, cd=2s, lfb=2s, vu=10
PHASE5_MATRIX=(
  "1|2|2|10|confirm-hello|0.33|32"    # baseline (threshold=0.33, limit=32)
  "1|2|2|10|confirm-hello|0|32"       # threshold=0 (remove sync constraint)
  "1|2|2|10|confirm-hello|0|128"      # threshold=0 + high block limit
  "1|2|2|10|confirm-hello|0.33|128"   # original threshold + high block limit
)

case "$PHASE" in
  phase1) MATRIX=("${PHASE1_MATRIX[@]}") ;;
  phase2) MATRIX=("${PHASE2_MATRIX[@]}") ;;
  phase3) MATRIX=("${PHASE3_MATRIX[@]}") ;;
  phase4) MATRIX=("${PHASE4_MATRIX[@]}") ;;
  phase5) MATRIX=("${PHASE5_MATRIX[@]}") ;;
  all)
    MATRIX=(
      "0.2|2|1|2|confirm-hello|0.33|32"
      "0.5|2|1|2|confirm-hello|0.33|32"
      "1|2|1|2|confirm-hello|0.33|32"
      "0.5|2|0.5|2|confirm-hello|0.33|32"
      "0.5|2|2|2|confirm-hello|0.33|32"
      "0.5|2|5|2|confirm-hello|0.33|32"
      "0.5|2|1|5|confirm-hello|0.33|32"
      "0.5|2|1|10|confirm-hello|0.33|32"
      "0.5|2|1|20|confirm-hello|0.33|32"
    )
    ;;
  p45)
    # Phases 4+5 only — for overnight follow-up run
    MATRIX=(
      "${PHASE4_MATRIX[@]}"
      "${PHASE5_MATRIX[@]}"
    )
    ;;
  *)
    echo "Usage: $0 [all|phase1|phase2|phase3|phase4|phase5|p45]"
    exit 1
    ;;
esac

# ── Main ───────────────────────────────────────────────────────────────────

# ── Pre-flight checks ─────────────────────────────────────────────────────
if ! $KUBECTL get namespace monitoring &>/dev/null; then
  echo "ERROR: 'monitoring' namespace not found. Run 'make monitoring-start' first."
  exit 1
fi

log "=============================="
log "  Parallel Experiment Runner"
log "  Phase: ${PHASE} | ${#MATRIX[@]} experiments"
log "  Logs: ${LOG_DIR}"
log "=============================="

# Compute tags and namespaces
declare -a TAGS NAMESPACES INTERVALS LFB_AGES COOLDOWNS VUS_LIST SCENARIOS SYNCHRONY_LIST MAX_DEPLOYS_LIST

for entry in "${MATRIX[@]}"; do
  IFS='|' read -r interval lfb_age cooldown vus scenario synchrony max_deploys <<< "$entry"
  synchrony="${synchrony:-0.33}"
  max_deploys="${max_deploys:-32}"

  # Include non-default params in tag for clarity
  tag="hb-${scenario}-ci${interval}s-lfb${lfb_age}s-cd${cooldown}s-vu${vus}"
  [ "$synchrony"   != "0.33" ] && tag="${tag}-sy${synchrony}"
  [ "$max_deploys" != "32"   ] && tag="${tag}-md${max_deploys}"

  ns=$(make_ns "$tag")
  TAGS+=("$tag")
  NAMESPACES+=("$ns")
  INTERVALS+=("$interval")
  LFB_AGES+=("$lfb_age")
  COOLDOWNS+=("$cooldown")
  VUS_LIST+=("$vus")
  SCENARIOS+=("$scenario")
  SYNCHRONY_LIST+=("$synchrony")
  MAX_DEPLOYS_LIST+=("$max_deploys")
done

# ── Phase A: Deploy all chains in parallel ─────────────────────────────────
log ""
log "--- Phase A: deploying ${#MATRIX[@]} chains in parallel ---"

declare -a DEPLOY_PIDS
for i in "${!TAGS[@]}"; do
  deploy_chain "${NAMESPACES[$i]}" "${TAGS[$i]}" \
    "${INTERVALS[$i]}" "${LFB_AGES[$i]}" "${COOLDOWNS[$i]}" \
    "${SYNCHRONY_LIST[$i]}" "${MAX_DEPLOYS_LIST[$i]}" &
  DEPLOY_PIDS+=($!)
done

DEPLOY_FAILED=0
for i in "${!DEPLOY_PIDS[@]}"; do
  if ! wait "${DEPLOY_PIDS[$i]}"; then
    log "ERROR: deploy failed for ${TAGS[$i]} — check ${LOG_DIR}/${TAGS[$i]}-deploy.log"
    DEPLOY_FAILED=$(( DEPLOY_FAILED + 1 ))
  fi
done

if [ "$DEPLOY_FAILED" -gt 0 ]; then
  log "WARNING: ${DEPLOY_FAILED} deploy(s) failed. Continuing with successful ones."
fi

# ── Phase B: Wait for all chains to stabilize (parallel) ──────────────────
log ""
log "--- Phase B: waiting for all chains to stabilize ---"

declare -a WAIT_PIDS
for i in "${!TAGS[@]}"; do
  wait_chain_stable "${NAMESPACES[$i]}" "${TAGS[$i]}" &
  WAIT_PIDS+=($!)
done
for pid in "${WAIT_PIDS[@]}"; do wait "$pid" || true; done

# ── Phase C: Run k6 tests in parallel ──────────────────────────────────────
# Note: k6 jobs all run in the shared `monitoring` namespace.
# Running many simultaneously is fine — each has a unique job name and testid.
log ""
log "--- Phase C: running ${#MATRIX[@]} k6 tests in parallel ---"

declare -a K6_PIDS
for i in "${!TAGS[@]}"; do
  run_k6 "${NAMESPACES[$i]}" "${TAGS[$i]}" \
    "${VUS_LIST[$i]}" "${SCENARIOS[$i]}" &
  K6_PIDS+=($!)
done
for pid in "${K6_PIDS[@]}"; do wait "$pid" || true; done

# ── Phase D: Cleanup (optional) ────────────────────────────────────────────
if [ "$CLEANUP" = "1" ]; then
  log ""
  log "--- Phase D: tearing down namespaces ---"
  for i in "${!TAGS[@]}"; do
    teardown_chain "${NAMESPACES[$i]}" "${TAGS[$i]}" &
  done
  wait
fi

# ── Summary ────────────────────────────────────────────────────────────────
log ""
log "=============================="
log "  Done!"
log "  Open Grafana → k6 Perf Report"
log "  Filter by testid prefix: hb-"
log "  Compare: k6_test_avg_block_creation_time_ms across runs"
log ""
log "  Experiments:"
for i in "${!TAGS[@]}"; do
  log "    ${TAGS[$i]}"
done
log "=============================="
