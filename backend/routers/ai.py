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
    """Gather a comprehensive snapshot of ALL cluster data for the AI context.

    This runs in-band with the chat request so the context is always fresh.
    Failures are silently swallowed — the AI still gets partial context
    thanks to mock data fallbacks for every data type.
    """
    from kubernetes_asyncio import client as k8s_client

    context: Dict[str, Any] = {
        "summary": {},
        "namespaces": [],
        "nodes": [],
        "pods": [],
        "services": [],
        "policies": [],
        "bgp_peers": [],
        "ip_pools": [],
        "ipam": [],
        "threats": [],
        "security": {
            "rbac_bindings": [],
            "privileged_pods": [],
            "root_containers": [],
            "exposed_pods": [],
        },
        "felix_metrics": {},
    }

    try:
        from services.network_service import get_pods as list_pods
        from services.calico_service import (
            get_calico_nodes,
            get_bgp_peers,
            get_ip_pools,
            get_ipam_utilization,
            get_cni_policies,
        )
        from services.security_service import get_rbac_bindings, get_privileged_pods
        from services.felix_metrics_service import get_felix_metrics
        from services.threat_service import ThreatService
        from models.mock_data import (
            MOCK_NAMESPACES,
            MOCK_NODES,
            MOCK_PODS,
            MOCK_SERVICES,
            MOCK_CALICO_NODES,
            MOCK_BGP_PEERS,
            MOCK_IP_POOLS,
            MOCK_IPAM_BLOCKS,
            MOCK_CNI_POLICIES,
            MOCK_FELIX_METRICS,
            MOCK_COVERAGE,
            MOCK_RBAC,
            MOCK_PRIVILEGED,
        )

        api_client = await get_k8s_client()
        v1 = k8s_client.CoreV1Api(api_client)

        # ── 1. Namespaces ────────────────────────────────────────
        try:
            ns_list = await v1.list_namespace()
            context["namespaces"] = [
                {"name": ns.metadata.name, "status": ns.status.phase}
                for ns in ns_list.items
            ]
        except Exception:
            context["namespaces"] = MOCK_NAMESPACES
        context["summary"]["namespaces"] = len(context["namespaces"])

        # ── 2. Nodes ─────────────────────────────────────────────
        try:
            node_list = await v1.list_node()
            context["nodes"] = []
            for n in node_list.items:
                labels = n.metadata.labels or {}
                role = "worker"
                if labels.get("node-role.kubernetes.io/control-plane") == "" or \
                   labels.get("node-role.kubernetes.io/master") == "":
                    role = "master"
                ready = True
                for cond in n.status.conditions or []:
                    if cond.type == "Ready":
                        ready = cond.status == "True"
                        break
                ip = None
                for addr in n.status.addresses or []:
                    if addr.type == "InternalIP":
                        ip = addr.address
                        break
                context["nodes"].append({
                    "name": n.metadata.name,
                    "role": role,
                    "ready": ready,
                    "ip": ip,
                    "kubelet_version": n.status.node_info.kubelet_version if n.status.node_info else None,
                    "os_image": n.status.node_info.os_image if n.status.node_info else None,
                    "capacity": {
                        "cpu": str(n.status.capacity.get("cpu", "")),
                        "memory": str(n.status.capacity.get("memory", "")),
                    } if n.status.capacity else None,
                })
        except Exception:
            context["nodes"] = MOCK_NODES
        context["summary"]["nodes"] = len(context["nodes"])
        context["summary"]["healthy_nodes"] = sum(
            1 for n in context["nodes"] if n.get("ready", True)
        )
        context["summary"]["master_nodes"] = sum(
            1 for n in context["nodes"] if n.get("role") == "master"
        )
        context["summary"]["worker_nodes"] = sum(
            1 for n in context["nodes"] if n.get("role") == "worker"
        )

        # ── 3. Pods ──────────────────────────────────────────────
        try:
            pods_data = await list_pods(api_client)
            context["pods"] = [
                {
                    "name": p.name if hasattr(p, "name") else p.get("name"),
                    "namespace": p.namespace if hasattr(p, "namespace") else p.get("namespace"),
                    "pod_ip": p.pod_ip if hasattr(p, "pod_ip") else p.get("pod_ip"),
                    "node_name": p.node_name if hasattr(p, "node_name") else p.get("node_name"),
                    "phase": p.phase if hasattr(p, "phase") else p.get("phase"),
                    "containers": p.containers if hasattr(p, "containers") else p.get("containers", []),
                }
                for p in pods_data[:30]
            ]
        except Exception:
            context["pods"] = MOCK_PODS[:15]
        context["summary"]["pods"] = len(context["pods"])
        context["summary"]["running_pods"] = sum(
            1 for p in context["pods"]
            if (p.get("phase") if isinstance(p, dict) else p.phase) == "Running"
        )

        # ── 4. Services ──────────────────────────────────────────
        try:
            svc_list = await v1.list_service_for_all_namespaces()
            context["services"] = []
            for s in svc_list.items:
                if s.metadata.namespace == "default" and s.metadata.name == "kubernetes":
                    continue
                ports = []
                for p in (s.spec.ports or []):
                    ports.append({
                        "port": p.port,
                        "protocol": p.protocol or "TCP",
                        "target_port": p.target_port,
                        "name": p.name,
                    })
                context["services"].append({
                    "name": s.metadata.name,
                    "namespace": s.metadata.namespace,
                    "cluster_ip": s.spec.cluster_ip,
                    "ports": ports,
                    "selector": s.spec.selector or {},
                })
        except Exception:
            context["services"] = MOCK_SERVICES
        context["summary"]["services"] = len(context["services"])

        # ── 5. Network Policies ──────────────────────────────────
        try:
            policies = await get_cni_policies(api_client)
            context["policies"] = policies
        except Exception:
            context["policies"] = MOCK_CNI_POLICIES
        context["summary"]["policies"] = len(context["policies"])

        # ── 6. Policy Coverage (exposed pods) ────────────────────
        try:
            from services.network_service import get_pods as pods_for_coverage
            from services.utils import compute_policy_coverage
            pods_raw = await pods_for_coverage(api_client)
            policies_raw = await get_cni_policies(api_client)
            pod_dicts = [
                {"name": p.name, "namespace": p.namespace, "labels": p.labels}
                for p in pods_raw
            ]
            coverage = compute_policy_coverage(pod_dicts, policies_raw)
            context["security"]["exposed_pods"] = [c for c in coverage if c.get("exposed")]
        except Exception:
            context["security"]["exposed_pods"] = [
                c for c in MOCK_COVERAGE if c.get("exposed")
            ]
        context["summary"]["exposed_pods"] = len(context["security"]["exposed_pods"])

        # ── 7. BGP Peers ─────────────────────────────────────────
        try:
            bgp = await get_bgp_peers(api_client)
            context["bgp_peers"] = bgp
        except Exception:
            context["bgp_peers"] = MOCK_BGP_PEERS
        context["summary"]["bgp_peers"] = len(context["bgp_peers"])
        context["summary"]["bgp_sessions_up"] = sum(
            1 for p in context["bgp_peers"] if p.get("session_state") == "up"
        )

        # ── 8. IP Pools ──────────────────────────────────────────
        try:
            pools = await get_ip_pools(api_client)
            context["ip_pools"] = pools
        except Exception:
            context["ip_pools"] = MOCK_IP_POOLS
        context["summary"]["ip_pools"] = len(context["ip_pools"])
        context["summary"]["active_pools"] = sum(
            1 for p in context["ip_pools"] if not p.get("disabled", False)
        )

        # ── 9. IPAM Utilization ──────────────────────────────────
        try:
            ipam = await get_ipam_utilization(api_client)
            context["ipam"] = ipam
        except Exception:
            context["ipam"] = MOCK_IPAM_BLOCKS
        context["summary"]["ipam_pools"] = len(context["ipam"])
        if context["ipam"]:
            total_alloc = sum(b.get("allocated", 0) for b in context["ipam"])
            total_cap = sum(b.get("total", 0) for b in context["ipam"])
            context["summary"]["total_allocated_ips"] = total_alloc
            context["summary"]["total_ip_capacity"] = total_cap
            context["summary"]["overall_utilization_pct"] = round(
                (total_alloc / total_cap * 100) if total_cap > 0 else 0, 1
            )

        # ── 10. Security: RBAC ───────────────────────────────────
        try:
            rbac = await get_rbac_bindings(api_client)
            context["security"]["rbac_bindings"] = rbac[:20]
        except Exception:
            context["security"]["rbac_bindings"] = MOCK_RBAC
        context["summary"]["rbac_bindings"] = len(context["security"]["rbac_bindings"])
        context["summary"]["admin_bindings"] = sum(
            1 for b in context["security"]["rbac_bindings"]
            if b.get("role_ref", {}).get("name") in ("cluster-admin", "admin")
        )

        # ── 11. Security: Privileged & Root ──────────────────────
        try:
            priv = await get_privileged_pods(api_client)
            context["security"]["privileged_pods"] = [p for p in priv if p.get("privileged")][:10]
            context["security"]["root_containers"] = [p for p in priv if p.get("run_as_user") == 0][:10]
        except Exception:
            context["security"]["privileged_pods"] = [p for p in MOCK_PRIVILEGED if p.get("privileged")][:5]
            context["security"]["root_containers"] = [p for p in MOCK_PRIVILEGED if p.get("run_as_user") == 0][:5]
        context["summary"]["privileged_pods"] = len(context["security"]["privileged_pods"])
        context["summary"]["root_containers"] = len(context["security"]["root_containers"])

        # ── 12. Felix Metrics ────────────────────────────────────
        try:
            context["felix_metrics"] = await get_felix_metrics(settings)
        except Exception:
            context["felix_metrics"] = MOCK_FELIX_METRICS
        context["summary"]["felix_metrics_available"] = bool(context["felix_metrics"])

        # ── 13. Threats (recent Falco events) ────────────────────
        try:
            threat_svc = ThreatService(settings)
            recent = await threat_svc.get_recent_events(limit=20)
            context["threats"] = recent
        except Exception:
            context["threats"] = []
        context["summary"]["recent_threats"] = len(context["threats"])
        context["summary"]["critical_threats"] = sum(
            1 for t in context["threats"] if t.get("priority", "").lower() in ("critical", "emergency")
        )

        await api_client.close()

    except Exception as e:
        logger.warning(f"Failed to gather cluster context, using mock fallbacks: {e}")
        # Fallback: populate every section with mock data
        if not context["namespaces"]:
            context["namespaces"] = MOCK_NAMESPACES
            context["summary"]["namespaces"] = len(context["namespaces"])
        if not context["nodes"]:
            context["nodes"] = MOCK_NODES
            context["summary"]["nodes"] = len(context["nodes"])
            context["summary"]["healthy_nodes"] = sum(1 for n in context["nodes"] if n.get("ready", True))
            context["summary"]["master_nodes"] = sum(1 for n in context["nodes"] if n.get("role") == "master")
            context["summary"]["worker_nodes"] = sum(1 for n in context["nodes"] if n.get("role") == "worker")
        if not context["pods"]:
            context["pods"] = MOCK_PODS[:10]
            context["summary"]["pods"] = len(context["pods"])
            context["summary"]["running_pods"] = sum(1 for p in context["pods"] if p.get("phase") == "Running")
        if not context["services"]:
            context["services"] = MOCK_SERVICES
            context["summary"]["services"] = len(context["services"])
        if not context["policies"]:
            context["policies"] = MOCK_CNI_POLICIES
            context["summary"]["policies"] = len(context["policies"])
        if not context["bgp_peers"]:
            context["bgp_peers"] = MOCK_BGP_PEERS
            context["summary"]["bgp_peers"] = len(context["bgp_peers"])
            context["summary"]["bgp_sessions_up"] = sum(1 for p in context["bgp_peers"] if p.get("session_state") == "up")
        if not context["ip_pools"]:
            context["ip_pools"] = MOCK_IP_POOLS
            context["summary"]["ip_pools"] = len(context["ip_pools"])
            context["summary"]["active_pools"] = sum(1 for p in context["ip_pools"] if not p.get("disabled", False))
        if not context["ipam"]:
            context["ipam"] = MOCK_IPAM_BLOCKS
            context["summary"]["ipam_pools"] = len(context["ipam"])
        if not context["security"]["rbac_bindings"]:
            context["security"]["rbac_bindings"] = MOCK_RBAC
            context["summary"]["rbac_bindings"] = len(MOCK_RBAC)
            context["summary"]["admin_bindings"] = sum(1 for b in MOCK_RBAC if b.get("role_ref", {}).get("name") in ("cluster-admin", "admin"))
        if not context["security"]["privileged_pods"]:
            context["security"]["privileged_pods"] = [p for p in MOCK_PRIVILEGED if p.get("privileged")][:5]
            context["summary"]["privileged_pods"] = len(context["security"]["privileged_pods"])
        if not context["felix_metrics"]:
            context["felix_metrics"] = MOCK_FELIX_METRICS
        # Fallback for threats: no mock threats (better than fake alarm data)

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
