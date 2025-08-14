# Observer Node Setup

This guide describes how to deploy an Observer Node on the ASI:Chain network.
Observer nodes are used to monitor the blockchain state without participating in consensus.

## Purpose of Observer Node

- Reads and synchronizes blockchain data
- Serves API endpoints for querying blocks, status, balance, etc.
- Does not sign blocks or participate in validator consensus

## Prerequisites

Ensure you meet the basic requirements outlined in [Node Image Source](/node-image/).

## Setup Instructions

### 1. Clone Repository

```bash
git clone https://github.com/F1R3FLY-io/f1r3fly.git
cd f1r3fly/docker
```

### 2. Prepare the `.env` file

In the `docker/` directory, edit or create the `.env` file:

```env
READONLY_HOST=<YOUR_PUBLIC_IP>
```

This sets your public IP address for the observer node.

### 3. Edit `observer.yml`

In the `docker/` directory, locate and edit `observer.yml`.

Update the bootstrap connection string:
```yaml
command: ["--bootstrap=rnode://138410b5da898936ec1dc13fafd4893950eb191b@$BOOTSTRAP_HOST?protocol=40400&discovery=40404"]
```
Replace `$BOOTSTRAP_HOST` with the actual IP of the bootstrap node.

### 4. Launch Observer

```bash
docker compose -f observer.yml up -d
```

### 5. Check Logs

```bash
docker compose -f observer.yml logs -f
```

You should see logs similar to the following:

```
rnode.readonly  | Approved state for block Block #0 (b22fa19038...) with empty parents (supposedly genesis) is successfully restored.
rnode.readonly  | Received ForkChoiceTipRequest from rnode.validator1
rnode.readonly  | Sending tips [b22fa19038...] to rnode.validator1
```

This indicates that your observer node is successfully syncing and communicating with the network.

## Next Steps

Once the observer is running, you can query the node using HTTP or WebSocket APIs to retrieve chain data.

For validator setup, see [Validator Setup](/node-image/validator/).
