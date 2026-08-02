"""Security audit endpoints — RBAC bindings and privileged pod detection."""

from typing import Any, Dict

from fastapi import APIRouter, Depends

from dependencies import get_k8s_client, fallback_response
from models.mock_data import MOCK_RBAC, MOCK_PRIVILEGED
from services.logging_service import get_logger
from services.security_service import get_privileged_pods, get_rbac_bindings

logger = get_logger(__name__)

router = APIRouter(prefix="/api/security", tags=["security"])


@router.get("/rbac")
async def list_rbac_bindings(
    api_client=Depends(get_k8s_client),
) -> Dict[str, Any]:
    """List all ClusterRoleBindings and RoleBindings across the cluster."""
    try:
        data = await get_rbac_bindings(api_client)
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"RBAC query failed: {e}")
        return fallback_response(
            {"status": "mock", "data": MOCK_RBAC},
            {"status": "error", "data": [], "error": str(e)},
        )


@router.get("/privileged-pods")
async def list_privileged_pods(
    api_client=Depends(get_k8s_client),
) -> Dict[str, Any]:
    """List pods with privileged containers or containers running as root (UID 0)."""
    try:
        data = await get_privileged_pods(api_client)
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"Privileged pod query failed: {e}")
        return fallback_response(
            {"status": "mock", "data": MOCK_PRIVILEGED},
            {"status": "error", "data": [], "error": str(e)},
        )
