# Network Topology

This section visualizes the ASI:Chain testnet topology and provides a brief description of each node role.

## Topology Diagram

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Bootstrap  │ ──▶│ Validator 1 │ ──▶ │ Validator 2 │
│  (Genesis)  │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Validator 3 │ ──▶│ Validator 4 │ ──▶ │  Observer   │
│             │     │  (Extra)    │     │ (Read-only) │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Node Roles

### Bootstrap Node
- First node in the network
- Acts as the entry point for new peers
- Does **not** participate in consensus

### Validator Nodes
- Sign, propose, and finalize blocks
- Can be launched from inside the cluster or externally

### Observer Node
- Read-only access
- No participation in consensus
- Powers the block explorer and monitoring tools

## Notes
- Validator bonding requires CLI bonding transaction
- Nodes are connected through RNode's built-in peer discovery

Continue to [Quick Start Guide](/quick-start/) to learn how to join this topology.
