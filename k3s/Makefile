KUBECTL    = kubectl
NAMESPACE  = asi-chain
AUTOPROPOSE              ?= 1
HEARTBEAT                ?= 1
MAX_DEPLOYS_PER_BLOCK    ?= 32
GRPC_STREAM_MSG_SIZE     ?= 256M
GRPC_RECV_MSG_SIZE       ?= 256K
BLOCK_PROTO_BUFFER       ?= 65536
BURST_MAX_VUS            ?= 256
CASPER_LOOP_INTERVAL     ?= 750 ms
SYNCHRONY_THRESHOLD      ?= 0.33
FAULT_TOLERANCE          ?= 0.1
ADAPTIVE_DEPLOY_CAP      ?= 1
HEARTBEAT_INTERVAL       ?= 5
HEARTBEAT_LFB_AGE        ?= 5
HEARTBEAT_COOLDOWN       ?= 15
CLEANUP                  ?= 1

_AUTOPROPOSE_SED        = $(if $(filter 0,$(AUTOPROPOSE)),-e '/--autopropose/d',)
_HEARTBEAT_SED          = $(if $(filter 0,$(HEARTBEAT)),-e 's/enabled = true/enabled = false/g',)
_MAX_DEPLOYS_SED        = -e '/F1R3_MAX_USER_DEPLOYS_PER_BLOCK/{n;s/value: ".*"/value: "$(MAX_DEPLOYS_PER_BLOCK)"/}'
_GRPC_STREAM_SED        = -e 's/grpc-max-recv-stream-message-size = .*/grpc-max-recv-stream-message-size = $(GRPC_STREAM_MSG_SIZE)/'
_GRPC_RECV_SED          = -e 's/grpc-max-recv-message-size = 256K/grpc-max-recv-message-size = $(GRPC_RECV_MSG_SIZE)/'
_BLOCK_PROTO_SED        = -e '/F1R3_BLOCK_PROTO_DECODE_BUFFER_BYTES/{n;s/value: ".*"/value: "$(BLOCK_PROTO_BUFFER)"/}'
_CASPER_LOOP_SED        = -e 's/casper-loop-interval = [0-9.]* \(ms\|seconds\)/casper-loop-interval = $(CASPER_LOOP_INTERVAL)/'
_FAULT_TOLERANCE_SED    = -e 's/fault-tolerance-threshold = [0-9.]*/fault-tolerance-threshold = $(FAULT_TOLERANCE)/'
_SYNCHRONY_SED          = -e 's/synchrony-constraint-threshold = [0-9.]*/synchrony-constraint-threshold = $(SYNCHRONY_THRESHOLD)/'
_ADAPTIVE_CAP_SED       = -e '/F1R3_ADAPTIVE_DEPLOY_CAP_ENABLED/{n;s/value: ".*"/value: "$(ADAPTIVE_DEPLOY_CAP)"/}'
_HEARTBEAT_INTERVAL_SED = -e 's/check-interval = [0-9.]* \(seconds\|ms\)/check-interval = $(HEARTBEAT_INTERVAL) seconds/'
_HEARTBEAT_LFB_SED      = -e 's/max-lfb-age = [0-9.]* \(seconds\|ms\)/max-lfb-age = $(HEARTBEAT_LFB_AGE) seconds/'
_HEARTBEAT_COOLDOWN_SED = -e 's/self-propose-cooldown = [0-9.]* \(seconds\|ms\)/self-propose-cooldown = $(HEARTBEAT_COOLDOWN) seconds/'
_NAMESPACE_SED          = -e "s/asi-chain/$(NAMESPACE)/g"

-include .env
export


.PHONY: help gen start stop restart status bootstrap-id \
	logs-bootstrap logs-validator1 logs-validator2 logs-validator3 logs-observer \
	monitoring-start monitoring-stop \
	api-build api-start api-stop logs-api \
	k6-build k6-run k6-logs k6-hello-world k6-transfer k6-confirm-hello k6-confirm-transfer k6-mixed k6-burst k6-capacity k6-clean k6-dashboard \
	experiment experiment-matrix experiment-parallel

help:
	@echo ""
	@echo "Usage: make <target> [OPTIONS]"
	@echo ""
	@echo "Chain"
	@echo "  gen                        Generate bootstrap TLS key + validator keypairs → .env"
	@echo "  start                      Deploy and start the chain (requires .env)"
	@echo "    HEARTBEAT=0              Start with heartbeat disabled"
	@echo "    AUTOPROPOSE=0            Start with autopropose disabled"
	@echo "    MAX_DEPLOYS_PER_BLOCK=N  Max deploys per user per block (default: 32)"
	@echo "    GRPC_STREAM_MSG_SIZE=S   gRPC max stream message size e.g. 512M (default: 256M)"
	@echo "    GRPC_RECV_MSG_SIZE=S     gRPC max recv message size e.g. 64M  (default: 256K)"
	@echo "    BLOCK_PROTO_BUFFER=N     Block proto decode buffer bytes       (default: 65536)"
	@echo "    CASPER_LOOP_INTERVAL=N   Block creation interval in seconds    (default: 1)"
	@echo "    FAULT_TOLERANCE=F        Finalization threshold 0.0–1.0 (default: 0.0)"
	@echo "    SYNCHRONY_THRESHOLD=F    Synchrony constraint 0.0–1.0  (default: 0.33, use 0 with HEARTBEAT=0)"
	@echo "    ADAPTIVE_DEPLOY_CAP=B    Enable adaptive deploy cap true/false (default: true)"
	@echo "    HEARTBEAT_INTERVAL=N     Heartbeat check-interval in seconds  (default: 5)"
	@echo "    HEARTBEAT_LFB_AGE=N      Heartbeat max-lfb-age in seconds     (default: 5)"
	@echo "    HEARTBEAT_COOLDOWN=N     Heartbeat self-propose-cooldown in s  (default: 15)"
	@echo "    NAMESPACE=name           Deploy to custom namespace (default: asi-chain)"
	@echo "  stop                       Delete chain namespace (wipes all data)"
	@echo "  restart                    stop + start"
	@echo "  status                     Show pod status"
	@echo "  bootstrap-id               Print bootstrap node ID"
	@echo "  logs-bootstrap             Stream bootstrap logs"
	@echo "  logs-validator1/2/3        Stream validator logs"
	@echo "  logs-observer              Stream observer logs"
	@echo ""
	@echo "Monitoring"
	@echo "  monitoring-start           Deploy Prometheus, Grafana, Pushgateway"
	@echo "  monitoring-stop            Delete monitoring namespace"
	@echo ""
	@echo "Management API"
	@echo "  api-build                  Build management-api Docker image"
	@echo "  api-start                  Deploy management-api"
	@echo "  api-stop                   Remove management-api"
	@echo "  logs-api                   Stream management-api logs"
	@echo ""
	@echo "k6 Load Tests"
	@echo "  k6-build                   Build k6-tests Docker image"
	@echo "  k6-hello-world             Unconfirmed HelloWorld deploys  (VUS=5, 60s)"
	@echo "  k6-transfer                Unconfirmed Transfer deploys    (VUS=5, 60s)"
	@echo "  k6-confirm-hello           Confirmed HelloWorld deploys    (VUS=2, 120s)"
	@echo "  k6-confirm-transfer        Confirmed Transfer deploys      (VUS=2, 120s)"
	@echo "  k6-mixed                   Confirmed mixed workload        (VUS=4, 120s)"
	@echo "  k6-burst                   Max deploys per block burst     (VUS≤256, 60s)"
	@echo "    MAX_DEPLOYS_PER_BLOCK=N  Controls total deploys/burst (deploys = N × 4 keys)"
	@echo "    BURST_MAX_VUS=N          Cap on VU count to prevent OOM (default: 256)"
	@echo "  k6-capacity                Single-type capacity: flood→propose→confirm cycles"
	@echo "    K6_DEPLOY_TYPE=T         hello-world (default) or transfer"
	@echo "    K6_CAPACITY_DEPLOYS=N    Deploys batched per round (default: 16)"
	@echo "    K6_CAPACITY_ROUNDS=N     Number of flood→propose rounds (default: 3)"
	@echo "    K6_PHLO_LIMIT=N          Phlo (gas) per deploy (default: 500000)"
	@echo "    K6_CONFIRM_TIMEOUT=N     Seconds to wait for block after propose (default: 60)"
	@echo "    Recommended: make start AUTOPROPOSE=0 HEARTBEAT=0 SYNCHRONY_THRESHOLD=0 MAX_DEPLOYS_PER_BLOCK=10000 ADAPTIVE_DEPLOY_CAP=false"
	@echo "  k6-run                     Custom run — see options below"
	@echo "    K6_SCRIPT=<path>         Script path under k6/src/ (without .js)"
	@echo "    K6_NODE=<validator>      Target node (default: validator1)"
	@echo "    K6_VUS=<n>               Virtual users (default: 5)"
	@echo "    K6_TOTAL_DEPLOYS=<n>     Total deploys per burst (burst-block only, default: K6_VUS)"
	@echo "    K6_DURATION=<t>          Duration e.g. 60s, 5m (default: 30s)"
	@echo "    K6_TAG=<tag>             Override testid prefix in Grafana"
	@echo "  k6-logs                    Stream logs from last k6 job"
	@echo "  k6-clean                   Delete completed k6 jobs"
	@echo "  k6-dashboard               Import k6 dashboard into Grafana"
	@echo ""
	@echo "Experiments"
	@echo "  experiment                 Single heartbeat experiment run"
	@echo "    INTERVAL=<s>             check-interval in seconds (default: 1)"
	@echo "    LFB_AGE=<s>              max-lfb-age in seconds   (default: 5)"
	@echo "    COOLDOWN=<ms>            self-propose cooldown ms  (default: 5000)"
	@echo "    K6_VUS=<n>               Virtual users             (default: 2)"
	@echo "    SCENARIO=<name>          confirm-hello | mixed     (default: confirm-hello)"
	@echo "  experiment-matrix          Full heartbeat sweep matrix, sequential (~40 min)"
	@echo "  experiment-parallel        Full heartbeat sweep matrix, parallel (~10 min)"
	@echo "    PHASE=phase1/.../phase5/p45/all  Which phase to run (default: all)"
	@echo "    phase4: max-lfb-age sweep (ci=1s, cd=2s, vu=5)"
	@echo "    phase5: synchrony-threshold + block limit (ci=1s, cd=2s, vu=10)"
	@echo "    p45:    phases 4+5 combined"
	@echo "    CLEANUP=0                Keep experiment namespaces after run"
	@echo ""

# Generate all keys (bootstrap TLS + validator secp256k1) → writes .env
gen:
	@echo "==> Generating bootstrap TLS key..."
	@mkdir -p .certs
	@openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out .certs/node.key.pem
	@echo ""
	@echo "==> Computing bootstrap node ID (keccak256 of pubkey coordinates)..."
	@NODE_ID=$$(openssl pkey -in .certs/node.key.pem -pubout -outform DER | python3 node_id.py); \
	if [ -z "$$NODE_ID" ]; then \
		echo "ERROR: Failed to compute node ID"; \
		exit 1; \
	fi; \
	echo "==> Generating validator secp256k1 keypairs..."; \
	{ \
		echo "BOOTSTRAP_NODE_ID=$$NODE_ID"; \
		echo "NETWORK_ID=testnet"; \
		echo ""; \
		python3 gen_validator_keys.py 4; \
		echo ""; \
		echo "# k6 load-test wallets (one per VU, funded at genesis)"; \
		python3 gen_validator_keys.py 32 K6_WALLET; \
	} > .env; \
	echo "Bootstrap Node ID: $$NODE_ID"; \
	echo "==> Written to .env (contains private keys — do not commit)"

# Full fresh start — requires .env with BOOTSTRAP_NODE_ID set (run 'make gen' first)
start:
	@if [ -z "$(BOOTSTRAP_NODE_ID)" ]; then \
		echo "ERROR: BOOTSTRAP_NODE_ID not set. Run 'make gen' first."; \
		exit 1; \
	fi
	@if [ ! -f .certs/node.key.pem ]; then \
		echo "ERROR: .certs/node.key.pem not found. Run 'make gen' first."; \
		exit 1; \
	fi

	@echo "==> Applying namespace, configmaps, pvcs, services..."
	@sed $(_NAMESPACE_SED) namespace.yaml | $(KUBECTL) apply -f -
	@python3 scripts/gen-wallets-configmap.py "$(NAMESPACE)" | $(KUBECTL) apply -f -
	@for cm in configmap-bonds.yaml configmap-bootstrap.yaml configmap-validator1.yaml configmap-validator2.yaml configmap-validator3.yaml configmap-validator4.yaml; do \
		sed \
			-e "s/REPLACE_V1_PUBKEY/$(VALIDATOR1_PUBLIC_KEY)/g" \
			-e "s/REPLACE_V2_PUBKEY/$(VALIDATOR2_PUBLIC_KEY)/g" \
			-e "s/REPLACE_V3_PUBKEY/$(VALIDATOR3_PUBLIC_KEY)/g" \
			-e "s/REPLACE_V4_PUBKEY/$(VALIDATOR4_PUBLIC_KEY)/g" \
			$(_HEARTBEAT_SED) \
			$(_GRPC_STREAM_SED) \
			$(_GRPC_RECV_SED) \
			$(_CASPER_LOOP_SED) \
			$(_FAULT_TOLERANCE_SED) \
			$(_SYNCHRONY_SED) \
			$(_HEARTBEAT_INTERVAL_SED) \
			$(_HEARTBEAT_LFB_SED) \
			$(_HEARTBEAT_COOLDOWN_SED) \
			$(_NAMESPACE_SED) \
			$$cm | $(KUBECTL) apply -f -; \
	done
	@sed \
		-e "s/REPLACE_V1_PUBKEY/$(VALIDATOR1_PUBLIC_KEY)/g" \
		-e "s/REPLACE_V2_PUBKEY/$(VALIDATOR2_PUBLIC_KEY)/g" \
		-e "s/REPLACE_V3_PUBKEY/$(VALIDATOR3_PUBLIC_KEY)/g" \
		-e "s/REPLACE_V4_PUBKEY/$(VALIDATOR4_PUBLIC_KEY)/g" \
		$(_HEARTBEAT_SED) \
		$(_GRPC_STREAM_SED) \
		$(_GRPC_RECV_SED) \
		$(_NAMESPACE_SED) \
		configmap-observer.yaml | $(KUBECTL) apply -f -
	@sed $(_NAMESPACE_SED) pvcs.yaml | $(KUBECTL) apply -f -
	@sed $(_NAMESPACE_SED) services.yaml | $(KUBECTL) apply -f -
	@if [ "$(NAMESPACE)" = "asi-chain" ]; then \
		$(KUBECTL) apply -f services-ext.yaml; \
	fi

	@echo ""
	@echo "==> Creating bootstrap TLS secret..."
	@$(KUBECTL) create secret generic bootstrap-tls \
		-n $(NAMESPACE) \
		--from-file=node.key.pem=.certs/node.key.pem \
		--dry-run=client -o yaml | $(KUBECTL) apply -f -

	@echo ""
	@echo "==> Starting bootstrap (node ID: $(BOOTSTRAP_NODE_ID), autopropose=$(AUTOPROPOSE))..."
	@sed \
		-e "s/REPLACE_ME/$(BOOTSTRAP_NODE_ID)/g" \
		$(_AUTOPROPOSE_SED) \
		$(_MAX_DEPLOYS_SED) \
		$(_BLOCK_PROTO_SED) \
		$(_SYNCHRONY_SED) \
		$(_NAMESPACE_SED) \
		statefulset-bootstrap.yaml | $(KUBECTL) apply -f -
	@$(KUBECTL) rollout status statefulset/bootstrap -n $(NAMESPACE) --timeout=120s

	@echo ""
	@echo "==> Starting validators and observer..."
	@sed \
		-e "s/REPLACE_ME/$(BOOTSTRAP_NODE_ID)/g" \
		-e "s/REPLACE_V1_PUBKEY/$(VALIDATOR1_PUBLIC_KEY)/g" \
		-e "s/REPLACE_V1_PRIVKEY/$(VALIDATOR1_PRIVATE_KEY)/g" \
		-e "s/REPLACE_V2_PUBKEY/$(VALIDATOR2_PUBLIC_KEY)/g" \
		-e "s/REPLACE_V2_PRIVKEY/$(VALIDATOR2_PRIVATE_KEY)/g" \
		-e "s/REPLACE_V3_PUBKEY/$(VALIDATOR3_PUBLIC_KEY)/g" \
		-e "s/REPLACE_V3_PRIVKEY/$(VALIDATOR3_PRIVATE_KEY)/g" \
		-e "s/REPLACE_V4_PUBKEY/$(VALIDATOR4_PUBLIC_KEY)/g" \
		-e "s/REPLACE_V4_PRIVKEY/$(VALIDATOR4_PRIVATE_KEY)/g" \
		$(_AUTOPROPOSE_SED) \
		$(_MAX_DEPLOYS_SED) \
		$(_BLOCK_PROTO_SED) \
		$(_SYNCHRONY_SED) \
		$(_ADAPTIVE_CAP_SED) \
		$(_NAMESPACE_SED) \
		statefulset-validators.yaml | $(KUBECTL) apply -f -
	@sed \
		-e "s/REPLACE_ME/$(BOOTSTRAP_NODE_ID)/g" \
		$(_MAX_DEPLOYS_SED) \
		$(_NAMESPACE_SED) \
		statefulset-observer.yaml | $(KUBECTL) apply -f -

	@echo ""
	@echo "==> Done. Check status with: make status"

stop:
	@echo "==> Deleting namespace $(NAMESPACE) (terminates pods, wipes PVCs and data)..."
	@$(KUBECTL) delete namespace $(NAMESPACE) --ignore-not-found
	@echo "==> Namespace deletion initiated."

restart: stop
	@echo "Waiting for namespace to be fully deleted..."
	@$(KUBECTL) wait namespace/$(NAMESPACE) --for=delete --timeout=60s 2>/dev/null || true
	@$(MAKE) start

status:
	@$(KUBECTL) get pods -n $(NAMESPACE) -o wide

bootstrap-id:
	@grep BOOTSTRAP_NODE_ID .env 2>/dev/null | cut -d= -f2 || { \
		echo "No .env found. Run 'make gen' first."; \
		exit 1; \
	}

logs-bootstrap:
	@$(KUBECTL) logs -n $(NAMESPACE) bootstrap-0 -f

logs-validator1:
	@$(KUBECTL) logs -n $(NAMESPACE) validator1-0 -f

logs-validator2:
	@$(KUBECTL) logs -n $(NAMESPACE) validator2-0 -f

logs-validator3:
	@$(KUBECTL) logs -n $(NAMESPACE) validator3-0 -f

logs-observer:
	@$(KUBECTL) logs -n $(NAMESPACE) observer-0 -f

monitoring-start:
	@echo "==> Starting monitoring stack..."
	@$(KUBECTL) apply -f monitoring/namespace.yaml
	@$(KUBECTL) apply -f monitoring/node-exporter.yaml
	@$(KUBECTL) apply -f monitoring/prometheus.yaml
	@$(KUBECTL) apply -f monitoring/firefly-exporter.yaml
	@$(KUBECTL) apply -f monitoring/pushgateway.yaml
	@$(KUBECTL) apply -f monitoring/grafana.yaml
	@echo ""
	@echo "==> Waiting for Grafana to be ready..."
	@$(KUBECTL) rollout status deployment/grafana -n monitoring --timeout=120s
	@echo ""
	@echo "==> Importing dashboards..."
	@bash monitoring/import-dashboards.sh
	@echo ""
	@echo "==> Done. Grafana: http://<HOST_IP>:30080 (admin/admin)"
	@echo "    Prometheus:     http://<HOST_IP>:30090"

monitoring-stop:
	@$(KUBECTL) delete namespace monitoring --ignore-not-found

api-build:
	@echo "==> Building management-api image..."
	@docker build -t management-api:latest management-api/
	@docker save management-api:latest | k3s ctr images import -
	@echo "==> management-api image imported into k3s"

api-start:
	@echo "==> Deploying management-api..."
	@$(KUBECTL) apply -f management-api/deploy.yaml
	@$(KUBECTL) rollout status deployment/management-api -n monitoring --timeout=60s
	@echo ""
	@echo "==> Management API:  http://<HOST_IP>:30800"
	@echo "    Swagger UI:       http://<HOST_IP>:30800/docs"

api-stop:
	@$(KUBECTL) delete -f management-api/deploy.yaml --ignore-not-found

logs-api:
	@$(KUBECTL) logs -n monitoring deployment/management-api -f

# --- k6 load testing (direct node targeting, no npm/bun on host) ---
# Usage: make k6-build
#        make k6-hello-world          (unconfirmed, throughput)
#        make k6-transfer             (unconfirmed, throughput)
#        make k6-confirm-hello        (confirmed, block metrics)
#        make k6-confirm-transfer     (confirmed, block metrics)
#        make k6-mixed                (confirmed HelloWorld + Transfer)
#        make k6-run K6_SCRIPT=... [K6_NODE=validator1] [K6_VUS=5] [K6_DURATION=30s]
K6_VUS           ?= 5
K6_DURATION      ?= 30s
K6_SCRIPT        ?= hello-world
K6_NODE          ?= validator1
K6_TAG           ?=
K6_PRIVATE_KEYS  ?= $(VALIDATOR1_PRIVATE_KEY)
K6_TOTAL_DEPLOYS ?= $(K6_VUS)
# Comma-separated list of k6 wallet private keys (one per VU).
# Populated from K6_WALLET*_PRIVATE_KEY entries in .env.
K6_WALLET_KEYS   ?= $(shell grep '^K6_WALLET[0-9]*_PRIVATE_KEY=' .env 2>/dev/null | cut -d= -f2 | tr '\n' ',' | sed 's/,$$//')

k6-build:
	@echo "==> Building k6-tests image (xk6 + Go extension inside Docker)..."
	@docker build -t k6-tests:latest -f k6/Dockerfile .
	@docker save k6-tests:latest | k3s ctr images import -
	@echo "==> k6-tests image imported into k3s"

k6-run:
	@if [ -z "$(VALIDATOR1_PRIVATE_KEY)" ]; then \
		echo "ERROR: VALIDATOR1_PRIVATE_KEY not set. Run 'make gen' first."; exit 1; \
	fi
	@RUN_ID=$$(date +%Y-%m-%d-%H-%M-%S); \
	NODE_URL="http://$(K6_NODE)-0.$(K6_NODE).$(NAMESPACE).svc.cluster.local:40403"; \
	SCRIPT_SLUG=$$(echo "$(K6_SCRIPT)" | tr '/' '-'); \
	if [ -n "$(K6_TAG)" ]; then \
		JOB_NAME="k6-$(K6_TAG)-$$RUN_ID"; \
	else \
		JOB_NAME="k6-$$SCRIPT_SLUG-$$RUN_ID"; \
	fi; \
	sed \
		-e "s|REPLACE_JOB_NAME|$$JOB_NAME|g" \
		-e "s|REPLACE_SCRIPT|$(K6_SCRIPT)|g" \
		-e "s|REPLACE_RUN_ID|$$RUN_ID|g" \
		-e "s|REPLACE_NODE_URL|$$NODE_URL|g" \
		-e "s|REPLACE_WALLET_KEYS|$(K6_WALLET_KEYS)|g" \
		-e "s|REPLACE_PRIVATE_KEYS|$(K6_PRIVATE_KEYS)|g" \
		-e "s|REPLACE_TOTAL_DEPLOYS|$(K6_TOTAL_DEPLOYS)|g" \
		-e "s|REPLACE_PRIVATE_KEY|$(VALIDATOR1_PRIVATE_KEY)|g" \
		-e "s|REPLACE_FROM_ADDR|$(VALIDATOR1_PUBLIC_KEY)|g" \
		-e "s|REPLACE_TO_ADDR|$(VALIDATOR2_PUBLIC_KEY)|g" \
		-e "s|REPLACE_DEPLOY_TYPE|$(K6_DEPLOY_TYPE)|g" \
		-e "s|REPLACE_ROUNDS|$(K6_CAPACITY_ROUNDS)|g" \
		-e "s|REPLACE_VUS|$(K6_VUS)|g" \
		-e "s|REPLACE_DURATION|$(K6_DURATION)|g" \
		k6/job.yaml | $(KUBECTL) apply -f -; \
	echo "==> Job $$JOB_NAME started"; \
	echo "    Node: $$NODE_URL"; \
	echo "    Logs: make k6-logs"

k6-logs:
	@$(KUBECTL) logs -n monitoring -l app=k6 --tail=200 -f --max-log-requests=20

k6-hello-world:
	@$(MAKE) --no-print-directory k6-run K6_SCRIPT=hello-world K6_VUS=5 K6_DURATION=60s

k6-transfer:
	@$(MAKE) --no-print-directory k6-run K6_SCRIPT=transfer K6_VUS=5 K6_DURATION=60s

k6-confirm-hello:
	@$(MAKE) --no-print-directory k6-run K6_SCRIPT=scenarios/confirmed-hello-world K6_VUS=2 K6_DURATION=120s

k6-confirm-transfer:
	@$(MAKE) --no-print-directory k6-run K6_SCRIPT=scenarios/confirmed-transfer K6_VUS=2 K6_DURATION=120s

k6-mixed:
	@$(MAKE) --no-print-directory k6-run K6_SCRIPT=scenarios/mixed-deploy K6_VUS=4 K6_DURATION=120s


k6-burst:
	$(eval _BURST_TOTAL := $(shell expr $(MAX_DEPLOYS_PER_BLOCK) \* 4))
	$(eval _BURST_VUS   := $(shell [ $(_BURST_TOTAL) -gt $(BURST_MAX_VUS) ] && echo $(BURST_MAX_VUS) || echo $(_BURST_TOTAL)))
	@$(MAKE) --no-print-directory k6-run K6_SCRIPT=scenarios/burst-block \
		K6_VUS=$(_BURST_VUS) \
		K6_TOTAL_DEPLOYS=$(_BURST_TOTAL) \
		K6_DURATION=60s \
		K6_PRIVATE_KEYS="$(VALIDATOR1_PRIVATE_KEY),$(VALIDATOR2_PRIVATE_KEY),$(VALIDATOR3_PRIVATE_KEY),$(VALIDATOR4_PRIVATE_KEY)"

K6_CAPACITY_DEPLOYS   ?= 16
K6_CAPACITY_ROUNDS    ?= 3
K6_DEPLOY_TYPE        ?= hello-world
K6_PHLO_LIMIT         ?= 500000
K6_CONFIRM_TIMEOUT    ?= 60

k6-capacity:
	@if [ -z "$(VALIDATOR1_PRIVATE_KEY)" ]; then \
		echo "ERROR: VALIDATOR1_PRIVATE_KEY not set. Run 'make gen' first."; exit 1; \
	fi
	@RUN_ID=$$(date +%Y-%m-%d-%H-%M-%S); \
	NODE_URL="http://validator1-0.validator1.asi-chain.svc.cluster.local:40403"; \
	JOB_NAME="k6-capacity-single-$$RUN_ID"; \
	sed \
		-e "s|REPLACE_JOB_NAME|$$JOB_NAME|g" \
		-e "s|REPLACE_SCRIPT|scenarios/capacity-single|g" \
		-e "s|REPLACE_RUN_ID|$$RUN_ID|g" \
		-e "s|REPLACE_NODE_URL|$$NODE_URL|g" \
		-e "s|REPLACE_PRIVATE_KEYS|$(VALIDATOR1_PRIVATE_KEY),$(VALIDATOR2_PRIVATE_KEY),$(VALIDATOR3_PRIVATE_KEY),$(VALIDATOR4_PRIVATE_KEY)|g" \
		-e "s|REPLACE_TOTAL_DEPLOYS|$(K6_CAPACITY_DEPLOYS)|g" \
		-e "s|REPLACE_PRIVATE_KEY|$(VALIDATOR1_PRIVATE_KEY)|g" \
		-e "s|REPLACE_FROM_ADDR|$(VALIDATOR1_PUBLIC_KEY)|g" \
		-e "s|REPLACE_TO_ADDR|$(VALIDATOR2_PUBLIC_KEY)|g" \
		-e "s|REPLACE_DEPLOY_TYPE|$(K6_DEPLOY_TYPE)|g" \
		-e "s|REPLACE_ROUNDS|$(K6_CAPACITY_ROUNDS)|g" \
		-e "s|REPLACE_PHLO_LIMIT|$(K6_PHLO_LIMIT)|g" \
		-e "s|REPLACE_CONFIRM_TIMEOUT|$(K6_CONFIRM_TIMEOUT)|g" \
		k6/capacity-job.yaml | $(KUBECTL) apply -f -; \
	echo "==> Job $$JOB_NAME started"; \
	echo "    Node: $$NODE_URL"; \
	echo "    Logs: make k6-logs"

k6-clean:
	@$(KUBECTL) delete jobs -n monitoring -l app=k6 --ignore-not-found

k6-dashboard:
	@echo "==> Importing k6 Grafana dashboard..."
	@bash monitoring/import-dashboards.sh 2>&1 | grep -E "k6|Done|ERROR"

# --- Experiments: sweep node config params, measure block time & CPU ---
# Usage:
#   make experiment INTERVAL=1 LFB_AGE=5 COOLDOWN=5000
#   make experiment-matrix   (runs all ~10 combinations, ~40 min total)
INTERVAL  ?= 1
LFB_AGE   ?= 5
COOLDOWN  ?= 5000
SCENARIO  ?= confirm-hello

experiment:
	@bash scripts/heartbeat-experiment.sh $(INTERVAL) $(LFB_AGE) $(COOLDOWN) $(K6_VUS) $(SCENARIO)

experiment-matrix:
	@bash scripts/heartbeat-experiment-matrix.sh

PHASE   ?= all

experiment-parallel:
	@CLEANUP=$(CLEANUP) EXP_K6_DURATION=$(K6_DURATION) bash scripts/run-heartbeat-experiments-parallel.sh $(PHASE)
