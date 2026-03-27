from dataclasses import dataclass, field
from enum import StrEnum


class NodeRole(StrEnum):
    BOOTSTRAP = "bootstrap"
    VALIDATOR = "validator"
    OBSERVER = "observer"


@dataclass
class Validator:
    name: str
    role: NodeRole
    ready_replicas: int

    @property
    def is_running(self) -> bool:
        return self.ready_replicas > 0


@dataclass
class PodStatus:
    name: str
    pod_phase: str | None
    ready: bool
    restart_count: int


@dataclass
class NetworkPartition:
    id: str
    group_a: list[str]
    group_b: list[str]
    policies: list[str] = field(default_factory=list)

    def validate(self) -> None:
        overlap = set(self.group_a) & set(self.group_b)
        if overlap:
            raise ValueError(f"Nodes appear in both groups: {overlap}")

    def affects_node(self, node: str) -> bool:
        return node in self.group_a or node in self.group_b


@dataclass
class NodeChainState:
    name: str
    reachable: bool
    version: str | None = None
    peers: int | None = None
    nodes: int | None = None
    latest_block: int | None = None
    finalized_block: int | None = None
    fault_tolerance: float | None = None

    @property
    def lag(self) -> int | None:
        if self.latest_block is not None and self.finalized_block is not None:
            return self.latest_block - self.finalized_block
        return None


@dataclass
class ConsensusView:
    nodes: list[NodeChainState]

    @property
    def finalized_in_sync(self) -> bool:
        finalized = [n.finalized_block for n in self.nodes if n.finalized_block is not None]
        return len(set(finalized)) <= 1

    @property
    def max_lag(self) -> int | None:
        lags = [n.lag for n in self.nodes if n.lag is not None]
        return max(lags) if lags else None

    @property
    def is_healthy(self) -> bool:
        return self.finalized_in_sync and all(n.reachable for n in self.nodes)
