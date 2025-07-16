# Quick Start Guide

This section provides a step-by-step guide to quickly join the ASI:Chain testnet as an observer or validator node.

## 1. Clone the Repository

```bash
git clone https://github.com/F1R3FLY-io/f1r3fly.git
cd f1r3fly/docker
```

## 2. Prepare Your Environment

Edit or create the `.env` file:
```env
VALIDATOR_HOST=<YOUR_PUBLIC_IP>
VALIDATOR_PRIVATE_KEY=<YOUR_PRIVATE_KEY>
```

This file will be used by your validator or observer YAML config.

## 3. Generate Wallet Keys

Use the [wallet generator](/network-access/address-generation/) tool to create a key pair.
You will need these keys for bonding and configuration.

## 4. Choose Node Type

### Observer Node
Set up `observer.yml` and run:
```bash
docker compose -f observer.yml up -d
```

### Validator Node
Set up `validator.conf` and `validator.yml`, then bond and run:
```bash
cargo run -- bond-validator --private-key <YOUR_PRIVATE_KEY>
docker compose -f validator.yml up -d
```

## 5. Check Logs

Use Docker logs to verify node connection:
```bash
docker compose -f <your-yml> logs -f
```
Look for handshake messages, peer connections, and block sync.

## 6. Verify Connection

- Ensure your node is visible in the explorer (if observer)
- Confirm block proposals and bonding (if validator)

## Next

- [Edit Configuration Files](/quick-start/configuration/)
- [Check Message Sequence](/quick-start/messages/)
- [Troubleshooting Errors](/quick-start/troubleshooting/)
