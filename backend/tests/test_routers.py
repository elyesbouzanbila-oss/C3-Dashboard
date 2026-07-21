"""
Integration tests for all FastAPI routers.

Tests request parsing, response envelope, error handling, and mock fallback
behavior by overriding Kubernetes client and auth dependencies with controlled mocks.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from typing import Any, Dict, List, Tuple

import pytest
from fastapi.testclient import TestClient

from main import app
from config import Settings
from fastapi import Header, HTTPException
from typing import Optional

from dependencies import get_k8s_client, get_settings_dep
from models.mock_data import (
    MOCK_CALICO_NODES,
    MOCK_BGP_PEERS,
    MOCK_IP_POOLS,
    MOCK_IPAM_BLOCKS,
    MOCK_CNI_POLICIES,
    MOCK_FELIX_METRICS,
    MOCK_PODS,
    MOCK_RBAC,
    MOCK_PRIVILEGED,
)

# ─── Test configuration ──────────────────────────────────────────
TEST_SETTINGS = Settings(API_KEY="test-key")

# ─── Override FastAPI dependencies ───────────────────────────────

async def _override_get_k8s_client() -> AsyncMock:
    """Override that returns a mock K8s ApiClient.
    
    No API key check needed — the frontend no longer ships the API key.
    """
    return AsyncMock()

def _override_settings() -> Settings:
    return TEST_SETTINGS

app.dependency_overrides.clear()
app.dependency_overrides[get_settings_dep] = _override_settings
app.dependency_overrides[get_k8s_client] = _override_get_k8s_client

client = TestClient(app)


# ─── Response helpers ─────────────────────────────────────────────

def assert_ok(resp, expected_status: str = "success") -> Dict[str, Any]:
    """Assert 200 and return parsed body with the expected top-level status."""
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
    body = resp.json()
    assert body.get("status") == expected_status, (
        f"Expected status={expected_status!r}, got {body.get('status')!r}"
    )
    return body


# ─── CNI Router — /api/cni/ ───────────────────────────────────────

class TestCniNodes:
    PATCH_TARGET = "services.calico_service.get_calico_nodes"

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_success(self, mock_fn):
        mock_fn.return_value = [{"node": "n1", "felix_ready": True}]
        body = assert_ok(client.get("/api/cni/nodes"))
        assert body["data"] == [{"node": "n1", "felix_ready": True}]

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_mock_fallback(self, mock_fn):
        mock_fn.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/nodes"), "mock")
        for expected, actual in zip(MOCK_CALICO_NODES, body["data"]):
            assert expected["node"] == actual["node"]
            assert expected["felix_ready"] == actual["felix_ready"]


class TestCniBgpPeers:
    PATCH_TARGET = "services.calico_service.get_bgp_peers"

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_success(self, mock_fn):
        mock_fn.return_value = [{"name": "peer-1", "session_state": "up"}]
        body = assert_ok(client.get("/api/cni/bgp-peers"))
        assert body["data"][0]["name"] == "peer-1"
        assert body["data"][0]["session_state"] == "up"

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_mock_fallback(self, mock_fn):
        mock_fn.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/bgp-peers"), "mock")
        assert body["data"] == MOCK_BGP_PEERS


class TestCniIpPools:
    PATCH_TARGET = "services.calico_service.get_ip_pools"

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_success(self, mock_fn):
        mock_fn.return_value = [{"name": "pool-1", "cidr": "10.0.0.0/16"}]
        body = assert_ok(client.get("/api/cni/ippools"))
        assert body["data"] == [{"name": "pool-1", "cidr": "10.0.0.0/16"}]

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_mock_fallback(self, mock_fn):
        mock_fn.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/ippools"), "mock")
        assert body["data"] == MOCK_IP_POOLS


class TestCniIpamUtilization:
    PATCH_TARGET = "services.calico_service.get_ipam_utilization"

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_success(self, mock_fn):
        mock_fn.return_value = [{"pool": "default-ipv4-ippool", "utilization_pct": 9.4}]
        body = assert_ok(client.get("/api/cni/ipam/utilization"))
        assert body["data"][0]["utilization_pct"] == 9.4

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_mock_fallback(self, mock_fn):
        mock_fn.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/ipam/utilization"), "mock")
        assert body["data"] == MOCK_IPAM_BLOCKS


class TestCniPolicies:
    PATCH_TARGET = "services.calico_service.get_cni_policies"

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_success(self, mock_fn):
        mock_fn.return_value = [{"name": "default-deny", "rules_count": 2}]
        body = assert_ok(client.get("/api/cni/policies"))
        assert body["data"][0]["rules_count"] == 2

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_mock_fallback(self, mock_fn):
        mock_fn.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/policies"), "mock")
        assert body["data"] == MOCK_CNI_POLICIES


class TestCniTopology:
    PATCH_TARGET = "services.calico_service.get_cni_topology"

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_success(self, mock_fn):
        mock_fn.return_value = {
            "nodes": [{"id": "node:m1", "type": "node", "name": "m1"}],
            "edges": [],
        }
        body = assert_ok(client.get("/api/cni/topology"))
        assert len(body["data"]["nodes"]) == 1

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_mock_fallback(self, mock_fn):
        mock_fn.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/topology"), "mock")
        assert len(body["data"]["nodes"]) > 0
        assert "edges" in body["data"]


class TestCniFelixMetrics:
    PATCH_GAUGES = "routers.cni.get_felix_metrics"

    @patch(PATCH_GAUGES, new_callable=AsyncMock)
    def test_success(self, mock_gauges):
        mock_gauges.return_value = {"active_local_endpoints": 14, "bgp_sessions_active": 2}
        body = assert_ok(client.get("/api/cni/metrics/felix"))
        assert body["data"]["active_local_endpoints"] == 14

    @patch(PATCH_GAUGES, new_callable=AsyncMock)
    def test_success_with_time_series(self, mock_gauges):
        mock_gauges.return_value = {"active_local_endpoints": 14}
        with patch("routers.cni.get_felix_metrics_time_series", new_callable=AsyncMock) as mock_series:
            mock_series.return_value = {
                "active_local_endpoints": [
                    {"timestamp": "2025-07-03T12:00:00Z", "value": 14.0}
                ]
            }
            body = assert_ok(
                client.get("/api/cni/metrics/felix?include_series=true")
            )
            assert "time_series" in body
            assert len(body["time_series"]["active_local_endpoints"]) == 1

    @patch(PATCH_GAUGES, new_callable=AsyncMock)
    def test_mock_fallback(self, mock_gauges):
        mock_gauges.side_effect = RuntimeError("Prometheus unreachable")
        body = assert_ok(client.get("/api/cni/metrics/felix"), "mock")
        assert body["data"] == MOCK_FELIX_METRICS


class TestCniPolicyCoverage:
    PATCH_TARGET = "services.network_service.get_pods"
    PATCH_POLICIES = "routers.cni.calico_service.get_cni_policies"

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    @patch(PATCH_POLICIES, new_callable=AsyncMock)
    def test_success(self, mock_policies, mock_pods):
        """Success path returns coverage data with exposed/covered pods."""
        from types import SimpleNamespace
        mock_pods.return_value = [
            SimpleNamespace(**{"name": "pod-a", "namespace": "default", "labels": {"app": "nginx"}}),
            SimpleNamespace(**{"name": "pod-b", "namespace": "default", "labels": {"app": "redis"}}),
        ]
        mock_policies.return_value = [
            {"name": "allow-nginx", "namespace": "default", "type": "NetworkPolicy",
             "selector": "app == 'nginx'"},
        ]
        body = assert_ok(client.get("/api/cni/policies/coverage"))
        assert len(body["data"]) == 2
        covered = next(d for d in body["data"] if d["pod_name"] == "pod-a")
        exposed = next(d for d in body["data"] if d["pod_name"] == "pod-b")
        assert covered["exposed"] is False
        assert covered["selecting_policies"] == ["allow-nginx"]
        assert exposed["exposed"] is True
        assert exposed["selecting_policies"] == []

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    @patch(PATCH_POLICIES, new_callable=AsyncMock)
    def test_mock_fallback(self, mock_policies, mock_pods):
        """When K8s services fail, fall back to MOCK_COVERAGE."""
        mock_pods.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/policies/coverage"), "mock")
        assert len(body["data"]) > 0
        assert all("pod_name" in d for d in body["data"])
        assert all("exposed" in d for d in body["data"])
        assert any(d["exposed"] for d in body["data"])


class TestCniConnectivityDiagnostics:
    _AUTH_HEADERS = {"X-API-Key": "test-key-not-real"}

    def test_requires_target(self):
        """POST without target_pod or target_service returns 400."""
        resp = client.post(
            "/api/cni/diagnostics/connectivity",
            params={"source_pod": "my-pod"},
            headers=self._AUTH_HEADERS,
        )
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text[:200]}"

    @patch("kubernetes_asyncio.client.CoreV1Api")
    def test_mock_fallback(self, mock_core_v1):
        """When K8s is unavailable, the endpoint falls back to mock data."""
        mock_core_v1.side_effect = RuntimeError("no cluster")
        body = assert_ok(
            client.post(
                "/api/cni/diagnostics/connectivity",
                params={
                    "source_pod": "my-pod",
                    "source_namespace": "default",
                    "target_service": "my-svc",
                    "target_namespace": "default",
                    "target_port": 80,
                },
                headers=self._AUTH_HEADERS,
            ),
            "mock",
        )
        assert body["data"]["reachable"] is True
        assert body["data"]["latency_ms"] == 2.3


# ─── Network Router — /api/network/ ───────────────────────────────

class TestNetworkPods:
    @patch("kubernetes_asyncio.client.CoreV1Api")
    def test_mock_fallback(self, mock_core_v1):
        """When K8s is unavailable, the endpoint falls back to mock data."""
        mock_core_v1.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/network/pods"), "mock")
        assert "items" in body
        assert len(body["items"]) > 0
        assert body["items"][0] == MOCK_PODS[0]


class TestNetworkTopology:
    @patch("kubernetes_asyncio.client.CoreV1Api")
    def test_mock_fallback(self, mock_core_v1):
        mock_core_v1.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/network/topology"), "mock")
        assert "nodes" in body
        assert "edges" in body
        assert len(body["nodes"]) > 0


# ─── Mock Router — /mock/ ─────────────────────────────────────────

class TestMockEndpoints:
    def test_mock_pods(self):
        """Mock pods endpoint now returns consistent status envelope."""
        body = client.get("/mock/pods").json()
        assert body["status"] == "mock"
        assert body["items"] == MOCK_PODS

    def test_mock_topology(self):
        body = client.get("/mock/topology").json()
        assert "nodes" in body
        assert "edges" in body

    def test_mock_rbac(self):
        body = client.get("/mock/rbac").json()
        assert body == MOCK_RBAC

    def test_mock_privileged(self):
        body = client.get("/mock/privileged").json()
        assert body == MOCK_PRIVILEGED


# ─── Threat Router — /api/threats/ ───────────────────────────────

import json
import hashlib
import hmac


class TestFalcoWebhook:
    PAYLOAD_DICT = {
        "output": "File opened for writing",
        "priority": "Warning",
        "rule": "Write below binary dir",
        "time": "2025-07-03T12:00:00Z",
    }

    @patch("routers.threats.ThreatService")
    def test_publish_falco_event_without_secret(self, mock_service_cls):
        """Falco webhook works without a signature when FALCO_WEBHOOK_SECRET is not set."""
        mock_instance = MagicMock()
        mock_service_cls.return_value = mock_instance
        mock_instance.publish_falco_event = AsyncMock()

        body = client.post("/api/threats/falco", json=self.PAYLOAD_DICT).json()
        assert body["status"] == "ok"
        mock_instance.publish_falco_event.assert_awaited_once()

    @patch("routers.threats.ThreatService")
    def test_publish_falco_event_with_valid_signature(self, mock_service_cls):
        """Falco webhook accepts valid HMAC signature when secret is set."""
        mock_instance = MagicMock()
        mock_service_cls.return_value = mock_instance
        mock_instance.publish_falco_event = AsyncMock()

        secret = "test-falco-secret"
        raw_body = json.dumps(self.PAYLOAD_DICT, separators=(",", ":")).encode()
        expected_sig = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()

        orig_override = app.dependency_overrides[get_settings_dep]

        def _override_with_secret():
            return Settings(API_KEY="test-key", FALCO_WEBHOOK_SECRET=secret)

        app.dependency_overrides[get_settings_dep] = _override_with_secret
        try:
            resp = client.post(
                "/api/threats/falco",
                content=raw_body,
                headers={
                    "Content-Type": "application/json",
                    "X-Falco-Signature": expected_sig,
                },
            )
            body = resp.json()
            assert body["status"] == "ok", f"Expected ok, got {resp.status_code}: {resp.text[:200]}"
            mock_instance.publish_falco_event.assert_awaited_once()
        finally:
            app.dependency_overrides[get_settings_dep] = orig_override

    @patch("routers.threats.ThreatService")
    def test_publish_falco_event_with_invalid_signature(self, mock_service_cls):
        """Falco webhook rejects invalid HMAC signature when secret is set."""
        mock_instance = MagicMock()
        mock_service_cls.return_value = mock_instance
        mock_instance.publish_falco_event = AsyncMock()

        secret = "test-falco-secret"
        raw_body = json.dumps(self.PAYLOAD_DICT).encode()

        orig_override = app.dependency_overrides[get_settings_dep]

        def _override_with_secret():
            return Settings(API_KEY="test-key", FALCO_WEBHOOK_SECRET=secret)

        app.dependency_overrides[get_settings_dep] = _override_with_secret
        try:
            resp = client.post(
                "/api/threats/falco",
                content=raw_body,
                headers={
                    "Content-Type": "application/json",
                    "X-Falco-Signature": "invalid-signature",
                },
            )
            assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text[:200]}"
            mock_instance.publish_falco_event.assert_not_called()
        finally:
            app.dependency_overrides[get_settings_dep] = orig_override
