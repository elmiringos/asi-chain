#!/usr/bin/env bash
# Run the heartbeat-only experiment matrix in parallel (no k6 load).
# Each experiment gets its own isolated k8s namespace so they don't interfere.
# Node logs are streamed in real-time via `kubectl logs -f` to avoid log rotation loss.
#
# Prerequisites:
#   - make gen already run (.env and .certs/ present)
#   - monitoring stack running (make monitoring-start)
#
# Usage:
#   ./scripts/run-heartbeat-experiments-parallel.sh
#   EXP_DURATION=48h   ./scripts/run-heartbeat-experiments-parallel.sh
#   CLEANUP=0          ./scripts/run-heartbeat-experiments-parallel.sh  # keep namespaces
#
# Logs: ./logs/parallel-<timestamp>/<tag>-nodes/<pod>.log  (full, real-time)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
KUBECTL="sudo kubectl"
CLEANUP="${CLEANUP:-1}"         # set CLEANUP=0 to keep namespaces for debugging
EXP_DURATION="${EXP_DURATION:-300s}"  # observation window per experiment (default: 5 min)
LOG_DIR="${ROOT_DIR}/logs/parallel-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"

# ── Helpers ────────────────────────────────────────────────────────────────

# Build a k8s-safe namespace name from a tag (max 63 chars, no dots)
make_ns() {
  local tag="$1"
  echo "exp-$(echo "$tag" | tr '.' 'p' | tr '_' '-' | tr '[:upper:]' '[:lower:]')" | head -c 63
}

log() { echo "[$(date +%H:%M:%S)] $*"; }

# Convert duration string (48h / 30m / 300s) to seconds.
duration_to_sec() {
  echo "$1" | awk '{
    if ($0 ~ /h/) { split($0, a, "h"); print a[1]*3600 + (a[2]+0)*60 }
    else if ($0 ~ /m/) { split($0, a, "m"); print a[1]*60 + (a[2]+0) }
    else { sub(/s$/,""); print $0+0 }
  }'
}

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

# Wait until ALL 5 pods (bootstrap, 3 validators, observer) are Running (up to 10 min).
wait_chain_stable() {
  local ns="$1" tag="$2"
  log "[${tag}] Waiting for all pods to be Running..."
  local deadline=$(( $(date +%s) + 600 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 10
    local total ready
    total=$($KUBECTL get pods -n "$ns" -l "app=asi-chain" --no-headers 2>/dev/null | wc -l | tr -d ' ')
    ready=$($KUBECTL get pods -n "$ns" -l "app=asi-chain" --no-headers 2>/dev/null | grep -c "^[^ ]* *1/1.*Running" || true)
    if [ "$total" -ge 5 ] && [ "$ready" -ge 5 ]; then
      sleep 30  # extra buffer for genesis ceremony and first blocks
      log "[${tag}] Chain stable (${ready}/${total} pods Running)"
      return 0
    fi
    log "[${tag}] Waiting for pods... (${ready}/${total} Running)"
  done
  log "[${tag}] WARNING: only $($KUBECTL get pods -n "$ns" -l "app=asi-chain" --no-headers 2>/dev/null | grep -c "Running" || echo 0)/5 pods Running after 10 min — proceeding anyway"
  return 0
}

# Start streaming logs from all node pods into files in real-time.
# Retries kubectl logs -f until the pod exists (up to 10 min), so this can be
# called immediately after `make start` — before pods are Running — and will
# capture logs from the very first line.
# PIDs are saved to <tag>-nodes/.stream_pids for later cleanup.
start_log_streaming() {
  local ns="$1" tag="$2"
  local node_log_dir="${LOG_DIR}/${tag}-nodes"
  mkdir -p "$node_log_dir"
  local pid_file="${node_log_dir}/.stream_pids"
  : > "$pid_file"
  log "[${tag}] Starting real-time log streaming → ${node_log_dir}/"
  for pod in bootstrap-0 validator1-0 validator2-0 validator3-0 observer-0; do
    (
      # Wait for pod to appear, then stream logs from the very beginning.
      # Loop runs until killed by stop_log_streaming (no deadline).
      # Re-attaches automatically if kubectl exits (pod restart / transient error).
      while true; do
        phase=$($KUBECTL get pod "$pod" -n "$ns" \
          -o jsonpath='{.status.phase}' 2>/dev/null || true)
        if [ "$phase" = "Running" ]; then
          $KUBECTL logs -f "$pod" -n "$ns" --timestamps \
            >> "${node_log_dir}/${pod}.log" 2>/dev/null || true
          sleep 2
        else
          sleep 3
        fi
      done
    ) &
    echo $! >> "$pid_file"
  done
}

# Stop background log streaming processes for a given tag.
stop_log_streaming() {
  local tag="$1"
  local pid_file="${LOG_DIR}/${tag}-nodes/.stream_pids"
  if [ -f "$pid_file" ]; then
    while read -r pid; do
      kill "$pid" 2>/dev/null || true
    done < "$pid_file"
    rm -f "$pid_file"
  fi
}

# ── Experiment matrix ──────────────────────────────────────────────────────
# Best-performing configs from the 48h parallel run (parallel-20260411-055640).
# No k6 load — pure heartbeat / consensus observation.
#
# Format: "interval_s|lfb_age_s|cooldown_s|synchrony_threshold|max_deploys"
# Defaults: synchrony_threshold=0.33, max_deploys=32

MATRIX=(
  # From phase 1+2+3: ci=0.5s, lfb=2s, cd=1s — passed 48h, 550 543 confirmed, avg fin=528ms
  "0.5|2|1|0.33|32"

  # From phase 4: ci=1s, lfb=0.5s, cd=2s — passed 48h, 569 142 confirmed, avg fin=505ms
  "1|0.5|2|0.33|32"

  # From phase 4: ci=1s, lfb=1s, cd=2s — best latency (p95=505ms, max=564ms), 572 773 confirmed
  "1|1|2|0.33|32"

  # From phase 5: ci=1s, lfb=2s, cd=2s, sy=0 — highest throughput, 1 144 788 confirmed
  "1|2|2|0|32"

  # New: ci=5s, lfb=10s, cd=10s — slower heartbeat, lower consensus overhead
  "5|10|10|0.33|32"
)

# ── Main ───────────────────────────────────────────────────────────────────

# ── Pre-flight checks ──────────────────────────────────────────────────────
if ! $KUBECTL get namespace monitoring &>/dev/null; then
  echo "ERROR: 'monitoring' namespace not found. Run 'make monitoring-start' first."
  exit 1
fi

EXP_DURATION_SEC=$(duration_to_sec "$EXP_DURATION")

log "=============================="
log "  Heartbeat Observation Runner"
log "  ${#MATRIX[@]} experiments (no k6 load)"
log "  Duration: ${EXP_DURATION} (${EXP_DURATION_SEC}s)"
log "  Logs: ${LOG_DIR}"
log "=============================="

# Stop all log streaming on exit (SIGINT / SIGTERM / normal exit)
trap 'log "Stopping log streams..."; for t in "${TAGS[@]}"; do stop_log_streaming "$t"; done' EXIT

# ── Build tag / namespace arrays ───────────────────────────────────────────
declare -a TAGS NAMESPACES INTERVALS LFB_AGES COOLDOWNS SYNCHRONY_LIST MAX_DEPLOYS_LIST

for entry in "${MATRIX[@]}"; do
  IFS='|' read -r interval lfb_age cooldown synchrony max_deploys <<< "$entry"
  synchrony="${synchrony:-0.33}"
  max_deploys="${max_deploys:-32}"

  tag="hb-obs-ci${interval}s-lfb${lfb_age}s-cd${cooldown}s"
  [ "$synchrony"   != "0.33" ] && tag="${tag}-sy${synchrony}"
  [ "$max_deploys" != "32"   ] && tag="${tag}-md${max_deploys}"

  ns=$(make_ns "$tag")
  TAGS+=("$tag")
  NAMESPACES+=("$ns")
  INTERVALS+=("$interval")
  LFB_AGES+=("$lfb_age")
  COOLDOWNS+=("$cooldown")
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

# ── Phase B: Start log streaming + wait for chains to stabilize ───────────
# Streaming starts immediately after deploy (before pods are Running) so that
# genesis / initialization lines are never missed.
log ""
log "--- Phase B: starting log streaming and waiting for all pods to be Running ---"

for i in "${!TAGS[@]}"; do
  start_log_streaming "${NAMESPACES[$i]}" "${TAGS[$i]}"
done

declare -a WAIT_PIDS
for i in "${!TAGS[@]}"; do
  wait_chain_stable "${NAMESPACES[$i]}" "${TAGS[$i]}" &
  WAIT_PIDS+=($!)
done
for pid in "${WAIT_PIDS[@]}"; do wait "$pid" || true; done

# ── Phase C: Confirm log streaming is active ──────────────────────────────
log ""
log "--- Phase C: log streaming active, observation starting ---"

# ── Phase D: Observe — wait for EXP_DURATION ──────────────────────────────
log ""
log "--- Phase D: observing for ${EXP_DURATION} (no load) ---"
sleep "$EXP_DURATION_SEC"
log "Observation window complete."

# ── Phase E: Stop log streaming ────────────────────────────────────────────
log ""
log "--- Phase E: stopping log streams ---"
for i in "${!TAGS[@]}"; do
  stop_log_streaming "${TAGS[$i]}"
  log "[${TAGS[$i]}] logs saved → ${LOG_DIR}/${TAGS[$i]}-nodes/"
done

# ── Phase F: Cleanup (optional) ────────────────────────────────────────────
if [ "$CLEANUP" = "1" ]; then
  log ""
  log "--- Phase F: tearing down namespaces ---"
  for i in "${!TAGS[@]}"; do
    $KUBECTL delete namespace "${NAMESPACES[$i]}" --ignore-not-found \
      >> "${LOG_DIR}/${TAGS[$i]}-deploy.log" 2>&1 &
  done
  wait
fi

# ── Summary ────────────────────────────────────────────────────────────────
log ""
log "=============================="
log "  Done!"
log "  Duration: ${EXP_DURATION}"
log "  Logs:"
for i in "${!TAGS[@]}"; do
  log "    ${LOG_DIR}/${TAGS[$i]}-nodes/"
done
log "=============================="
