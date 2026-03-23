import asyncio
import logging
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from kubernetes.client.rest import ApiException

import k8s_ops as k8s
from domain import ConsensusView, NetworkPartition, NodeChainState
from models import (
    ConsensusHealthResponse,
    ConsensusNodeResponse,
    LatencyRequest,
    NodeChainStatusResponse,
    PartitionRequest,
    PartitionResponse,
    PodStatusResponse,
    ThrottleRequest,
    ValidatorResponse,
)
from settings import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="ASI-Chain Management API",
    description="HTTP control plane for chaos and load testing of the f1r3fly blockchain cluster",
    version="1.0.0",
)


def _raise_if_k8s_error(e: ApiException, detail: str) -> None:
    if e.status == 404:
        raise HTTPException(status_code=404, detail=detail)
    if e.status == 409:
        raise HTTPException(status_code=409, detail="Resource already exists")
    raise HTTPException(status_code=500, detail=str(e))


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/validators", response_model=list[ValidatorResponse], tags=["validators"])
def list_validators() -> list[ValidatorResponse]:
    return [ValidatorResponse.from_domain(v) for v in k8s.list_validators()]


@app.post("/validators/{name}/start", tags=["validators"])
def start_validator(name: str) -> dict[str, str]:
    try:
        k8s.scale_validator(name, replicas=1)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Validator '{name}' not found")
    return {"name": name, "action": "started"}


@app.post("/validators/{name}/stop", tags=["validators"])
def stop_validator(name: str) -> dict[str, str]:
    try:
        k8s.scale_validator(name, replicas=0)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Validator '{name}' not found")
    return {"name": name, "action": "stopped"}


@app.post("/validators/{name}/restart", tags=["validators"])
def restart_validator(name: str) -> dict[str, str]:
    try:
        k8s.restart_validator(name)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Pod '{name}-0' not found")
    return {"name": name, "action": "restarted"}


@app.post("/partitions", response_model=PartitionResponse, tags=["network"])
def create_partition(req: PartitionRequest) -> PartitionResponse:
    partition = NetworkPartition(id=req.id, group_a=req.group_a, group_b=req.group_b)
    try:
        partition.validate()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    try:
        k8s.create_partition(partition)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Failed to create partition '{req.id}'")
    partition.policies = [f"partition-{req.id}-{n}" for n in req.group_a + req.group_b]
    return PartitionResponse.from_domain(partition)


@app.get("/partitions", response_model=list[PartitionResponse], tags=["network"])
def list_partitions() -> list[PartitionResponse]:
    return [PartitionResponse.from_domain(p) for p in k8s.list_partitions()]


@app.delete("/partitions/{partition_id}", tags=["network"])
def delete_partition(partition_id: str) -> dict[str, str]:
    try:
        k8s.delete_partition(partition_id)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Partition '{partition_id}' not found")
    return {"id": partition_id, "action": "deleted"}


@app.post("/nodes/{name}/isolate", tags=["network"])
def isolate_node(name: str) -> dict[str, str]:
    try:
        k8s.isolate_node(name)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Failed to isolate '{name}'")
    return {"name": name, "action": "isolated"}


@app.delete("/nodes/{name}/isolate", tags=["network"])
def unisolate_node(name: str) -> dict[str, str]:
    try:
        k8s.unisolate_node(name)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Node '{name}' is not isolated")
    return {"name": name, "action": "unisolated"}


@app.post("/nodes/{name}/throttle", tags=["chaos"])
def throttle_node(name: str, req: ThrottleRequest) -> dict[str, str]:
    try:
        k8s.throttle_node(name, req.cpu, req.memory)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Node '{name}' not found")
    return {"name": name, "action": "throttled", "cpu": req.cpu, "memory": req.memory}


@app.delete("/nodes/{name}/throttle", tags=["chaos"])
def unthrottle_node(name: str) -> dict[str, str]:
    try:
        k8s.unthrottle_node(name)
    except ApiException as e:
        _raise_if_k8s_error(e, f"Node '{name}' not found")
    return {"name": name, "action": "unthrottled"}


@app.post("/nodes/{name}/latency", tags=["chaos"])
def inject_latency(name: str, req: LatencyRequest) -> dict[str, Any]:
    try:
        k8s.inject_latency(name, req.delay_ms, req.jitter_ms)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"tc exec failed: {e}") from e
    return {
        "name": name,
        "action": "latency_injected",
        "delay_ms": req.delay_ms,
        "jitter_ms": req.jitter_ms,
    }


@app.delete("/nodes/{name}/latency", tags=["chaos"])
def remove_latency(name: str) -> dict[str, str]:
    try:
        k8s.remove_latency(name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"tc exec failed: {e}") from e
    return {"name": name, "action": "latency_removed"}


@app.get("/nodes/{name}/status", response_model=NodeChainStatusResponse, tags=["observability"])
async def node_status(name: str) -> NodeChainStatusResponse:
    url = settings.node_urls.get(name)
    if not url:
        raise HTTPException(status_code=404, detail=f"Unknown node '{name}'")
    async with httpx.AsyncClient(timeout=settings.node_request_timeout) as client:
        try:
            resp = await client.get(f"{url}/status")
            data = resp.json()
            state = NodeChainState(
                name=name,
                reachable=True,
                version=data.get("version"),
                peers=data.get("peers"),
                nodes=data.get("nodes"),
            )
        except Exception:
            state = NodeChainState(name=name, reachable=False)
    return NodeChainStatusResponse.from_domain(state)


@app.get("/nodes/{name}/k8s-status", response_model=PodStatusResponse, tags=["observability"])
def node_k8s_status(name: str) -> PodStatusResponse:
    return PodStatusResponse.from_domain(k8s.get_pod_status(name))


@app.get("/consensus/health", response_model=ConsensusHealthResponse, tags=["observability"])
async def consensus_health() -> ConsensusHealthResponse:
    view = ConsensusView(nodes=await _fetch_consensus_states())
    return ConsensusHealthResponse.from_domain(view)


@app.get("/consensus/lag", tags=["observability"])
async def consensus_lag() -> list[ConsensusNodeResponse]:
    nodes = await _fetch_consensus_states()
    return [ConsensusNodeResponse.from_domain(n) for n in nodes]


async def _fetch_consensus_states() -> list[NodeChainState]:
    async def fetch_one(name: str, base_url: str) -> NodeChainState:
        async with httpx.AsyncClient(timeout=settings.node_request_timeout) as client:
            try:
                blocks_resp, fin_resp = await asyncio.gather(
                    client.get(f"{base_url}/api/blocks"),
                    client.get(f"{base_url}/api/last-finalized-block"),
                )
                latest = (
                    blocks_resp.json()[0].get("blockNumber")
                    if blocks_resp.status_code == 200
                    else None
                )
                fin_data = fin_resp.json() if fin_resp.status_code == 200 else {}
                fin_block = fin_data.get("blockInfo", {}).get("blockNumber")
                fin_ft = fin_data.get("blockInfo", {}).get("faultTolerance")
                return NodeChainState(
                    name=name,
                    reachable=True,
                    latest_block=latest,
                    finalized_block=fin_block,
                    fault_tolerance=fin_ft,
                )
            except Exception:
                return NodeChainState(name=name, reachable=False)

    tasks = [fetch_one(name, url) for name, url in settings.node_urls.items() if name != "observer"]
    return await asyncio.gather(*tasks)
