from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    namespace: str = "asi-chain"

    # Node HTTP base URLs (port 40403). Override via env vars if needed.
    bootstrap_url: str = "http://bootstrap-0.bootstrap.asi-chain.svc.cluster.local:40403"
    validator1_url: str = "http://validator1-0.validator1.asi-chain.svc.cluster.local:40403"
    validator2_url: str = "http://validator2-0.validator2.asi-chain.svc.cluster.local:40403"
    validator3_url: str = "http://validator3-0.validator3.asi-chain.svc.cluster.local:40403"
    validator4_url: str = "http://validator4-0.validator4.asi-chain.svc.cluster.local:40403"
    validator5_url: str = "http://validator5-0.validator5.asi-chain.svc.cluster.local:40403"
    validator6_url: str = "http://validator6-0.validator6.asi-chain.svc.cluster.local:40403"
    observer_url: str = "http://observer-0.observer.asi-chain.svc.cluster.local:40403"

    # P2P port (TCP) and Kademlia peer discovery port (UDP)
    p2p_port: int = 40400
    kademlia_port: int = 40404

    # Non-P2P ports: gRPC external, gRPC internal, HTTP REST, HTTP admin
    grpc_ext_port: int = 40401
    grpc_int_port: int = 40402
    http_port: int = 40403
    http_admin_port: int = 40405

    # HTTP client timeout for node status requests (seconds)
    node_request_timeout: float = 5.0

    # secp256k1 private key hex for signing deploys (set via DEPLOY_PRIVATE_KEY env var)
    deploy_private_key: str = ""

    @property
    def node_urls(self) -> dict[str, str]:
        return {
            "bootstrap": self.bootstrap_url,
            "validator1": self.validator1_url,
            "validator2": self.validator2_url,
            "validator3": self.validator3_url,
            "validator4": self.validator4_url,
            "validator5": self.validator5_url,
            "validator6": self.validator6_url,
            "observer": self.observer_url,
        }

    @property
    def node_grpc_urls(self) -> dict[str, str]:
        return {
            name: url.removeprefix("http://").replace(f":{self.http_port}", f":{self.grpc_ext_port}")
            for name, url in self.node_urls.items()
        }

    @property
    def node_grpc_int_urls(self) -> dict[str, str]:
        return {
            name: url.removeprefix("http://").replace(f":{self.http_port}", f":{self.grpc_int_port}")
            for name, url in self.node_urls.items()
        }

    @property
    def non_p2p_ports(self) -> list[int]:
        return [self.grpc_ext_port, self.grpc_int_port, self.http_port, self.http_admin_port]


settings = Settings()
