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


def _parse_json_objects(text: str) -> list[dict]:
    """Parse one or more JSON objects from *text*, handling NDJSON and
    concatenated JSON (e.g. ``{...}{...}``). Falco may batch multiple
    events in a single HTTP POST."""
    results: list[dict] = []

    # 1. Try standard single-object parse first (fast path)
    try:
        results.append(json.loads(text))
        return results
    except json.JSONDecodeError as exc:
        # If it's only "Extra data", parse iteratively
        if "Extra data" not in str(exc):
            # Try NDJSON: split by newlines and parse each line
            for line in text.strip().splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    results.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
            return results

    # 2. Iterative decode for concatenated JSON like `{...}{...}`
    decoder = json.JSONDecoder()
    idx = 0
    while idx < len(text):
        try:
            obj, end = decoder.raw_decode(text, idx)
            results.append(obj)
            idx = end
            # skip whitespace between objects
            while idx < len(text) and text[idx] in " \t\n\r":
                idx += 1
        except json.JSONDecodeError:
            break

    return results


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
    text = body.decode(errors="replace")

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

    # Parse one or more JSON objects from the body
    # Falco may batch events or send NDJSON (newline-delimited JSON)
    decoded_events = _parse_json_objects(text)

    if not decoded_events:
        logger.error(f"No valid JSON objects found in Falco body: {text[:500]}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No valid JSON objects in request body",
        )

    service = ThreatService(settings)
    count = 0
    for raw in decoded_events:
        # Skip empty/keepalive objects
        if not raw or raw == {}:
            continue
        try:
            event = FalcoEvent(
                output=raw.get("output", "") or "",
                priority=raw.get("priority", "") or "",
                rule=raw.get("rule", "") or "",
                time=raw.get("time", "") or "",
                output_fields=raw.get("output_fields", raw.get("fields", {}) or {}),
            )
            await service.publish_falco_event(event)
            logger.info("Falco event received", extra={"rule": event.rule, "priority": event.priority})
            count += 1
        except Exception as exc:
            logger.warning(f"Skipped unparseable Falco event: {exc}")

    return {"status": "ok", "events_processed": count}


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
