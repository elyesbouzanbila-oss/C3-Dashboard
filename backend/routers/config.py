"""
Cluster configuration endpoints — CRUD for Calico resources via the K8s API.
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel, Field

from dependencies import get_k8s_client
from services import config_service, calico_service
from services.logging_service import get_logger
from models.mock_data import MOCK_IP_POOLS, MOCK_BGP_PEERS

logger = get_logger(__name__)

router = APIRouter(prefix="/api/config", tags=["Configuration"])


# ─── API key check for write operations ────────────────────────────


def _check_api_key(x_api_key: str = Header("", alias="X-API-Key")) -> None:
    """FastAPI dependency: check API key for write operations."""
    from config import get_settings

    settings = get_settings()
    if settings.API_KEY and x_api_key != settings.API_KEY:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing API key. Set X-API-Key header.",
        )


# ─── Request / Response Models ──────────────────────────────────────


class IPPoolCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=253, description="IP pool name")
    cidr: str = Field(..., description="CIDR notation, e.g. 10.244.0.0/16")
    nat_outgoing: bool = True
    disabled: bool = False
    mode: str = Field(default="vxlan", pattern="^(ipip|vxlan|none)$")
    node_selector: Optional[str] = "all()"


class IPPoolUpdate(BaseModel):
    nat_outgoing: Optional[bool] = None
    disabled: Optional[bool] = None
    mode: Optional[str] = Field(None, pattern="^(ipip|vxlan|none)$")
    node_selector: Optional[str] = None


class BGPPeerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=253, description="BGP peer name")
    peer_ip: str = Field(..., description="Peer IP address")
    peer_as_number: int = Field(default=64512, ge=1, le=65535)
    node_as_number: Optional[int] = Field(None, ge=1, le=65535)
    node: Optional[str] = Field(None, description="Node name (None = global)")


class BGPPeerUpdate(BaseModel):
    peer_ip: Optional[str] = None
    peer_as_number: Optional[int] = Field(None, ge=1, le=65535)
    node_as_number: Optional[int] = Field(None, ge=1, le=65535)
    node: Optional[str] = None


# ─── IP Pool Endpoints ──────────────────────────────────────────────


@router.get("/ippools")
async def list_ip_pools(
    api_client=Depends(get_k8s_client),
) -> Dict[str, Any]:
    """List all Calico IP pools."""
    if api_client is None:
        return {"status": "mock", "data": MOCK_IP_POOLS}
    try:
        data = await calico_service.get_ip_pools(api_client)
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"List IP pools failed: {e}, using mock")
        return {"status": "mock", "data": MOCK_IP_POOLS}


@router.post("/ippools", status_code=201)
async def create_ip_pool(
    pool: IPPoolCreate,
    api_client=Depends(get_k8s_client),
    _auth=Depends(_check_api_key),
) -> Dict[str, Any]:
    """Create a new Calico IP pool."""
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        result = await config_service.create_ip_pool(api_client, pool.model_dump())
        return {"status": "success", "data": {"name": pool.name, "cidr": pool.cidr}}
    except Exception as e:
        logger.error(f"Create IP pool failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/ippools/{name}")
async def update_ip_pool(
    name: str,
    pool: IPPoolUpdate,
    api_client=Depends(get_k8s_client),
    _auth=Depends(_check_api_key),
) -> Dict[str, Any]:
    """Update an existing Calico IP pool."""
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        # Only pass fields that are set
        update_data = {k: v for k, v in pool.model_dump().items() if v is not None}
        await config_service.update_ip_pool(api_client, name, update_data)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        logger.error(f"Update IP pool {name} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/ippools/{name}")
async def delete_ip_pool(
    name: str,
    api_client=Depends(get_k8s_client),
    _auth=Depends(_check_api_key),
) -> Dict[str, Any]:
    """Delete a Calico IP pool."""
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.delete_ip_pool(api_client, name)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        logger.error(f"Delete IP pool {name} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── BGP Peer Endpoints ─────────────────────────────────────────────


@router.get("/bgppeers")
async def list_bgp_peers(
    api_client=Depends(get_k8s_client),
) -> Dict[str, Any]:
    """List all Calico BGP peers."""
    if api_client is None:
        return {"status": "mock", "data": MOCK_BGP_PEERS}
    try:
        data = await calico_service.get_bgp_peers(api_client)
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"List BGP peers failed: {e}, using mock")
        return {"status": "mock", "data": MOCK_BGP_PEERS}


@router.post("/bgppeers", status_code=201)
async def create_bgp_peer(
    peer: BGPPeerCreate,
    api_client=Depends(get_k8s_client),
    _auth=Depends(_check_api_key),
) -> Dict[str, Any]:
    """Create a new Calico BGP peer."""
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.create_bgp_peer(api_client, peer.model_dump())
        return {"status": "success", "data": {"name": peer.name, "peer_ip": peer.peer_ip}}
    except Exception as e:
        logger.error(f"Create BGP peer failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/bgppeers/{name}")
async def update_bgp_peer(
    name: str,
    peer: BGPPeerUpdate,
    api_client=Depends(get_k8s_client),
    _auth=Depends(_check_api_key),
) -> Dict[str, Any]:
    """Update an existing Calico BGP peer."""
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        update_data = {k: v for k, v in peer.model_dump().items() if v is not None}
        await config_service.update_bgp_peer(api_client, name, update_data)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        logger.error(f"Update BGP peer {name} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/bgppeers/{name}")
async def delete_bgp_peer(
    name: str,
    api_client=Depends(get_k8s_client),
    _auth=Depends(_check_api_key),
) -> Dict[str, Any]:
    """Delete a Calico BGP peer."""
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.delete_bgp_peer(api_client, name)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        logger.error(f"Delete BGP peer {name} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Dashboard Settings ─────────────────────────────────────────────


@router.get("/settings")
async def dashboard_settings() -> Dict[str, Any]:
    """Return current dashboard runtime settings (no secrets)."""
    from config import get_settings

    s = get_settings()
    return {
        "status": "success",
        "data": {
            "k8s_mode": s.K8S_MODE,
            "prometheus_url": s.PROMETHEUS_URL,
            "ai_enabled": s.AI_ENABLED,
            "ai_model": s.AI_MODEL,
            "frontend_url": s.FRONTEND_URL,
            "has_api_key": bool(s.API_KEY),
            "has_redis_password": bool(s.REDIS_PASSWORD),
            "has_falco_webhook_secret": bool(s.FALCO_WEBHOOK_SECRET),
        },
    }
