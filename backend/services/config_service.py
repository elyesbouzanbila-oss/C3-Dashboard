"""
Service layer for cluster configuration operations — CRUD on Calico CRDs
via the Kubernetes API.
"""

import logging
from typing import Any, Dict, Optional
from kubernetes_asyncio import client as k8s_client

logger = logging.getLogger(__name__)

# Calico CRD API group and version
CALICO_GROUP = "crd.projectcalico.org"
CALICO_VERSION = "v1"


# ─── IP Pool CRUD ───────────────────────────────────────────────────


async def create_ip_pool(api_client, pool_data: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new Calico IPPool CRD."""
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
        group=CALICO_GROUP,
        version=CALICO_VERSION,
        plural="ippools",
        body=body,
    )
    logger.info(f"Created IP pool {pool_data['name']} ({pool_data['cidr']})")
    return result


async def update_ip_pool(
    api_client, name: str, pool_data: Dict[str, Any]
) -> Dict[str, Any]:
    """Update an existing Calico IPPool CRD."""
    custom_api = k8s_client.CustomObjectsApi(api_client)

    current = await custom_api.get_cluster_custom_object(
        group=CALICO_GROUP, version=CALICO_VERSION, plural="ippools", name=name
    )

    spec = current.get("spec", {})
    if "cidr" in pool_data:
        spec["cidr"] = pool_data["cidr"]
    if "nat_outgoing" in pool_data:
        spec["natOutgoing"] = pool_data["nat_outgoing"]
    if "disabled" in pool_data:
        spec["disabled"] = pool_data["disabled"]
    if "mode" in pool_data:
        spec["ipipMode"] = _resolve_encap_mode(pool_data["mode"], "ipip")
        spec["vxlanMode"] = _resolve_encap_mode(pool_data["mode"], "vxlan")
    if "node_selector" in pool_data:
        spec["nodeSelector"] = pool_data["node_selector"]

    body = {"spec": spec}

    result = await custom_api.patch_cluster_custom_object(
        group=CALICO_GROUP,
        version=CALICO_VERSION,
        plural="ippools",
        name=name,
        body=body,
    )
    logger.info(f"Updated IP pool {name}")
    return result


async def delete_ip_pool(api_client, name: str) -> None:
    """Delete a Calico IPPool CRD."""
    custom_api = k8s_client.CustomObjectsApi(api_client)
    await custom_api.delete_cluster_custom_object(
        group=CALICO_GROUP,
        version=CALICO_VERSION,
        plural="ippools",
        name=name,
    )
    logger.info(f"Deleted IP pool {name}")


def _resolve_encap_mode(mode: str, target: str) -> str:
    """Resolve a user-friendly mode string into ipipMode / vxlanMode values."""
    if mode == "ipip":
        return "Always" if target == "ipip" else "Never"
    if mode == "vxlan":
        return "Never" if target == "ipip" else "Always"
    return "Never"


# ─── BGP Peer CRUD ──────────────────────────────────────────────────


async def create_bgp_peer(api_client, peer_data: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new Calico BGPPeer CRD."""
    custom_api = k8s_client.CustomObjectsApi(api_client)

    spec: Dict[str, Any] = {
        "peerIP": peer_data["peer_ip"],
        "asNumber": peer_data.get("peer_as_number", 64512),
    }
    if peer_data.get("node_as_number") is not None:
        spec["nodeASNumber"] = peer_data["node_as_number"]
    if peer_data.get("node"):
        spec["node"] = peer_data["node"]

    body = {
        "apiVersion": f"{CALICO_GROUP}/{CALICO_VERSION}",
        "kind": "BGPPeer",
        "metadata": {"name": peer_data["name"]},
        "spec": spec,
    }

    result = await custom_api.create_cluster_custom_object(
        group=CALICO_GROUP,
        version=CALICO_VERSION,
        plural="bgppeers",
        body=body,
    )
    logger.info(f"Created BGP peer {peer_data['name']} -> {peer_data['peer_ip']}")
    return result


async def update_bgp_peer(
    api_client, name: str, peer_data: Dict[str, Any]
) -> Dict[str, Any]:
    """Update an existing Calico BGPPeer CRD."""
    custom_api = k8s_client.CustomObjectsApi(api_client)

    spec: Dict[str, Any] = {}
    if "peer_ip" in peer_data:
        spec["peerIP"] = peer_data["peer_ip"]
    if "peer_as_number" in peer_data:
        spec["asNumber"] = peer_data["peer_as_number"]
    if "node_as_number" in peer_data:
        spec["nodeASNumber"] = peer_data["node_as_number"]
    if "node" in peer_data:
        spec["node"] = peer_data["node"]

    body = {"spec": spec}

    result = await custom_api.patch_cluster_custom_object(
        group=CALICO_GROUP,
        version=CALICO_VERSION,
        plural="bgppeers",
        name=name,
        body=body,
    )
    logger.info(f"Updated BGP peer {name}")
    return result


async def delete_bgp_peer(api_client, name: str) -> None:
    """Delete a Calico BGPPeer CRD."""
    custom_api = k8s_client.CustomObjectsApi(api_client)
    await custom_api.delete_cluster_custom_object(
        group=CALICO_GROUP,
        version=CALICO_VERSION,
        plural="bgppeers",
        name=name,
    )
    logger.info(f"Deleted BGP peer {name}")
