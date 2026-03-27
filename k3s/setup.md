# k3s Setup — ASI-Chain

Single-node k3s cluster running a 5-node ASI-Chain blockchain (1 bootstrap + 3 validators + 1 observer) with a full monitoring stack.

---

## Namespaces

| Namespace   | Contents                                                    |
|-------------|-------------------------------------------------------------|
| `asi-chain` | Bootstrap, validator1–3, observer StatefulSets + PVCs      |
| `monitoring` | Prometheus, Grafana, Loki, Promtail, Node Exporter, Firefly Exporter, Management API, k6 jobs |

---

## Prerequisites

- k3s installed on the host machine
- `kubectl` configured (k3s default: `/etc/rancher/k3s/k3s.yaml`)
- Docker (for building images)
- Python 3 (for key generation scripts)
- OpenSSL (for bootstrap TLS key generation)

---

## First-time Setup

### 1. Generate keys

```bash
make gen
```

Generates:
- `k3s/.certs/node.key.pem` — bootstrap node EC P-256 TLS key
- `k3s/.env` — `BOOTSTRAP_NODE_ID`, `NETWORK_ID`, `VALIDATOR{1,2,3}_{PUBLIC,PRIVATE}_KEY`

**Do not commit `.env` or `.certs/`** — they contain validator private keys.

### 2. Start the chain

```bash
sudo make start
```

Applies (in order): namespace, configmaps (wallets, bonds, per-node), PVCs, Services, bootstrap TLS secret, bootstrap StatefulSet (waits for ready), validators + observer StatefulSets.

### 3. Start monitoring

```bash
sudo make monitoring-start
```

Applies: monitoring namespace, Node Exporter, Prometheus, Loki, Promtail, Firefly Exporter, Grafana.
Waits for Grafana rollout, then imports dashboards via `monitoring/import-dashboards.sh`.

### 4. Build and start APIs

```bash
sudo make api-build   # builds management-api Docker image, imports into k3s
sudo make api-start   # deploys the service
```

---

## Chain Nodes

### Bootstrap node

- **StatefulSet**: `bootstrap` (1 replica)
- **Role**: seed peer; validators and observer connect to it on startup
- **Key**: EC P-256 TLS key in `bootstrap-tls` secret; node ID = keccak256 of public key coordinates
- **Config**: `configmap-bootstrap.yaml` — sets `--bootstrap` flag, TLS key path, network ID

### Validators (1–3)

- **StatefulSet**: `statefulset-validators.yaml` — defines 3 replicas with per-pod env vars
- **Keys**: secp256k1 keypairs; public key = validator identity in bonding config
- **Bonding**: `configmap-bonds.yaml` — initial bond amounts for each validator public key
- **Autopropose**: controlled by `AUTOPROPOSE` variable (default: 1 = enabled); set `AUTOPROPOSE=0` to disable

### Observer

- **StatefulSet**: `statefulset-observer.yaml` (1 replica)
- **Role**: read-only node; does not participate in consensus
- **Use for**: exploratory deploys, block queries, status checks without affecting consensus

### Port layout

See [ports.md](ports.md) for full port reference.

### PVCs

Each node has a dedicated PVC (`local-path` storage class, 10Gi) for blockchain data. Defined in `pvcs.yaml` + `pvc-node0.yaml`.

**Warning**: `make stop` deletes the entire `asi-chain` namespace including PVCs — all chain data is lost.

---

## ConfigMaps

| File | Contents |
|------|----------|
| `configmap-wallets.yaml` | Initial wallet addresses |
| `configmap-bonds.yaml` | Validator bond amounts (uses `REPLACE_V{1,2,3}_PUBKEY` placeholders) |
| `configmap-bootstrap.yaml` | Bootstrap node config |
| `configmap-validator{1,2,3}.yaml` | Per-validator config + private key |
| `configmap-observer.yaml` | Observer node config |
| `configmap-common.yaml` | Shared config applied to all nodes |

Placeholders (`REPLACE_ME`, `REPLACE_V1_PUBKEY`, etc.) are substituted by `make start` via `sed`.

---

## Monitoring Stack

All components run in the `monitoring` namespace.

### Prometheus

- **File**: `monitoring/prometheus.yaml`
- **NodePort**: 30090
- **Config**: scrapes Firefly Exporter + Node Exporter; remote write receiver enabled; `native-histograms` feature flag enabled
- **Retention**: 30 days
- **Remote write receiver**: `http://prometheus.monitoring.svc.cluster.local:9090/api/v1/write` — used by k6 to push metrics

### Grafana

- **File**: `monitoring/grafana.yaml`
- **NodePort**: 30080 (admin/admin)
- **Dashboards provisioned via ConfigMaps**:
  - `grafana-dashboard-firefly` — blockchain metrics (block number, validation time)
  - `grafana-dashboard-k6-report` — k6 test reports per `testid`
- **Datasources**: Prometheus (`uid: prometheus`), Loki (`uid: loki`)
- **Annotations**: Grafana stores test run annotations in SQLite — persist independently of Prometheus retention

### Loki

- **File**: `monitoring/loki.yaml`
- **Internal only**: `http://loki.monitoring.svc.cluster.local:3100`
- **Storage**: local filesystem PVC

### Promtail

- **File**: `monitoring/promtail.yaml`
- **DaemonSet** — runs on every node
- **Collects**: container logs from `/var/log/pods/` via pod UID glob
- **Pipeline**: `cri: {}` stage parses containerd CRI log format
- **Labels**: `namespace`, `pod`, `container` extracted from Kubernetes metadata

### Node Exporter

- **File**: `monitoring/node-exporter.yaml`
- **DaemonSet** — exposes host CPU, memory, disk, network metrics
- **Used by**: Grafana "Node Resources" panels in k6 test report dashboard

### Firefly Exporter

- **File**: `monitoring/firefly-exporter.yaml`
- **Scrapes**: validator HTTP APIs → `firefly_node_latest_block_number`, block validation time recording rules

---

## Management API

- **Location**: `management-api/`
- **Image**: `management-api:latest` (built from `management-api/Dockerfile`)
- **NodePort**: 30800
- **Swagger UI**: `http://<HOST_IP>:30800/docs`
- **Language**: Python (FastAPI)
- **Capabilities**: validator start/stop/restart, network partitions, node isolation, CPU/memory throttling, latency injection, node chain status, consensus health/lag

---

## Makefile Reference

| Target | Description |
|--------|-------------|
| `make gen` | Generate bootstrap TLS key + validator keypairs → `.env` |
| `make start` | Apply all chain manifests, wait for bootstrap ready |
| `make stop` | Delete `asi-chain` namespace (destroys all data) |
| `make restart` | `stop` then `start` |
| `make status` | `kubectl get pods -n asi-chain -o wide` |
| `make bootstrap-id` | Print `BOOTSTRAP_NODE_ID` from `.env` |
| `make logs-bootstrap` | Follow bootstrap logs |
| `make logs-validator1` | Follow validator1 logs |
| `make logs-validator2` | Follow validator2 logs |
| `make logs-validator3` | Follow validator3 logs |
| `make logs-observer` | Follow observer logs |
| `make monitoring-start` | Apply monitoring stack, wait for Grafana, import dashboards |
| `make monitoring-stop` | Delete `monitoring` namespace |
| `make api-build` | Build + import management-api image |
| `make api-start` | Deploy management-api |
| `make api-stop` | Delete management-api |
| `make logs-api` | Follow management-api logs |

---

## Directory Layout

```
k3s/
├── .env                          # generated keys (gitignored)
├── .certs/                       # bootstrap TLS key (gitignored)
├── Makefile
├── namespace.yaml
├── configmap-*.yaml              # per-node and shared configs
├── pvcs.yaml / pvc-node0.yaml
├── services.yaml / service-node0.yaml
├── statefulset-bootstrap.yaml
├── statefulset-validators.yaml
├── statefulset-observer.yaml
├── ports.md
├── setup.md                      # this file
├── k6.md
├── monitoring/
│   ├── namespace.yaml
│   ├── prometheus.yaml
│   ├── grafana.yaml              # includes dashboard ConfigMaps
│   ├── loki.yaml
│   ├── promtail.yaml
│   ├── node-exporter.yaml
│   ├── firefly-exporter.yaml
│   └── import-dashboards.sh
├── management-api/
│   ├── Dockerfile
│   ├── deploy.yaml
│   └── *.py
├── k6/
│   ├── Dockerfile
│   ├── job.yaml
│   └── src/
└── k6-ext/                       # xk6 Go extension
    ├── go.mod
    ├── module.go
    ├── sign.go
    ├── terms.go
    └── blocks.go
```
