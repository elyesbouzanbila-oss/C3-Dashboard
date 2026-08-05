"""Tests for super-user authentication hardening.

Covers token minting/verification (auth_service) and the endpoint-level
flow: /auth mints a token, write endpoints require it, and the audit
endpoint returns entries for valid sessions. Redis and K8s are faked so
the tests run offline.
"""

import json
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from main import app
from config import Settings
from services import auth_service

client = TestClient(app)


def _settings_with_password(password: str = "s3cret-password") -> Settings:
    return Settings(API_KEY="test-key", SUPER_USER_PASSWORD=password)


# ─── auth_service unit tests ──────────────────────────────────────

class TestAuthService:
    def test_passwords_match(self):
        assert auth_service.passwords_match("secret", "secret") is True
        assert auth_service.passwords_match("secret", "Secret") is False
        assert auth_service.passwords_match("", "") is True

    def test_token_round_trip(self):
        token = auth_service.create_token("secret")
        assert token.count(".") == 1
        assert auth_service.verify_token(token, "secret") is True

    def test_token_wrong_password_rejected(self):
        token = auth_service.create_token("secret")
        assert auth_service.verify_token(token, "other") is False

    def test_token_tampered_rejected(self):
        token = auth_service.create_token("secret")
        payload, sig = token.split(".", 1)
        tampered_payload = payload[:-4] + ("AAAA" if not payload.endswith("AAAA") else "BBBB")
        assert auth_service.verify_token(f"{tampered_payload}.{sig}", "secret") is False
        assert auth_service.verify_token(f"{payload}.AAAA", "secret") is False

    def test_expired_token_rejected(self):
        with patch("services.auth_service.time.time", return_value=1_000_000_000):
            token = auth_service.create_token("secret")  # exp = 1_000_000_900
        with patch("services.auth_service.time.time", return_value=2_000_000_000):
            assert auth_service.verify_token(token, "secret") is False

    def test_garbage_token_rejected(self):
        assert auth_service.verify_token("", "secret") is False
        assert auth_service.verify_token("not-a-token", "secret") is False
        assert auth_service.verify_token("a.b.c", "secret") is False


# ─── Endpoint flow tests ──────────────────────────────────────────

def _fake_redis():
    r = AsyncMock()
    return r


class TestAuthEndpoint:
    # Each request uses a unique X-Real-IP so the auth limiter (5/min) buckets
    # never collide with test_routers.py's auth requests in the shared
    # in-memory storage within the same minute.

    def test_wrong_password_returns_401(self):
        """Bad credentials fail with a real HTTP 401 (not a 200-with-body)."""
        with patch("config.get_settings", return_value=_settings_with_password()):
            resp = client.post(
                "/api/config/auth",
                json={"password": "nope"},
                headers={"X-Real-IP": "198.51.100.21"},
            )
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text[:200]}"
        assert "Invalid password" in resp.json().get("detail", "")

    def test_correct_password_mints_token(self):
        with patch("config.get_settings", return_value=_settings_with_password()):
            resp = client.post(
                "/api/config/auth",
                json={"password": "s3cret-password"},
                headers={"X-Real-IP": "198.51.100.22"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["authenticated"] is True
        assert body["token"]
        assert auth_service.verify_token(body["token"], "s3cret-password") is True

    def test_no_password_mode_authenticates_without_token(self):
        with patch("config.get_settings", return_value=Settings(API_KEY="test-key")):
            resp = client.post(
                "/api/config/auth",
                json={"password": "anything"},
                headers={"X-Real-IP": "198.51.100.23"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["authenticated"] is True
        assert body.get("token") is None


class TestRequireSuperUser:
    def test_write_without_token_401(self):
        with patch("config.get_settings", return_value=_settings_with_password()), \
             patch("services.audit_service._redis", return_value=_fake_redis()):
            resp = client.post("/api/config/namespaces", json={"name": "test-ns"})
        assert resp.status_code == 401, resp.text[:200]

    def test_write_with_invalid_token_401(self):
        with patch("config.get_settings", return_value=_settings_with_password()), \
             patch("services.audit_service._redis", return_value=_fake_redis()):
            resp = client.post(
                "/api/config/namespaces",
                json={"name": "test-ns"},
                headers={"X-Super-User-Token": "garbage"},
            )
        assert resp.status_code == 401, resp.text[:200]

    def test_audit_endpoint_requires_token(self):
        with patch("config.get_settings", return_value=_settings_with_password()):
            resp = client.get("/api/config/audit")
        assert resp.status_code == 401, resp.text[:200]

    def test_audit_endpoint_with_valid_token(self):
        fake_redis = _fake_redis()
        fake_redis.lrange.return_value = [
            json.dumps({
                "actor": "127.0.0.1",
                "action": "POST create ip pool",
                "target": "pool-prod",
                "success": True,
            })
        ]
        with patch("config.get_settings", return_value=_settings_with_password()), \
             patch("services.audit_service._redis", return_value=fake_redis):
            token = auth_service.create_token("s3cret-password")
            resp = client.get("/api/config/audit", headers={"X-Super-User-Token": token})
        assert resp.status_code == 200, resp.text[:200]
        body = resp.json()
        assert body["status"] == "success"
        assert body["data"][0]["action"] == "POST create ip pool"
        assert body["data"][0]["target"] == "pool-prod"
