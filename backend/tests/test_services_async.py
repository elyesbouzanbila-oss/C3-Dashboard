"""
Async tests for backend service functions with mocked Kubernetes/Prometheus clients.

Uses pytest-asyncio and unittest.mock.AsyncMock to mock the K8s API and Prometheus
HTTP responses without requiring a live cluster.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Any, Dict, List

from services.rag_service import retrieve
from services.ai_service import _rag_prompt


# ─── Calico Service: get_ipam_utilization ─────────────────────────

class TestGetIpamUtilization:
    """Tests the most complex service function — CIDR containment logic."""

    @patch("services.calico_service.k8s_client.CustomObjectsApi")
    @pytest.mark.asyncio
    async def test_pools_with_blocks(self, mock_custom_api: MagicMock):
        """Two pools, each with matching blocks, should compute correct utilization."""
        api_client = AsyncMock()
        mock_custom_api.return_value = api_client

        api_client.list_cluster_custom_object = AsyncMock()
        api_client.list_cluster_custom_object.side_effect = [
            # First call: list IPPools
            {
                "items": [
                    {
                        "metadata": {"name": "pool-a"},
                        "spec": {"cidr": "10.0.0.0/16", "ipipMode": "Never", "vxlanMode": "Always"},
                    },
                    {
                        "metadata": {"name": "pool-b"},
                        "spec": {"cidr": "10.1.0.0/16", "ipipMode": "Never", "vxlanMode": "Never"},
                    },
                ]
            },
            # Second call: list IPAMBlocks
            {
                "items": [
                    {
                        "spec": {
                            "cidr": "10.0.1.0/24",
                            "allocations": [1, None, 3, None],
                        }
                    },
                    {
                        "spec": {
                            "cidr": "10.0.2.0/24",
                            "allocations": [None, None],
                        }
                    },
                    {
                        "spec": {
                            "cidr": "10.1.0.0/24",
                            "allocations": [5, 6, 7],
                        }
                    },
                ]
            },
        ]

        from services.calico_service import get_ipam_utilization
        result = await get_ipam_utilization(api_client)

        result_map = {r["pool"]: r for r in result}

        # pool-a: 2 blocks, 2 allocated out of 6 total = 33.3%
        assert result_map["pool-a"]["blocks"] == 2
        assert result_map["pool-a"]["allocated"] == 2
        assert result_map["pool-a"]["total"] == 6
        assert result_map["pool-a"]["utilization_pct"] == pytest.approx(33.3, rel=0.1)

        # pool-b: 1 block, 3 allocated out of 3 total = 100%
        assert result_map["pool-b"]["blocks"] == 1
        assert result_map["pool-b"]["allocated"] == 3
        assert result_map["pool-b"]["total"] == 3
        assert result_map["pool-b"]["utilization_pct"] == 100.0

    @patch("services.calico_service.k8s_client.CustomObjectsApi")
    @pytest.mark.asyncio
    async def test_pool_without_blocks_included(self, mock_custom_api: MagicMock):
        """A pool with zero blocks should still appear with 0 utilization."""
        api_client = AsyncMock()
        mock_custom_api.return_value = api_client
        api_client.list_cluster_custom_object = AsyncMock()
        api_client.list_cluster_custom_object.side_effect = [
            {"items": [{"metadata": {"name": "empty-pool"}, "spec": {"cidr": "10.0.0.0/16"}}]},
            {"items": []},
        ]

        from services.calico_service import get_ipam_utilization
        result = await get_ipam_utilization(api_client)
        assert any(r["pool"] == "empty-pool" for r in result)
        pool = next(r for r in result if r["pool"] == "empty-pool")
        assert pool["blocks"] == 0
        assert pool["allocated"] == 0
        assert pool["utilization_pct"] == 0.0

    @patch("services.calico_service.k8s_client.CustomObjectsApi")
    @pytest.mark.asyncio
    async def test_block_without_cidr_goes_to_unknown(self, mock_custom_api: MagicMock):
        """An IPAMBlock without a CIDR should be assigned to the 'unknown' pool."""
        api_client = AsyncMock()
        mock_custom_api.return_value = api_client
        api_client.list_cluster_custom_object = AsyncMock()
        api_client.list_cluster_custom_object.side_effect = [
            {"items": [{"metadata": {"name": "pool-a"}, "spec": {"cidr": "10.0.0.0/16"}}]},
            {"items": [{"spec": {"cidr": "", "allocations": [1]}}]},
        ]

        from services.calico_service import get_ipam_utilization
        result = await get_ipam_utilization(api_client)
        assert any(r["pool"] == "unknown" for r in result)

    @patch("services.calico_service.k8s_client.CustomObjectsApi")
    @pytest.mark.asyncio
    async def test_no_pools_returns_empty_list(self, mock_custom_api: MagicMock):
        api_client = AsyncMock()
        mock_custom_api.return_value = api_client
        api_client.list_cluster_custom_object = AsyncMock()
        api_client.list_cluster_custom_object.side_effect = [
            {"items": []},
            {"items": []},
        ]

        from services.calico_service import get_ipam_utilization
        result = await get_ipam_utilization(api_client)
        assert result == []


# ─── Calico Service: get_bgp_peers ────────────────────────────────

class TestGetBgpPeers:
    @patch("services.calico_service.k8s_client.CustomObjectsApi")
    @pytest.mark.asyncio
    async def test_parses_bgp_peers(self, mock_custom_api: MagicMock):
        api_client = AsyncMock()
        mock_custom_api.return_value = api_client
        api_client.list_cluster_custom_object = AsyncMock()
        api_client.list_cluster_custom_object.return_value = {
            "items": [
                {
                    "metadata": {"name": "peer-1"},
                    "spec": {
                        "node": "worker-1",
                        "peerIP": "10.0.0.1",
                        "asNumber": 64512,
                        "nodeASNumber": 64513,
                        "sessionState": "up",
                    },
                },
                {
                    "metadata": {"name": "peer-2"},
                    "spec": {
                        "node": "worker-2",
                        "peerIP": "10.0.0.2",
                        "sessionState": "down",
                    },
                },
            ]
        }

        from services.calico_service import get_bgp_peers
        result = await get_bgp_peers(api_client)

        assert len(result) == 2
        assert result[0]["name"] == "peer-1"
        assert result[0]["peer_as_number"] == 64512
        # The CRD has no session state — it is never fabricated from spec.
        assert result[0]["session_state"] is None
        assert result[1]["name"] == "peer-2"
        assert result[1]["peer_as_number"] is None  # not provided
        assert result[1]["session_state"] is None

    @patch("services.calico_service.k8s_client.CustomObjectsApi")
    @pytest.mark.asyncio
    async def test_no_peers_returns_empty_list(self, mock_custom_api: MagicMock):
        api_client = AsyncMock()
        mock_custom_api.return_value = api_client
        api_client.list_cluster_custom_object = AsyncMock()
        api_client.list_cluster_custom_object.return_value = {"items": []}

        from services.calico_service import get_bgp_peers
        result = await get_bgp_peers(api_client)
        assert result == []


# ─── Felix Metrics Service ────────────────────────────────────────

class TestGetFelixMetrics:
    @patch("services.felix_metrics_service.query_prometheus")
    @pytest.mark.asyncio
    async def test_returns_summed_scalar_values(self, mock_query: AsyncMock):
        """Multiple Prometheus results should be summed per metric key."""
        mock_query.side_effect = [
            {"result": [{"value": [12345, "8"]}, {"value": [12346, "6"]}]},  # active_local_endpoints
            # cluster_network_policies: same value on both nodes — must not sum
            {"result": [{"value": [12345, "2"]}, {"value": [12346, "2"]}]},
            {"result": [{"value": [12345, "0"]}]},                          # iptables_restore_errors
            {"result": [{"value": [12345, "1"]}, {"value": [12346, "1"]}]}, # bgp_sessions_active
            {"result": [{"value": [12345, "0"]}]},                          # int_dataplane_failures
        ]

        from config import Settings
        from services.felix_metrics_service import get_felix_metrics

        settings = Settings(API_KEY="test")
        result = await get_felix_metrics(settings)

        assert result["active_local_endpoints"] == pytest.approx(14.0)
        assert result["cluster_network_policies"] == pytest.approx(2.0)
        assert result["iptables_restore_errors"] == pytest.approx(0.0)
        assert result["bgp_sessions_active"] == pytest.approx(2.0)

    @patch("services.felix_metrics_service.query_prometheus")
    @pytest.mark.asyncio
    async def test_returns_none_on_query_failure(self, mock_query: AsyncMock):
        """When Prometheus query raises, each metric defaults to None."""
        mock_query.side_effect = RuntimeError("Prometheus unreachable")

        from config import Settings
        from services.felix_metrics_service import get_felix_metrics

        settings = Settings(API_KEY="test")
        result = await get_felix_metrics(settings)

        for key in ("active_local_endpoints", "cluster_network_policies",
                     "iptables_restore_errors", "bgp_sessions_active",
                     "int_dataplane_failures"):
            assert result[key] is None

    @patch("services.felix_metrics_service.query_prometheus")
    @pytest.mark.asyncio
    async def test_returns_none_on_empty_result(self, mock_query: AsyncMock):
        """Empty Prometheus result should yield None."""
        mock_query.return_value = {"result": []}

        from config import Settings
        from services.felix_metrics_service import get_felix_metrics

        settings = Settings(API_KEY="test")
        result = await get_felix_metrics(settings)

        for key, val in result.items():
            assert val is None, f"{key} should be None, got {val}"


# ─── Network Service: get_pods ────────────────────────────────────

class TestNetworkGetPods:
    @patch("services.network_service.k8s_client.CoreV1Api")
    @pytest.mark.asyncio
    async def test_returns_pod_list(self, mock_core_v1: MagicMock):
        api_client = AsyncMock()
        mock_v1 = AsyncMock()
        mock_core_v1.return_value = mock_v1

        # Build a mock pod with all the attributes the service reads
        pod = MagicMock()
        pod.metadata.name = "nginx-abc123"
        pod.metadata.namespace = "default"
        pod.status.pod_ip = "10.0.0.5"
        pod.status.phase = "Running"
        pod.spec.node_name = "worker-1"
        pod.metadata.labels = {"app": "nginx"}
        container_mock = MagicMock()
        container_mock.name = "nginx-container"
        container_mock.image = "nginx:latest"
        pod.spec.containers = [container_mock]

        mock_v1.list_pod_for_all_namespaces = AsyncMock()
        mock_v1.list_pod_for_all_namespaces.return_value = MagicMock(items=[pod])

        from services.network_service import get_pods
        result = await get_pods(api_client)

        assert len(result) == 1
        assert result[0].name == "nginx-abc123"
        assert result[0].namespace == "default"
        assert result[0].pod_ip == "10.0.0.5"
        assert result[0].phase == "Running"
        assert result[0].node_name == "worker-1"
        assert result[0].labels == {"app": "nginx"}
        assert len(result[0].containers) == 1
        assert result[0].containers[0]["name"] == "nginx-container"

    @patch("services.network_service.k8s_client.CoreV1Api")
    @pytest.mark.asyncio
    async def test_handles_missing_fields(self, mock_core_v1: MagicMock):
        """Pods without IP, node_name, or containers should not crash."""
        api_client = AsyncMock()
        mock_v1 = AsyncMock()
        mock_core_v1.return_value = mock_v1

        pod = MagicMock()
        pod.metadata.name = "no-ip-pod"
        pod.metadata.namespace = "default"
        pod.status.pod_ip = None
        pod.status.phase = None
        pod.spec.node_name = None
        pod.metadata.labels = {}
        pod.spec.containers = []

        mock_v1.list_pod_for_all_namespaces = AsyncMock()
        mock_v1.list_pod_for_all_namespaces.return_value = MagicMock(items=[pod])

        from services.network_service import get_pods
        result = await get_pods(api_client)

        assert len(result) == 1
        assert result[0].pod_ip is None
        assert result[0].phase is None
        assert result[0].node_name is None
        assert result[0].containers == []


# ─── Felix Metrics Time Series ────────────────────────────────────

class TestGetFelixTimeSeries:
    @patch("services.prometheus_service.query_range_prometheus")
    @pytest.mark.asyncio
    async def test_parses_range_results(self, mock_range_query: AsyncMock):
        """Time-series values should be parsed into {timestamp, value} dicts."""
        mock_range_query.return_value = {
            "result": [
                {
                    "metric": {},
                    "values": [
                        [1000000, "14.5"],
                        [1000030, "15.0"],
                    ],
                }
            ]
        }

        from config import Settings
        from services.felix_metrics_service import get_felix_metrics_time_series

        settings = Settings(API_KEY="test")
        result = await get_felix_metrics_time_series(settings, duration_minutes=5)

        assert "active_local_endpoints" in result
        assert len(result["active_local_endpoints"]) == 2
        assert result["active_local_endpoints"][0]["value"] == 14.5
        assert result["active_local_endpoints"][1]["value"] == 15.0

    @patch("services.prometheus_service.query_range_prometheus")
    @pytest.mark.asyncio
    async def test_empty_result_returns_empty_list(self, mock_range_query: AsyncMock):
        mock_range_query.return_value = None

        from config import Settings
        from services.felix_metrics_service import get_felix_metrics_time_series

        settings = Settings(API_KEY="test")
        result = await get_felix_metrics_time_series(settings, duration_minutes=5)

        for key in ("active_local_endpoints", "cluster_network_policies"):
            assert result[key] == []


# ─── AI service: live cluster snapshot ────────────────────────────

class TestAiClusterSnapshot:
    def _service(self, monkeypatch):
        from contextlib import asynccontextmanager
        from config import Settings
        from services.ai_service import AIService

        monkeypatch.setattr(
            "services.network_service.get_pods",
            AsyncMock(return_value=[
                MagicMock(namespace="default", phase="Running"),
                MagicMock(namespace="kube-system", phase="Running"),
                MagicMock(namespace="default", phase="Pending"),
            ]),
        )
        monkeypatch.setattr(
            "services.calico_service.get_cni_policies",
            AsyncMock(return_value=[
                {"type": "GlobalNetworkPolicy"},
                {"type": "NetworkPolicy"},
            ]),
        )
        monkeypatch.setattr(
            "services.calico_service.get_calico_nodes",
            AsyncMock(return_value=[
                {"node": "n1", "calico_ready": True},
                {"node": "n2", "calico_ready": False},
            ]),
        )

        @asynccontextmanager
        async def fake_k8s_client():
            yield AsyncMock()

        service = AIService(Settings(AI_ENABLED=True, AI_API_KEY="test"))
        service._k8s_client = fake_k8s_client
        return service

    @pytest.mark.asyncio
    async def test_counts_and_degrades_on_failure(self, monkeypatch):
        """Snapshot aggregates real totals; a failing section is marked, not raised."""
        monkeypatch.setattr(
            "services.calico_service.get_ip_pools",
            AsyncMock(side_effect=RuntimeError("CRD missing")),
        )
        snapshot = await self._service(monkeypatch)._cluster_snapshot()

        assert snapshot["pods"] == {
            "total": 3,
            "namespaces": 2,
            "by_phase": {"Running": 2, "Pending": 1},
        }
        assert snapshot["nodes"] == {"total": 2, "calico_not_ready": ["n2"]}
        assert snapshot["policies"] == {
            "total": 2,
            "by_type": {"GlobalNetworkPolicy": 1, "NetworkPolicy": 1},
        }
        assert "ip_pools" not in snapshot
        assert snapshot["unavailable"] == ["ip_pools"]

    @pytest.mark.asyncio
    async def test_chat_injects_snapshot_into_system_prompt(self, monkeypatch):
        """The model receives the live totals, not just the bare instructions."""
        monkeypatch.setattr(
            "services.calico_service.get_ip_pools", AsyncMock(return_value=[])
        )
        service = self._service(monkeypatch)
        service._run_conversation = AsyncMock(return_value="ok")

        await service.chat([{"role": "user", "content": "how many pods?"}])

        system = service._run_conversation.await_args.args[1][0]
        assert system["role"] == "system"
        assert "Live cluster snapshot" in system["content"]
        assert '"total": 3' in system["content"]


# ─── AI service: diagnostic tools ─────────────────────────────────

def _fake_ai_service():
    from contextlib import asynccontextmanager
    from config import Settings
    from services.ai_service import AIService

    @asynccontextmanager
    async def fake_k8s_client():
        yield AsyncMock()

    service = AIService(Settings(AI_ENABLED=True, AI_API_KEY="test"))
    service._k8s_client = fake_k8s_client
    return service


class TestAiDiagnosticTools:
    @pytest.mark.asyncio
    async def test_events_newest_first_and_capped(self, monkeypatch):
        """Events come back newest first, capped at the requested limit."""
        from datetime import datetime, timedelta, timezone
        from types import SimpleNamespace

        now = datetime.now(timezone.utc)

        def event(minutes_ago, name):
            ts = now - timedelta(minutes=minutes_ago)
            return SimpleNamespace(
                metadata=SimpleNamespace(namespace="shop", creation_timestamp=ts),
                last_timestamp=ts,
                event_time=None,
                type="Warning",
                reason="BackOff",
                involved_object=SimpleNamespace(kind="Pod", name=name),
                message="Back-off restarting failed container",
                count=3,
            )

        api = MagicMock()
        api.list_event_for_all_namespaces = AsyncMock(
            return_value=SimpleNamespace(
                items=[event(5, "old"), event(0, "new"), event(1, "mid")]
            )
        )
        monkeypatch.setattr("kubernetes_asyncio.client.CoreV1Api", lambda _client: api)

        events = await _fake_ai_service()._tool_events({"limit": 2})

        assert [e["object"] for e in events] == ["Pod/new", "Pod/mid"]

    @pytest.mark.asyncio
    async def test_ipam_failure_becomes_tool_error(self, monkeypatch):
        """A failing IPAM read reaches the model as an error, not an exception."""
        monkeypatch.setattr(
            "services.calico_service.get_ipam_utilization",
            AsyncMock(side_effect=RuntimeError("no ipamblocks")),
        )

        out = await _fake_ai_service()._execute_tool("get_ipam", {})

        assert "Failed to fetch get_ipam" in out

    @pytest.mark.asyncio
    async def test_pod_policies_returns_selecting_policies_and_rules(self, monkeypatch):
        """Reachability answer: the pod's endpoint state plus its policies' rules."""
        from models.network import PodNetwork

        pods = [
            PodNetwork(name="web", namespace="shop", labels={"app": "web"}, phase="Running", pod_ip="10.0.0.1"),
            PodNetwork(name="db", namespace="shop", labels={"app": "db"}, phase="Running", pod_ip="10.0.0.2"),
        ]
        policies = [{
            "name": "allow-db",
            "namespace": "shop",
            "type": "NetworkPolicy",
            "selector": "app == 'web'",
            "ingress": [{"action": "Allow", "source": {"selector": "app == 'db'"}}],
            "egress": [],
        }]
        monkeypatch.setattr("services.network_service.get_pods", AsyncMock(return_value=pods))
        monkeypatch.setattr(
            "services.calico_service.get_cni_policies_detailed", AsyncMock(return_value=policies)
        )

        result = await _fake_ai_service()._tool_pod_policies(
            {"namespace": "shop", "pod": "web"}
        )

        assert result["endpoint"]["selecting_policies"] == [
            {"name": "allow-db", "type": "NetworkPolicy"}
        ]
        assert result["policies"][0]["selected_pods"] == [
            {"namespace": "shop", "pod_name": "web"}
        ]

    @pytest.mark.asyncio
    async def test_logs_are_returned_unquoted(self, monkeypatch):
        """Log text reaches the model as plain text, not a JSON-escaped string."""
        api = MagicMock()
        api.read_namespaced_pod_log = AsyncMock(return_value="2026-01-01T00:00:00Z boom")
        monkeypatch.setattr("kubernetes_asyncio.client.CoreV1Api", lambda _client: api)

        out = await _fake_ai_service()._execute_tool(
            "get_pod_logs", {"namespace": "shop", "pod": "web"}
        )

        assert out == "2026-01-01T00:00:00Z boom"


# ─── RAG grounded knowledge ─────────────────────────────────────────────

class TestRagRetrieval:
    def test_returns_top_match_for_ip_exhaustion_question(self):
        chunks = retrieve("why can my pod not get an ip address")
        assert len(chunks) >= 1
        top = chunks[0]
        assert "ipam" in top["text"].lower() or "exhaustion" in top["text"].lower()
        assert "source" in top

    def test_returns_at_most_three(self):
        chunks = retrieve("why can my pod not get an ip address")
        assert len(chunks) <= 3

    def test_empty_query_returns_nothing(self):
        assert retrieve("") == []


class TestRagPrompt:
    def test_includes_relevant_chunk_with_source(self):
        prompt = _rag_prompt("why can my pod not get an ip address")
        assert "Grounded project knowledge" in prompt
        assert "source:" in prompt
        assert "IPAM" in prompt or "ipam" in prompt.lower()

    def test_empty_query_produces_no_section(self):
        assert _rag_prompt("") == ""


class TestAiChatIncludesRag:
    def _service(self, monkeypatch):
        from contextlib import asynccontextmanager
        from config import Settings
        from services.ai_service import AIService

        @asynccontextmanager
        async def fake_k8s_client():
            yield AsyncMock()

        service = AIService(Settings(AI_ENABLED=True, AI_API_KEY="test"))
        service._k8s_client = fake_k8s_client
        return service

    @pytest.mark.asyncio
    async def test_chat_builds_prompt_with_grounded_knowledge_section(self, monkeypatch):
        monkeypatch.setattr(
            "services.calico_service.get_ip_pools", AsyncMock(return_value=[])
        )
        monkeypatch.setattr(
            "services.calico_service.get_calico_nodes",
            AsyncMock(return_value=[]),
        )
        monkeypatch.setattr(
            "services.calico_service.get_cni_policies", AsyncMock(return_value=[])
        )
        monkeypatch.setattr(
            "services.network_service.get_pods",
            AsyncMock(return_value=[]),
        )
        service = self._service(monkeypatch)
        service._run_conversation = AsyncMock(return_value="ok")

        await service.chat([{"role": "user", "content": "why can my pod not get an ip?"}])

        system = service._run_conversation.await_args.args[1][0]
        content = system["content"]
        assert "Grounded project knowledge" in content
        assert "source:" in content
        # IPAM-per-pool fact should be pulled in for this query.
        assert "IPAM" in content or "ipam" in content.lower()