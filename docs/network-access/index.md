# Network Access

This section provides addresses and endpoints required to access the ASI:Chain network.

## Block Explorer Address

You can browse the testnet using the public explorer:

**Explorer URL**:  
[http://44.198.8.24:5173/](http://44.198.8.24:5173/)

The explorer fetches live data from the network via an Observer Node.

## Bootstrap Node Endpoint

To connect a node to the testnet, use the following bootstrap address:

```text
rnode://138410b5da898936ec1dc13fafd4893950eb191b@44.198.8.24?protocol=40400&discovery=40404
```

Use this in your configuration or `--bootstrap` command line parameter.

## Validator Endpoints

Used for peer discovery and validator communication:

```text
Validator #1: rnode://46412097b9895ccf786c84d8db3a91ec80762a8e@44.198.8.24?protocol=40410&discovery=40414
Validator #2: rnode://992703c92b5ea37e27256a687cdb68d8b182badf@44.198.8.24?protocol=40420&discovery=40424
Validator #3: rnode://67676f0954467aa3507f36fe801b8ec12370501@44.198.8.24?protocol=40430&discovery=40434
Validator #4: rnode://73992afad92256bcc914836c40decccdbd0048d4@44.198.8.24?protocol=40440&discovery=40444
```

## API Access

These ports are typically used by RNode:

- **gRPC External**: 40401
- **gRPC Internal**: 40402
- **HTTP API**: 40403
- **Admin HTTP**: 40405

HTTP API endpoints:
- `/status`
- `/deploy`
- `/blocks`
- `/query`
- WebSocket: `/ws`

For instructions on generating your own validator keypair, see [Address Generation](/network-access/address-generation/).
