"""
Integration tests for all FastAPI routers.

Tests request parsing, response envelope, error handling, and mock fallback
behavior by overriding Kubernetes client and auth dependencies with controlled mocks.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from typing import Any, Dict, List, Tuple
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from main import app
from config import Settings
from fastapi import Header, HTTPException
from services import auth_service
from typing import Optional

from dependencies import get_k8s_client, get_settings_dep, real_client_ip
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


# ─── Probe endpoints — /healthz and /readyz ───────────────────────
# These back the Kubernetes liveness/readiness probes on the backend
# Deployment. If these routes are ever removed, the pods crash-loop
# in-cluster, so the contract is pinned here.

class TestProbeEndpoints:
    def test_healthz(self):
        """Liveness endpoint returns 200 ok."""
        assert_ok(client.get("/healthz"), "ok")

    def test_readyz(self):
        """Readiness endpoint returns 200 ready."""
        assert_ok(client.get("/readyz"), "ready")


# ─── CNI Router — /api/cni/ ───────────────────────────────────────

class TestCniNodes:
    PATCH_TARGET = "services.calico_service.get_calico_nodes"

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_success(self, mock_fn):
        mock_fn.return_value = [{"node": "n1", "felix_ready": True}]
        body = assert_ok(client.get("/api/cni/nodes"))
        assert body["data"] == [{"node": "n1", "felix_ready": True}]

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_error_fallback(self, mock_fn, monkeypatch):
        """K8s failure returns error status (mock data only in K8S_MODE=mock)."""
        monkeypatch.delenv("K8S_MODE", raising=False)
        mock_fn.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/nodes"), "error")
        assert body["data"] == []
        # Error detail stays server-side (leaked only to logs).
        assert "no cluster" not in body.get("error", "")

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_mock_mode_fallback(self, mock_fn, monkeypatch):
        """With K8S_MODE=mock, the endpoint serves fabricated demo data."""
        monkeypatch.setenv("K8S_MODE", "mock")
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
    def test_error_fallback(self, mock_fn, monkeypatch):
        """K8s failure returns error status (mock data only in K8S_MODE=mock)."""
        monkeypatch.delenv("K8S_MODE", raising=False)
        mock_fn.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/bgp-peers"), "error")
        assert body["data"] == []

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_mock_mode_fallback(self, mock_fn, monkeypatch):
        monkeypatch.setenv("K8S_MODE", "mock")
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
    def test_error_fallback(self, mock_fn, monkeypatch):
        """K8s failure returns error status (mock data only in K8S_MODE=mock)."""
        monkeypatch.delenv("K8S_MODE", raising=False)
        mock_fn.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/ippools"), "error")
        assert body["data"] == []

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_mock_mode_fallback(self, mock_fn, monkeypatch):
        monkeypatch.setenv("K8S_MODE", "mock")
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
    def test_error_fallback(self, mock_fn, monkeypatch):
        """K8s failure returns error status (mock data only in K8S_MODE=mock)."""
        monkeypatch.delenv("K8S_MODE", raising=False)
        mock_fn.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/ipam/utilization"), "error")
        assert body["data"] == []

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_mock_mode_fallback(self, mock_fn, monkeypatch):
        monkeypatch.setenv("K8S_MODE", "mock")
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
    def test_error_fallback(self, mock_fn, monkeypatch):
        """K8s failure returns error status (mock data only in K8S_MODE=mock)."""
        monkeypatch.delenv("K8S_MODE", raising=False)
        mock_fn.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/policies"), "error")
        assert body["data"] == []

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_mock_mode_fallback(self, mock_fn, monkeypatch):
        monkeypatch.setenv("K8S_MODE", "mock")
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
    def test_error_fallback(self, mock_fn, monkeypatch):
        """K8s failure returns error status (mock data only in K8S_MODE=mock)."""
        monkeypatch.delenv("K8S_MODE", raising=False)
        mock_fn.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/topology"), "error")
        assert body["data"] == {"nodes": [], "edges": []}

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    def test_mock_mode_fallback(self, mock_fn, monkeypatch):
        monkeypatch.setenv("K8S_MODE", "mock")
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
    def test_error_fallback(self, mock_gauges, monkeypatch):
        """Prometheus failure returns error status (mock data only in K8S_MODE=mock)."""
        monkeypatch.delenv("K8S_MODE", raising=False)
        mock_gauges.side_effect = RuntimeError("Prometheus unreachable")
        body = assert_ok(client.get("/api/cni/metrics/felix"), "error")
        assert body["data"] == {}

    @patch(PATCH_GAUGES, new_callable=AsyncMock)
    def test_mock_mode_fallback(self, mock_gauges, monkeypatch):
        monkeypatch.setenv("K8S_MODE", "mock")
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
    def test_advanced_selectors_evaluated(self, mock_policies, mock_pods):
        """Advanced selectors (startsWith, &&) are now evaluated, not misclassified."""
        from types import SimpleNamespace
        mock_pods.return_value = [
            SimpleNamespace(**{"name": "web-1", "namespace": "default", "labels": {"app": "web", "tier": "frontend"}}),
            SimpleNamespace(**{"name": "db-1", "namespace": "default", "labels": {"app": "db"}}),
        ]
        mock_policies.return_value = [
            {"name": "allow-web", "namespace": "default", "type": "NetworkPolicy",
             "selector": "app startsWith 'we' && has(tier)"},
        ]
        body = assert_ok(client.get("/api/cni/policies/coverage"))
        data = {d["pod_name"]: d for d in body["data"]}
        assert data["web-1"]["exposed"] is False
        assert data["web-1"]["selecting_policies"] == ["allow-web"]
        assert data["db-1"]["exposed"] is True
        # Fully-evaluable selectors produce no warnings
        assert "unsupported_selectors" not in body

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    @patch(PATCH_POLICIES, new_callable=AsyncMock)
    def test_unsupported_selector_surfaced(self, mock_policies, mock_pods):
        """Unparseable selectors are surfaced by name so the UI can warn."""
        from types import SimpleNamespace
        mock_pods.return_value = [
            SimpleNamespace(**{"name": "web-1", "namespace": "default", "labels": {"app": "web"}}),
        ]
        mock_policies.return_value = [
            {"name": "legacy-policy", "namespace": "default", "type": "NetworkPolicy",
             "selector": "app == 'web' &&"},
        ]
        body = assert_ok(client.get("/api/cni/policies/coverage"))
        assert body["unsupported_selectors"] == [
            {"policy_name": "legacy-policy", "selector": "app == 'web' &&"}
        ]
        # The broken policy is not counted as covering the pod
        assert body["data"][0]["exposed"] is True
        assert body["data"][0]["selecting_policies"] == []

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    @patch(PATCH_POLICIES, new_callable=AsyncMock)
    def test_error_fallback(self, mock_policies, mock_pods, monkeypatch):
        """K8s failure returns error status (mock data only in K8S_MODE=mock)."""
        monkeypatch.delenv("K8S_MODE", raising=False)
        mock_pods.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/policies/coverage"), "error")
        assert body["data"] == []

    @patch(PATCH_TARGET, new_callable=AsyncMock)
    @patch(PATCH_POLICIES, new_callable=AsyncMock)
    def test_mock_mode_fallback(self, mock_policies, mock_pods, monkeypatch):
        """With K8S_MODE=mock, fall back to MOCK_COVERAGE."""
        monkeypatch.setenv("K8S_MODE", "mock")
        mock_pods.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/policies/coverage"), "mock")
        assert len(body["data"]) > 0
        assert all("pod_name" in d for d in body["data"])
        assert all("exposed" in d for d in body["data"])
        assert any(d["exposed"] for d in body["data"])


class TestCniPolicyMatrix:
    PATCH_PODS = "services.network_service.get_pods"
    PATCH_POLICIES = "routers.cni.calico_service.get_cni_policies_detailed"

    @patch(PATCH_PODS, new_callable=AsyncMock)
    @patch(PATCH_POLICIES, new_callable=AsyncMock)
    def test_success(self, mock_policies, mock_pods):
        """Success path returns both workload endpoints and policy impacts."""
        from types import SimpleNamespace
        mock_pods.return_value = [
            SimpleNamespace(**{
                "name": "api-1", "namespace": "production",
                "labels": {"app": "api-server"},
                "node_name": "worker-1", "pod_ip": "10.244.1.10", "phase": "Running",
            }),
        ]
        mock_policies.return_value = [
            {
                "name": "allow-api-egress", "namespace": "production",
                "type": "NetworkPolicy", "selector": "app == 'api-server'",
                "ingress": [],
                "egress": [{"action": "Allow", "destination": {"selector": "app == 'database'", "ports": [5432]}}],
            },
        ]
        body = assert_ok(client.get("/api/cni/policy-matrix"))
        assert "workload_endpoints" in body["data"]
        assert "policy_impacts" in body["data"]
        ep = body["data"]["workload_endpoints"][0]
        assert ep["pod_name"] == "api-1"
        assert ep["exposed"] is False
        assert ep["interface_status"] == "up"
        imp = body["data"]["policy_impacts"][0]
        assert imp["name"] == "allow-api-egress"
        assert imp["selected_count"] == 1

    @patch(PATCH_PODS, new_callable=AsyncMock)
    @patch(PATCH_POLICIES, new_callable=AsyncMock)
    def test_error_fallback(self, mock_policies, mock_pods, monkeypatch):
        """K8s failure returns error status (mock data only in K8S_MODE=mock)."""
        monkeypatch.delenv("K8S_MODE", raising=False)
        mock_pods.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/policy-matrix"), "error")
        assert body["data"] == {"workload_endpoints": [], "policy_impacts": []}
        # Error detail stays server-side (leaked only to logs).
        assert "no cluster" not in body.get("error", "")

    @patch(PATCH_PODS, new_callable=AsyncMock)
    @patch(PATCH_POLICIES, new_callable=AsyncMock)
    def test_mock_mode_fallback(self, mock_policies, mock_pods, monkeypatch):
        """With K8S_MODE=mock, serve the demo policy matrix built from mock data."""
        monkeypatch.setenv("K8S_MODE", "mock")
        mock_pods.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/cni/policy-matrix"), "mock")
        assert len(body["data"]["workload_endpoints"]) > 0
        assert len(body["data"]["policy_impacts"]) > 0
        assert all("pod_name" in d for d in body["data"]["workload_endpoints"])
        assert all("selected_pods" in d for d in body["data"]["policy_impacts"])


class TestCniConnectivityDiagnostics:
    _TEST_PASSWORD = "test-pw"

    @staticmethod
    def _password_settings(monkeypatch):
        monkeypatch.setattr(
            "config.get_settings",
            lambda: Settings(API_KEY="test-key", SUPER_USER_PASSWORD=TestCniConnectivityDiagnostics._TEST_PASSWORD),
        )

    @staticmethod
    def _auth_headers():
        token = auth_service.create_token(TestCniConnectivityDiagnostics._TEST_PASSWORD)
        return {"X-Super-User-Token": token}

    def test_requires_target(self, monkeypatch):
        """POST without target_pod or target_service returns 400."""
        self._password_settings(monkeypatch)
        resp = client.post(
            "/api/cni/diagnostics/connectivity",
            params={"source_pod": "my-pod"},
            headers=self._auth_headers(),
        )
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text[:200]}"

    @patch("kubernetes_asyncio.client.CoreV1Api")
    def test_error_fallback(self, mock_core_v1, monkeypatch):
        """When K8s is unavailable, the endpoint returns an error status."""
        self._password_settings(monkeypatch)
        monkeypatch.delenv("K8S_MODE", raising=False)
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
                headers=self._auth_headers(),
            ),
            "error",
        )
        assert body["data"]["reachable"] is None
        assert "Diagnostic could not run" in body["data"]["note"]

    @patch("kubernetes_asyncio.client.CoreV1Api")
    def test_mock_mode_fallback(self, mock_core_v1, monkeypatch):
        """With K8S_MODE=mock, the endpoint serves a fabricated success result."""
        self._password_settings(monkeypatch)
        monkeypatch.setenv("K8S_MODE", "mock")
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
                headers=self._auth_headers(),
            ),
            "mock",
        )
        assert body["data"]["reachable"] is True
        assert body["data"]["latency_ms"] == 2.3


# ─── Network Router — /api/network/ ───────────────────────────────

class TestNetworkPods:
    @patch("kubernetes_asyncio.client.CoreV1Api")
    def test_error_fallback(self, mock_core_v1, monkeypatch):
        """When K8s is unavailable, the endpoint returns an error status."""
        monkeypatch.delenv("K8S_MODE", raising=False)
        mock_core_v1.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/network/pods"), "error")
        assert "items" in body
        assert body["items"] == []

    @patch("kubernetes_asyncio.client.CoreV1Api")
    def test_mock_mode_fallback(self, mock_core_v1, monkeypatch):
        """With K8S_MODE=mock, serve MOCK_PODS."""
        monkeypatch.setenv("K8S_MODE", "mock")
        mock_core_v1.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/network/pods"), "mock")
        assert "items" in body
        assert len(body["items"]) > 0
        assert body["items"][0] == MOCK_PODS[0]


class TestNetworkTopology:
    @patch("kubernetes_asyncio.client.CoreV1Api")
    def test_error_fallback(self, mock_core_v1, monkeypatch):
        monkeypatch.delenv("K8S_MODE", raising=False)
        mock_core_v1.side_effect = RuntimeError("no cluster")
        body = assert_ok(client.get("/api/network/topology"), "error")
        assert "nodes" in body
        assert "edges" in body
        assert body["nodes"] == []

    @patch("kubernetes_asyncio.client.CoreV1Api")
    def test_mock_mode_fallback(self, mock_core_v1, monkeypatch):
        monkeypatch.setenv("K8S_MODE", "mock")
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
from datetime import datetime, timedelta, timezone

from routers import threats as threats_router


def _falco_time(**delta):
    """Fresh RFC3339 falco timestamp, optionally shifted (e.g. hours=-2)."""
    return (datetime.now(timezone.utc) + timedelta(**delta)).strftime(
        "%Y-%m-%dT%H:%M:%S.%fZ"
    )[:26] + "Z"


class TestFalcoWebhook:
    # Dated "now": the stale-event filter would otherwise drop the payload
    # (it rejects events older than routers.threats._MAX_EVENT_AGE_SECONDS).
    PAYLOAD_DICT = {
        "output": "File opened for writing",
        "priority": "Warning",
        "rule": "Write below binary dir",
        "time": _falco_time(),
    }

    def _signed_post(self, payload_dict: dict, monkeypatch, *, replay: bool = False):
        """POST a correctly HMAC-signed falco event with controlled dedupe.

        Returns (response, ThreatService instance mock).
        """
        monkeypatch.setattr(
            threats_router, "_seen_signature_before", AsyncMock(return_value=replay)
        )
        secret = "test-falco-secret"
        raw_body = json.dumps(payload_dict, separators=(",", ":")).encode()
        expected_sig = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()

        orig_override = app.dependency_overrides[get_settings_dep]

        def _override_with_secret():
            return Settings(API_KEY="test-key", FALCO_WEBHOOK_SECRET=secret)

        app.dependency_overrides[get_settings_dep] = _override_with_secret
        try:
            with patch("routers.threats.ThreatService") as mock_service_cls:
                instance = MagicMock()
                mock_service_cls.return_value = instance
                instance.publish_falco_event = AsyncMock()
                instance.store_falco_event = AsyncMock()
                resp = client.post(
                    "/api/threats/falco",
                    content=raw_body,
                    headers={"X-Falco-Signature": expected_sig, "Content-Type": "application/json"},
                )
        finally:
            app.dependency_overrides[get_settings_dep] = orig_override
        return resp, instance

    def test_publish_falco_event_with_valid_signature(self, monkeypatch):
        """Falco webhook accepts a valid HMAC signature when the secret is set."""
        resp, instance = self._signed_post(self.PAYLOAD_DICT, monkeypatch)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        body = resp.json()
        assert body["status"] == "ok"
        assert body["events_processed"] == 1
        instance.publish_falco_event.assert_awaited_once()

    def test_publish_falco_event_rejects_replayed_signature(self, monkeypatch):
        """A signature already processed within the dedupe window → 409."""
        resp, instance = self._signed_post(self.PAYLOAD_DICT, monkeypatch, replay=True)
        assert resp.status_code == 409, f"Expected 409, got {resp.status_code}: {resp.text[:200]}"
        instance.publish_falco_event.assert_not_called()

    def test_publish_falco_event_filters_stale_events(self, monkeypatch):
        """Parseable timestamps older than the window are dropped, not stored."""
        stale = dict(self.PAYLOAD_DICT, time=_falco_time(hours=-2))
        resp, instance = self._signed_post(stale, monkeypatch)
        assert resp.status_code == 200
        body = resp.json()
        assert body["events_processed"] == 0
        assert body["events_filtered_stale"] == 1
        instance.publish_falco_event.assert_not_called()


class TestFalcoTimeParsing:
    """Unit tests for replay-window timestamp parsing."""

    def test_nanosecond_precision_is_parseable(self):
        """Falco emits 9-digit fractional seconds — beyond fromisoformat."""
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S") + ".123456789Z"
        parsed = threats_router._parse_event_time(ts)
        assert parsed is not None
        assert parsed.tzinfo is not None

    def test_epoch_millis_and_epoch_string(self):
        now = datetime.now(timezone.utc)
        parsed = threats_router._parse_event_time(int(now.timestamp() * 1000))
        assert parsed is not None
        assert abs((now - parsed).total_seconds()) < 1
        parsed = threats_router._parse_event_time(str(int(now.timestamp() * 1000)))
        assert parsed is not None

    def test_naive_timestamp_becomes_utc(self):
        parsed = threats_router._parse_event_time(
            datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        )
        assert parsed is not None
        assert parsed.tzinfo is not None

    def test_plus_hhmm_offset_is_normalised(self):
        parsed = threats_router._parse_event_time("2025-07-03T14:00:00.500000000+0100")
        assert parsed is not None
        assert parsed.utcoffset() == timedelta(hours=1)

    def test_garbage_is_none(self):
        assert threats_router._parse_event_time("not-a-date") is None
        assert threats_router._parse_event_time("") is None
        assert threats_router._parse_event_time(None) is None

    def test_stale_boundary(self):
        now = datetime.now(timezone.utc)
        old = now - timedelta(seconds=threats_router._MAX_EVENT_AGE_SECONDS + 1)
        fresh = now - timedelta(seconds=10)
        assert threats_router._is_stale_event(old, now) is True
        assert threats_router._is_stale_event(fresh, now) is False
        assert threats_router._is_stale_event(None, now) is False


class TestFalcoWebhookFailClosed:
    """Webhook auth failures — independent of the replay-window tests."""

    PAYLOAD_DICT = {
        "output": "File opened for writing",
        "priority": "Warning",
        "rule": "Write below binary dir",
        "time": _falco_time(),
    }

    @patch("routers.threats.ThreatService")
    def test_publish_falco_event_rejected_without_secret(self, mock_service_cls, monkeypatch):
        """Falco webhook is fail-closed: 503 when FALCO_WEBHOOK_SECRET is not set."""
        monkeypatch.delenv("FALCO_WEBHOOK_SECRET", raising=False)
        mock_instance = MagicMock()
        mock_service_cls.return_value = mock_instance
        mock_instance.publish_falco_event = AsyncMock()

        resp = client.post("/api/threats/falco", json=self.PAYLOAD_DICT)
        assert resp.status_code == 503, f"Expected 503, got {resp.status_code}"
        mock_instance.publish_falco_event.assert_not_awaited()

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


# ─── Security hardening — real-client-IP rate limiting ─────────────
# The limiter key must never be a client-writable header. The demo exploit
# rotated X-Forwarded-For to reset the 5/min auth budget; real_client_ip
# closes that by keying on X-Real-IP (nginx-set) or the socket peer.

class TestRealClientIp:
    def test_prefers_x_real_ip_over_spoofed_forwarded_for(self):
        """nginx-overwritten X-Real-IP wins even if the client spoofs XFF."""
        req = SimpleNamespace(
            headers={"X-Forwarded-For": "203.0.113.9", "X-Real-IP": "10.0.0.5"},
            client=SimpleNamespace(host="127.0.0.1"),
        )
        assert real_client_ip(req) == "10.0.0.5"

    def test_xff_rotation_does_not_rotate_the_bucket(self):
        """Direct connections ignore spoofed XFF and key on the peer address."""
        req1 = SimpleNamespace(headers={"X-Forwarded-For": "203.0.113.1"}, client=SimpleNamespace(host="127.0.0.1"))
        req2 = SimpleNamespace(headers={"X-Forwarded-For": "203.0.113.2"}, client=SimpleNamespace(host="127.0.0.1"))
        assert real_client_ip(req1) == "127.0.0.1"
        assert real_client_ip(req2) == "127.0.0.1"

    def test_falls_back_to_peer_address(self):
        req = SimpleNamespace(headers={}, client=SimpleNamespace(host="192.168.1.10"))
        assert real_client_ip(req) == "192.168.1.10"

    def test_no_client_returns_unknown(self):
        assert real_client_ip(SimpleNamespace(headers={}, client=None)) == "unknown"

    def test_whitespace_only_real_ip_falls_back_to_peer(self):
        """Whitespace-only X-Real-IP must not produce an empty limiter key.

        An empty key is falsy in slowapi's ``all(args)`` check, which would
        skip the limit entirely (bypass). It must fall back to the peer.
        """
        req = SimpleNamespace(
            headers={"X-Real-IP": "   "},
            client=SimpleNamespace(host="127.0.0.1"),
        )
        assert real_client_ip(req) == "127.0.0.1"
        # Empty value is falsy -> same fallback.
        req2 = SimpleNamespace(headers={"X-Real-IP": ""}, client=SimpleNamespace(host="127.0.0.1"))
        assert real_client_ip(req2) == "127.0.0.1"

    def test_distrusted_proxy_headers_fall_back_to_peer(self, monkeypatch):
        """With TRUST_PROXY_HEADERS disabled, client-set X-Real-IP is ignored.

        Model of a backend reachable directly by untrusted clients (no nginx
        in front): the header is fully client-writable, so keying on it would
        let attackers rotate it to reset every rate limit.
        """
        monkeypatch.setattr(
            "dependencies.get_settings",
            lambda: Settings(API_KEY="test-key", TRUST_PROXY_HEADERS=False),
        )
        req = SimpleNamespace(
            headers={"X-Real-IP": "attacker-chosen-1"},
            client=SimpleNamespace(host="127.0.0.1"),
        )
        # Header rotation does not move the key — the socket peer is used.
        assert real_client_ip(req) == "127.0.0.1"
        req2 = SimpleNamespace(
            headers={"X-Real-IP": "attacker-chosen-2"},
            client=SimpleNamespace(host="127.0.0.1"),
        )
        assert real_client_ip(req2) == "127.0.0.1"


# ─── Security hardening — secret VALUES require super-user ────────
# GET /api/config/secrets/{ns}/{name} returns base64 values. It is now gated
# behind the same session token as write operations (the list endpoint, which
# only exposes names/keys, stays open).

class TestSecretDetailAuth:
    @staticmethod
    def _password_settings(monkeypatch):
        monkeypatch.setattr(
            "config.get_settings",
            lambda: Settings(API_KEY="test-key", SUPER_USER_PASSWORD="secret-pw"),
        )

    @staticmethod
    def _mock_secret_read(mock_core_v1):
        instance = MagicMock()
        instance.read_namespaced_secret = AsyncMock(
            return_value=SimpleNamespace(type="Opaque", data={"password": "c2VjcmV0"})
        )
        mock_core_v1.return_value = instance

    def test_requires_super_user_token(self, monkeypatch):
        """Without a valid token the detail (values) endpoint is denied."""
        self._password_settings(monkeypatch)
        resp = client.get("/api/config/secrets/default/kubernetes-dashboard-token")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text[:200]}"
        assert "super user" in resp.text.lower()

    @patch("kubernetes_asyncio.client.CoreV1Api")
    def test_valid_token_reads_secret_values(self, mock_core_v1, monkeypatch):
        """With the session token the edit form can still load secret values."""
        self._password_settings(monkeypatch)
        self._mock_secret_read(mock_core_v1)
        from services import auth_service
        token = auth_service.create_token("secret-pw")
        resp = client.get(
            "/api/config/secrets/default/kubernetes-dashboard-token",
            headers={"X-Super-User-Token": token},
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        body = resp.json()
        assert body["status"] == "success"
        assert body["data"]["data"] == {"password": "c2VjcmV0"}

    @patch("kubernetes_asyncio.client.CoreV1Api")
    def test_no_password_mode_still_allows(self, mock_core_v1):
        """SUPER_USER_PASSWORD unset (default) keeps reads open — no regression."""
        self._mock_secret_read(mock_core_v1)
        resp = client.get("/api/config/secrets/default/kubernetes-dashboard-token")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        assert resp.json()["status"] == "success"


# ─── Security hardening — AI chat rate limit ──────────────────────

# ─── Security hardening — failed logins return HTTP 401 ─────────
# POST /api/config/auth now raises 401 on bad credentials instead of a
# 200-with-body, so HTTP-level tooling can detect failed authentication.

class TestSuperUserAuth:
    # Each request carries a unique X-Real-IP so the auth limiter (5/min)
    # buckets never collide with test_auth.py's requests in the shared
    # in-memory storage within the same minute.

    @staticmethod
    def _password_settings(monkeypatch):
        monkeypatch.setattr(
            "config.get_settings",
            lambda: Settings(API_KEY="test-key", SUPER_USER_PASSWORD="secret-pw"),
        )

    def test_correct_password_returns_token(self, monkeypatch):
        self._password_settings(monkeypatch)
        resp = client.post(
            "/api/config/auth",
            json={"password": "secret-pw"},
            headers={"X-Real-IP": "198.51.100.11"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["authenticated"] is True
        assert body["token"]

    def test_wrong_password_returns_401(self, monkeypatch):
        """Bad credentials produce an HTTP 401, not a 200-with-body."""
        self._password_settings(monkeypatch)
        resp = client.post(
            "/api/config/auth",
            json={"password": "nope"},
            headers={"X-Real-IP": "198.51.100.12"},
        )
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text[:200]}"
        assert "Invalid password" in resp.json()["detail"]

    def test_no_password_mode_authenticates_without_token(self):
        """SUPER_USER_PASSWORD unset (default) keeps no-password mode working."""
        resp = client.post(
            "/api/config/auth",
            json={"password": "anything"},
            headers={"X-Real-IP": "198.51.100.13"},
        )
        assert resp.status_code == 200
        assert resp.json()["authenticated"] is True


# ─── Security hardening — threat history degrades gracefully ─────
# /api/threats/history must return an empty feed (not a 500) when the
# Redis vault is unreachable.

class TestThreatHistory:
    @patch("routers.threats.ThreatService")
    def test_success(self, mock_service_cls):
        mock_instance = MagicMock()
        mock_service_cls.return_value = mock_instance
        mock_instance.get_recent_events = AsyncMock(
            return_value=[{"rule": "x", "priority": "Warning"}]
        )
        resp = client.get("/api/threats/history")
        assert resp.status_code == 200
        assert resp.json()["events"] == [{"rule": "x", "priority": "Warning"}]

    @patch("routers.threats.ThreatService")
    def test_graceful_degradation_when_redis_down(self, mock_service_cls):
        mock_instance = MagicMock()
        mock_service_cls.return_value = mock_instance
        mock_instance.get_recent_events = AsyncMock(
            side_effect=ConnectionError("redis down")
        )
        resp = client.get("/api/threats/history")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        body = resp.json()
        assert body["status"] == "success"
        assert body["events"] == []


class TestAiRateLimit:
    def test_chat_rate_limited(self):
        """POST /api/ai/chat allows 20/min, then 429 (blocks cost amplification).

        All 21 requests carry a fixed X-Real-IP so the burst lands in its own
        isolated rate-limit bucket and can never collide with (or pollute)
        the other tests' bucket in the shared in-memory storage.
        """
        headers = {"X-Real-IP": "198.51.100.42"}
        statuses = [
            client.post("/api/ai/chat", json={"messages": []}, headers=headers).status_code
            for _ in range(21)
        ]
        assert statuses.count(200) == 20, f"Expected 20 ok, got {statuses}"
        assert statuses[-1] == 429, f"Expected 429 on the 21st, got {statuses[-1]}"
