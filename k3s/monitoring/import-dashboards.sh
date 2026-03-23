#!/usr/bin/env bash
set -e

GRAFANA_URL="http://admin:admin@localhost:30080"
OBSERVER_METRICS_URL="${OBSERVER_METRICS_URL:-http://localhost:30053/metrics}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

grafana_import() {
    printf '%s' "$1" | python3 -c "
import sys, json
dash = json.loads(sys.stdin.read())
payload = {
    'dashboard': dash,
    'overwrite': True,
    'folderId': 0,
    'inputs': [{'name': 'DS_PROMETHEUS', 'type': 'datasource', 'pluginId': 'prometheus', 'value': 'Prometheus'}]
}
print(json.dumps(payload))
" | curl -sf -X POST "$GRAFANA_URL/api/dashboards/import" \
        -H "Content-Type: application/json" \
        -d @- > /dev/null
}

echo "==> Waiting for Grafana API..."
for i in $(seq 1 30); do
    curl -sf "$GRAFANA_URL/api/health" > /dev/null 2>&1 && break
    [ "$i" -eq 30 ] && echo "ERROR: Grafana not ready" && exit 1
    sleep 2
done

echo "==> Importing Node Exporter dashboard (grafana.com ID: 1860)..."
NODE_DASH=$(curl -sf "https://grafana.com/api/dashboards/1860/revisions/latest/download")
grafana_import "$NODE_DASH"
echo "    Done"

SCRIPT="$SCRIPT_DIR/rnode-metric-counters-to-grafana-dash.sh"
if [ -f "$SCRIPT" ]; then
    echo "==> Generating F1r3fly dashboard from $OBSERVER_METRICS_URL..."
    F1R3_DASH=$(bash "$SCRIPT" "$OBSERVER_METRICS_URL")
    grafana_import "$F1R3_DASH"
    echo "    Done"
else
    echo "WARNING: $SCRIPT not found, skipping F1r3fly dashboard"
    echo "         Set F1R3NODE_SCRIPTS env var to point to f1r3node/scripts/"
fi

echo ""
echo "==> Dashboards: http://localhost:30080/dashboards"
