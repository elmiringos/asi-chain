#!/usr/bin/env python3
"""Generate secp256k1 validator keypairs using openssl. Usage: python3 gen_validator_keys.py [n]"""
import subprocess
import sys


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
    for idx in range(1, n + 1):
        priv, pub = gen_keypair()
        print(f"VALIDATOR{idx}_PUBLIC_KEY={pub}")
        print(f"VALIDATOR{idx}_PRIVATE_KEY={priv}")
