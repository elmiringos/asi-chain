# Message Exchange Scenarios

This section outlines typical logs and message sequences that occur when connecting a new node to the ASI:Chain network.

Use this as a checklist to verify successful node connection.

---

## Observer Node Logs

### Expected Messages:

```
Approved state for block Block #0 (b22fa19038...) with empty parents (supposedly genesis) is successfully restored.
Received ForkChoiceTipRequest from rnode.validatorX
Sending tips [b22fa19038...] to rnode.validatorX
Peers: 4 or more
```

- ✅ **Genesis state restored** — your node loaded the correct blockchain state
- ✅ **Tip exchange started** — observer is syncing with validators
- ✅ **Peers >= 4** — node is fully connected to the network

---

## Validator Node Logs

### After Bonding:
```
Creating new channel to peer rnode://...
Responded to protocol handshake request from rnode://...
Peers: 4 or more
``` 

- ✅ **Channel creation** — validator found other peers
- ✅ **Handshake** — successful peer registration
- ✅ **Bonded status visible in explorer** (external check)

---

## Tips

- If `Peers` remains below 2, check firewall/NAT issues
- Missing `ForkChoiceTipRequest` logs indicate sync failure
- Ensure `bootstrap` address is reachable and not mistyped

---

Continue to [Common Errors](/quick-start/troubleshooting/) if your node doesn’t appear to connect properly.
