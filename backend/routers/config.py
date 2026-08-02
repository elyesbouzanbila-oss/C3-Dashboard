"""
Cluster management endpoints — comprehensive CRUD for all major K8s resources
with super-user session-token protection for write operations.
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from kubernetes_asyncio.client.exceptions import ApiException
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from dependencies import get_k8s_client, fallback_response
from services import config_service, calico_service, auth_service
from services.audit_service import get_audit_log, log_audit
from services.logging_service import get_logger
from models.mock_data import MOCK_IP_POOLS, MOCK_BGP_PEERS

logger = get_logger(__name__)

router = APIRouter(prefix="/api/config", tags=["Configuration"])

# Kubernetes DNS-1123 subdomain: lowercase alphanumeric, dashes, optional dots.
# Enforced on every resource name so invalid names get a clean 422 instead of
# a raw 500 from the Kubernetes API server.
DNS_NAME_PATTERN = r"^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$"

# IPv4 CIDR, e.g. 10.244.0.0/16. Lenient octet ranges (defense-in-depth only;
# the cluster rejects truly invalid CIDRs).
CIDR_PATTERN = r"^(\d{1,3}\.){3}\d{1,3}/\d{1,2}$"

# IPv4 dotted-quad or IPv6 address. Lenient (defense-in-depth only; the cluster
# rejects truly invalid addresses). Grouped so both alternatives are anchored.
IP_PATTERN = r"^(?:(\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+)$"


# ═══════════════════════════════════════════════════════════════════
#  SUPER USER AUTH
# ═══════════════════════════════════════════════════════════════════

# Rate limiter for the /auth endpoint — 5 attempts/minute per IP to blunt
# brute-force password guessing (same pattern as the diagnostics limiter).
auth_limiter = Limiter(key_func=get_remote_address)

# Header carrying the short-lived session token minted by POST /auth.
_TOKEN_HEADER = "X-Super-User-Token"


class AuthRequest(BaseModel):
    password: str


class AuthResponse(BaseModel):
    authenticated: bool
    message: str
    token: Optional[str] = None


@router.post("/auth", response_model=AuthResponse)
@auth_limiter.limit("5/minute")
async def verify_super_user(request: Request, auth: AuthRequest) -> AuthResponse:
    """Verify the super user password and mint a short-lived signed session token.

    The returned token (15-minute TTL) must be sent as the X-Super-User-Token
    header on write requests — the raw password is never transmitted again.
    """
    from config import get_settings
    settings = get_settings()
    if not settings.SUPER_USER_PASSWORD:
        # No password configured = all operations allowed
        return AuthResponse(authenticated=True, message="No super user password configured")
    actor = request.client.host if request.client else "unknown"
    if auth_service.passwords_match(auth.password, settings.SUPER_USER_PASSWORD):
        token = auth_service.create_token(settings.SUPER_USER_PASSWORD)
        await log_audit(actor, "auth attempt", "super-user login", success=True)
        return AuthResponse(authenticated=True, message="Authenticated", token=token)
    # Audit failed attempts so brute-force probes leave a forensic trail.
    await log_audit(actor, "auth attempt", "super-user login", success=False, error="invalid password")
    return AuthResponse(authenticated=False, message="Invalid password")


def _audit_action(request: Request) -> str:
    """Human-readable action label from the matched route, e.g. 'POST create ip pool'."""
    route_name = getattr(request.scope.get("route"), "name", "") or "write"
    friendly = route_name.replace("_endpoint", "").replace("_", " ").strip()
    return f"{request.method} {friendly}".strip()


async def _audit_target(request: Request) -> str:
    """Describe the affected resource: path params, or the name in a JSON body."""
    params = request.path_params
    parts = []
    if params.get("namespace"):
        parts.append(str(params["namespace"]))
    if params.get("name"):
        parts.append(str(params["name"]))
    if parts:
        return "/".join(parts)
    # Create endpoints carry the resource name in the request body.
    try:
        body = await request.json()
        if isinstance(body, dict):
            name = body.get("name") or body.get("image") or ""
            if name:
                return str(name)[:120]
    except Exception:
        pass
    return f"{request.method} {request.url.path}"


async def require_super_user(
    request: Request,
    x_super_user_token: str = Header("", alias=_TOKEN_HEADER),
) -> str:
    """FastAPI dependency: require a valid super-user session token for writes.

    Tokens are minted by POST /api/config/auth and are valid for 15 minutes.
    Every write operation (POST/PUT/DELETE/PATCH) is recorded in the audit log
    with actor (client IP), action, target and outcome.

    If SUPER_USER_PASSWORD is not set (empty), all operations are allowed
    (no-password mode) and writes are still audited.
    """
    from config import get_settings
    settings = get_settings()

    is_write = request.method in ("POST", "PUT", "DELETE", "PATCH")

    if not settings.SUPER_USER_PASSWORD:
        if not is_write:
            yield "no-password-mode"
            return
        actor = request.client.host if request.client else "unknown"
        action = _audit_action(request)
        target = await _audit_target(request)
        try:
            yield "no-password-mode"
        except Exception as e:
            await log_audit(actor, action, target, success=False, error=str(e))
            raise
        await log_audit(actor, action, target, success=True)
        return

    if not auth_service.verify_token(x_super_user_token, settings.SUPER_USER_PASSWORD):
        if is_write:
            actor = request.client.host if request.client else "unknown"
            await log_audit(
                actor,
                _audit_action(request),
                await _audit_target(request),
                success=False,
                error="invalid or expired token",
            )
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired super user session. Re-authenticate via POST /api/config/auth.",
        )

    if not is_write:
        yield "super-user"
        return

    actor = request.client.host if request.client else "unknown"
    action = _audit_action(request)
    target = await _audit_target(request)
    try:
        yield "super-user"
    except Exception as e:
        await log_audit(actor, action, target, success=False, error=str(e))
        raise
    await log_audit(actor, action, target, success=True)


# ═══════════════════════════════════════════════════════════════════
#  REQUEST / RESPONSE MODELS
# ═══════════════════════════════════════════════════════════════════

# ─── IP Pool models ────────────────────────────────────────────

class IPPoolCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=253, pattern=DNS_NAME_PATTERN)
    cidr: str = Field(..., description="CIDR notation, e.g. 10.244.0.0/16", pattern=CIDR_PATTERN)
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
    name: str = Field(..., min_length=1, max_length=253, pattern=DNS_NAME_PATTERN)
    peer_ip: str = Field(..., description="Peer IP address", pattern=IP_PATTERN)
    peer_as_number: int = Field(default=64512, ge=1, le=65535)
    node_as_number: Optional[int] = Field(None, ge=1, le=65535)
    node: Optional[str] = None

class BGPPeerUpdate(BaseModel):
    peer_ip: Optional[str] = Field(None, pattern=IP_PATTERN)
    peer_as_number: Optional[int] = Field(None, ge=1, le=65535)
    node_as_number: Optional[int] = Field(None, ge=1, le=65535)
    node: Optional[str] = None

# ─── Namespace models ─────────────────────────────────────────

class NamespaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=253, pattern=DNS_NAME_PATTERN)

# ─── Service models ───────────────────────────────────────────

class ServicePort(BaseModel):
    port: int = 80
    targetPort: Optional[int] = None
    protocol: str = "TCP"
    name: Optional[str] = None

class ServiceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=253, pattern=DNS_NAME_PATTERN)
    namespace: str = Field("default", pattern=DNS_NAME_PATTERN)
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
    name: str = Field(..., min_length=1, max_length=253, pattern=DNS_NAME_PATTERN)
    namespace: str = Field("default", pattern=DNS_NAME_PATTERN)
    data: Dict[str, str] = {}

class ConfigMapUpdate(BaseModel):
    data: Dict[str, str] = {}

# ─── Secret models ────────────────────────────────────────────

class SecretCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=253, pattern=DNS_NAME_PATTERN)
    namespace: str = Field("default", pattern=DNS_NAME_PATTERN)
    type: str = "Opaque"
    data: Dict[str, str] = Field(default={}, description="Base64-encoded values")

class SecretUpdate(BaseModel):
    type: Optional[str] = None
    data: Optional[Dict[str, str]] = Field(None, description="Base64-encoded values")

# ─── Deployment models ────────────────────────────────────────

class DeploymentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=253, pattern=DNS_NAME_PATTERN)
    namespace: str = Field("default", pattern=DNS_NAME_PATTERN)
    replicas: int = Field(1, ge=0, le=1000)
    image: str = Field(..., min_length=1, description="Container image, e.g. nginx:1.27")
    app_label: Optional[str] = None

class DeploymentImageUpdate(BaseModel):
    image: str = Field(..., min_length=1)

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
        return fallback_response(
            {"status": "mock", "data": MOCK_IP_POOLS},
            {"status": "error", "data": [], "error": "Kubernetes API unavailable"},
        )
    try:
        data = await calico_service.get_ip_pools(api_client)
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"List IP pools failed: {e}")
        return fallback_response(
            {"status": "mock", "data": MOCK_IP_POOLS},
            {"status": "error", "data": [], "error": str(e)},
        )

@router.get("/bgppeers")
async def list_bgp_peers(api_client=Depends(get_k8s_client)) -> Dict[str, Any]:
    if api_client is None:
        return fallback_response(
            {"status": "mock", "data": MOCK_BGP_PEERS},
            {"status": "error", "data": [], "error": "Kubernetes API unavailable"},
        )
    try:
        data = await calico_service.get_bgp_peers(api_client)
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"List BGP peers failed: {e}")
        return fallback_response(
            {"status": "mock", "data": MOCK_BGP_PEERS},
            {"status": "error", "data": [], "error": str(e)},
        )

@router.get("/namespaces")
async def list_namespaces(api_client=Depends(get_k8s_client)) -> Dict[str, Any]:
    if api_client is None:
        return fallback_response(
            {"status": "mock", "data": [{"name": "default"}, {"name": "kube-system"}, {"name": "production"}, {"name": "monitoring"}]},
            {"status": "error", "data": [], "error": "Kubernetes API unavailable"},
        )
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
        return fallback_response(
            {"status": "mock", "data": [{"name": "kube-dns", "namespace": "kube-system", "cluster_ip": "10.100.0.10", "type": "ClusterIP", "ports": "dns-udp:53/UDP, dns-tcp:53/TCP, metrics:9153/TCP"}, {"name": "api-service", "namespace": "production", "cluster_ip": "10.100.1.1", "type": "ClusterIP", "ports": "http:80/TCP"}]},
            {"status": "error", "data": [], "error": "Kubernetes API unavailable"},
        )
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
        return fallback_response(
            {"status": "mock", "data": [{"name": "kube-dns-config", "namespace": "kube-system", "keys": ["Corefile", "upstreamNameservers"]}, {"name": "app-config", "namespace": "production", "keys": ["config.yaml", "env"]}]},
            {"status": "error", "data": [], "error": "Kubernetes API unavailable"},
        )
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
        return fallback_response(
            {"status": "mock", "data": [{"name": "default-token", "namespace": "default", "type": "kubernetes.io/service-account-token", "keys": ["ca.crt", "token"]}, {"name": "db-credentials", "namespace": "production", "type": "Opaque", "keys": ["username", "password"]}]},
            {"status": "error", "data": [], "error": "Kubernetes API unavailable"},
        )
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

@router.get("/configmaps/{namespace}/{name}")
async def get_configmap_detail(namespace: str, name: str, api_client=Depends(get_k8s_client)) -> Dict[str, Any]:
    """Full ConfigMap detail including data — for the edit form."""
    if api_client is None:
        return fallback_response(
            {"status": "mock", "data": {"name": name, "namespace": namespace, "data": {}}},
            {"status": "error", "data": {}, "error": "Kubernetes API unavailable"},
        )
    try:
        from kubernetes_asyncio import client as k8s_client
        v1 = k8s_client.CoreV1Api(api_client)
        cm = await v1.read_namespaced_config_map(name=name, namespace=namespace)
        return {"status": "success", "data": {"name": name, "namespace": namespace, "data": cm.data or {}}}
    except Exception as e:
        logger.warning(f"Get configmap {namespace}/{name} failed: {e}")
        return {"status": "error", "data": {}}

@router.get("/secrets/{namespace}/{name}")
async def get_secret_detail(namespace: str, name: str, api_client=Depends(get_k8s_client)) -> Dict[str, Any]:
    """Full Secret detail including base64 data — for the edit form."""
    if api_client is None:
        return fallback_response(
            {"status": "mock", "data": {"name": name, "namespace": namespace, "type": "Opaque", "data": {}}},
            {"status": "error", "data": {}, "error": "Kubernetes API unavailable"},
        )
    try:
        from kubernetes_asyncio import client as k8s_client
        v1 = k8s_client.CoreV1Api(api_client)
        sec = await v1.read_namespaced_secret(name=name, namespace=namespace)
        return {"status": "success", "data": {"name": name, "namespace": namespace, "type": sec.type or "Opaque", "data": sec.data or {}}}
    except Exception as e:
        logger.warning(f"Get secret {namespace}/{name} failed: {e}")
        return {"status": "error", "data": {}}

@router.get("/deployments")
async def list_deployments(api_client=Depends(get_k8s_client), namespace: str = "") -> Dict[str, Any]:
    if api_client is None:
        return fallback_response(
            {"status": "mock", "data": [{"name": "coredns", "namespace": "kube-system", "replicas": 2, "ready_replicas": 2, "image": "registry.k8s.io/coredns:v1.10.1"}, {"name": "api-server", "namespace": "production", "replicas": 3, "ready_replicas": 3, "image": "myapp:v2.1.0"}, {"name": "redis-cache", "namespace": "production", "replicas": 1, "ready_replicas": 1, "image": "redis:7-alpine"}]},
            {"status": "error", "data": [], "error": "Kubernetes API unavailable"},
        )
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
        return fallback_response(
            {"status": "mock", "data": MOCK_NODES},
            {"status": "error", "data": [], "error": "Kubernetes API unavailable"},
        )
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
#  KUBERNETES API ERROR MAPPING
# ═══════════════════════════════════════════════════════════════════

# Map Kubernetes API server status codes to human-readable guidance so
# users get actionable responses instead of raw str(e) dumps / generic 500s.
_K8S_STATUS_HINTS = {
    400: "Kubernetes API rejected the request as invalid (400).",
    403: "Permission denied by Kubernetes RBAC — the dashboard service account lacks the required permissions for this resource.",
    404: "Resource not found in the cluster. It may have been deleted or never existed.",
    409: "Conflict — the resource already exists or was modified concurrently. Refresh and try again.",
    422: "Kubernetes API rejected the resource as invalid (422).",
    503: "Kubernetes API server is temporarily unavailable.",
}


def _k8s_api_message(exc: ApiException) -> str:
    """Extract a readable message from a kubernetes_asyncio ApiException.

    The raw str(exc) is a huge multi-line dump of status/reason/headers/body.
    The useful part lives in the JSON 'message' field of the HTTP response
    body, e.g. nodes \"masternode\" is forbidden: User cannot patch resource...
    """
    body = getattr(exc, "body", None) or ""
    # body is normally a JSON string, but some client paths yield a parsed dict.
    parsed = None
    if isinstance(body, str) and body.strip():
        import json
        try:
            parsed = json.loads(body)
        except (ValueError, TypeError):
            parsed = None
    elif isinstance(body, dict):
        parsed = body
    if isinstance(parsed, dict):
        msg = parsed.get("message")
        if msg:
            return msg
    reason = getattr(exc, "reason", None) or "Kubernetes API error"
    status = getattr(exc, "status", None)
    return f"{reason} (HTTP {status})" if status else reason


def _raise_k8s_error(exc: Exception, context: str) -> None:
    """Map an exception from a Kubernetes API call to a clean HTTP response.

    kubernetes_asyncio.ApiException carries a real HTTP status — forward the
    meaningful ones (403 RBAC, 404 not found, 409 conflict, ...) with a
    readable detail instead of a raw str(exc) 500. HTTPException passes
    through untouched. Anything else becomes a logged 500.
    """
    if isinstance(exc, HTTPException):
        raise exc
    if isinstance(exc, ApiException):
        status = exc.status or 500
        detail = _k8s_api_message(exc)
        hint = _K8S_STATUS_HINTS.get(status)
        if hint:
            detail = f"{hint} — {detail}".strip()
        logger.error(f"{context}: Kubernetes API error {status}: {detail}")
        raise HTTPException(status_code=status, detail=detail)
    logger.error(f"{context}: {exc}")
    raise HTTPException(status_code=500, detail=str(exc))


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
        _raise_k8s_error(e, "Create IP pool")

@router.put("/ippools/{name}")
async def update_ip_pool_endpoint(name: str, pool: IPPoolUpdate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        update_data = {k: v for k, v in pool.model_dump().items() if v is not None}
        await config_service.update_ip_pool(api_client, name, update_data)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        _raise_k8s_error(e, f"Update IP pool {name}")

@router.delete("/ippools/{name}")
async def delete_ip_pool_endpoint(name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.delete_ip_pool(api_client, name)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        _raise_k8s_error(e, f"Delete IP pool {name}")

# ─── BGP Peer write ─────────────────────────────────────────────

@router.post("/bgppeers", status_code=201)
async def create_bgp_peer_endpoint(peer: BGPPeerCreate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.create_bgp_peer(api_client, peer.model_dump())
        return {"status": "success", "data": {"name": peer.name, "peer_ip": peer.peer_ip}}
    except Exception as e:
        _raise_k8s_error(e, "Create BGP peer")

@router.put("/bgppeers/{name}")
async def update_bgp_peer_endpoint(name: str, peer: BGPPeerUpdate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        update_data = {k: v for k, v in peer.model_dump().items() if v is not None}
        await config_service.update_bgp_peer(api_client, name, update_data)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        _raise_k8s_error(e, f"Update BGP peer {name}")

@router.delete("/bgppeers/{name}")
async def delete_bgp_peer_endpoint(name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.delete_bgp_peer(api_client, name)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        _raise_k8s_error(e, f"Delete BGP peer {name}")

# ─── Namespace write ────────────────────────────────────────────

@router.post("/namespaces", status_code=201)
async def create_namespace_endpoint(ns: NamespaceCreate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.create_namespace(api_client, ns.name)
        return {"status": "success", "data": {"name": ns.name}}
    except Exception as e:
        _raise_k8s_error(e, "Create namespace")

@router.delete("/namespaces/{name}")
async def delete_namespace_endpoint(name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.delete_namespace(api_client, name)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        _raise_k8s_error(e, f"Delete namespace {name}")

# ─── Service write ──────────────────────────────────────────────

@router.post("/services", status_code=201)
async def create_service_endpoint(svc: ServiceCreate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.create_service(api_client, svc.model_dump())
        return {"status": "success", "data": {"name": svc.name, "namespace": svc.namespace}}
    except Exception as e:
        _raise_k8s_error(e, "Create service")

@router.put("/services/{namespace}/{name}")
async def update_service_endpoint(namespace: str, name: str, svc: ServiceUpdate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        update_data = {k: v for k, v in svc.model_dump().items() if v is not None}
        await config_service.update_service(api_client, namespace, name, update_data)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        _raise_k8s_error(e, f"Update service {namespace}/{name}")

@router.delete("/services/{namespace}/{name}")
async def delete_service_endpoint(namespace: str, name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.delete_service(api_client, namespace, name)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        _raise_k8s_error(e, f"Delete service {namespace}/{name}")

# ─── ConfigMap write ────────────────────────────────────────────

@router.post("/configmaps", status_code=201)
async def create_configmap_endpoint(cm: ConfigMapCreate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.create_configmap(api_client, cm.model_dump())
        return {"status": "success", "data": {"name": cm.name, "namespace": cm.namespace}}
    except Exception as e:
        _raise_k8s_error(e, "Create configmap")

@router.put("/configmaps/{namespace}/{name}")
async def update_configmap_endpoint(namespace: str, name: str, cm: ConfigMapUpdate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.update_configmap(api_client, namespace, name, cm.model_dump())
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        _raise_k8s_error(e, f"Update configmap {namespace}/{name}")

@router.delete("/configmaps/{namespace}/{name}")
async def delete_configmap_endpoint(namespace: str, name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.delete_configmap(api_client, namespace, name)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        _raise_k8s_error(e, f"Delete configmap {namespace}/{name}")

# ─── Secret write ───────────────────────────────────────────────

@router.post("/secrets", status_code=201)
async def create_secret_endpoint(secret: SecretCreate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.create_secret(api_client, secret.model_dump())
        return {"status": "success", "data": {"name": secret.name, "namespace": secret.namespace}}
    except Exception as e:
        _raise_k8s_error(e, "Create secret")

@router.put("/secrets/{namespace}/{name}")
async def update_secret_endpoint(namespace: str, name: str, secret: SecretUpdate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        update_data = {k: v for k, v in secret.model_dump().items() if v is not None}
        await config_service.update_secret(api_client, namespace, name, update_data)
        return {"status": "success", "data": {"name": name, "namespace": namespace}}
    except Exception as e:
        _raise_k8s_error(e, f"Update secret {namespace}/{name}")

@router.delete("/secrets/{namespace}/{name}")
async def delete_secret_endpoint(namespace: str, name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.delete_secret(api_client, namespace, name)
        return {"status": "success", "data": {"name": name}}
    except Exception as e:
        _raise_k8s_error(e, f"Delete secret {namespace}/{name}")

# ─── Deployment write ─────────────────────────────────────────

@router.post("/deployments", status_code=201)
async def create_deployment_endpoint(dep: DeploymentCreate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.create_deployment(api_client, dep.model_dump())
        return {"status": "success", "data": {"name": dep.name, "namespace": dep.namespace}}
    except Exception as e:
        _raise_k8s_error(e, "Create deployment")

@router.put("/deployments/{namespace}/{name}/image")
async def update_deployment_image_endpoint(namespace: str, name: str, body: DeploymentImageUpdate, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.update_deployment_image(api_client, namespace, name, body.image)
        return {"status": "success", "data": {"name": name, "namespace": namespace, "image": body.image}}
    except Exception as e:
        _raise_k8s_error(e, f"Update deployment {namespace}/{name} image")

# ─── Deployment operations ──────────────────────────────────────

@router.post("/deployments/{namespace}/{name}/scale")
async def scale_deployment_endpoint(namespace: str, name: str, req: ScaleRequest, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.scale_deployment(api_client, namespace, name, req.replicas)
        return {"status": "success", "data": {"name": name, "namespace": namespace, "replicas": req.replicas}}
    except Exception as e:
        _raise_k8s_error(e, f"Scale deployment {namespace}/{name}")

@router.post("/deployments/{namespace}/{name}/restart")
async def restart_deployment_endpoint(namespace: str, name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.restart_deployment(api_client, namespace, name)
        return {"status": "success", "data": {"name": name, "namespace": namespace, "action": "restart"}}
    except Exception as e:
        _raise_k8s_error(e, f"Restart deployment {namespace}/{name}")

# ─── Node operations ────────────────────────────────────────────

@router.post("/nodes/{name}/cordon")
async def cordon_node_endpoint(name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.cordon_node(api_client, name, True)
        return {"status": "success", "data": {"name": name, "action": "cordon"}}
    except Exception as e:
        _raise_k8s_error(e, f"Cordon node {name}")

@router.post("/nodes/{name}/uncordon")
async def uncordon_node_endpoint(name: str, api_client=Depends(get_k8s_client), _su=Depends(require_super_user)) -> Dict[str, Any]:
    if api_client is None:
        raise HTTPException(status_code=503, detail="Kubernetes API not available")
    try:
        await config_service.cordon_node(api_client, name, False)
        return {"status": "success", "data": {"name": name, "action": "uncordon"}}
    except Exception as e:
        _raise_k8s_error(e, f"Uncordon node {name}")


# ═══════════════════════════════════════════════════════════════════
#  AUDIT LOG
# ═══════════════════════════════════════════════════════════════════

@router.get("/audit")
async def get_audit(
    limit: int = Query(100, ge=1, le=500),
    _su=Depends(require_super_user),
) -> Dict[str, Any]:
    """Return recent super-user write audit entries, newest first.

    Each entry records actor (client IP), action, target and outcome.
    Requires a valid super-user session token.
    """
    entries = await get_audit_log(limit)
    return {"status": "success", "data": entries}


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
