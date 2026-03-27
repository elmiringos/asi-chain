package asichain

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// WaitForBlock polls GET {nodeUrl}/api/blocks/1 every 500ms until the returned
// blockNumber exceeds afterBlockNumber, indicating the deploy was included in a block.
// Returns the new block number, or -1 if timeoutSec elapses.
func WaitForBlock(nodeUrl string, afterBlockNumber int64, timeoutSec int64) int64 {
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	client := &http.Client{Timeout: 5 * time.Second}

	for {
		select {
		case <-ctx.Done():
			return -1
		case <-ticker.C:
			if block := fetchLatestBlockNumber(client, nodeUrl); block > afterBlockNumber {
				return block
			}
		}
	}
}

// ParseDeployId extracts the deploy ID from the JSON response body of POST /api/deploy.
// The node returns either a plain string or a JSON object with a "deployId" / "id" field.
// Falls back to returning the raw body if parsing fails.
func ParseDeployId(body string) string {
	var s string
	if err := json.Unmarshal([]byte(body), &s); err == nil && s != "" {
		return s
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal([]byte(body), &obj); err == nil {
		for _, key := range []string{"deployId", "deploy_id", "id", "hash"} {
			if v, ok := obj[key]; ok {
				var id string
				if json.Unmarshal(v, &id) == nil && id != "" {
					return id
				}
			}
		}
	}
	return body
}

func fetchLatestBlockNumber(client *http.Client, nodeUrl string) int64 {
	resp, err := client.Get(nodeUrl + "/api/blocks/1")
	if err != nil {
		return -1
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return -1
	}
	var blocks []struct {
		BlockNumber int64 `json:"blockNumber"`
	}
	if err := json.Unmarshal(body, &blocks); err != nil || len(blocks) == 0 {
		return -1
	}
	return blocks[0].BlockNumber
}
