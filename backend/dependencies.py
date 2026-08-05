import os
from fastapi import Depends, Request
from typing import AsyncGenerator

from connection.models import ConnectionConfig
from connection.factory import create_api_client
from config import get_settings, Settings
from services.logging_service import get_logger

logger = get_logger(__name__)


def is_mock_mode() -> bool:
    """True when the backend is explicitly running in demo mode (K8S_MODE=mock).

    Mock data is served ONLY in this opt-in mode. Any other failure — RBAC
    denial, connection error, API error — surfaces as an 'error' status
    instead of silently substituting fabricated data.
    """
    return os.getenv("K8S_MODE", "").strip().lower() == "mock"


def fallback_response(mock_payload: dict, error_payload: dict) -> dict:
    """Return the mock payload in opt-in demo mode, otherwise the error envelope.

    Errors are never silently swapped for fabricated data: RBAC denials,
    connection failures and API errors surface as ``status: error`` unless the
    operator explicitly opted into demo mode via ``K8S_MODE=mock``.
    """
    if is_mock_mode():
        return mock_payload
    return error_payload


def real_client_ip(request: Request) -> str:
    """Rate-limit key: the true client IP, never a client-writable header.

    Used as the ``key_func`` for every rate limiter. Two sources, both
    attacker-proof:

    - ``X-Real-IP``: nginx sets this to the socket peer address
      (``$remote_addr``), overwriting anything the client sent, so it cannot
      be spoofed when traffic flows through the proxy.
    - The socket peer address (``request.client.host``) for direct
      connections (dev / mock mode, or in-cluster pod traffic).

    ``X-Forwarded-For`` is deliberately ignored: it is append-only from the
    proxy's perspective, so when a client connects directly it controls
    every entry and can rotate it to reset the limiter (the classic
    brute-force bypass).
    """
    real_ip = request.headers.get("X-Real-IP")
    # Guard against whitespace-only values: ``"  ".strip()`` would produce an
    # empty key, which slowapi treats as falsy and SKIPS the limit entirely.
    if real_ip and real_ip.strip():
        return real_ip.strip()
    if request.client:
        return request.client.host
    return "unknown"


async def get_settings_dep() -> Settings:
	return get_settings()


async def get_connection_config() -> ConnectionConfig:
	"""Get Kubernetes connection configuration from environment."""
	return ConnectionConfig.from_env()


async def get_k8s_client(
	connection: ConnectionConfig = Depends(get_connection_config),
) -> AsyncGenerator:
	"""FastAPI dependency that yields a configured Kubernetes ApiClient.

	If the Kubernetes API is unreachable, yields None instead of raising
	HTTPException 500 — endpoint handlers then return an error status, or
	mock data when running in opt-in demo mode (K8S_MODE=mock).

	No longer requires X-API-Key header — the frontend no longer ships
	the API key to the browser. In production, put the backend behind an
	authenticating reverse proxy (nginx + OIDC/mTLS, Istio, or similar).

	Usage in a router:
		async def handler(api_client = Depends(get_k8s_client)):
			if api_client is None:
				return {"status": "mock", "data": MOCK_DATA}
			v1 = kubernetes_asyncio.client.CoreV1Api(api_client)
	"""
	api_client = None
	try:
		api_client = await create_api_client(connection)
	except Exception as exc:
		logger.warning(f"Kubernetes API connection failed: {exc} — endpoints will return error responses (mock data only in K8S_MODE=mock)")

	try:
		yield api_client
	finally:
		if api_client is not None:
			try:
				await api_client.close()
			except Exception:
				pass
