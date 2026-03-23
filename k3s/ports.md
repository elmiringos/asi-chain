# Ports

## Node ports (inside cluster)

| Port  | Protocol | Name        | Description                        |
|-------|----------|-------------|------------------------------------|
| 40400 | TCP      | p2p         | P2P transport (inter-node comms)   |
| 40401 | TCP      | grpc-ext    | gRPC API (external clients)        |
| 40402 | TCP      | grpc-int    | gRPC API (internal, admin)         |
| 40403 | TCP      | http        | HTTP REST API                      |
| 40404 | TCP      | kademlia    | Peer discovery (Kademlia DHT)      |
| 40405 | TCP      | http-admin  | HTTP admin API                     |

## NodePort mapping (external access)

| Node       | HTTP :40403 | gRPC-ext :40401 | gRPC-int :40402 |
|------------|-------------|-----------------|-----------------|
| bootstrap  | 30003       | 30001           | 30002           |
| validator1 | 30013       | 30011           | 30012           |
| validator2 | 30023       | 30021           | 30022           |
| validator3 | 30033       | 30031           | 30032           |
| observer   | 30053       | 30051           | —               |

## Usage

For external queries use **observer** — it is read-only and does not affect consensus.

```bash
# Node status
curl http://<HOST_IP>:30053/status

# Latest blocks
curl http://<HOST_IP>:30053/blocks/1

# Block by hash
curl http://<HOST_IP>:30053/block/<BLOCK_HASH>

# gRPC (node CLI)
cargo run -- status --host <HOST_IP> --port 30051
cargo run -- exploratory-deploy -f query.rho --host <HOST_IP> --port 30051
```

For deploys and propose use any **validator** (e.g. port 30011 / 30013).

## Monitoring NodePorts

| Service            | NodePort |
|--------------------|----------|
| Grafana            | 30080    |
| Prometheus         | 30090    |
| Management API     | 30800    |

Loki доступен только внутри кластера (используется Grafana и Promtail).

## Firewall

NodePorts must be open on the host machine:

```bash
sudo ufw allow 30051/tcp   # observer gRPC
sudo ufw allow 30053/tcp   # observer HTTP
```

Or via SSH tunnel without opening ports:

```bash
ssh -L 40403:localhost:30053 ubuntu@<HOST_IP>
curl http://localhost:40403/status
```
