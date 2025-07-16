# Network Configuration

This section describes the current configuration of the ASI:Chain testnet, including node types, addresses, and bonding status.

## Overview

The testnet is running a custom blockchain based on the F1R3FLY stack.

### Nodes Deployed:
- 1 Bootstrap Node
- 4 Validator Nodes
- 1 Observer Node

### Node Topology:
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Bootstrap  │ ──▶ │ Validator 1 │ ──▶ │ Validator 2 │
│  (Genesis)  │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Validator 3 │ ──▶ │ Validator 4 │ ──▶ │  Observer   │
│             │     │  (Extra)    │     │ (Read-only) │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Node Address Summary

```text
Bootstrap:
  rnode://138410b5da898936ec1dc13fafd4893950eb191b@44.198.8.24?protocol=40400&discovery=40404

Validator 1:
  rnode://46412097b9895ccf786c84d8db3a91ec80762a8e@44.198.8.24?protocol=40410&discovery=40414

Validator 2:
  rnode://992703c92b5ea37e27256a687cdb68d8b182badf@44.198.8.24?protocol=40420&discovery=40424

Validator 3:
  rnode://67676f0954467aa3507f36fe801b8ec12370501@44.198.8.24?protocol=40430&discovery=40434

Validator 4:
  rnode://73992afad92256bcc914836c40decccdbd0048d4@44.198.8.24?protocol=40440&discovery=40444
```

## External Validators

External validator support is in testing. Full onboarding instructions will be added once validated.

To learn about network parameters and validator bonding settings, continue to [Network Parameters](/network-configuration/parameters/).
