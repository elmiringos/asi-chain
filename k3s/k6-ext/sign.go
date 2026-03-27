package asichain

import (
	"encoding/hex"
	"fmt"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/blake2b"
)

// SignDeploy signs a deploy and returns { deployer, sig, sigAlgorithm }.
// Accepts a JS object with fields: term, timestamp, phloPrice, phloLimit,
// validAfterBlockNumber, shardId (optional).
func (mi *ModuleInstance) SignDeploy(data map[string]any, privateKeyHex string) (map[string]any, error) {
	d, err := parseDeployData(data)
	if err != nil {
		return nil, err
	}

	serialized := serializeForSigning(d)

	h, err := blake2b.New256(nil)
	if err != nil {
		return nil, fmt.Errorf("blake2b init: %w", err)
	}
	h.Write(serialized)
	hash := h.Sum(nil)

	privKeyBytes, err := hex.DecodeString(privateKeyHex)
	if err != nil {
		return nil, fmt.Errorf("invalid private key: %w", err)
	}

	privKey := secp256k1.PrivKeyFromBytes(privKeyBytes)
	sig := ecdsa.Sign(privKey, hash)
	pubKey := privKey.PubKey()

	return map[string]any{
		"deployer":     hex.EncodeToString(pubKey.SerializeUncompressed()),
		"sig":          hex.EncodeToString(sig.Serialize()),
		"sigAlgorithm": "secp256k1",
	}, nil
}

// deployData holds the fields used for protobuf serialization and signing.
type deployData struct {
	term                  string
	timestamp             int64
	phloPrice             int64
	phloLimit             int64
	validAfterBlockNumber int64
	shardId               string
}

func parseDeployData(m map[string]any) (deployData, error) {
	getString := func(key string) string {
		v, ok := m[key]
		if !ok {
			return ""
		}
		s, _ := v.(string)
		return s
	}
	getInt64 := func(key string) int64 {
		v, ok := m[key]
		if !ok {
			return 0
		}
		switch n := v.(type) {
		case int64:
			return n
		case float64:
			return int64(n)
		case int:
			return int64(n)
		}
		return 0
	}

	d := deployData{
		term:                  getString("term"),
		timestamp:             getInt64("timestamp"),
		phloPrice:             getInt64("phloPrice"),
		phloLimit:             getInt64("phloLimit"),
		validAfterBlockNumber: getInt64("validAfterBlockNumber"),
		shardId:               getString("shardId"),
	}
	if d.term == "" {
		return d, fmt.Errorf("signDeploy: term is required")
	}
	return d, nil
}

// serializeForSigning encodes deploy fields as a minimal protobuf message,
// matching the CasperMessage.proto field layout used by ASI-Chain nodes.
//
// Field numbers: term=2, timestamp=3, phloPrice=7, phloLimit=8,
// validAfterBlockNumber=10, shardId=11
func serializeForSigning(d deployData) []byte {
	var buf []byte
	writeString(&buf, 2, d.term)
	writeInt64(&buf, 3, d.timestamp)
	writeInt64(&buf, 7, d.phloPrice)
	writeInt64(&buf, 8, d.phloLimit)
	writeInt64(&buf, 10, d.validAfterBlockNumber)
	writeString(&buf, 11, d.shardId)
	return buf
}

func writeVarint(buf *[]byte, v uint64) {
	for v > 0x7f {
		*buf = append(*buf, byte(v&0x7f)|0x80)
		v >>= 7
	}
	*buf = append(*buf, byte(v))
}

func writeString(buf *[]byte, fieldNum int, s string) {
	if s == "" {
		return
	}
	writeVarint(buf, uint64(fieldNum<<3)|2) // wire type 2 = length-delimited
	writeVarint(buf, uint64(len(s)))
	*buf = append(*buf, []byte(s)...)
}

func writeInt64(buf *[]byte, fieldNum int, v int64) {
	if v == 0 {
		return
	}
	writeVarint(buf, uint64(fieldNum<<3)) // wire type 0 = varint
	writeVarint(buf, uint64(v))
}
