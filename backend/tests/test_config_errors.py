"""Tests for Kubernetes API error mapping in the config router.

Verifies that kubernetes_asyncio.ApiException (403 RBAC, 404, 409, ...) is
mapped to readable HTTP responses with the right status codes instead of
raw str(e) 500 dumps, at both the helper level and the endpoint level.
"""

import json
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from kubernetes_asyncio.client.exceptions import ApiException

from main import app
from config import Settings
from dependencies import get_k8s_client
from routers import config as config_router

# Self-contained: override the K8s client dependency so endpoint tests don't
# depend on test_routers.py's module-level overrides (which would silently
# change behavior depending on test collection order).
app.dependency_overrides[get_k8s_client] = lambda: AsyncMock()

client = TestClient(app)


def _api_exc(status: int, reason: str, message: str) -> ApiException:
    exc = ApiException(status=status, reason=reason)
    exc.body = json.dumps({"kind": "Status", "message": message, "reason": reason, "code": status})
    return exc


# ─── Helper unit tests ─────────────────────────────────────────────

class TestK8sApiMessage:
    def test_extracts_message_from_json_body(self):
        exc = _api_exc(403, "Forbidden", 'nodes "masternode" is forbidden: User cannot patch resource "nodes"')
        msg = config_router._k8s_api_message(exc)
        assert 'nodes "masternode" is forbidden' in msg

    def test_falls_back_to_reason_when_body_not_json(self):
        exc = ApiException(status=404, reason="Not Found")
        exc.body = "Not Found"
        msg = config_router._k8s_api_message(exc)
        assert "Not Found" in msg

    def test_falls_back_to_generic(self):
        exc = ApiException()
        exc.body = None
        msg = config_router._k8s_api_message(exc)
        assert msg  # non-empty


class TestRaiseK8sError:
    def test_403_maps_to_403_with_hint(self):
        exc = _api_exc(403, "Forbidden", 'nodes "masternode" is forbidden')
        try:
            config_router._raise_k8s_error(exc, "Test context")
            assert False, "should have raised"
        except HTTPException as e:
            assert e.status_code == 403
            assert "RBAC" in e.detail
            assert 'masternode' in e.detail

    def test_404_maps_to_404(self):
        exc = _api_exc(404, "Not Found", 'configmaps "x" not found')
        try:
            config_router._raise_k8s_error(exc, "Test context")
            assert False, "should have raised"
        except HTTPException as e:
            assert e.status_code == 404
            assert "not found" in e.detail.lower()

    def test_409_maps_to_409(self):
        exc = _api_exc(409, "Conflict", 'deployments "web" already exists')
        try:
            config_router._raise_k8s_error(exc, "Test context")
            assert False, "should have raised"
        except HTTPException as e:
            assert e.status_code == 409
            assert "already exists" in e.detail.lower()

    def test_unknown_status_preserved(self):
        exc = _api_exc(502, "Bad Gateway", "upstream error")
        try:
            config_router._raise_k8s_error(exc, "Test context")
            assert False, "should have raised"
        except HTTPException as e:
            assert e.status_code == 502
            assert "upstream error" in e.detail

    def test_http_exception_passthrough(self):
        original = HTTPException(status_code=418, detail="teapot")
        try:
            config_router._raise_k8s_error(original, "Test context")
            assert False, "should have raised"
        except HTTPException as e:
            assert e is original

    def test_plain_exception_becomes_500(self):
        try:
            config_router._raise_k8s_error(RuntimeError("boom"), "Test context")
            assert False, "should have raised"
        except HTTPException as e:
            assert e.status_code == 500
            assert "boom" in e.detail


# ─── Endpoint-level tests (no-password mode, so writes are allowed) ─

def _no_password_settings():
    return Settings(API_KEY="test-key")


class TestWriteEndpointErrorMapping:
    @patch("services.config_service.create_ip_pool", new_callable=AsyncMock)
    def test_create_ip_pool_403_readable(self, mock_create):
        mock_create.side_effect = _api_exc(403, "Forbidden", 'ippools "default" is forbidden')
        with patch("config.get_settings", return_value=_no_password_settings()), \
             patch("services.audit_service._redis", return_value=AsyncMock()):
            resp = client.post("/api/config/ippools", json={"name": "default", "cidr": "10.0.0.0/16"})
        assert resp.status_code == 403, resp.text[:300]
        assert "RBAC" in resp.json()["detail"]

    @patch("services.config_service.create_namespace", new_callable=AsyncMock)
    def test_create_namespace_409_readable(self, mock_create):
        mock_create.side_effect = _api_exc(409, "AlreadyExists", 'namespaces "prod" already exists')
        with patch("config.get_settings", return_value=_no_password_settings()), \
             patch("services.audit_service._redis", return_value=AsyncMock()):
            resp = client.post("/api/config/namespaces", json={"name": "prod"})
        assert resp.status_code == 409, resp.text[:300]
        assert "already exists" in resp.json()["detail"].lower()

    @patch("services.config_service.delete_configmap", new_callable=AsyncMock)
    def test_delete_configmap_404_readable(self, mock_delete):
        mock_delete.side_effect = _api_exc(404, "NotFound", 'configmaps "ghost" not found')
        with patch("config.get_settings", return_value=_no_password_settings()), \
             patch("services.audit_service._redis", return_value=AsyncMock()):
            resp = client.delete("/api/config/configmaps/default/ghost")
        assert resp.status_code == 404, resp.text[:300]
        assert "not found" in resp.json()["detail"].lower()

    @patch("services.config_service.scale_deployment", new_callable=AsyncMock)
    def test_scale_deployment_plain_error_500(self, mock_scale):
        mock_scale.side_effect = RuntimeError("boom")
        with patch("config.get_settings", return_value=_no_password_settings()), \
             patch("services.audit_service._redis", return_value=AsyncMock()):
            resp = client.post("/api/config/deployments/default/web/scale", json={"replicas": 2})
        assert resp.status_code == 500, resp.text[:300]
        assert "boom" in resp.json()["detail"]
