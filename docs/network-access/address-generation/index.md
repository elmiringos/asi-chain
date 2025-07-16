# RNode Address Generation

This guide describes how to generate a wallet key pair required to run a validator or interact with the ASI:Chain network.

## Purpose

RNode requires a public/private key pair for:
- Bonding your validator
- Signing blocks and deploys
- Accessing wallet functionality

## Wallet Generator

We provide a CLI tool to generate your own key pair.

### Steps:

1. Clone the wallet generator repository:
```bash
git clone https://github.com/asi-alliance/asi-chain.git
cd asi-chain/wallet-generator
```

2. Build the tool (if needed) or run the provided script.

You will obtain two values:
- `PRIVATE_KEY`
- `PUBLIC_KEY`

These are required in `.env`, `.conf`, and bonding commands.

## Example `.env` Variables

```env
VALIDATOR_PRIVATE_KEY=<YOUR_GENERATED_PRIVATE_KEY>
VALIDATOR_HOST=<YOUR_PUBLIC_IP>
```

## Example `.conf` Snippet

```hocon
casper {
  validator-public-key = <YOUR_GENERATED_PUBLIC_KEY>
  validator-private-key = <YOUR_GENERATED_PRIVATE_KEY>
}
```

Do not share your private key. Keep it secure.

---

Once you have generated the keys, proceed to configure your validator using [Validator Setup](/node-image/validator/).
