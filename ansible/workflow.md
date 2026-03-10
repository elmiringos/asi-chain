# ASI-Chain — Ansible Workflow

Managing dev and devnet networks via Ansible.

---

## Network Topology

### Dev

| Server | What runs there |
|---|---|
| mettacycle-server-1 | validator1 (node1), validator2 (node2) — single `v1-v2.yml` |
| mettacycle-server-2 | bootstrap (node0), validator3 (node3), deployer script |
| mettacycle-server-4 | observer (node5) |

### Devnet

| Server | What runs there |
|---|---|
| mettacycle-devnet-1 | bootstrap (node0), deployer bot |
| mettacycle-devnet-2 | validator1 (node0, dev-mode) |
| mettacycle-devnet-3 | validator2 (node0) |
| mettacycle-devnet-4 | validator3 (node0) |

---

## Setup

### 1. Fill in IP addresses in the inventory

```
inventory/dev.ini
inventory/devnet.ini
```

Replace `REPLACE_IP` with the actual server addresses.

### 2. Verify SSH access

```bash
ansible -i inventory/dev.ini all -m ping
ansible -i inventory/devnet.ini all -m ping
```

---

## Starting the network

### Dev

```bash
ansible-playbook -i inventory/dev.ini up-dev.yml
```

Steps:
1. **[server-2]** Bootstrap starts, then validator3
2. **[server-1]** validator1 and validator2 start (via `v1-v2.yml`)
3. **[server-1, server-2]** Health check — waits for `MultiParentCasper instance created` in each container's logs (up to 5 minutes)
4. **[server-4]** Observer starts, waits for block sync (up to 4 minutes). On failure — automatically restarts once

### Devnet

```bash
ansible-playbook -i inventory/devnet.ini up-devnet.yml
```

Steps:
1. **[devnet-1]** Bootstrap starts
2. **[devnet-2]** validator1 starts
3. **[devnet-3]** validator2 starts
4. **[devnet-4]** validator3 starts
5. **[devnet-1,2,3,4]** Health check — waits for `MultiParentCasper instance created` on all nodes (up to 5 minutes)
6. **[devnet-1]** Deployer bot starts

---

## Stopping the network

### Dev

```bash
ansible-playbook -i inventory/dev.ini down-dev.yml
```

Steps:
1. All nodes and observer are stopped (`docker compose down`)

> Container logs are written automatically via logback in the node directories.

### Devnet

```bash
ansible-playbook -i inventory/devnet.ini down-devnet.yml
```

Steps:
1. Deployer bot is stopped
2. All nodes are stopped (`docker compose down`)
3. `data/` folders are wiped in each node's directory

---

## File structure

```
ansible/
├── inventory/
│   ├── dev.ini                  # IP addresses for dev servers
│   └── devnet.ini               # IP addresses for devnet servers
│
├── group_vars/
│   ├── all.yml                  # Shared timeouts
│   ├── dev_server1.yml          # compose_jobs and containers for server-1
│   ├── dev_server2.yml          # compose_jobs and containers for server-2
│   ├── dev_server4.yml          # compose_jobs and containers for server-4
│   ├── devnet_bootstrap.yml     # compose_jobs, deployer, data_dirs
│   ├── devnet_val1.yml          # compose_jobs, data_dirs
│   ├── devnet_val2.yml          # compose_jobs, data_dirs
│   └── devnet_val3.yml          # compose_jobs, data_dirs
│
├── tasks/                       # Reusable task blocks
│   ├── start_nodes.yml          # docker compose up per compose_jobs
│   ├── stop_nodes.yml           # docker compose down per compose_jobs
│   ├── health_check_casper.yml  # grep MultiParentCasper with retries
│   ├── health_check_observer.yml# grep Approved with retries + auto-restart
│   ├── cleanup_data.yml         # rm -rf data/* per data_dirs
│   └── log_trail.yml            # append operation entry to logs/operations.log
│
├── up-dev.yml                   # Start dev network
├── down-dev.yml                 # Stop dev network
├── up-devnet.yml                # Start devnet network
└── down-devnet.yml              # Stop devnet network
```

---

## Adding a new server or node

1. Add the host to the appropriate `inventory/*.ini` in the correct group
2. Create `group_vars/<group_name>.yml` with `compose_jobs`, `local_containers`, and (for devnet) `data_dirs`
3. Add a step to the relevant playbook (`up-*.yml` / `down-*.yml`)

---

## Diagnostics

**Check that Casper is up on a node:**
```bash
docker logs <container> | grep "MultiParentCasper instance created"
```

**Check that blocks are being produced:**
```bash
docker logs <container> | grep "block number"
```

**Check logs for errors (indented lines):**
```bash
docker logs <container> 2>&1 | grep "^  "
```

**View operation trail:**
```bash
cat ansible/logs/operations.log
```
