# Node Image Source

## Overview

ASI\:Chain is powered by a flexible Docker-based infrastructure that supports multiple node roles within the **MettaCycle** network — a decentralized logical network built on blockchain principles.

Each participant in the network is represented by a **node**, which can be hosted either locally or remotely. Nodes can assume one of three roles depending on their purpose and configuration.

## Node Types

### Bootstrap Node

Acts as the **initial entry point** to the network. It maintains a minimal peer list and shares it with newcomers.

* Does **not** participate in consensus or validate blocks.
* Can be run as a standalone node or co-located with a validator.
* Configured via the `--bootstrap` flag or by starting first in the network.

>[!NOTE]
> At least one bootstrap node is required for other nodes to join the network.
> If none is explicitly defined, a validator can also act as a bootstrap node.

---

### Validator Node

Responsible for **consensus participation**, **block validation**, and **finalization**.

* Connects to a bootstrap node during startup using the `--bootstrap` flag.
* May also serve as a bootstrap node itself, if needed.
* Must be registered in the network at genesis via its public key.

>[!TIP]
> To include a validator at launch, its public key must be added to the [`wallet.txt`](https://github.com/asi-alliance/asi-chain/blob/master/testnet-wallets.txt) configuration.

---

### Observer Node

A **read-only** node used for monitoring and accessing blockchain data.

* Does not sign or propose blocks.
* Useful for running explorers, APIs, or passive listeners.
* Fully synchronizes the chain state from the network.

## Minimum Network Requirements

To form a functional ASI\:Chain network:

* At least **2 validator nodes** are required to maintain consensus.
* One of them should **also act as the bootstrap node** if no separate bootstrap node is defined.

## Docker Image Source

All node types share a single official Docker image:

```bash
f1r3flyindustries/f1r3fly-scala-node:latest
```

This image is referenced across all Compose configurations, including:

* `validator.yml`
* `observer.yml`
* `bootstrap.yml`
* `shard.yml`

## Related Setup Guides

* [Validator Node Setup](/node-image/validator/)
