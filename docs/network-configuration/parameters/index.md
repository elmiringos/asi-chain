# Network Parameters

This section outlines the core parameters and services used in the ASI:Chain network configuration.

## Validator Configuration

- **Minimum Validators**: 2
- **Bootstrap Validator**: One validator acts as the initial bootstrap node
- **Validator Keys**: Stored in `wallet.txt` or specified via `.conf`
- **Thresholds**:
  - `fault-tolerance-threshold`
  - `synchrony-constraint-threshold`

## Node Services and Ports

### gRPC and HTTP API
- gRPC External: 40401
- gRPC Internal: 40402
- HTTP API: 40403
- Admin HTTP: 40405

### WebSocket API
- `/ws` endpoint for real-time updates

### Prometheus Metrics
- Port: 9090
- Enabled via `metrics.enabled = true`

## Consensus Engine (Casper)
- Uses CBC Casper
- Requires bonding with CLI
- Validates using key pair configured in:
```hocon
casper {
  validator-public-key = "..."
  validator-private-key = "..."
}
```

## Storage
- Backend: MapDB (RSpace)
- Configurable: `max-db-size`, `cache-size`

## Autopropose Mode
- Enabled via `autopropose = true`
- Allows block creation without manual propose commands

## Development Mode
- `dev-mode = true` disables certain checks for local/testing purposes

## Peer Discovery
- Configurable intervals:
  - `heartbeat`
  - `lookup-interval`
  - `cleanup-interval`

## Logging
- Log level: `info`, `debug`, `warn`
- Output targets: file, console

For a visual overview, see [Network Topology](/network-configuration/topology/).
