"""CNI (Calico) diagnostic endpoints."""

import asyncio
import os
import re
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Header
from slowapi import Limiter
from slowapi.util import get_remote_address

from config import Settings
from dependencies import get_k8s_client, get_settings_dep
from models.mock_data import (
    MOCK_BGP_PEERS,
    MOCK_CALICO_NODES,
    MOCK_CNI_POLICIES,
    MOCK_FELIX_METRICS,
    MOCK_IPAM_BLOCKS,
    MOCK_IP_POOLS,
)
from services import calico_service
from services.felix_metrics_service import get_felix_metrics, get_felix_metrics_time_series
from services.logging_service import get_logger

logger = get_logger(__name__)

# ── Security configuration ──────────────────────────────────────
# Namespace whitelist for the diagnostics endpoint (ephemeral pod creation).
# Only namespaces in this list are allowed as source/target for connectivity tests.
# Set via env var DIAG_NAMESPACE_WHITELIST (comma-separated, defaults to "default,k8s-dashboard").
_DIAG_NS_WHITELIST = frozenset(
    ns.strip()
    for ns in os.getenv("DIAG_NAMESPACE_WHITELIST", "default,k8s-dashboard").split(",")
    if ns.strip()
)

# Rate limiter for the diagnostics POST endpoint: 10 requests/minute per IP
# to prevent creating a flood of ephemeral pods.
diag_limiter = Limiter(key_func=get_remote_address)


# RFC 1123 subdomain: lowercase alphanumeric, hyphens, max 253 chars, start/end with alphanumeric
_NAME_RE = re.compile(r"^[a-z0-9]([-a-z0-9]*[a-z0-9])?$")


def _validate_k8s_name(value: str, field: str) -> str:
    """Validate that a Kubernetes resource name conforms to RFC 1123 subdomain."""
    if not value or len(value) > 253 or not _NAME_RE.match(value):
        raise HTTPException(status_code=400, detail=f"Invalid {field}: {value!r}")
    return value


def _check_api_key(x_api_key: str = Header("", alias="X-API-Key")) -> None:
    """FastAPI dependency: check API key for write operations.

    Only protects state-changing endpoints (POST diagnostics).
    GET endpoints remain open — they are read-only.
    """
    from config import get_settings
    settings = get_settings()
    if settings.API_KEY and x_api_key != settings.API_KEY:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing API key. Set X-API-Key header.",
        )


def _validate_diag_namespace(ns: str, field: str) -> str:
    """Validate that a namespace is in the diagnostics whitelist."""
    _validate_k8s_name(ns, field)
    if ns not in _DIAG_NS_WHITELIST:
        raise HTTPException(
            status_code=403,
            detail=f"Namespace {ns!r} is not in the diagnostics whitelist "
                   f"(allowed: {', '.join(sorted(_DIAG_NS_WHITELIST))})",
        )
    return ns


router = APIRouter(prefix="/api/cni", tags=["CNI / Calico"])


@router.get("/nodes")
async def list_cni_nodes(
    api_client=Depends(get_k8s_client),
) -> Dict[str, Any]:
    """Per-node Calico agent status (Felix ready, BIRD/BGP ready, IP, uptime)."""
    try:
        data = await calico_service.get_calico_nodes(api_client)
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"CNI nodes failed: {e}, using mock data")
        return {"status": "mock", "data": MOCK_CALICO_NODES}


@router.get("/bgp-peers")
async def list_bgp_peers(
    api_client=Depends(get_k8s_client),
) -> Dict[str, Any]:
    """BGP peer list with session state per node."""
    try:
        data = await calico_service.get_bgp_peers(api_client)
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"CNI BGP peers failed: {e}, using mock data")
        return {"status": "mock", "data": MOCK_BGP_PEERS}


@router.get("/ippools")
async def list_ip_pools(
    api_client=Depends(get_k8s_client),
) -> Dict[str, Any]:
    """IP pool definitions (CIDR, mode, disabled, NAT outgoing)."""
    try:
        data = await calico_service.get_ip_pools(api_client)
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"CNI IP pools failed: {e}, using mock data")
        return {"status": "mock", "data": MOCK_IP_POOLS}


@router.get("/ipam/utilization")
async def ipam_utilization(
    api_client=Depends(get_k8s_client),
) -> Dict[str, Any]:
    """Allocated vs. free IPs per pool / per node block."""
    try:
        data = await calico_service.get_ipam_utilization(api_client)
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"CNI IPAM utilization failed: {e}, using mock data")
        return {"status": "mock", "data": MOCK_IPAM_BLOCKS}


@router.get("/policies")
async def list_cni_policies(
    api_client=Depends(get_k8s_client),
) -> Dict[str, Any]:
    """All NetworkPolicy + GlobalNetworkPolicy, which pods/namespaces they select."""
    try:
        data = await calico_service.get_cni_policies(api_client)
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"CNI policies failed: {e}, using mock data")
        return {"status": "mock", "data": MOCK_CNI_POLICIES}


@router.get("/policies/coverage")
async def policy_coverage(
    api_client=Depends(get_k8s_client),
) -> Dict[str, Any]:
    """Per-pod policy coverage: which policies select each pod.

    Surfaces pods with no NetworkPolicy selecting them ("exposed" pods)
    that accept traffic from anywhere by default in Calico's allow-all
    default behavior.
    """
    try:
        # Fetch pods and policies in parallel
        from services.network_service import get_pods
        from services.utils import compute_policy_coverage

        pods, policies_raw = await asyncio.gather(
            get_pods(api_client),
            calico_service.get_cni_policies(api_client),
        )

        # Convert PodNetwork models to dicts
        pod_dicts = [
            {
                "name": p.name,
                "namespace": p.namespace,
                "labels": p.labels,
            }
            for p in pods
        ]

        data = compute_policy_coverage(pod_dicts, policies_raw)
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"Policy coverage failed: {e}, using mock data")
        from models.mock_data import MOCK_COVERAGE
        return {"status": "mock", "data": MOCK_COVERAGE}


@router.get("/topology")
async def cni_topology(
    api_client=Depends(get_k8s_client),
) -> Dict[str, Any]:
    """Node-to-node BGP mesh + pod overlay topology."""
    try:
        data = await calico_service.get_cni_topology(api_client)
        return {"status": "success", "data": data}
    except Exception as e:
        logger.warning(f"CNI topology failed: {e}, using mock data")
        from models.mock_data import build_mock_topology
        mock = build_mock_topology()
        return {"status": "mock", "data": mock}


@router.get("/metrics/felix")
async def felix_metrics(
    include_series: bool = Query(False, description="Include time-series data for the past hour"),
    settings: Settings = Depends(get_settings_dep),
) -> Dict[str, Any]:
    """Felix performance counters: policy evaluations, dropped packets, denied connections, BGP sessions."""
    try:
        gauges = await get_felix_metrics(settings)
        response: Dict[str, Any] = {"status": "success", "data": gauges}

        if include_series:
            series = await get_felix_metrics_time_series(settings)
            response["time_series"] = series

        return response
    except Exception as e:
        logger.warning(f"Felix metrics query failed: {e}, using mock data")
        response: Dict[str, Any] = {"status": "mock", "data": MOCK_FELIX_METRICS}
        if include_series:
            response["time_series"] = {}
        return response


@router.post("/diagnostics/connectivity")
@diag_limiter.limit("10/minute")
async def connectivity_diagnostics(
    source_pod: str = Query(..., description="Source pod name"),
    source_namespace: str = Query("default", description="Source pod namespace"),
    target_pod: Optional[str] = Query(None, description="Target pod name"),
    target_service: Optional[str] = Query(None, description="Target service name"),
    target_namespace: str = Query("default", description="Target namespace"),
    target_port: int = Query(80, description="Target port to test"),
    timeout_seconds: int = Query(30, description="Max time to wait for diagnostic pod (5-60)"),
    api_client=Depends(get_k8s_client),
    _auth=Depends(_check_api_key),
) -> Dict[str, Any]:
    """On-demand connectivity test between pods / services.

    Creates an ephemeral diagnostic pod in the source namespace that
    uses `nc` (netcat) to test TCP connectivity to the target.
    The pod is automatically deleted after the test completes.

    **Security:**
    - Requires a valid X-API-Key header (if API_KEY is configured)
    - Rate-limited to 10 requests/minute per IP
    - source_namespace and target_namespace must be in the whitelist
      (configurable via DIAG_NAMESPACE_WHITELIST env var)
    """
    try:
        from kubernetes_asyncio import client as k8s_client
        v1 = k8s_client.CoreV1Api(api_client)

        # ── Validate namespaces against whitelist ─────────────
        _validate_diag_namespace(source_namespace, "source_namespace")
        _validate_diag_namespace(target_namespace, "target_namespace")

        # Validate resource names (K8s RFC 1123 compliance)
        _validate_k8s_name(source_pod, "source_pod")

        # ── Resolve target host ──────────────────────────────
        target_host: Optional[str] = None
        target_display: str = ""

        if target_pod:
            _validate_k8s_name(target_pod, "target_pod")
            target_display = f"{target_namespace}/{target_pod}:{target_port}"
            try:
                pod_obj = await v1.read_namespaced_pod(name=target_pod, namespace=target_namespace)
                target_host = getattr(pod_obj.status, "pod_ip", None)
                if not target_host:
                    raise ValueError("Target pod has no IP assigned yet")
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Cannot resolve target pod: {e}")
        elif target_service:
            _validate_k8s_name(target_service, "target_service")
            target_display = f"{target_namespace}/{target_service}:{target_port}"
            # Use DNS name for service (works across namespaces)
            target_host = f"{target_service}.{target_namespace}.svc.cluster.local"
        else:
            raise HTTPException(status_code=400, detail="Either target_pod or target_service is required")

        # ── Create ephemeral diagnostic pod ──────────────────
        pod_name = f"cni-diag-{uuid.uuid4().hex[:8]}"
        clamped_timeout = max(5, min(timeout_seconds, 60))
        nc_timeout = max(1, clamped_timeout - 5)

        # Build command: test TCP connectivity, measure latency, capture DNS
        # Use env vars instead of string interpolation to prevent shell injection.
        cmd = (
            "echo '=== DIAGNOSTIC START ===' && "
            "echo '--- DNS ---' && "
            'nslookup "$TARGET_HOST" 2>&1 | head -20 && '
            "echo '--- TCP CHECK ---' && "
            "START=$(awk '{print int($1*1000)}' /proc/uptime) && "
            'rc=0; nc -zv -w "$NC_TIMEOUT" "$TARGET_HOST" "$TARGET_PORT" 2>&1 || rc=$? && '
            "if [ $rc -eq 0 ]; then echo 'RESULT=OK'; else echo 'RESULT=FAIL'; fi && "
            "END=$(awk '{print int($1*1000)}' /proc/uptime) && "
            'echo "LATENCY_MS=$((END - START))" && '
            "echo '=== DIAGNOSTIC END ==='"
        )

        pod_manifest = {
            "apiVersion": "v1",
            "kind": "Pod",
            "metadata": {
                "name": pod_name,
                "namespace": source_namespace,
                "labels": {
                    "app": "cni-diag",
                    "ephemeral": "true",
                    "source-pod": source_pod.replace(".", "-"),
                }
            },
            "spec": {
                "activeDeadlineSeconds": clamped_timeout + 10,
                "ttlSecondsAfterFinished": 60,
                "restartPolicy": "Never",
                "containers": [{
                    "name": "connectivity-check",
                    "image": "dashboard-backend:latest",
                    "imagePullPolicy": "Never",
                    "command": ["sh", "-c", cmd],
                    "env": [
                        {"name": "TARGET_HOST", "value": target_host},
                        {"name": "TARGET_PORT", "value": str(target_port)},
                        {"name": "NC_TIMEOUT", "value": str(nc_timeout)},
                    ],
                    "resources": {
                        "requests": {"cpu": "10m", "memory": "16Mi"},
                        "limits": {"cpu": "50m", "memory": "32Mi"},
                    }
                }],
                "terminationGracePeriodSeconds": 5,
            }
        }

        await v1.create_namespaced_pod(namespace=source_namespace, body=pod_manifest)

        # ── Wait for pod to finish ───────────────────────────
        elapsed = 0
        pod_phase = "Pending"
        while elapsed < clamped_timeout:
            await asyncio.sleep(1)
            elapsed += 1
            try:
                pod = await v1.read_namespaced_pod(name=pod_name, namespace=source_namespace)
                pod_phase = pod.status.phase
                if pod_phase in ("Succeeded", "Failed"):
                    break
            except Exception:
                # Pod might have been deleted externally
                break

        # ── Read logs ────────────────────────────────────────
        logs = ""
        try:
            logs = await v1.read_namespaced_pod_log(name=pod_name, namespace=source_namespace)
        except Exception:
            logs = "(Logs unavailable)"

        # ── Delete the pod ────────────────────────────────────
        try:
            await v1.delete_namespaced_pod(name=pod_name, namespace=source_namespace, grace_period_seconds=0)
        except Exception:
            pass

        # ── Parse results ────────────────────────────────────
        result = _parse_diag_logs(logs)

        return {
            "status": "success",
            "data": {
                "source": f"{source_namespace}/{source_pod}",
                "target": target_display,
                "target_host": target_host,
                "target_port": target_port,
                "reachable": result["reachable"],
                "latency_ms": result["latency_ms"],
                "dns_result": result["dns_result"],
                "connection_output": result["output"],
                "log_preview": result["log_preview"],
                "pod_phase": pod_phase,
                "test_duration_s": elapsed,
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Connectivity diagnostics failed: {e}, using mock result")
        return {
            "status": "mock",
            "data": {
                "source": f"{source_namespace}/{source_pod}",
                "target": (
                    f"{target_namespace}/{target_service}:{target_port}" if target_service
                    else f"{target_namespace}/{target_pod}:{target_port}"
                ),
                "reachable": True,
                "latency_ms": 2.3,
                "dns_result": "Mock DNS resolution successful",
                "connection_output": "Connection to target succeeded",
                "log_preview": "Mock diagnostic — K8s API not available",
                "pod_phase": "Succeeded",
                "test_duration_s": 1,
            },
        }


def _parse_diag_logs(logs: str) -> Dict[str, Any]:
    """Parse the diagnostic pod's output to extract connectivity result."""
    result: Dict[str, Any] = {
        "reachable": None,
        "latency_ms": None,
        "dns_result": "",
        "output": "",
        "log_preview": logs[:500] if logs else "",
    }

    if not logs:
        result["reachable"] = False
        result["output"] = "No output from diagnostic pod"
        return result

    # Extract DNS result
    dns_lines = []
    in_dns = False
    for line in logs.split("\n"):
        if "--- DNS ---" in line:
            in_dns = True
            continue
        if "--- TCP CHECK ---" in line or "=== DIAGNOSTIC END ===" in line:
            in_dns = False
            continue
        if in_dns:
            dns_lines.append(line.strip())
    result["dns_result"] = "\n".join(dns_lines[:10])

    # Extract connectivity result
    if "RESULT=OK" in logs:
        result["reachable"] = True
    elif "RESULT=FAIL" in logs:
        result["reachable"] = False
    elif "nc: connect to" in logs and "refused" in logs:
        result["reachable"] = False
    elif "Connection refused" in logs:
        result["reachable"] = False
    elif "Network is unreachable" in logs:
        result["reachable"] = False
    elif "No route to host" in logs:
        result["reachable"] = False
    elif "timed out" in logs:
        result["reachable"] = False
    elif "succeeded" in logs.lower() or "open" in logs.lower():
        result["reachable"] = True

    # Extract latency
    lat_match = re.search(r"LATENCY_MS=(\d+)", logs)
    if lat_match:
        result["latency_ms"] = int(lat_match.group(1))

    # Extract nc output
    output_lines = []
    capture = False
    for line in logs.split("\n"):
        if "--- TCP CHECK ---" in line:
            capture = True
            continue
        if "=== DIAGNOSTIC END ===" in line or "RESULT=" in line or "LATENCY_MS=" in line:
            continue
        if capture and line.strip():
            output_lines.append(line.strip())
    result["output"] = "\n".join(output_lines[-10:])

    return result
