from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi import Limiter
from slowapi.util import get_remote_address

from config import get_settings
from routers import network as network_router
from routers import threats as threats_router
from routers import mock
from routers import cni as cni_router
from routers import security as security_router
from services.logging_service import get_logger

logger = get_logger(__name__)

settings = get_settings()

# Rate limiter: uses X-Forwarded-For header when behind nginx
limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — replaces deprecated @app.on_event("startup")."""
    # ── Startup checks ──────────────────────────────────────────
    from services.threat_service import ThreatService
    try:
        svc = ThreatService(get_settings())
        await svc.redis.ping()
        logger.info("Redis connection OK")
    except Exception as e:
        logger.error(f"Redis connection failed: {e} — threat streaming will not work")

    try:
        from connection.factory import create_api_client
        from connection.models import ConnectionConfig
        client = await create_api_client(ConnectionConfig.from_env())
        await client.close()
        logger.info("Kubernetes API connection OK")
    except Exception as e:
        logger.warning(f"Kubernetes API connection failed: {e} — endpoints will use mock data")

    # ── Falco webhook secret check ────────────────────────────
    settings_ = get_settings()
    if not settings_.FALCO_WEBHOOK_SECRET:
        logger.warning(
            "FALCO_WEBHOOK_SECRET is not set — the Falco webhook endpoint "
            "(/api/threats/falco) will accept events WITHOUT signature verification. "
            "Set FALCO_WEBHOOK_SECRET in production to prevent forged threat events."
        )
    else:
        logger.info("Falco webhook HMAC secret is configured")

    # ── Diagnostics namespace whitelist ───────────────────────
    from routers.cni import _DIAG_NS_WHITELIST
    logger.info(f"Diagnostics namespace whitelist: {', '.join(sorted(_DIAG_NS_WHITELIST))}")

    yield
    # ── Shutdown (nothing to clean up yet) ──────────────────────


app = FastAPI(title="K8s Dashboard API", lifespan=lifespan)

# Register rate-limit exception handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# CORS configuration: restrict to frontend domain only
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/")
def read_root():
    logger.info("Health check")
    return {"status": "ok", "message": "K8s Dashboard API is running"}


# Include mock endpoints with prefixes (primary handlers when K8s not available)
app.include_router(mock.router, prefix="", tags=["mock"])

# Include real endpoints (will override mock if K8s available)
app.include_router(network_router.router, prefix="/api/network", tags=["network"])
app.include_router(threats_router.router, prefix="/api/threats", tags=["threats"])
app.include_router(cni_router.router)
app.include_router(security_router.router)