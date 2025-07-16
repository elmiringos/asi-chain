# ASI:Chain - Become chain validator

1. Setup `.env`, `validator.yml`, `conf/validator.conf` by guide

2. Launch your own chain validator node:

```bash
docker compose -f validator.yml up -d
```

3. Check your node status:

```bash
docker compose <CONTRAINER_ID> logs -f
```
