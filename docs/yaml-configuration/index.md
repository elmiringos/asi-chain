# YAML File Source

This section describes where the Docker Compose YAML files for ASI:Chain nodes come from and how they are structured.

## Source of YAML Files

YAML configuration files are provided in the `docker/` directory of the official ASI:Chain repository:

```bash
git clone https://github.com/F1R3FLY-io/f1r3fly.git
cd f1r3fly/docker
```

The following YAML files define how different node types are launched:

- `shard.yml` — launches bootstrap and initial validator nodes
- `observer.yml` — launches a read-only observer node
- `validator.yml` (custom or copied) — launches an external validator

These files are structured for use with Docker Compose.

## Associated Configuration Files

Each YAML file references the following types of configuration:

- `.env` file — environment variables such as public IP or private keys
- `.conf` file — internal node settings (API ports, validator keys, etc.)
- Mounted volumes — to persist chain data and certificates

Example volume section:
```yaml
volumes:
  - ./data/validator:/var/lib/rnode/
  - ./conf/validator.conf:/var/lib/rnode/rnode.conf
  - ./conf/validator.certificate.pem:/var/lib/rnode/node.certificate.pem
  - ./conf/validator.key.pem:/var/lib/rnode/node.key.pem
  - ./conf/logback.xml:/var/lib/rnode/logback.xml
```

## Next

See [YAML Parameters & Examples](/yaml-configuration/parameters/) for detailed explanation of YAML fields and configuration use cases.
