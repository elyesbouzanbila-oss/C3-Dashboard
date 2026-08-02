"""Audit log service — records every super-user write operation.

Entries are stored in a Redis list (ring buffer) so they survive backend
restarts, mirroring the threat-event vault pattern. If Redis is
unavailable, the entry still goes to the application log and the failure
is swallowed — auditing must never break a write operation.
"""

import json
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from services.logging_service import get_logger

logger = get_logger(__name__)

MAX_AUDIT_ENTRIES = 1000
AUDIT_KEY = "audit:vault"


def _redis():
    """Return a Redis client sharing the threat service's connection pool."""
    import redis.asyncio as redis
    from config import get_settings
    from services.threat_service import ThreatService
    return redis.Redis(connection_pool=ThreatService.get_pool(get_settings()))


async def log_audit(
    actor: str,
    action: str,
    target: str,
    success: bool,
    error: Optional[str] = None,
) -> None:
    """Record an audit entry. Never raises — falls back to app logs."""
    entry: Dict[str, Any] = {
        "ts": int(time.time()),
        "iso": datetime.now(timezone.utc).isoformat(),
        "actor": actor,
        "action": action,
        "target": target,
        "success": success,
    }
    if error:
        entry["error"] = error
    try:
        r = _redis()
        await r.lpush(AUDIT_KEY, json.dumps(entry))
        await r.ltrim(AUDIT_KEY, 0, MAX_AUDIT_ENTRIES - 1)
    except Exception as e:
        logger.warning(f"Audit log write failed (Redis unavailable): {e}")
    outcome = "OK" if success else "FAIL"
    logger.info(
        f"AUDIT {outcome} actor={actor} action={action} target={target}"
        + (f" error={error}" if error else "")
    )


async def get_audit_log(limit: int = 100) -> List[Dict[str, Any]]:
    """Return the most recent audit entries, newest first."""
    try:
        r = _redis()
        items = await r.lrange(AUDIT_KEY, 0, max(1, min(limit, 500)) - 1)
    except Exception as e:
        logger.warning(f"Audit log read failed (Redis unavailable): {e}")
        return []
    result: List[Dict[str, Any]] = []
    for item in items:
        try:
            result.append(json.loads(item))
        except (json.JSONDecodeError, TypeError):
            continue
    return result
