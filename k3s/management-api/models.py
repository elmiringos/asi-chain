from pydantic import BaseModel, Field

from domain import ConsensusView, NetworkPartition, NodeChainState, PodStatus, Validator


class PartitionRequest(BaseModel):
    id: str = Field(..., description="Unique partition ID, used to delete it later")
    group_a: list[str] = Field(..., description="First group of node names, e.g. ['validator1']")
    group_b: list[str] = Field(..., description="Second group of node names, e.g. ['validator3']")


class ThrottleRequest(BaseModel):
    cpu: str = Field("100m", description="CPU limit, e.g. '100m', '500m', '1'")
    memory: str = Field("512Mi", description="Memory limit, e.g. '512Mi', '1Gi'")


class LatencyRequest(BaseModel):
    delay_ms: int = Field(..., ge=0, description="Base delay in milliseconds")
    jitter_ms: int = Field(0, ge=0, description="Jitter in milliseconds")


class ValidatorResponse(BaseModel):
    name: str
    role: str
    running: bool
    ready_replicas: int

    @classmethod
    def from_domain(cls, v: Validator) -> ValidatorResponse:
        return cls(
            name=v.name,
            role=v.role.value,
            running=v.is_running,
            ready_replicas=v.ready_replicas,
        )


class PartitionResponse(BaseModel):
    id: str
    policies: list[str]

    @classmethod
    def from_domain(cls, p: NetworkPartition) -> PartitionResponse:
        return cls(id=p.id, policies=p.policies)


class PodStatusResponse(BaseModel):
    name: str
    pod_phase: str | None
    ready: bool
    restart_count: int

    @classmethod
    def from_domain(cls, s: PodStatus) -> PodStatusResponse:
        return cls(
            name=s.name,
            pod_phase=s.pod_phase,
            ready=s.ready,
            restart_count=s.restart_count,
        )


class NodeChainStatusResponse(BaseModel):
    name: str
    reachable: bool
    version: str | None = None
    peers: int | None = None
    nodes: int | None = None

    @classmethod
    def from_domain(cls, s: NodeChainState) -> NodeChainStatusResponse:
        return cls(
            name=s.name,
            reachable=s.reachable,
            version=s.version,
            peers=s.peers,
            nodes=s.nodes,
        )


class ConsensusNodeResponse(BaseModel):
    name: str
    reachable: bool
    latest_block: int | None = None
    finalized_block: int | None = None
    fault_tolerance: float | None = None
    lag: int | None = None

    @classmethod
    def from_domain(cls, s: NodeChainState) -> ConsensusNodeResponse:
        return cls(
            name=s.name,
            reachable=s.reachable,
            latest_block=s.latest_block,
            finalized_block=s.finalized_block,
            fault_tolerance=s.fault_tolerance,
            lag=s.lag,
        )


class ConsensusHealthResponse(BaseModel):
    nodes: list[ConsensusNodeResponse]
    finalized_in_sync: bool
    max_lag: int | None
    is_healthy: bool

    @classmethod
    def from_domain(cls, view: ConsensusView) -> ConsensusHealthResponse:
        return cls(
            nodes=[ConsensusNodeResponse.from_domain(n) for n in view.nodes],
            finalized_in_sync=view.finalized_in_sync,
            max_lag=view.max_lag,
            is_healthy=view.is_healthy,
        )
