#!/usr/bin/env python3
"""Generate secp256k1 validator keypairs using openssl. Usage: python3 gen_validator_keys.py [n]"""
import hashlib
import subprocess
import sys

BASE58_ALPHABET = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _keccak256(data: bytes) -> bytes:
    k = hashlib.new("sha3_256")
    # hashlib sha3_256 is SHA-3, not Keccak-256; use pysha3 or inline
    # Inline Keccak-256 (same as node_id.py)
    import struct

    _RC = [
        0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
        0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
        0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
        0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
        0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
        0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
    ]
    _ROT = [
        [ 0, 36,  3, 41, 18],
        [ 1, 44, 10, 45,  2],
        [62,  6, 43, 15, 61],
        [28, 55, 25, 21, 56],
        [27, 20, 39,  8, 14],
    ]

    def rol64(x, n):
        return ((x << n) | (x >> (64 - n))) & 0xFFFFFFFFFFFFFFFF

    def keccak_f(s):
        for rc in _RC:
            c = [s[x][0] ^ s[x][1] ^ s[x][2] ^ s[x][3] ^ s[x][4] for x in range(5)]
            d = [c[(x - 1) % 5] ^ rol64(c[(x + 1) % 5], 1) for x in range(5)]
            s = [[s[x][y] ^ d[x] for y in range(5)] for x in range(5)]
            b = [[0] * 5 for _ in range(5)]
            for x in range(5):
                for y in range(5):
                    b[y][(2 * x + 3 * y) % 5] = rol64(s[x][y], _ROT[x][y])
            s = [[b[x][y] ^ (~b[(x + 1) % 5][y] & b[(x + 2) % 5][y]) for y in range(5)] for x in range(5)]
            s[0][0] ^= rc
        return s

    rate = 136
    msg = bytearray(data)
    msg.append(0x01)  # Keccak padding (not SHA-3)
    msg += b'\x00' * (-len(msg) % rate)
    msg[-1] |= 0x80
    s = [[0] * 5 for _ in range(5)]
    for i in range(0, len(msg), rate):
        for j in range(rate // 8):
            x, y = j % 5, j // 5
            s[x][y] ^= struct.unpack_from('<Q', msg, i + j * 8)[0]
        s = keccak_f(s)
    out = bytearray()
    for y in range(5):
        for x in range(5):
            out += struct.pack('<Q', s[x][y])
    return bytes(out[:32])


def _blake2b256(data: bytes) -> bytes:
    return hashlib.blake2b(data, digest_size=32).digest()


def _base58_encode(data: bytes) -> str:
    leading_zeros = len(data) - len(data.lstrip(b'\x00'))
    n = int.from_bytes(data, 'big')
    result = []
    while n > 0:
        n, rem = divmod(n, 58)
        result.append(BASE58_ALPHABET[rem:rem+1])
    result.extend([BASE58_ALPHABET[0:1]] * leading_zeros)
    return b''.join(reversed(result)).decode('ascii')


def wallet_address(pub_hex: str) -> str:
    """Derive REV/wallet address from uncompressed secp256k1 public key (hex, 65 bytes)."""
    pk = bytes.fromhex(pub_hex)                      # 65 bytes, starts with 04
    eth_addr = _keccak256(pk[1:])[-20:]              # keccak256(x||y), last 20 bytes
    key_hash = _keccak256(eth_addr)                  # keccak256 of eth address bytes
    prefix = bytes([0x00, 0x00, 0x00, 0x00])         # COIN_ID="000000" + VERSION="00" → 4 zero bytes
    payload = prefix + key_hash                      # 34 bytes
    checksum = _blake2b256(payload)[:4]              # first 4 bytes of blake2b256
    return _base58_encode(payload + checksum)        # base58(34 + 4 bytes)


def gen_keypair():
    key_pem = subprocess.check_output(
        ["openssl", "ecparam", "-name", "secp256k1", "-genkey", "-noout"],
        stderr=subprocess.DEVNULL,
    )
    priv_der = subprocess.check_output(
        ["openssl", "ec", "-outform", "DER"],
        input=key_pem, stderr=subprocess.DEVNULL,
    )
    pub_der = subprocess.check_output(
        ["openssl", "ec", "-pubout", "-outform", "DER", "-conv_form", "uncompressed"],
        input=key_pem, stderr=subprocess.DEVNULL,
    )
    priv_hex = _extract_priv_sec1(priv_der)
    pub_hex = pub_der[-65:].hex()
    return priv_hex, pub_hex


def _extract_priv_sec1(der: bytes) -> str:
    i = 0
    assert der[i] == 0x30; i += 1
    if der[i] < 0x80:
        i += 1
    else:
        i += 1 + (der[i] & 0x7F)
    assert der[i] == 0x02; i += 1
    i += 1 + der[i]
    assert der[i] == 0x04; i += 1
    plen = der[i]; i += 1
    return der[i:i + plen].hex().zfill(64)


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    prefix = sys.argv[2] if len(sys.argv) > 2 else "VALIDATOR"
    for idx in range(1, n + 1):
        priv, pub = gen_keypair()
        addr = wallet_address(pub)
        print(f"{prefix}{idx}_PUBLIC_KEY={pub}")
        print(f"{prefix}{idx}_PRIVATE_KEY={priv}")
        print(f"{prefix}{idx}_WALLET_ADDR={addr}")
