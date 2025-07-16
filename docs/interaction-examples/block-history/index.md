# View Block History

You can inspect recent and historical blocks using the HTTP API or CLI.

## Using HTTP API

To list recent blocks:
```bash
curl http://localhost:40403/blocks
```

This will return JSON containing:
- Block hash
- Timestamp
- Proposer address
- Parent hash

You can filter or parse this using `jq` or other tools.

## Using CLI (if available)

If your CLI includes `bonds` or `is-finalized`, you can use commands like:
```bash
cargo run -- is-finalized -b <block_hash>
```

This checks if the block is finalized in the consensus process.

---

## Explorer Alternative

To visually explore block history, use:
[http://44.198.8.24:5173/](http://44.198.8.24:5173/)

---

For smart contract deployment, see [Smart Contracts](/interaction-examples/smart-contracts/).
