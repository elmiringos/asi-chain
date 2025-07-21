# Check Balance

This guide explains how to check your wallet balance using the ASI:Chain HTTP API.

## Requirements
- Access to an observer node (running and synced)
- Wallet public key or REV address

## Query Method

Use the `/explore-deploy` endpoint to query wallet state.

### Example Command
```bash
curl -X POST http://localhost:40403/explore-deploy \
  -H 'Content-Type: application/json' \
  -d '{
    "term": "new rl(`rho:registry:lookup`) in { rl!(\"rho:rchain:revVault\") }"
  }'
```

> Adjust the query term if you want to look up a specific vault by address.

## Notes
- You must escape double quotes properly inside JSON payloads
- Ensure your observer node is synced with the latest block height

---

For more advanced interaction, see:
- [Deploying Contracts](/interaction-examples/smart-contracts/)
- [Viewing Blocks](/interaction-examples/block-history/)
