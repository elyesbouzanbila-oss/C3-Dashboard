"""
Service layer for cluster management — full CRUD on all major K8s resources
plus Calico CRDs via the Kubernetes API.
"""

import logging
from datetime import datetime
from typing import Any, Dict, Optional
from kubernetes_asyncio import client as k8s_client

logger = logging.getLogger(__name__)

CALICO_GROUP = "crd.projectcalico.org"
CALICO_VERSION = "v1"


# ═══════════════════════════════════════════════════════════════════
#  CALICO CRD OPERATIONS
# ═══════════════════════════════════════════════════════════════════

async def create_ip_pool(api_client, pool_data: Dict[str, Any]) -> Dict[str, Any]:
    custom_api = k8s_client.CustomObjectsApi(api_client)
    body = {
        "apiVersion": f"{CALICO_GROUP}/{CALICO_VERSION}",
        "kind": "IPPool",
        "metadata": {"name": pool_data["name"]},
        "spec": {
            "cidr": pool_data["cidr"],
            "natOutgoing": pool_data.get("nat_outgoing", True),
            "disabled": pool_data.get("disabled", False),
            "ipipMode": _resolve_encap_mode(pool_data.get("mode", "vxlan"), "ipip"),
            "vxlanMode": _resolve_encap_mode(pool_data.get("mode", "vxlan"), "vxlan"),
            "nodeSelector": pool_data.get("node_selector", "all()"),
        },
    }
    result = await custom_api.create_cluster_custom_object(
        group=CALICO_GROUP, version=CALICO_VERSION, plural="ippools", body=body
    )
    logger.info(f"Created IP pool {pool_data['name']}")
    return result


async def update_ip_pool(api_client, name: str, pool_data: Dict[str, Any]) -> Dict[str, Any]:
    custom_api = k8s_client.CustomObjectsApi(api_client)
    # Use a JSON Patch array: the client's default content type for
    # patch_cluster_custom_object is application/json-patch+json, which the
    # Calico API server decodes as a JSON Patch operation list. (Sending a
    # plain object here yields 400 "cannot unmarshal object into Go value of
    # type []handlers.jsonPatchOp".) RFC 6902 "add" on an existing member
    # replaces its value, so it works whether the field is present or not.
    ops: list = []
    if "nat_outgoing" in pool_data:
        ops.append({"op": "add", "path": "/spec/natOutgoing", "value": bool(pool_data["nat_outgoing"])})
    if "disabled" in pool_data:
        ops.append({"op": "add", "path": "/spec/disabled", "value": bool(pool_data["disabled"])})
    if "mode" in pool_data:
        ops.append({"op": "add", "path": "/spec/ipipMode", "value": _resolve_encap_mode(pool_data["mode"], "ipip")})
        ops.append({"op": "add", "path": "/spec/vxlanMode", "value": _resolve_encap_mode(pool_data["mode"], "vxlan")})
    if "node_selector" in pool_data:
        ops.append({"op": "add", "path": "/spec/nodeSelector", "value": pool_data["node_selector"]})
    if not ops:
        raise ValueError("No fields to update")
    return await custom_api.patch_cluster_custom_object(
        group=CALICO_GROUP, version=CALICO_VERSION, plural="ippools", name=name, body=ops
    )


async def delete_ip_pool(api_client, name: str) -> None:
    custom_api = k8s_client.CustomObjectsApi(api_client)
    await custom_api.delete_cluster_custom_object(
        group=CALICO_GROUP, version=CALICO_VERSION, plural="ippools", name=name
    )
    logger.info(f"Deleted IP pool {name}")


async def create_bgp_peer(api_client, peer_data: Dict[str, Any]) -> Dict[str, Any]:
    custom_api = k8s_client.CustomObjectsApi(api_client)
    spec: Dict[str, Any] = {
        "peerIP": peer_data["peer_ip"],
        "asNumber": peer_data.get("peer_as_number", 64512),
    }
    if peer_data.get("node_as_number") is not None: spec["nodeASNumber"] = peer_data["node_as_number"]
    if peer_data.get("node"): spec["node"] = peer_data["node"]
    body = {
        "apiVersion": f"{CALICO_GROUP}/{CALICO_VERSION}",
        "kind": "BGPPeer",
        "metadata": {"name": peer_data["name"]},
        "spec": spec,
    }
    return await custom_api.create_cluster_custom_object(
        group=CALICO_GROUP, version=CALICO_VERSION, plural="bgppeers", body=body
    )


async def update_bgp_peer(api_client, name: str, peer_data: Dict[str, Any]) -> Dict[str, Any]:
    custom_api = k8s_client.CustomObjectsApi(api_client)
    # JSON Patch array — same rationale as update_ip_pool: the client's default
    # content type is application/json-patch+json, so the body must be an op list.
    ops: list = []
    if "peer_ip" in peer_data:
        ops.append({"op": "add", "path": "/spec/peerIP", "value": peer_data["peer_ip"]})
    if "peer_as_number" in peer_data:
        ops.append({"op": "add", "path": "/spec/asNumber", "value": peer_data["peer_as_number"]})
    if "node_as_number" in peer_data:
        ops.append({"op": "add", "path": "/spec/nodeASNumber", "value": peer_data["node_as_number"]})
    if "node" in peer_data:
        ops.append({"op": "add", "path": "/spec/node", "value": peer_data["node"]})
    if not ops:
        raise ValueError("No fields to update")
    return await custom_api.patch_cluster_custom_object(
        group=CALICO_GROUP, version=CALICO_VERSION, plural="bgppeers", name=name, body=ops
    )


async def delete_bgp_peer(api_client, name: str) -> None:
    custom_api = k8s_client.CustomObjectsApi(api_client)
    await custom_api.delete_cluster_custom_object(
        group=CALICO_GROUP, version=CALICO_VERSION, plural="bgppeers", name=name
    )
    logger.info(f"Deleted BGP peer {name}")


def _resolve_encap_mode(mode: str, target: str) -> str:
    if mode == "ipip": return "Always" if target == "ipip" else "Never"
    if mode == "vxlan": return "Never" if target == "ipip" else "Always"
    return "Never"


# ═══════════════════════════════════════════════════════════════════
#  CORE K8s RESOURCE OPERATIONS
# ═══════════════════════════════════════════════════════════════════

# ─── Namespaces ─────────────────────────────────────────────────


async def create_namespace(api_client, name: str, labels: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    v1 = k8s_client.CoreV1Api(api_client)
    meta: Dict[str, Any] = {"name": name}
    if labels: meta["labels"] = labels
    body = {"apiVersion": "v1", "kind": "Namespace", "metadata": meta}
    result = await v1.create_namespace(body=body)
    logger.info(f"Created namespace {name}")
    return result


async def delete_namespace(api_client, name: str) -> None:
    v1 = k8s_client.CoreV1Api(api_client)
    await v1.delete_namespace(name=name)
    logger.info(f"Deleted namespace {name}")


# ─── Services ────────────────────────────────────────────────────


async def create_service(api_client, svc_data: Dict[str, Any]) -> Dict[str, Any]:
    v1 = k8s_client.CoreV1Api(api_client)
    body = {
        "apiVersion": "v1",
        "kind": "Service",
        "metadata": {"name": svc_data["name"], "namespace": svc_data["namespace"]},
        "spec": {
            "selector": svc_data.get("selector", {}),
            "ports": svc_data.get("ports", [{"port": 80, "protocol": "TCP"}]),
        },
    }
    if svc_data.get("type"): body["spec"]["type"] = svc_data["type"]
    if svc_data.get("cluster_ip"): body["spec"]["clusterIP"] = svc_data["cluster_ip"]
    result = await v1.create_namespaced_service(namespace=svc_data["namespace"], body=body)
    logger.info(f"Created service {svc_data['namespace']}/{svc_data['name']}")
    return result


async def update_service(api_client, namespace: str, name: str, svc_data: Dict[str, Any]) -> Dict[str, Any]:
    v1 = k8s_client.CoreV1Api(api_client)
    current = await v1.read_namespaced_service(name=name, namespace=namespace)
    spec = current.spec
    # Build patch
    patch: Dict[str, Any] = {"spec": {}}
    if "selector" in svc_data: patch["spec"]["selector"] = svc_data["selector"]
    if "ports" in svc_data: patch["spec"]["ports"] = svc_data["ports"]
    if "type" in svc_data: patch["spec"]["type"] = svc_data["type"]
    return await v1.patch_namespaced_service(name=name, namespace=namespace, body=patch)


async def delete_service(api_client, namespace: str, name: str) -> None:
    v1 = k8s_client.CoreV1Api(api_client)
    await v1.delete_namespaced_service(name=name, namespace=namespace)
    logger.info(f"Deleted service {namespace}/{name}")


# ─── ConfigMaps ──────────────────────────────────────────────────


async def create_configmap(api_client, cm_data: Dict[str, Any]) -> Dict[str, Any]:
    v1 = k8s_client.CoreV1Api(api_client)
    body = {
        "apiVersion": "v1",
        "kind": "ConfigMap",
        "metadata": {"name": cm_data["name"], "namespace": cm_data["namespace"]},
        "data": cm_data.get("data", {}),
    }
    return await v1.create_namespaced_config_map(namespace=cm_data["namespace"], body=body)


async def update_configmap(api_client, namespace: str, name: str, cm_data: Dict[str, Any]) -> Dict[str, Any]:
    v1 = k8s_client.CoreV1Api(api_client)
    body = {"data": cm_data.get("data", {})}
    return await v1.patch_namespaced_config_map(name=name, namespace=namespace, body=body)


async def delete_configmap(api_client, namespace: str, name: str) -> None:
    v1 = k8s_client.CoreV1Api(api_client)
    await v1.delete_namespaced_config_map(name=name, namespace=namespace)
    logger.info(f"Deleted ConfigMap {namespace}/{name}")


# ─── Secrets ─────────────────────────────────────────────────────


async def create_secret(api_client, secret_data: Dict[str, Any]) -> Dict[str, Any]:
    v1 = k8s_client.CoreV1Api(api_client)
    body = {
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {"name": secret_data["name"], "namespace": secret_data["namespace"]},
        "type": secret_data.get("type", "Opaque"),
        "data": secret_data.get("data", {}),
    }
    return await v1.create_namespaced_secret(namespace=secret_data["namespace"], body=body)


async def update_secret(api_client, namespace: str, name: str, secret_data: Dict[str, Any]) -> Dict[str, Any]:
    v1 = k8s_client.CoreV1Api(api_client)
    patch: Dict[str, Any] = {}
    if "type" in secret_data and secret_data.get("type"):
        patch["type"] = secret_data["type"]
    if "data" in secret_data and secret_data.get("data") is not None:
        patch["data"] = secret_data["data"]
    return await v1.patch_namespaced_secret(name=name, namespace=namespace, body=patch)


async def delete_secret(api_client, namespace: str, name: str) -> None:
    v1 = k8s_client.CoreV1Api(api_client)
    await v1.delete_namespaced_secret(name=name, namespace=namespace)
    logger.info(f"Deleted Secret {namespace}/{name}")


# ─── Deployments ─────────────────────────────────────────────────


async def create_deployment(api_client, dep_data: Dict[str, Any]) -> Dict[str, Any]:
    apps_v1 = k8s_client.AppsV1Api(api_client)
    name = dep_data["name"]
    namespace = dep_data["namespace"]
    app_label = dep_data.get("app_label") or name
    body = {
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": {"name": name, "namespace": namespace, "labels": {"app": app_label}},
        "spec": {
            "replicas": dep_data.get("replicas", 1),
            "selector": {"matchLabels": {"app": app_label}},
            "template": {
                "metadata": {"labels": {"app": app_label}},
                "spec": {"containers": [{"name": name, "image": dep_data["image"]}]},
            },
        },
    }
    return await apps_v1.create_namespaced_deployment(namespace=namespace, body=body)


async def scale_deployment(api_client, namespace: str, name: str, replicas: int) -> Dict[str, Any]:
    apps_v1 = k8s_client.AppsV1Api(api_client)
    body = {"spec": {"replicas": replicas}}
    return await apps_v1.patch_namespaced_deployment_scale(name=name, namespace=namespace, body=body)


async def restart_deployment(api_client, namespace: str, name: str) -> Dict[str, Any]:
    apps_v1 = k8s_client.AppsV1Api(api_client)
    # Trigger a rolling restart by patching annotations
    body = {"spec": {"template": {"metadata": {"annotations": {"kubectl.kubernetes.io/restartedAt": datetime.utcnow().isoformat() + "Z"}}}}}
    return await apps_v1.patch_namespaced_deployment(name=name, namespace=namespace, body=body)


async def update_deployment_image(api_client, namespace: str, name: str, image: str) -> Dict[str, Any]:
    apps_v1 = k8s_client.AppsV1Api(api_client)
    dep = await apps_v1.read_namespaced_deployment(name=name, namespace=namespace)
    containers = dep.spec.template.spec.containers
    if not containers:
        raise ValueError("Deployment has no containers")
    # Patch the first container's image (typical single-container case)
    body = {
        "spec": {
            "template": {
                "spec": {"containers": [{"name": containers[0].name, "image": image}]}
            }
        }
    }
    return await apps_v1.patch_namespaced_deployment(name=name, namespace=namespace, body=body)


# ─── Nodes ───────────────────────────────────────────────────────


async def cordon_node(api_client, name: str, cordon: bool) -> Dict[str, Any]:
    v1 = k8s_client.CoreV1Api(api_client)
    body = {"spec": {"unschedulable": cordon}}
    return await v1.patch_node(name=name, body=body)
