import asyncio
import logging
from typing import List

import httpx
from fastapi import FastAPI, HTTPException
from kubernetes.client.rest import ApiException

import k8s_ops as k8s
from models import (
    ValidatorStatus,
    PartitionRequest,
    PartitionInfo,
    ThrottleRequest,
    LatencyRequest,
    NodeK8sStatus,
    NodeChainStatus,
    ConsensusNodeState,
    ConsensusHealth,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="ASI-Chain Management API",
    description="HTTP control plane for chaos and load testing of the f1r3fly blockchain cluster",
    version="1.0.0",
)

NODE_BASE_URLS = {
    "bootstrap":  "http://bootstrap-0.bootstrap.asi-chain.svc.cluster.local:40403",
    "validator1": "http://validator1-0.validator1.asi-chain.svc.cluster.local:40403",
    "validator2": "http://validator2-0.validator2.asi-chain.svc.cluster.local:40403",
    "validator3": "http://validator3-0.validator3.asi-chain.svc.cluster.local:40403",
    "validator4": "http://validator4-0.validator4.asi-chain.svc.cluster.local:40403",
    "validator5": "http://validator5-0.validator5.asi-chain.svc.cluster.local:40403",
    "validator6": "http://validator6-0.validator6.asi-chain.svc.cluster.local:40403",
    "observer":   "http://observer-0.observer.asi-chain.svc.cluster.local:40403",
}


def _raise_if_k8s_error(e: ApiException, detail: str):
    if e.status == 404:
        raise HTTPException(status_code=404, detail=detail)
    if e.status == 409:
        raise HTTPException(status_code=409, detail="Resource already exists")
    raise HTTPException(status_code=500, detail=str(e))


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok"}


@app.get("/validators", response_model=List[ValidatorStatus], tags=["validators"])
def list_validators():
    return k8s.list_validators()


@app.post("/validators/{name}/start", tags=["validators"])
def start_validator(name: str):
    try:
        k8s.scale_validator(name, replicas=1)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Validator '{name}' not found")
    return {"name": name, "action": "started"}


@app.post("/validators/{name}/stop", tags=["validators"])
def stop_validator(name: str):
    try:
        k8s.scale_validator(name, replicas=0)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Validator '{name}' not found")
    return {"name": name, "action": "stopped"}


@app.post("/validators/{name}/restart", tags=["validators"])
def restart_validator(name: str):
    try:
        k8s.restart_validator(name)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Pod '{name}-0' not found")
    return {"name": name, "action": "restarted"}


@app.post("/partitions", response_model=PartitionInfo, tags=["network"])
def create_partition(req: PartitionRequest):
    overlap = set(req.group_a) & set(req.group_b)
    if overlap:
        raise HTTPException(status_code=400, detail=f"Nodes in both groups: {overlap}")
    try:
        k8s.create_partition(req.id, req.group_a, req.group_b)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Failed to create partition '{req.id}'")
    return {"id": req.id, "policies": [
        f"partition-{req.id}-{n}" for n in req.group_a + req.group_b
    ]}


@app.get("/partitions", response_model=List[PartitionInfo], tags=["network"])
def list_partitions():
    return k8s.list_partitions()


@app.delete("/partitions/{partition_id}", tags=["network"])
def delete_partition(partition_id: str):
    try:
        k8s.delete_partition(partition_id)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Partition '{partition_id}' not found")
    return {"id": partition_id, "action": "deleted"}


@app.post("/nodes/{name}/isolate", tags=["network"])
def isolate_node(name: str):
    try:
        k8s.isolate_node(name)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Failed to isolate '{name}'")
    return {"name": name, "action": "isolated"}


@app.delete("/nodes/{name}/isolate", tags=["network"])
def unisolate_node(name: str):
    try:
        k8s.unisolate_node(name)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Node '{name}' is not isolated")
    return {"name": name, "action": "unisolated"}


@app.post("/nodes/{name}/throttle", tags=["chaos"])
def throttle_node(name: str, req: ThrottleRequest):
    try:
        k8s.throttle_node(name, req.cpu, req.memory)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Node '{name}' not found")
    return {"name": name, "action": "throttled", "cpu": req.cpu, "memory": req.memory}


@app.delete("/nodes/{name}/throttle", tags=["chaos"])
def unthrottle_node(name: str):
    try:
        k8s.unthrottle_node(name)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Node '{name}' not found")
    return {"name": name, "action": "unthrottled"}


@app.post("/nodes/{name}/latency", tags=["chaos"])
def inject_latency(name: str, req: LatencyRequest):
    try:
        k8s.inject_latency(name, req.delay_ms, req.jitter_ms)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"tc exec failed: {e}")
    return {"name": name, "action": "latency_injected", "delay_ms": req.delay_ms, "jitter_ms": req.jitter_ms}


@app.delete("/nodes/{name}/latency", tags=["chaos"])
def remove_latency(name: str):
    try:
        k8s.remove_latency(name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"tc exec failed: {e}")
    return {"name": name, "action": "latency_removed"}


@app.get("/nodes/{name}/status", response_model=NodeChainStatus, tags=["observability"])
async def node_status(name: str):
    url = NODE_BASE_URLS.get(name)
    if not url:
        raise HTTPException(status_code=404, detail=f"Unknown node '{name}'")
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.get(f"{url}/status")
            data = resp.json()
            return NodeChainStatus(
                name=name,
                reachable=True,
                version=data.get("version"),
                peers=data.get("peers"),
                nodes=data.get("nodes"),
            )
        except Exception:
            return NodeChainStatus(name=name, reachable=False)


@app.get("/nodes/{name}/k8s-status", response_model=NodeK8sStatus, tags=["observability"])
def node_k8s_status(name: str):
    return k8s.get_pod_status(name)


@app.get("/consensus/health", response_model=ConsensusHealth, tags=["observability"])
async def consensus_health():
    nodes = await _fetch_consensus_states()
    finalized = [n.finalized_block for n in nodes if n.finalized_block is not None]
    in_sync = len(set(finalized)) <= 1
    lags = [n.lag for n in nodes if n.lag is not None]
    return ConsensusHealth(
        nodes=nodes,
        finalized_in_sync=in_sync,
        max_lag=max(lags) if lags else None,
    )


@app.get("/consensus/lag", tags=["observability"])
async def consensus_lag():
    nodes = await _fetch_consensus_states()
    return [
        {"name": n.name, "latest_block": n.latest_block, "finalized_block": n.finalized_block, "lag": n.lag}
        for n in nodes
    ]


async def _fetch_consensus_states() -> list[ConsensusNodeState]:
    async def fetch_one(name: str, base_url: str) -> ConsensusNodeState:
        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                blocks_resp, fin_resp = await asyncio.gather(
                    client.get(f"{base_url}/api/blocks"),
                    client.get(f"{base_url}/api/last-finalized-block"),
                )
                latest = blocks_resp.json()[0].get("blockNumber") if blocks_resp.status_code == 200 else None
                fin_data = fin_resp.json() if fin_resp.status_code == 200 else {}
                fin_block = fin_data.get("blockInfo", {}).get("blockNumber")
                fin_ft = fin_data.get("blockInfo", {}).get("faultTolerance")
                lag = (latest - fin_block) if (latest is not None and fin_block is not None) else None
                return ConsensusNodeState(
                    name=name, reachable=True,
                    latest_block=latest, finalized_block=fin_block,
                    fault_tolerance=fin_ft, lag=lag,
                )
            except Exception:
                return ConsensusNodeState(name=name, reachable=False)

    tasks = [
        fetch_one(name, url)
        for name, url in NODE_BASE_URLS.items()
        if name != "observer"
    ]
    return await asyncio.gather(*tasks)
