#!/usr/bin/env python3
"""Generate wallets ConfigMap YAML from .env file.
Usage: python3 scripts/gen-wallets-configmap.py <namespace>
"""
import sys

namespace = sys.argv[1] if len(sys.argv) > 1 else "asi-chain"

env_vars = {}
try:
    with open(".env") as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env_vars[k] = v
except FileNotFoundError:
    pass

lines = [
    "apiVersion: v1",
    "kind: ConfigMap",
    "metadata:",
    "  name: wallets",
    f"  namespace: {namespace}",
    "data:",
    "  wallets.txt: |",
]

for i in range(1, 5):
    addr = env_vars.get(f"VALIDATOR{i}_WALLET_ADDR", "")
    if addr:
        lines.append(f"    {addr},9000000000000000000")

for i in range(1, 100):
    addr = env_vars.get(f"K6_WALLET{i}_WALLET_ADDR", "")
    if not addr:
        break
    lines.append(f"    {addr},1000000000000000000")

print("\n".join(lines))
