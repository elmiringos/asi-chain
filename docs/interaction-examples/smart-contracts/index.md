# Simple Smart Contract

This guide shows how to deploy a basic Rholang smart contract to the ASI:Chain testnet.

## Requirements

- A validator node running and accessible
- A `.rho` contract file (e.g. `stdout.rho`)
- CLI available with `cargo run` or compiled binary

---

## Example Contract

The following example writes to the node’s standard output:
```rholang
new stdout(`rho:io:stdout`) in {
  stdout!("Hello, ASI:Chain!")
}
```

Save this to `stdout.rho` or use the example file in `rholang/examples/`.

---

## Deploy Command

Use the CLI to deploy the contract:
```bash
cargo run -- deploy -f ../rholang/examples/stdout.rho -p 40412
```

- `-f` — path to the `.rho` contract
- `-p` — port of the target validator node

---

## Verifying Execution

Check the logs of your validator node:
```bash
docker compose -f validator.yml logs -f
```

Look for output similar to:
```
Hello, ASI:Chain!
```

---

For more interaction options, return to [Interaction Scenarios](/interaction-examples/).
