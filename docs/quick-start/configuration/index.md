# Configuration Guide

This section explains how to customize and edit the configuration files used for ASI:Chain node deployment.

## Configuration Files Overview

- `.env` — Environment-specific variables like public IP or validator keys
- `.conf` — RNode application config (HOCON format)
- `validator.yml` / `observer.yml` — Docker Compose service definitions

---

## 1. .env File

Used to separate secrets and IP addresses from YAML/CONF files.

```env
VALIDATOR_HOST=203.0.113.101
VALIDATOR_PRIVATE_KEY=deadbeef123...
```

Referenced from `.conf` using:
```hocon
host = ${?VALIDATOR_HOST}
```

---

## 2. .conf File

Configuration for internal node logic:

```hocon
api-server {
  host = ${?VALIDATOR_HOST}
  port = 40403
}

casper {
  validator-public-key = "..."
  validator-private-key = "..."
  fault-tolerance-threshold = 0.1
  synchrony-constraint-threshold = 0.2
}

tls {
  certificate-path = "node.certificate.pem"
  key-path = "node.key.pem"
}
```

For external validators:
- Set `genesis-validator-mode = false`
- Replace `bootstrap` with a live node address

---

## 3. Docker Compose YAML

Define node container and mounting behavior:

```yaml
services:
  rnode:
    container_name: validator1
    image: f1r3flyindustries/f1r3fly-scala-node:latest
    ports:
      - "40400:40400"
    volumes:
      - ./conf/validator1.conf:/var/lib/rnode/rnode.conf
      - ./data/validator1:/var/lib/rnode/
```

**Note**: Always ensure port values in YAML and `.conf` match.

---

See also:
- [Quick Start Guide](/quick-start/)
- [YAML Parameters](/yaml-configuration/parameters/)
