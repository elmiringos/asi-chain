# Network Nodes Configuration

## Network Overview
This document contains the complete list of IP addresses and ports for all nodes in the ASI:Chain network, organized by machine deployment.

## Machine 2: `54.175.6.183`

### Genesis Bootstrap Node
- **URL**: `http://54.175.6.183:40403`
- **Type**: Bootstrap Node

### Validators (Machine 2)
| Validator | URL | Port |
|-----------|-----|------|
| Validator 1 | `http://54.175.6.183:40413` | 40413 |
| Validator 2 | `http://54.175.6.183:40423` | 40423 |
| Validator 3 | `http://54.175.6.183:40433` | 40433 |
| Validator 7 | `http://54.175.6.183:40473` | 40473 |

### Observer Node
- **URL**: `http://54.175.6.183:40453`
- **Type**: Observer Node

## Machine 3: `184.73.0.34`

### Validators (Machine 3)
| Validator | URL | Port |
|-----------|-----|------|
| Validator 4 | `http://184.73.0.34:40443` | 40443 |
| Validator 6 | `http://184.73.0.34:40463` | 40463 |

## Network Topology Summary

### Total Node Count
- **1** Genesis Bootstrap Node
- **6** Validator Nodes (Validators 1-4, 6-7)
- **1** Observer Node
- **Total**: 8 Nodes

### Machine Distribution
- **Machine 2** (`54.175.6.183`): 6 nodes (1 bootstrap + 4 validators + 1 observer)
- **Machine 3** (`184.73.0.34`): 2 nodes (2 validators)

## Port Allocation Schema

### Machine 2 Ports (54.175.6.183)
```
40403 - Genesis Bootstrap
40413 - Validator 1
40423 - Validator 2  
40433 - Validator 3
40453 - Observer
40473 - Validator 7
```

### Machine 3 Ports (184.73.0.34)
```
40443 - Validator 4
40463 - Validator 6
```
