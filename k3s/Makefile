KUBECTL = kubectl
NAMESPACE = asi-chain
AUTOPROPOSE ?= 1

_AUTOPROPOSE_SED = $(if $(filter 0,$(AUTOPROPOSE)),-e '/--autopropose/d',)

-include .env
export

.PHONY: gen start stop restart status bootstrap-id \
	logs-bootstrap logs-validator1 logs-validator2 logs-validator3 logs-observer \
	monitoring-start monitoring-stop \
	api-build api-start api-stop

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
	@echo "==> Deleting PVCs to wipe node data..."
	@$(KUBECTL) delete pvc --all -n $(NAMESPACE) --ignore-not-found
	@echo "==> Waiting for PVs to be reclaimed..."
	@$(KUBECTL) wait pvc --all -n $(NAMESPACE) --for=delete --timeout=120s 2>/dev/null || true
	@$(KUBECTL) delete namespace $(NAMESPACE) --ignore-not-found

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
	@echo "==> Importing image into k3s..."
	@docker save management-api:latest | k3s ctr images import -

api-start:
	@echo "==> Deploying management-api..."
	@$(KUBECTL) apply -f management-api/deploy.yaml
	@$(KUBECTL) rollout status deployment/management-api -n monitoring --timeout=60s
	@echo ""
	@echo "==> Management API: http://<HOST_IP>:30800"
	@echo "    Swagger UI:      http://<HOST_IP>:30800/docs"

api-stop:
	@$(KUBECTL) delete -f management-api/deploy.yaml --ignore-not-found
