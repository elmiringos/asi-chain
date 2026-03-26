import logging

from kubernetes import client, config
from kubernetes import stream as k8s_stream
from kubernetes.client.rest import ApiException

from domain import NetworkPartition, NodeRole, PodStatus, Validator
from settings import settings

logger = logging.getLogger(__name__)

MANAGED_BY_LABEL = "managed-by=management-api"
PARTITION_LABEL = "partition-id"

P2P_PORTS = [
    client.V1NetworkPolicyPort(port=settings.p2p_port, protocol="TCP"),
    client.V1NetworkPolicyPort(port=settings.kademlia_port, protocol="UDP"),
]
NON_P2P_PORTS = [client.V1NetworkPolicyPort(port=p, protocol="TCP") for p in settings.non_p2p_ports]
DNS_PORTS = [
    client.V1NetworkPolicyPort(port=53, protocol="UDP"),
    client.V1NetworkPolicyPort(port=53, protocol="TCP"),
]


def _load_k8s() -> None:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()


_load_k8s()
apps_v1 = client.AppsV1Api()
core_v1 = client.CoreV1Api()
networking_v1 = client.NetworkingV1Api()

_throttle_cache: dict[str, dict[str, str]] = {}


def list_validators() -> list[Validator]:
    sts_list = apps_v1.list_namespaced_stateful_set(
        namespace=settings.namespace,
        label_selector="app=asi-chain",
    )
    result = []
    for sts in sts_list.items:
        raw_role = sts.metadata.labels.get("role", "")
        if raw_role == NodeRole.BOOTSTRAP:
            continue
        elif raw_role == NodeRole.OBSERVER:
            role = NodeRole.OBSERVER
        elif raw_role.startswith("validator"):
            role = NodeRole.VALIDATOR
        else:
            continue
        result.append(
            Validator(
                name=sts.metadata.name,
                role=role,
                ready_replicas=sts.status.ready_replicas or 0,
            )
        )
    return result


def scale_validator(name: str, replicas: int) -> None:
    apps_v1.patch_namespaced_stateful_set_scale(
        name=name,
        namespace=settings.namespace,
        body={"spec": {"replicas": replicas}},
    )


def restart_validator(name: str) -> None:
    pod_name = f"{name}-0"
    core_v1.delete_namespaced_pod(name=pod_name, namespace=settings.namespace)


def get_pod_status(name: str) -> PodStatus:
    pod_name = f"{name}-0"
    try:
        pod = core_v1.read_namespaced_pod(name=pod_name, namespace=settings.namespace)
        ready = any(c.ready for c in (pod.status.conditions or []) if c.type == "Ready")
        restart_count = sum(cs.restart_count for cs in (pod.status.container_statuses or []))
        return PodStatus(
            name=name,
            pod_phase=pod.status.phase,
            ready=ready,
            restart_count=restart_count,
        )
    except ApiException as e:
        if e.status == 404:
            return PodStatus(name=name, pod_phase=None, ready=False, restart_count=0)
        raise


def create_partition(partition: NetworkPartition) -> None:
    for node in partition.group_a:
        policy = _build_partition_policy(partition.id, node, blocked=partition.group_b)
        networking_v1.create_namespaced_network_policy(namespace=settings.namespace, body=policy)
    for node in partition.group_b:
        policy = _build_partition_policy(partition.id, node, blocked=partition.group_a)
        networking_v1.create_namespaced_network_policy(namespace=settings.namespace, body=policy)


def _build_partition_policy(
    partition_id: str, node: str, blocked: list[str]
) -> client.V1NetworkPolicy:
    allow_p2p_from = client.V1NetworkPolicyIngressRule(
        _from=[
            client.V1NetworkPolicyPeer(
                pod_selector=client.V1LabelSelector(
                    match_expressions=[
                        client.V1LabelSelectorRequirement(
                            key="role", operator="NotIn", values=blocked
                        )
                    ]
                )
            )
        ],
        ports=P2P_PORTS,
    )
    allow_non_p2p_in = client.V1NetworkPolicyIngressRule(ports=NON_P2P_PORTS)

    allow_p2p_to = client.V1NetworkPolicyEgressRule(
        to=[
            client.V1NetworkPolicyPeer(
                pod_selector=client.V1LabelSelector(
                    match_expressions=[
                        client.V1LabelSelectorRequirement(
                            key="role", operator="NotIn", values=blocked
                        )
                    ]
                )
            )
        ],
        ports=P2P_PORTS,
    )
    allow_dns_out = client.V1NetworkPolicyEgressRule(ports=DNS_PORTS)
    allow_non_p2p_out = client.V1NetworkPolicyEgressRule(ports=NON_P2P_PORTS)

    return client.V1NetworkPolicy(
        metadata=client.V1ObjectMeta(
            name=f"partition-{partition_id}-{node}",
            namespace=settings.namespace,
            labels={"managed-by": "management-api", PARTITION_LABEL: partition_id},
        ),
        spec=client.V1NetworkPolicySpec(
            pod_selector=client.V1LabelSelector(match_labels={"role": node}),
            policy_types=["Ingress", "Egress"],
            ingress=[allow_p2p_from, allow_non_p2p_in],
            egress=[allow_p2p_to, allow_dns_out, allow_non_p2p_out],
        ),
    )


def list_partitions() -> list[NetworkPartition]:
    policies = networking_v1.list_namespaced_network_policy(
        namespace=settings.namespace,
        label_selector=MANAGED_BY_LABEL,
    )
    partitions: dict[str, list[str]] = {}
    for p in policies.items:
        pid = p.metadata.labels.get(PARTITION_LABEL)
        if pid and "isolate" not in p.metadata.name:
            partitions.setdefault(pid, []).append(p.metadata.name)
    return [
        NetworkPartition(id=pid, group_a=[], group_b=[], policies=names)
        for pid, names in partitions.items()
    ]


def delete_partition(partition_id: str) -> None:
    policies = networking_v1.list_namespaced_network_policy(
        namespace=settings.namespace,
        label_selector=f"{MANAGED_BY_LABEL},{PARTITION_LABEL}={partition_id}",
    )
    for p in policies.items:
        networking_v1.delete_namespaced_network_policy(
            name=p.metadata.name, namespace=settings.namespace
        )


def isolate_node(name: str) -> None:
    policy = client.V1NetworkPolicy(
        metadata=client.V1ObjectMeta(
            name=f"isolate-{name}",
            namespace=settings.namespace,
            labels={"managed-by": "management-api", "isolate": name},
        ),
        spec=client.V1NetworkPolicySpec(
            pod_selector=client.V1LabelSelector(match_labels={"role": name}),
            policy_types=["Ingress", "Egress"],
            ingress=[client.V1NetworkPolicyIngressRule(ports=NON_P2P_PORTS)],
            egress=[
                client.V1NetworkPolicyEgressRule(ports=DNS_PORTS),
                client.V1NetworkPolicyEgressRule(ports=NON_P2P_PORTS),
            ],
        ),
    )
    networking_v1.create_namespaced_network_policy(namespace=settings.namespace, body=policy)


def unisolate_node(name: str) -> None:
    networking_v1.delete_namespaced_network_policy(
        name=f"isolate-{name}", namespace=settings.namespace
    )


def throttle_node(name: str, cpu: str, memory: str) -> None:
    sts = apps_v1.read_namespaced_stateful_set(name=name, namespace=settings.namespace)
    container = sts.spec.template.spec.containers[0]
    limits = container.resources.limits if container.resources else {}
    _throttle_cache[name] = {
        "cpu": (limits or {}).get("cpu", "1"),
        "memory": (limits or {}).get("memory", "2Gi"),
    }
    patch = {
        "spec": {
            "template": {
                "spec": {
                    "containers": [
                        {
                            "name": container.name,
                            "resources": {"limits": {"cpu": cpu, "memory": memory}},
                        }
                    ]
                }
            }
        }
    }
    apps_v1.patch_namespaced_stateful_set(name=name, namespace=settings.namespace, body=patch)


def unthrottle_node(name: str) -> None:
    original = _throttle_cache.pop(name, {"cpu": "1", "memory": "2Gi"})
    sts = apps_v1.read_namespaced_stateful_set(name=name, namespace=settings.namespace)
    container = sts.spec.template.spec.containers[0]
    patch = {
        "spec": {
            "template": {
                "spec": {
                    "containers": [
                        {
                            "name": container.name,
                            "resources": {"limits": original},
                        }
                    ]
                }
            }
        }
    }
    apps_v1.patch_namespaced_stateful_set(name=name, namespace=settings.namespace, body=patch)


def inject_latency(name: str, delay_ms: int, jitter_ms: int = 0) -> None:
    _exec_in_pod(
        name,
        f"tc qdisc replace dev eth0 root netem delay {delay_ms}ms {jitter_ms}ms",
    )


def remove_latency(name: str) -> None:
    _exec_in_pod(name, "tc qdisc del dev eth0 root 2>/dev/null || true")


def _exec_in_pod(name: str, command: str) -> str:
    pod_name = f"{name}-0"
    result: str = k8s_stream.stream(
        core_v1.connect_get_namespaced_pod_exec,
        pod_name,
        settings.namespace,
        command=["/bin/sh", "-c", command],
        stderr=True,
        stdin=False,
        stdout=True,
        tty=False,
    )
    return result
