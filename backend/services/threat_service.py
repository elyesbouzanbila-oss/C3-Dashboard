import json
from typing import Optional

import redis.asyncio as redis
from config import Settings
from models.threat import FalcoEvent
from services.logging_service import get_logger

logger = get_logger(__name__)

# ── Vault configuration ─────────────────────────────────────────
# Maximum number of historical threat events retained in Redis.
# Acts as a ring buffer — oldest events are trimmed when this is
# exceeded so the vault doesn't use unbounded memory.
MAX_HISTORY: int = 200


class ThreatService:
    """Redis-backed threat event pub/sub + vault with shared connection pool."""

    _pool: Optional[redis.ConnectionPool] = None

    @classmethod
    def get_pool(cls, settings: Settings) -> redis.ConnectionPool:
        if cls._pool is None:
            cls._pool = redis.ConnectionPool.from_url(settings.REDIS_URL, max_connections=20)
        return cls._pool

    def __init__(self, settings: Settings):
        self.settings = settings
        self.redis = redis.Redis(connection_pool=self.get_pool(settings))

    async def publish_falco_event(self, event: FalcoEvent):
        """Publish a Falco event to the real-time pub/sub channel."""
        await self.redis.publish("falco:events", event.model_dump_json())

    async def store_falco_event(self, event: FalcoEvent):
        """Persist a Falco event to the Redis vault (capped list).

        The vault acts as a ring buffer: events are LPUSH'd and the
        list is trimmed to *MAX_HISTORY* entries so memory is bounded.
        """
        payload = event.model_dump_json()
        await self.redis.lpush("falco:vault", payload)
        await self.redis.ltrim("falco:vault", 0, MAX_HISTORY - 1)

    async def get_recent_events(self, limit: int = 50) -> list[dict]:
        """Return the *limit* most recent events from the Redis vault.

        Events are returned newest-first, which is the order the
        frontend expects (most recent at index 0).
        """
        items = await self.redis.lrange("falco:vault", 0, limit - 1)
        result: list[dict] = []
        for item in items:
            try:
                result.append(json.loads(item))
            except json.JSONDecodeError:
                pass
        return result

    async def subscribe_events(self):
        pubsub = self.redis.pubsub()
        await pubsub.subscribe("falco:events")
        return pubsub
