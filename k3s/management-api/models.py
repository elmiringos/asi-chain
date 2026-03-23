from pydantic import BaseModel, Field
from typing import List, Optional


class ValidatorStatus(BaseModel):
    name: str
    role: str
    running: bool
    ready_replicas: int


class PartitionRequest(BaseModel):
    id: str = Field(..., description="Unique partition ID, used to delete it later")
    group_a: List[str] = Field(..., description="First group of node names, e.g. ['validator1', 'validator2']")
    group_b: List[str] = Field(..., description="Second group of node names, e.g. ['validator3']")


class PartitionInfo(BaseModel):
    id: str
    policies: List[str]


class ThrottleRequest(BaseModel):
    cpu: str = Field("100m", description="CPU limit, e.g. '100m', '500m', '1'")
    memory: str = Field("512Mi", description="Memory limit, e.g. '512Mi', '1Gi'")


class LatencyRequest(BaseModel):
    delay_ms: int = Field(..., ge=0, description="Base delay in milliseconds")
    jitter_ms: int = Field(0, ge=0, description="Jitter in milliseconds")


class NodeK8sStatus(BaseModel):
    name: str
    pod_phase: Optional[str]
    ready: bool
    restart_count: int


class NodeChainStatus(BaseModel):
    name: str
    reachable: bool
    version: Optional[str] = None
    peers: Optional[int] = None
    nodes: Optional[int] = None


class ConsensusNodeState(BaseModel):
    name: str
    reachable: bool
    latest_block: Optional[int] = None
    finalized_block: Optional[int] = None
    fault_tolerance: Optional[float] = None
    lag: Optional[int] = None


class ConsensusHealth(BaseModel):
    nodes: List[ConsensusNodeState]
    finalized_in_sync: bool
    max_lag: Optional[int]
