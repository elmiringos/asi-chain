#!/usr/bin/env python3
"""
Compute f1r3fly node ID from a PKCS#8 EC P-256 private key.

Algorithm: keccak256(pubkey_x || pubkey_y)[12:] — Ethereum-style address derivation.

Usage:
    openssl pkey -in node.key.pem -pubout -outform DER | python3 node_id.py
"""
import sys
import struct

# Keccak-f[1600] round constants
_RC = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]

# Rotation offsets [x][y]
_ROT = [
    [ 0, 36,  3, 41, 18],
    [ 1, 44, 10, 45,  2],
    [62,  6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39,  8, 14],
]

def _rol64(x, n):
    return ((x << n) | (x >> (64 - n))) & 0xFFFFFFFFFFFFFFFF

def _keccak_f(s):
    for rc in _RC:
        c = [s[x][0] ^ s[x][1] ^ s[x][2] ^ s[x][3] ^ s[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rol64(c[(x + 1) % 5], 1) for x in range(5)]
        s = [[s[x][y] ^ d[x] for y in range(5)] for x in range(5)]
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rol64(s[x][y], _ROT[x][y])
        s = [[b[x][y] ^ (~b[(x + 1) % 5][y] & b[(x + 2) % 5][y]) for y in range(5)] for x in range(5)]
        s[0][0] ^= rc
    return s

def keccak256(data: bytes) -> bytes:
    rate = 136  # 1088-bit rate for keccak-256
    msg = bytearray(data)
    msg.append(0x01)              # Keccak padding (not SHA-3's 0x06)
    msg += b'\x00' * (-len(msg) % rate)
    msg[-1] |= 0x80
    s = [[0] * 5 for _ in range(5)]
    for i in range(0, len(msg), rate):
        for j in range(rate // 8):
            x, y = j % 5, j // 5
            s[x][y] ^= struct.unpack_from('<Q', msg, i + j * 8)[0]
        s = _keccak_f(s)
    out = bytearray()
    for y in range(5):
        for x in range(5):
            out += struct.pack('<Q', s[x][y])
    return bytes(out[:32])


pub_der = sys.stdin.buffer.read()
# SubjectPublicKeyInfo for P-256 is 91 bytes: 27-byte header + 04 + 32x + 32y
# Last 64 bytes are always x||y
if len(pub_der) < 64:
    print(f"ERROR: unexpected DER length {len(pub_der)}", file=sys.stderr)
    sys.exit(1)

node_id = keccak256(pub_der[-64:])[12:]  # last 20 bytes
print(node_id.hex())
