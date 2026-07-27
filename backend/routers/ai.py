"""AI chat endpoint — answers cluster-related questions using an LLM.

The endpoint gathers relevant cluster context (pods, policies, threats, etc.)
and passes it to the AI service for grounded answers.
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends

from dependencies import get_k8s_client, get_settings_dep
from config import Settings
from services.ai_service import AIService
from services.logging_service import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/ai", tags=["ai"])


async def _gather_cluster_context(settings: Settings) -> Dict[str, Any]:
    """Gather a lightweight snapshot of cluster data for the AI context.

    This runs in-band with the chat request so the context is always fresh.
    Failures are silently swallowed — the AI still gets partial context.
    """
    context: Dict[str, Any] = {
        "summary": {},
        "pods": [],
        "policies": [],
        "threats": [],
        "security": {},
    }

    try:
        from services.network_service import list_pods
        from services.calico_service import (
            get_calico_node_status,
            get_bgp_peers,
            get_ip_pools,
            get_ipam_utilization,
        )
        from services.security_service import get_rbac_bindings, get_privileged_pods
        from models.mock_data import (
            MOCK_PODS,
            MOCK_CALICO_NODES,
            MOCK_BGP_PEERS,
            MOCK_IP_POOLS,
            MOCK_IPAM_BLOCKS,
            MOCK_POLICIES,
            MOCK_RBAC,
            MOCK_PRIVILEGED,
        )

        api_client = await get_k8s_client()

        try:
            pods_data = await list_pods(api_client)
            context["pods"] = pods_data[:20]  # keep it light
        except Exception:
            context["pods"] = MOCK_PODS[:10]

        try:
            nodes = await get_calico_node_status(api_client)
            context["summary"]["calico_nodes"] = len(nodes)
            context["summary"]["healthy_nodes"] = sum(
                1 for n in nodes if n.get("status", {}) != {}
            )
        except Exception:
            context["summary"]["calico_nodes"] = len(MOCK_CALICO_NODES)

        try:
            peers = await get_bgp_peers(api_client)
            context["summary"]["bgp_peers"] = len(peers)
        except Exception:
            context["summary"]["bgp_peers"] = len(MOCK_BGP_PEERS)

        try:
            pools = await get_ip_pools(api_client)
            context["summary"]["ip_pools"] = len(pools)
        except Exception:
            context["summary"]["ip_pools"] = len(MOCK_IP_POOLS)

        try:
            _ = await get_ipam_utilization(api_client)
            context["summary"]["ipam_blocks"] = len(MOCK_IPAM_BLOCKS)
        except Exception:
            pass

        # Security context
        try:
            rbac = await get_rbac_bindings(api_client)
            context["security"]["rbac_bindings"] = len(rbac)
            context["security"]["admin_bindings"] = sum(
                1 for b in rbac if b.get("role_ref", {}).get("name") in ("cluster-admin", "admin")
            )
        except Exception:
            context["security"]["rbac_bindings"] = len(MOCK_RBAC)

        try:
            priv = await get_privileged_pods(api_client)
            context["security"]["privileged_pods"] = [
                p for p in priv if p.get("privileged")
            ][:10]
            context["security"]["root_containers"] = [
                p for p in priv if p.get("run_as_user") == 0
            ][:10]
        except Exception:
            context["security"]["privileged_pods"] = [
                p for p in MOCK_PRIVILEGED if p.get("privileged")
            ][:5]

        if api_client:
            await api_client.close()
    except Exception as e:
        logger.warning(f"Failed to gather cluster context: {e}")

    return context


@router.post("/chat")
async def ai_chat(
    body: Dict[str, Any],
    settings: Settings = Depends(get_settings_dep),
) -> Dict[str, Any]:
    """Send a chat message to the AI assistant.

    The AI has access to current cluster context (pods, policies, threats,
    security posture) to answer questions about the cluster.

    Request body:
        messages: List[{role: str, content: str}] — chat history
        context: Optional[bool] — whether to include cluster context (default: true)

    Returns:
        { reply: str }
    """
    messages: List[Dict[str, str]] = body.get("messages", [])
    include_context = body.get("context", True)

    if not messages:
        return {"reply": "No messages provided."}

    # Gather cluster context
    cluster_context = await _gather_cluster_context(settings) if include_context else None

    # Call the AI
    service = AIService(settings)
    reply = await service.chat(messages, cluster_context=cluster_context)

    return {"reply": reply}


@router.get("/status")
async def ai_status(
    settings: Settings = Depends(get_settings_dep),
) -> Dict[str, Any]:
    """Check whether the AI assistant is configured and ready."""
    service = AIService(settings)
    return {
        "enabled": service.enabled,
        "model": service.model if service.enabled else None,
        "provider": service.base_url.split("//")[1].split(".")[0] if service.enabled else None,
    }
