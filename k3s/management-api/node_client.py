import hashlib
import time

import grpc
import grpc.aio
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import Prehashed
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from stubs import CasperMessage_pb2 as casper_pb
from stubs import DeployServiceV1_pb2_grpc as deploy_grpc
from stubs import ProposeServiceV1_pb2 as propose_pb
from stubs import ProposeServiceV1_pb2_grpc as propose_grpc


def _blake2b256(data: bytes) -> bytes:
    return hashlib.blake2b(data, digest_size=32).digest()


def _secp256k1_key(hex_str: str) -> ec.EllipticCurvePrivateKey:
    return ec.derive_private_key(int(hex_str, 16), ec.SECP256K1())


def _public_key_bytes(private_key_hex: str) -> bytes:
    sk = _secp256k1_key(private_key_hex)
    return sk.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)


def build_signed_deploy(
    term: str,
    private_key_hex: str,
    *,
    phlo_price: int = 1,
    phlo_limit: int = 1_000_000,
    shard_id: str = "root",
    valid_after_block_number: int = -1,
) -> "casper_pb.DeployDataProto":
    timestamp = int(time.time() * 1000)

    # Encode only the fields that are part of DeployData (no deployer/sig/sigAlgorithm/language)
    data_for_signing = casper_pb.DeployDataProto(
        term=term,
        timestamp=timestamp,
        phloPrice=phlo_price,
        phloLimit=phlo_limit,
        validAfterBlockNumber=valid_after_block_number,
        shardId=shard_id,
    )
    proto_bytes: bytes = data_for_signing.SerializeToString()

    hash_bytes = _blake2b256(proto_bytes)
    sk = _secp256k1_key(private_key_hex)
    sig_der: bytes = sk.sign(hash_bytes, ec.ECDSA(Prehashed(hashes.SHA256())))

    return casper_pb.DeployDataProto(
        deployer=_public_key_bytes(private_key_hex),
        term=term,
        timestamp=timestamp,
        sig=sig_der,
        sigAlgorithm="secp256k1",
        phloPrice=phlo_price,
        phloLimit=phlo_limit,
        validAfterBlockNumber=valid_after_block_number,
        shardId=shard_id,
        language="rholang",
    )


async def do_deploy(grpc_addr: str, deploy: "casper_pb.DeployDataProto") -> str:
    async with grpc.aio.insecure_channel(grpc_addr) as channel:
        stub = deploy_grpc.DeployServiceStub(channel)
        response = await stub.doDeploy(deploy)
    which = response.WhichOneof("message")
    if which == "error":
        raise ValueError(f"doDeploy failed: {list(response.error.messages)}")
    return str(response.result)


async def do_propose(grpc_addr: str) -> str:
    async with grpc.aio.insecure_channel(grpc_addr) as channel:
        stub = propose_grpc.ProposeServiceStub(channel)
        response = await stub.propose(propose_pb.ProposeQuery(isAsync=False))
    which = response.WhichOneof("message")
    if which == "error":
        raise ValueError(f"propose failed: {list(response.error.messages)}")
    return str(response.result)
