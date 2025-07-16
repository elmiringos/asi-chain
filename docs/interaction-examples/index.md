# Interaction Scenarios

This section demonstrates common actions you can perform on the ASI:Chain network after your node is running.

These examples assume you have a validator or observer node running and access to the CLI.

## Available Interactions

### 1. Deploy a Smart Contract
Submit a `.rho` file to a validator node.
```bash
cargo run -- deploy -f ../rholang/examples/stdout.rho -p 40412
```

### 2. View Block History
Query finalized blocks from your observer node:
```bash
curl http://localhost:40403/blocks
```

### 3. Check Balance
```bash
curl -X POST http://localhost:40403/explore-deploy \
  -H 'Content-Type: application/json' \
  -d '{ "term": "new rl(`rho:registry:lookup`) in { rl!("rho:rchain:revVault") }" }'
```

---

## Requirements

- Local or remote RNode instance must be running
- Ensure `cargo` CLI and contract files are accessible
- HTTP API should be enabled (`40403` by default)

---

See detailed usage in:
- [Smart Contract Guide](/interaction-examples/smart-contracts/)
- [Block History](/interaction-examples/block-history/)
- [Balance Check](/interaction-examples/balance-check/)
