KUBECTL    = kubectl
NAMESPACE  = asi-chain
AUTOPROPOSE ?= 1

_AUTOPROPOSE_SED = $(if $(filter 0,$(AUTOPROPOSE)),-e '/--autopropose/d',)

-include .env
export


.PHONY: gen start stop restart status bootstrap-id \
	logs-bootstrap logs-validator1 logs-validator2 logs-validator3 logs-observer \
	monitoring-start monitoring-stop \
	api-build api-start api-stop logs-api \
	k6-build k6-run k6-logs k6-hello-world k6-transfer k6-confirm-hello k6-confirm-transfer k6-mixed k6-clean k6-dashboard

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
		python3 gen_validator_keys.py 3; \
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
	@$(KUBECTL) apply -f namespace.yaml
	@$(KUBECTL) apply -f configmap-wallets.yaml
	@for cm in configmap-bonds.yaml configmap-bootstrap.yaml configmap-validator1.yaml configmap-validator2.yaml configmap-validator3.yaml configmap-observer.yaml; do \
		sed \
			-e "s/REPLACE_V1_PUBKEY/$(VALIDATOR1_PUBLIC_KEY)/g" \
			-e "s/REPLACE_V2_PUBKEY/$(VALIDATOR2_PUBLIC_KEY)/g" \
			-e "s/REPLACE_V3_PUBKEY/$(VALIDATOR3_PUBLIC_KEY)/g" \
			$$cm | $(KUBECTL) apply -f -; \
	done
	@$(KUBECTL) apply -f pvcs.yaml
	@$(KUBECTL) apply -f services.yaml

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
		$(_AUTOPROPOSE_SED) \
		statefulset-validators.yaml | $(KUBECTL) apply -f -
	@sed \
		-e "s/REPLACE_ME/$(BOOTSTRAP_NODE_ID)/g" \
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
	@$(KUBECTL) apply -f monitoring/loki.yaml
	@$(KUBECTL) apply -f monitoring/promtail.yaml
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
K6_VUS      ?= 5
K6_DURATION ?= 30s
K6_SCRIPT   ?= hello-world
K6_NODE     ?= validator1

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
	JOB_NAME="k6-$$SCRIPT_SLUG-$$RUN_ID"; \
	sed \
		-e "s|REPLACE_JOB_NAME|$$JOB_NAME|g" \
		-e "s|REPLACE_SCRIPT|$(K6_SCRIPT)|g" \
		-e "s|REPLACE_RUN_ID|$$RUN_ID|g" \
		-e "s|REPLACE_NODE_URL|$$NODE_URL|g" \
		-e "s|REPLACE_PRIVATE_KEY|$(VALIDATOR1_PRIVATE_KEY)|g" \
		-e "s|REPLACE_FROM_ADDR|$(VALIDATOR1_PUBLIC_KEY)|g" \
		-e "s|REPLACE_TO_ADDR|$(VALIDATOR2_PUBLIC_KEY)|g" \
		-e "s|REPLACE_VUS|$(K6_VUS)|g" \
		-e "s|REPLACE_DURATION|$(K6_DURATION)|g" \
		k6/job.yaml | $(KUBECTL) apply -f -; \
	echo "==> Job $$JOB_NAME started"; \
	echo "    Node: $$NODE_URL"; \
	echo "    Logs: make k6-logs"

k6-logs:
	@$(KUBECTL) logs -n monitoring -l app=k6 --tail=200 -f

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

k6-clean:
	@$(KUBECTL) delete jobs -n monitoring -l app=k6 --ignore-not-found

k6-dashboard:
	@echo "==> Importing k6 Grafana dashboard..."
	@bash monitoring/import-dashboards.sh 2>&1 | grep -E "k6|Done|ERROR"
