import argparse
import time
import os
import asyncio
import httpx
import threading # NEW: Imported for background thread
from prometheus_client import start_http_server, REGISTRY
from prometheus_client.core import GaugeMetricFamily, CounterMetricFamily

class FireflyCollector:
    def __init__(self, targets, cluster_name):
        self.targets = targets
        self.cluster_name = cluster_name
        # NEW: Metrics are now created once in the constructor
        self.up_metric = GaugeMetricFamily('firefly_node_up', 'Shows if the Firefly node is reachable', labels=['target', 'cluster'])
        self.peers_metric = GaugeMetricFamily('firefly_node_peers', 'Number of connected peers', labels=['target', 'cluster'])
        self.nodes_metric = GaugeMetricFamily('firefly_node_discovered_nodes', 'Number of discovered nodes in the network as reported by this node', labels=['target', 'cluster'])
        self.uptime_metric = CounterMetricFamily('firefly_node_uptime_seconds', 'Uptime of the node in seconds', labels=['target', 'cluster'])
        self.latest_block_metric = GaugeMetricFamily('firefly_node_latest_block_number', 'The latest block number', labels=['target', 'cluster'])
        self.finalized_block_metric = GaugeMetricFamily('firefly_node_last_finalized_block_number', 'The last finalized block number', labels=['target', 'cluster'])
        self.finalized_ft_metric = GaugeMetricFamily('firefly_node_last_finalized_block_fault_tolerance', 'Fault tolerance of the last finalized block', labels=['target', 'cluster'])
        self.info_metric = GaugeMetricFamily('firefly_node_info', 'Version and other information for a node', labels=['target', 'cluster', 'version', 'network_id', 'shard_id'])

    def collect(self):
        """
        CHANGED: This method is now very simple. It just yields the current
        (cached) state of the metrics. The data is updated by a background thread.
        """
        yield self.up_metric
        yield self.peers_metric
        yield self.nodes_metric
        yield self.uptime_metric
        yield self.info_metric
        yield self.latest_block_metric
        yield self.finalized_block_metric
        yield self.finalized_ft_metric

    # NEW: All scraping logic is now in this method, to be run by the background thread.
    def _update_metrics(self):
        print("Starting new scrape cycle...")
        results = asyncio.run(self._scrape_all_targets())

        # Create temporary metric families to build the new state
        up_metric = GaugeMetricFamily('firefly_node_up', 'Shows if the Firefly node is reachable', labels=['target', 'cluster'])
        peers_metric = GaugeMetricFamily('firefly_node_peers', 'Number of connected peers', labels=['target', 'cluster'])
        nodes_metric = GaugeMetricFamily('firefly_node_discovered_nodes', 'Number of discovered nodes in the network as reported by this node', labels=['target', 'cluster'])
        uptime_metric = CounterMetricFamily('firefly_node_uptime_seconds', 'Uptime of the node in seconds', labels=['target', 'cluster'])
        latest_block_metric = GaugeMetricFamily('firefly_node_latest_block_number', 'The latest block number', labels=['target', 'cluster'])
        finalized_block_metric = GaugeMetricFamily('firefly_node_last_finalized_block_number', 'The last finalized block number', labels=['target', 'cluster'])
        finalized_ft_metric = GaugeMetricFamily('firefly_node_last_finalized_block_fault_tolerance', 'Fault tolerance of the last finalized block', labels=['target', 'cluster'])
        info_metric = GaugeMetricFamily('firefly_node_info', 'Version and other information for a node', labels=['target', 'cluster', 'version', 'network_id', 'shard_id'])

        for i, result in enumerate(results):
