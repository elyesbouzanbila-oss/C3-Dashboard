"""
Cluster management endpoints — comprehensive CRUD for all major K8s resources
with super user password protection for write operations.
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field

from dependencies import get_k8s_client
from services import config_service, calico_service
from services.logging_service import get_logger
from models.mock_data import MOCK_IP_POOLS, MOCK_BGP_PEERS

logger = get_logger(__name__)

router = APIRouter(prefix="/api/config", tags=["Configuration"])


# ═══════════════════════════════════════════════════════════════════
#  SUPER USER AUTH
# ═══════════════════════════════════════════════════════════════════


class AuthRequest(BaseModel):
    password: str


class AuthResponse(BaseModel):
    authenticated: bool
    message: str


@router.post("/auth", response_model=AuthResponse)
async def verify_super_user(auth: AuthRequest) -> AuthResponse:
    """Verify super user password. Used by the frontend to authenticate write operations."""
    from config import get_settings
    settings = get_settings()
    if not settings.SUPER_USER_PASSWORD:
        # No password configured = all operations allowed
        return AuthResponse(authenticated=True, message="No super user password configured")
    if auth.password == settings.SUPER_USER_PASSWORD:
        return AuthResponse(authenticated=True, message="Authenticated")
    return AuthResponse(authenticated=False, message="Invalid password")


def require_super_user(x_super_user_password: str = Header("", alias="X-Super-User-Password")) -> str:
    """FastAPI dependency: require valid super user password for write operations.

    If SUPER_USER_PASSWORD is not set (empty), all operations are allowed.
    Otherwise the header must match.
    """
    from config import get_settings
    settings = get_settings()
    if not settings.SUPER_USER_PASSWORD:
        return "no-password-mode"
    if x_super_user_password != settings.SUPER_USER_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid or missing super user password. Set X-Super-User-Password header.")
    return x_super_user_password


# ═══════════════════════════════════════════════════════════════════
#  REQUEST / RESPONSE MODELS
# ═══════════════════════════════════════════════════════════════════

# ─── IP Pool models ────────────────────────────────────────────

class IPPoolCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=253)
    cidr: str = Field(..., description="CIDR notation, e.g. 10.244.0.0/16")
    nat_outgoing: bool = True
    disabled: bool = False
    mode: str = Field(default="vxlan", pattern="^(ipip|vxlan|none)$")
    node_selector: str = "all()"

class IPPoolUpdate(BaseModel):
    nat_outgoing: Optional[bool] = None
    disabled: Optional[bool] = None
    mode: Optional[str] = Field(None, pattern="^(ipip|vxlan|none)$")
    node_selector: Optional[str] = None

# ─── BGP Peer models ──────────────────────────────────────────

class BGPPeerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=253)
    peer_ip: str = Field(..., description="Peer IP address")
    peer_as_number: int = Field(default=64512, ge=1, le=65535)
    node_as_number: Optional[int] = Field(None, ge=1, le=65535)
    node: Optional[str] = None

class BGPPeerUpdate(BaseModel):
    peer_ip: Optional[str] = None
    peer_as_number: Optional[int] = Field(None, ge=1, le=65535)
    node_as_number: Optional[int] = Field(None, ge=1, le=65535)
    node: Optional[str] = None

# ─── Namespace models ─────────────────────────────────────────

class NamespaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=253, pattern=r"^[a-z0-9]([-a-z0-9]*[a-z0-9])?$")

# ─── Service models ───────────────────────────────────────────

class ServicePort(BaseModel):
    port: int = 80
    targetPort: Optional[int] = None
    protocol: str = "TCP"
    name: Optional[str] = None

class ServiceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=253)
    namespace: str = "default"
    selector: Dict[str, str] = {}
    ports: List[ServicePort] = [ServicePort()]
    type: str = "ClusterIP"
    cluster_ip: Optional[str] = None

class ServiceUpdate(BaseModel):
    selector: Optional[Dict[str, str]] = None
    ports: Optional[List[ServicePort]] = None
    type: Optional[str] = None

# ─── ConfigMap models ─────────────────────────────────────────

class ConfigMapCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=253)
    namespace: str = "default"
    data: Dict[str, str] = {}

class ConfigMapUpdate(BaseModel):
    data: Dict[str, str] = {}

# ─── Secret models ────────────────────────────────────────────

class SecretCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=253)
    namespace: str = "default"
    type: str = "Opaque"
    data: Dict[str, str] = Field(default={}, description="Base64-encoded values")

# ─── Deployment models ────────────────────────────────────────

class ScaleRequest(BaseModel):
    replicas: int = Field(..., ge=0, le=1000)

class RestartResponse(BaseModel):
    status: str
    message: str


# ═══════════════════════════════════════════════════════════════════
#  READ ENDPOINTS (no auth required)
# ═══════════════════════════════════════════════════════════════════

@router.get("/ippools")
async def list_ip_pools(api_client=Depends(get_k8s_client)) -> Dict[str, Any]:
    if api_client is None:
        return {"status": "mock", "data": MOCK_IP_POOLS}
    try:
        data = await calico_service.get_ip_pools(api_client)
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"List IP pools failed: {e}")
        return {"status": "mock", "data": MOCK_IP_POOLS}

@router.get("/bgppeers")
async def list_bgp_peers(api_client=Depends(get_k8s_client)) -> Dict[str, Any]:
    if api_client is None:
        return {"status": "mock", "data": MOCK_BGP_PEERS}
    try:
        data = await calico_service.get_bgp_peers(api_client)
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"List BGP peers failed: {e}")
        return {"status": "mock", "data": MOCK_BGP_PEERS}

@router.get("/namespaces")
async def list_namespaces(api_client=Depends(get_k8s_client)) -> Dict[str, Any]:
    if api_client is None:
        return {"status": "mock", "data": [{"name": "default"}, {"name": "kube-system"}, {"name": "production"}, {"name": "monitoring"}]}
    try:
        from kubernetes_asyncio import client as k8s_client
        v1 = k8s_client.CoreV1Api(api_client)
        nss = await v1.list_namespace()
        data = [{"name": ns.metadata.name, "status": ns.status.phase, "labels": ns.metadata.labels or {}} for ns in nss.items]
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"List namespaces failed: {e}")
        return {"status": "error", "data": []}

@router.get("/services")
async def list_services(api_client=Depends(get_k8s_client), namespace: str = "") -> Dict[str, Any]:
    if api_client is None:
        return {"status": "mock", "data": [{"name": "kube-dns", "namespace": "kube-system", "cluster_ip": "10.100.0.10", "type": "ClusterIP", "ports": "dns-udp:53/UDP, dns-tcp:53/TCP, metrics:9153/TCP"}, {"name": "api-service", "namespace": "production", "cluster_ip": "10.100.1.1", "type": "ClusterIP", "ports": "http:80/TCP"}]}
    try:
        from kubernetes_asyncio import client as k8s_client
        v1 = k8s_client.CoreV1Api(api_client)
        if namespace:
            svcs = await v1.list_namespaced_service(namespace=namespace)
        else:
            svcs = await v1.list_service_for_all_namespaces()
        data = [{"name": s.metadata.name, "namespace": s.metadata.namespace, "cluster_ip": s.spec.cluster_ip or "-", "type": s.spec.type or "ClusterIP", "ports": _fmt_svc_ports(s.spec.ports)} for s in svcs.items]
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"List services failed: {e}")
        return {"status": "error", "data": []}

@router.get("/configmaps")
async def list_configmaps(api_client=Depends(get_k8s_client), namespace: str = "") -> Dict[str, Any]:
    if api_client is None:
        return {"status": "mock", "data": [{"name": "kube-dns-config", "namespace": "kube-system", "keys": ["Corefile", "upstreamNameservers"]}, {"name": "app-config", "namespace": "production", "keys": ["config.yaml", "env"]}]}
    try:
        from kubernetes_asyncio import client as k8s_client
        v1 = k8s_client.CoreV1Api(api_client)
        if namespace:
            cms = await v1.list_namespaced_config_map(namespace=namespace)
        else:
            cms = await v1.list_config_map_for_all_namespaces()
        data = [{"name": cm.metadata.name, "namespace": cm.metadata.namespace, "keys": list((cm.data or {}).keys())} for cm in cms.items]
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"List configmaps failed: {e}")
        return {"status": "error", "data": []}

@router.get("/secrets")
async def list_secrets(api_client=Depends(get_k8s_client), namespace: str = "") -> Dict[str, Any]:
    if api_client is None:
        return {"status": "mock", "data": [{"name": "default-token", "namespace": "default", "type": "kubernetes.io/service-account-token", "keys": ["ca.crt", "token"]}, {"name": "db-credentials", "namespace": "production", "type": "Opaque", "keys": ["username", "password"]}]}
    try:
        from kubernetes_asyncio import client as k8s_client
        v1 = k8s_client.CoreV1Api(api_client)
        if namespace:
            secs = await v1.list_namespaced_secret(namespace=namespace)
        else:
            secs = await v1.list_secret_for_all_namespaces()
        data = [{"name": s.metadata.name, "namespace": s.metadata.namespace, "type": s.type or "Opaque", "keys": list((s.data or {}).keys())} for s in secs.items]
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"List secrets failed: {e}")
        return {"status": "error", "data": []}

@router.get("/deployments")
async def list_deployments(api_client=Depends(get_k8s_client), namespace: str = "") -> Dict[str, Any]:
    if api_client is None:
        return {"status": "mock", "data": [{"name": "coredns", "namespace": "kube-system", "replicas": 2, "ready_replicas": 2, "image": "registry.k8s.io/coredns:v1.10.1"}, {"name": "api-server", "namespace": "production", "replicas": 3, "ready_replicas": 3, "image": "myapp:v2.1.0"}, {"name": "redis-cache", "namespace": "production", "replicas": 1, "ready_replicas": 1, "image": "redis:7-alpine"}]}
    try:
        from kubernetes_asyncio import client as k8s_client
        apps = k8s_client.AppsV1Api(api_client)
        if namespace:
            deps = await apps.list_namespaced_deployment(namespace=namespace)
        else:
            deps = await apps.list_deployment_for_all_namespaces()
        data = [{"name": d.metadata.name, "namespace": d.metadata.namespace, "replicas": d.spec.replicas or 0, "ready_replicas": d.status.ready_replicas or 0, "image": (d.spec.template.spec.containers[0].image if d.spec.template.spec.containers else "")} for d in deps.items]
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"List deployments failed: {e}")
        return {"status": "error", "data": []}

@router.get("/nodes")
async def list_cluster_nodes(api_client=Depends(get_k8s_client)) -> Dict[str, Any]:
    if api_client is None:
        from models.mock_data import MOCK_NODES
        return {"status": "mock", "data": MOCK_NODES}
    try:
        from kubernetes_asyncio import client as k8s_client
        v1 = k8s_client.CoreV1Api(api_client)
        nodes = await v1.list_node()
        data = []
        for n in nodes.items:
            ready = True
            for c in n.status.conditions or []:
                if c.type == "Ready": ready = c.status == "True"; break
            labels = n.metadata.labels or {}
            role = "worker"
            if labels.get("node-role.kubernetes.io/control-plane") == "" or labels.get("node-role.kubernetes.io/master") == "":
                role = "master"
            ip = ""
            for addr in n.status.addresses or []:
                if addr.type == "InternalIP": ip = addr.address; break
            data.append({"name": n.metadata.name, "role": role, "ip": ip, "ready": ready, "unschedulable": n.spec.unschedulable or False, "kubelet_version": n.status.node_info.kubelet_version if n.status.node_info else "", "os_image": n.status.node_info.os_image if n.status.node_info else ""})
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"List nodes failed: {e}")
        return {"status": "error", "data": []}


def _fmt_svc_ports(ports) -> str:
    if not ports: return "-"
    parts = []
    for p in ports:
        proto = p.protocol or "TCP"
        name = f"{p.name}:" if p.name else ""
        parts.append(f"{name}{p.port}/{proto}")
    return ", ".join(parts)


# ═══════════════════════════════════════════════════════════════════
#  WRITE ENDPOINTS (super user auth required)
# ═══════════════════════════════════════════════════════════════════

# ─── IP Pool write ──────────────────────────────────────────────

@router.post("/ippools", status_code=201)
async def create_ip_pool_endpoint(pool: IPPoolCreate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.create_ip_pool(api_client, pool.model_dump())
        return {"status": "success", "data": {"name": pool.name, "cidr": pool.cidr}}
    except Exception as e:
        logger.error(f"Create IP pool failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/ippools/{name}")
async def update_ip_pool_endpoint(name: str, pool: IPPoolUpdate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        update_data = {k: v for k, v in pool.model_dump().items() if v is not None}
        await config_service.update_ip_pool(api_client, name, update_data)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        logger.error(f"Update IP pool {name} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/ippools/{name}")
async def delete_ip_pool_endpoint(name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.delete_ip_pool(api_client, name)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        logger.error(f"Delete IP pool {name} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ─── BGP Peer write ─────────────────────────────────────────────

@router.post("/bgppeers", status_code=201)
async def create_bgp_peer_endpoint(peer: BGPPeerCreate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.create_bgp_peer(api_client, peer.model_dump())
        return {"status": "success", "data": {"name": peer.name, "peer_ip": peer.peer_ip}}
    except Exception as e:
        logger.error(f"Create BGP peer failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/bgppeers/{name}")
async def update_bgp_peer_endpoint(name: str, peer: BGPPeerUpdate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
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
async def delete_bgp_peer_endpoint(name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.delete_bgp_peer(api_client, name)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        logger.error(f"Delete BGP peer {name} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ─── Namespace write ────────────────────────────────────────────

@router.post("/namespaces", status_code=201)
async def create_namespace_endpoint(ns: NamespaceCreate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.create_namespace(api_client, ns.name)
        return {"status": "success", "data": {"name": ns.name}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/namespaces/{name}")
async def delete_namespace_endpoint(name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.delete_namespace(api_client, name)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Service write ──────────────────────────────────────────────

@router.post("/services", status_code=201)
async def create_service_endpoint(svc: ServiceCreate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.create_service(api_client, svc.model_dump())
        return {"status": "success", "data": {"name": svc.name, "namespace": svc.namespace}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/services/{namespace}/{name}")
async def update_service_endpoint(namespace: str, name: str, svc: ServiceUpdate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        update_data = {k: v for k, v in svc.model_dump().items() if v is not None}
        await config_service.update_service(api_client, namespace, name, update_data)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/services/{namespace}/{name}")
async def delete_service_endpoint(namespace: str, name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.delete_service(api_client, namespace, name)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── ConfigMap write ────────────────────────────────────────────

@router.post("/configmaps", status_code=201)
async def create_configmap_endpoint(cm: ConfigMapCreate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.create_configmap(api_client, cm.model_dump())
        return {"status": "success", "data": {"name": cm.name, "namespace": cm.namespace}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/configmaps/{namespace}/{name}")
async def update_configmap_endpoint(namespace: str, name: str, cm: ConfigMapUpdate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.update_configmap(api_client, namespace, name, cm.model_dump())
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/configmaps/{namespace}/{name}")
async def delete_configmap_endpoint(namespace: str, name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.delete_configmap(api_client, namespace, name)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Secret write ───────────────────────────────────────────────

@router.post("/secrets", status_code=201)
async def create_secret_endpoint(secret: SecretCreate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.create_secret(api_client, secret.model_dump())
        return {"status": "success", "data": {"name": secret.name, "namespace": secret.namespace}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/secrets/{namespace}/{name}")
async def delete_secret_endpoint(namespace: str, name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.delete_secret(api_client, namespace, name)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Deployment operations ──────────────────────────────────────

@router.post("/deployments/{namespace}/{name}/scale")
async def scale_deployment_endpoint(namespace: str, name: str, req: ScaleRequest, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.scale_deployment(api_client, namespace, name, req.replicas)
        return {"status": "success", "data": {"name": name, "namespace": namespace, "replicas": req.replicas}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/deployments/{namespace}/{name}/restart")
async def restart_deployment_endpoint(namespace: str, name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.restart_deployment(api_client, namespace, name)
        return {"status": "success", "data": {"name": name, "namespace": namespace, "action": "restart"}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Node operations ────────────────────────────────────────────

@router.post("/nodes/{name}/cordon")
async def cordon_node_endpoint(name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.cordon_node(api_client, name, True)
        return {"status": "success", "data": {"name": name, "action": "cordon"}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/nodes/{name}/uncordon")
async def uncordon_node_endpoint(name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.cordon_node(api_client, name, False)
        return {"status": "success", "data": {"name": name, "action": "uncordon"}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════
#  SETTINGS
# ═══════════════════════════════════════════════════════════════════

@router.get("/settings")
async def dashboard_settings() -> Dict[str, Any]:
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
            "has_super_user_password": bool(s.SUPER_USER_PASSWORD),
            "has_redis_password": bool(s.REDIS_PASSWORD),
            "has_falco_webhook_secret": bool(s.FALCO_WEBHOOK_SECRET),
        },
    }
