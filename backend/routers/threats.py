import hashlib
import hmac
import json
import asyncio
from urllib.parse import urlparse

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect, Depends, HTTPException, status
from slowapi import Limiter
from slowapi.util import get_remote_address

from dependencies import get_settings_dep
from config import Settings
from models.threat import FalcoEvent
from services.threat_service import ThreatService
from services.logging_service import get_logger

logger = get_logger(__name__)

router = APIRouter()

# Rate limit: max 600 POSTs per minute per IP on the Falco webhook
# Falco fires many events (K8s API connections per node, container spawns, etc.)
# so the limit needs to be generous to avoid dropping legitimate threat alerts.
# The NetworkPolicy and HMAC signature provide the real security.
falco_limiter = Limiter(key_func=get_remote_address)


@router.post("/falco")
@falco_limiter.limit("600/minute")
async def falco_webhook(
    request: Request,
    settings: Settings = Depends(get_settings_dep),
) -> dict:
    """Receive Falco events via webhook.

    Accepts both Falco's native JSON payload and the standard Falcosidekick
    webhook format.  Authenticated via HMAC-SHA256 signature.

    Rate-limited to 10 requests per minute per IP.
    """
    body = await request.body()
    raw = json.loads(body)

    # Signature check — read the raw bytes before parsing
    if settings.FALCO_WEBHOOK_SECRET:
        sig = request.headers.get("X-Falco-Signature", "")
        expected = hmac.new(
            settings.FALCO_WEBHOOK_SECRET.encode(),
            body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(sig, expected):
            logger.warning("Falco webhook rejected: invalid signature")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Falco signature",
            )

    # Build FalcoEvent from whatever fields Falco sends
    try:
        event = FalcoEvent(
            output=raw.get("output", "") or "",
            priority=raw.get("priority", "") or "",
            rule=raw.get("rule", "") or "",
            time=raw.get("time", "") or "",
            output_fields=raw.get("output_fields", raw.get("fields", {}) or {}),
        )
    except Exception as exc:
        logger.error(f"Failed to parse Falco event: {exc} — raw body: {body.decode(errors='replace')[:500]}")
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    logger.info("Falco event received", extra={"rule": event.rule, "priority": event.priority})
    service = ThreatService(settings)
    await service.publish_falco_event(event)
    return {"status": "ok"}


@router.websocket("/ws/threats")
async def ws_threats(ws: WebSocket, settings: Settings = Depends(get_settings_dep)):
    """WebSocket endpoint for real-time threat events.

    Security model:
      1. NetworkPolicy (k8s/networkpolicy-backend.yaml) blocks direct
         access to the backend — only dashboard-frontend pods can reach
         port 8000. External clients must go through nginx.
      2. Origin check below verifies the WS upgrade came from the same
         host nginx served the SPA on, derived dynamically from the Host
         header. Works for any access URL (node IP, DNS, port-forward,
         Ingress) without needing FRONTEND_URL to enumerate them all.
      3. Endpoint is read-only — it streams Redis pubsub to clients and
         takes no actions on incoming messages, so cross-origin WS
         attacks have no impact even if (1) and (2) somehow fail.
    """
    origin = ws.headers.get("origin", "")
    host = ws.headers.get("host", "")
    if origin and host:
        # Parse Origin URL and Host header as URLs to extract hostnames.
        # This handles ports, IPv6 brackets, and all edge cases consistently.
        parsed_origin = urlparse(origin)
        parsed_host = urlparse(f"//{host}")
        origin_hostname = parsed_origin.hostname or ""
        host_hostname = parsed_host.hostname or ""
        if origin_hostname != host_hostname:
            logger.warning(f"WebSocket rejected: origin {origin!r} (hostname={origin_hostname!r}) "
                           f"doesn't match host {host!r} (hostname={host_hostname!r})")
            await ws.close(code=status.WS_1008_POLICY_VIOLATION, reason="Origin not allowed")
            return

    await ws.accept()
    logger.info("WebSocket client connected")
    service = ThreatService(settings)
    pubsub = None
    try:
        pubsub = await service.subscribe_events()
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message.get("type") == "message":
                payload = message.get("data")
                if isinstance(payload, bytes):
                    payload = payload.decode()
                await ws.send_text(payload)

            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    finally:
        if pubsub:
            try:
                await pubsub.unsubscribe("falco:events")
                await pubsub.close()
            except Exception:
                pass
