#!/usr/bin/env bash
# Run a single experiment iteration with given node configuration parameters.
# Usage: ./scripts/experiment.sh <check-interval-s> <max-lfb-age-s> <cooldown-ms>
# Example: ./scripts/experiment.sh 1 5 5000
set -euo pipefail

INTERVAL=${1:?Usage: experiment.sh <check-interval-s> <max-lfb-age-s> <cooldown-ms>}
LFB_AGE=${2:?}
COOLDOWN=${3:?}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
KUBECTL="sudo kubectl"
NAMESPACE="asi-chain"
TAG="ci${INTERVAL}s-lfb${LFB_AGE}s-cd${COOLDOWN}"

echo ""
echo "========================================"
echo "  Experiment: ${TAG}"
echo "  check-interval=${INTERVAL}s  max-lfb-age=${LFB_AGE}s  cooldown=${COOLDOWN}ms"
echo "========================================"

# 1. Generate modified validator configmaps in temp dir (source files stay intact)
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "==> Applying validator configmaps..."
for i in 1 2 3; do
  sed \
    -e "s/check-interval = .* seconds/check-interval = ${INTERVAL} seconds/" \
    -e "s/max-lfb-age = .* seconds/max-lfb-age = ${LFB_AGE} seconds/" \
    "${ROOT_DIR}/configmap-validator${i}.yaml" > "${TMPDIR}/configmap-validator${i}.yaml"
  $KUBECTL apply -f "${TMPDIR}/configmap-validator${i}.yaml"
done

# 2. Patch cooldown env var — triggers automatic rolling restart of each StatefulSet
echo "==> Patching self-propose cooldown to ${COOLDOWN}ms..."
for i in 1 2 3; do
  $KUBECTL set env statefulset/validator${i} \
    "F1R3_HEARTBEAT_SELF_PROPOSE_COOLDOWN_MS=${COOLDOWN}" \
    -n ${NAMESPACE}
done

# 3. Wait for rolling restarts to finish
echo "==> Waiting for validators to restart..."
for i in 1 2 3; do
  $KUBECTL rollout status statefulset/validator${i} -n ${NAMESPACE} --timeout=180s
done

# 4. Wait for chain to stabilize: poll Prometheus until block rate > 0
echo "==> Waiting for chain to stabilize (up to 90s)..."
PROM_URL="http://prometheus.monitoring.svc.cluster.local:9090"
DEADLINE=$(($(date +%s) + 90))
STABLE=false
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  sleep 5
  RATE=$($KUBECTL run --rm -i --restart=Never --namespace=monitoring \
    tmp-stab-$$ --image=curlimages/curl:8.5.0 \
    -- curl -sf "${PROM_URL}/api/v1/query?query=rate(f1r3fly_casper_running_block_hash_received_total%5B30s%5D)" \
    2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
vals = [float(r['value'][1]) for r in d.get('data',{}).get('result',[])]
print(sum(vals))
" 2>/dev/null || echo "0")
  if python3 -c "exit(0 if float('${RATE}') > 0 else 1)" 2>/dev/null; then
    echo "    Chain producing blocks (rate=${RATE})"
    STABLE=true
    break
  fi
done
if [ "$STABLE" != "true" ]; then
  echo "WARNING: chain may not be stable, continuing anyway"
fi

# 5. Push experiment config to Pushgateway so it's queryable by testid in Grafana
PUSHGW="http://pushgateway.monitoring.svc.cluster.local:9091"
echo "==> Pushing experiment config to Pushgateway..."
$KUBECTL run --rm -i --restart=Never --namespace=monitoring \
  tmp-push-$$ --image=curlimages/curl:8.5.0 \
  -- sh -c "printf 'k6_experiment_config{check_interval=\"${INTERVAL}\",max_lfb_age=\"${LFB_AGE}\",cooldown_ms=\"${COOLDOWN}\"} 1\n' \
  | curl -sf --data-binary @- '${PUSHGW}/metrics/job/k6/testid/${TAG}'" \
  2>/dev/null || echo "WARNING: could not push config to Pushgateway"

# 6. Run k6 confirmed-hello-world — TAG is embedded in testid via job name
echo "==> Starting k6 test..."
make -C "${ROOT_DIR}" k6-confirm-hello K6_TAG="${TAG}"

# 6. Wait for the k6 job to finish
echo "==> Waiting for k6 job to complete..."
sleep 5
JOB=$($KUBECTL get jobs -n monitoring -l app=k6 \
  --sort-by=.metadata.creationTimestamp \
  -o jsonpath='{.items[-1].metadata.name}')
$KUBECTL wait --for=condition=complete "job/${JOB}" -n monitoring --timeout=300s

echo "==> Done: ${TAG}"
