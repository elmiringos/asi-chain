# YAML Parameters & Examples

This page provides a breakdown of parameters used in YAML files for ASI:Chain node deployment. Each section defines key fields and their purpose.

## Container Section

```yaml
container_name: validator1
```
- Custom name for the container
- Useful for logging and volume path referencing

---

## Command Section

```yaml
command: ["--bootstrap=rnode://<PEER_ID>@<HOST>?protocol=40400&discovery=40404"]
```
- Defines CLI arguments passed to `rnode`
- Use to set bootstrap peer connection string

---

## Ports Section

```yaml
ports:
  - "40400:40400"   # Protocol
  - "40401:40401"   # gRPC External
  - "40402:40402"   # gRPC Internal
  - "40403:40403"   # HTTP API
```
- Map internal RNode ports to host
- Must match `.conf` file configuration

---

## Volumes Section

```yaml
volumes:
  - ./data/validator:/var/lib/rnode/
  - ./conf/validator.conf:/var/lib/rnode/rnode.conf
```
- Maps local files and directories into the container
- Required to persist blockchain data and load configuration

---

## Environment File (`.env`)

Used to inject private validator keys and IP address without hardcoding them in YAML or conf.

```env
VALIDATOR_PRIVATE_KEY=xyz...
VALIDATOR_HOST=192.168.1.100
```

In `.conf` you can reference this with:
```hocon
host = ${?VALIDATOR_HOST}
```

---

## Certificate Auto-Generation

To allow RNode to auto-generate TLS certificates, **comment out** these lines in the YAML file:
```yaml
# ./conf/validator.certificate.pem
# ./conf/validator.key.pem
```
This is useful when adding a new external validator to avoid reusing static keys.

---

## Example Minimal Validator YAML

```yaml
version: '3.9'
services:
  rnode:
    image: f1r3flyindustries/f1r3fly-scala-node:latest
    container_name: validator-custom
    ports:
      - "40400:40400"
      - "40401:40401"
    volumes:
      - ./data/validator-custom:/var/lib/rnode/
      - ./conf/validator.conf:/var/lib/rnode/rnode.conf
    command:
      - "--bootstrap=rnode://138410b5da898936ec1dc13fafd4893950eb191b@44.198.8.24?protocol=40400&discovery=40404"
```

For full node configuration, see [Node Services & Parameters](/network-configuration/parameters/).
