"""Service layer for Calico CNI resources accessed via Kubernetes CustomObjectsApi."""

import asyncio
import ipaddress
from typing import Any, Dict, List, Optional
from collections import defaultdict
from datetime import datetime, timezone
from kubernetes_asyncio import client as k8s_client

# Calico CRD API group and version (Tigera operator installation)
CALICO_GROUP = "crd.projectcalico.org"
CALICO_VERSION = "v1"


async def get_calico_nodes(api_client) -> List[Dict[str, Any]]:
    """Return per-node Calico agent status from calico-node pods.

    Cross-references against node Ready status: if a node is NotReady,
    its calico-node pod is reported as Down regardless of the container
    readiness (the pod status is stale when the kubelet stops reporting).
    """
    v1 = k8s_client.CoreV1Api(api_client)

    # Fetch nodes and calico-node pods in parallel
    node_list, pods = await asyncio.gather(
        v1.list_node(),
        v1.list_pod_for_all_namespaces(
            label_selector="k8s-app=calico-node",
            watch=False,
        ),
    )

    # Build a set of nodes that are NOT Ready
    not_ready_nodes: set[str] = set()
    for n in node_list.items:
        node_ready = True
        for condition in n.status.conditions or []:
            if condition.type == "Ready":
                node_ready = condition.status == "True"
                break
        if not node_ready:
            not_ready_nodes.add(n.metadata.name)

    nodes = []
    for p in pods.items:
        node_name = getattr(p.spec, "node_name", None)
        pod_ip = getattr(p.status, "pod_ip", None)

        # If the node itself is NotReady, mark the calico agent as down
        # regardless of what the stale container status says.
        if node_name and node_name in not_ready_nodes:
            calico_ready = False
        else:
            calico_ready = False
            for c in (p.status.container_statuses or []):
                if c.ready and c.name == "calico-node":
                    calico_ready = True
                    break

        # Compute uptime from the earliest running container
        uptime_seconds = None
        for c in (p.status.container_statuses or []):
            if c.state and c.state.running and c.state.running.started_at:
                started = c.state.running.started_at
                uptime_seconds = int(
                    (datetime.now(timezone.utc) - started).total_seconds()
                )
                break

        nodes.append({
            "node": node_name,
            "calico_ready": calico_ready,
            "felix_ready": calico_ready,
            "bird_ready": calico_ready,
            "ip": pod_ip,
            "uptime_seconds": uptime_seconds,
            "last_reported": None,
        })

    return nodes


async def get_bgp_peers(api_client) -> List[Dict[str, Any]]:
    """List BGPPeer CRDs."""
    custom_api = k8s_client.CustomObjectsApi(api_client)
    peers = await custom_api.list_cluster_custom_object(
        group=CALICO_GROUP,
        version=CALICO_VERSION,
        plural="bgppeers",
    )

    result = []
    for item in (peers.get("items") or []):
        spec = item.get("spec", {})
        result.append({
            "name": item["metadata"]["name"],
            "node": spec.get("node"),
            "peer_ip": spec.get("peerIP"),
            "peer_as_number": spec.get("asNumber"),
            "node_as_number": spec.get("nodeASNumber"),
            "session_state": spec.get("sessionState", "unknown"),
        })
    return result


async def get_ip_pools(api_client) -> List[Dict[str, Any]]:
    """List IPPool CRDs."""
    custom_api = k8s_client.CustomObjectsApi(api_client)
    pools = await custom_api.list_cluster_custom_object(
        group=CALICO_GROUP,
        version=CALICO_VERSION,
        plural="ippools",
    )

    result = []
    for item in (pools.get("items") or []):
        spec = item.get("spec", {})
        # Determine encapsulation mode
        mode = "none"
        if spec.get("ipipMode") and spec["ipipMode"] not in ("Never", "Disabled"):
            mode = "ipip"
        elif spec.get("vxlanMode") and spec["vxlanMode"] not in ("Never", "Disabled"):
            mode = "vxlan"

        result.append({
            "name": item["metadata"]["name"],
            "cidr": spec.get("cidr", ""),
            "nat_outgoing": spec.get("natOutgoing", True),
            "disabled": spec.get("disabled", False),
            "mode": mode,
            "node_selector": spec.get("nodeSelector"),
        })
    return result


async def get_ipam_utilization(api_client) -> List[Dict[str, Any]]:
    """Aggregate IPAMBlock allocations per pool.

    IPAMBlocks do NOT have a "pool" field — they reference their parent
    pool by CIDR containment. This function:
      1. Fetches all IPPools to build a list of (name, ip_network)
      2. Fetches all IPAMBlocks and reads spec.cidr
      3. Resolves each block to its parent pool by checking which pool's
         CIDR network contains the block's CIDR
    """
    custom_api = k8s_client.CustomObjectsApi(api_client)

    # ── Fetch IPPools and build CIDR networks ─────────────────────
    pools_raw = await custom_api.list_cluster_custom_object(
        group=CALICO_GROUP,
        version=CALICO_VERSION,
        plural="ippools",
    )
    # (pool_name, pool_cidr_string) for pools with no blocks
    pool_cidrs: Dict[str, str] = {}
    # (pool_name, ip_network) for CIDR containment checks
    pool_networks: List[tuple] = []
    for item in (pools_raw.get("items") or []):
        cidr = item.get("spec", {}).get("cidr", "")
        name = item["metadata"]["name"]
        pool_cidrs[name] = cidr
        try:
            pool_networks.append((name, ipaddress.ip_network(cidr)))
        except Exception:
            pass

    # ── Fetch all IPAM blocks ────────────────────────────────────
    blocks_raw = await custom_api.list_cluster_custom_object(
        group=CALICO_GROUP,
        version=CALICO_VERSION,
        plural="ipamblocks",
    )
    blocks = blocks_raw.get("items") or []

    # ── Aggregate blocks per pool via CIDR containment ────────────
    pool_blocks = defaultdict(list)
    for block in blocks:
        spec = block.get("spec", {})
        block_cidr = spec.get("cidr", "")

        # Resolve parent pool by checking CIDR containment
        pool_name = "unknown"
        if block_cidr:
            try:
                block_net = ipaddress.ip_network(block_cidr)
                for pname, pnet in pool_networks:
                    if block_net.subnet_of(pnet):
                        pool_name = pname
                        break
            except Exception:
                pass

        pool_blocks[pool_name].append(block)

    # ── Compute per-pool statistics ───────────────────────────────
    result = []
    for pool_name, pool_block_list in pool_blocks.items():
        total = 0
        allocated_count = 0
        for block in pool_block_list:
            allocations = block.get("spec", {}).get("allocations", [])
            total += len(allocations)
            allocated_count += sum(1 for a in allocations if a is not None)

        utilization_pct = (allocated_count / total * 100) if total > 0 else 0.0
        result.append({
            "pool": pool_name,
            "blocks": len(pool_block_list),
            "allocated": allocated_count,
            "total": total,
            "utilization_pct": round(utilization_pct, 1),
        })

    # ── Include pools that exist but have no blocks ───────────────
    for pname in pool_cidrs:
        if not any(r["pool"] == pname for r in result):
            result.append({
                "pool": pname,
                "blocks": 0,
                "allocated": 0,
                "total": 0,
                "utilization_pct": 0.0,
            })

    return result


async def _iter_policy_items(api_client) -> List[Dict[str, Any]]:
    """Yield raw Calico NetworkPolicy / GlobalNetworkPolicy CRD items with
    ``_ns`` and ``_type`` annotations attached (used by both the summary and
    detailed listing variants)."""
    custom_api = k8s_client.CustomObjectsApi(api_client)
    items: List[Dict[str, Any]] = []

    # GlobalNetworkPolicies (cluster-scoped)
    try:
        gnp_raw = await custom_api.list_cluster_custom_object(
            group=CALICO_GROUP,
            version=CALICO_VERSION,
            plural="globalnetworkpolicies",
        )
        for item in (gnp_raw.get("items") or []):
            item["_ns"] = None
            item["_type"] = "GlobalNetworkPolicy"
            items.append(item)
    except Exception:
        pass

    # NetworkPolicies (namespaced — need to list across all namespaces)
    try:
        v1 = k8s_client.CoreV1Api(api_client)
        namespaces = await v1.list_namespace()
        for ns in (namespaces.items or []):
            ns_name = ns.metadata.name
            try:
                np_raw = await custom_api.list_namespaced_custom_object(
                    group=CALICO_GROUP,
                    version=CALICO_VERSION,
                    namespace=ns_name,
                    plural="networkpolicies",
                )
                for item in (np_raw.get("items") or []):
                    item["_ns"] = ns_name
                    item["_type"] = "NetworkPolicy"
                    items.append(item)
            except Exception:
                continue
    except Exception:
        pass

    return items


async def get_cni_policies(api_client) -> List[Dict[str, Any]]:
    """List Calico NetworkPolicy and GlobalNetworkPolicy CRDs (summary form)."""
    result = []
    for item in await _iter_policy_items(api_client):
        spec = item.get("spec", {})
        result.append({
            "name": item["metadata"]["name"],
            "namespace": item["_ns"],
            "type": item["_type"],
            "policy_type": spec.get("types", []),
            "selector": spec.get("selector"),
            "order": spec.get("order"),
            "rules_count": _count_policy_rules(spec),
            "rule_actions": _extract_rule_actions(spec),
        })
    return result


async def get_cni_policies_detailed(api_client) -> List[Dict[str, Any]]:
    """List Calico policies including full ingress/egress rule specs.

    Used by the policy-matrix engine (Workload Endpoints + Policy Impact)
    which needs rule-level detail (actions, protocols, ports, peer selectors)
    on top of the summary fields returned by ``get_cni_policies``.
    """
    result = []
    for item in await _iter_policy_items(api_client):
        spec = item.get("spec", {})
        result.append({
            "name": item["metadata"]["name"],
            "namespace": item["_ns"],
            "type": item["_type"],
            "policy_type": spec.get("types", []),
            "selector": spec.get("selector"),
            "order": spec.get("order"),
            "rules_count": _count_policy_rules(spec),
            "rule_actions": _extract_rule_actions(spec),
            "ingress": spec.get("ingress", []),
            "egress": spec.get("egress", []),
        })
    return result


def _count_policy_rules(spec: Dict[str, Any]) -> int:
    """Count total ingress + egress rules in a Calico policy spec."""
    count = 0
    for direction in ("ingress", "egress"):
        rules = spec.get(direction, [])
        if isinstance(rules, list):
            count += len(rules)
    return count


def _extract_rule_actions(spec: Dict[str, Any]) -> List[str]:
    """Extract unique action values (Allow, Deny, Log, Pass) from all rules."""
    actions: set[str] = set()
    for direction in ("ingress", "egress"):
        rules = spec.get(direction, [])
        if isinstance(rules, list):
            for rule in rules:
                if isinstance(rule, dict):
                    action = rule.get("action", "Allow")
                    actions.add(action)
    return sorted(actions)


async def get_cni_topology(api_client) -> Dict[str, Any]:
    """Build CNI-aware topology: cluster nodes, pods, services, BGP peers, overlay connections.

    Returns a rich graph with:
      - Cluster nodes (type: "node") with BGP/overlay edges
      - Pods (type: "pod") nested under their parent node
      - Services (type: "service") with label-matched pod-to-service edges
    """
    v1 = k8s_client.CoreV1Api(api_client)
    custom_api = k8s_client.CustomObjectsApi(api_client)

    # ── Fetch all resources in parallel ──────────────────────────
    node_list = await v1.list_node()
    pods = await v1.list_pod_for_all_namespaces(watch=False)
    svc_list = await v1.list_service_for_all_namespaces()

    # ── BGP peer edges ───────────────────────────────────────────
    bgp_edges = []
    try:
        peers_raw = await custom_api.list_cluster_custom_object(
            group=CALICO_GROUP,
            version=CALICO_VERSION,
            plural="bgppeers",
        )
        for peer in (peers_raw.get("items") or []):
            spec = peer.get("spec", {})
            peer_node = spec.get("node", "")
            peer_ip = spec.get("peerIP", "")
            if peer_node and peer_ip:
                bgp_edges.append({
                    "id": f"bgp-{peer_node}-to-{peer_ip}",
                    "source": f"node:{peer_node}",
                    "target": f"bgp:{peer_ip}",
                    "type": "bgp",
                })
    except Exception:
        pass

    # ── Build node entries ───────────────────────────────────────
    nodes: List[Dict[str, Any]] = []
    services_data: List[Dict[str, Any]] = []
    pods_data: List[Dict[str, Any]] = []

    # Cluster nodes
    for n in node_list.items:
        labels = n.metadata.labels or {}
        role = "worker"
        if labels.get("node-role.kubernetes.io/control-plane") == "" or \
           labels.get("node-role.kubernetes.io/master") == "":
            role = "master"

        ip = None
        for addr in n.status.addresses or []:
            if addr.type == "InternalIP":
                ip = addr.address
                break

        # Determine if node is ready
        ready = True
        for condition in n.status.conditions or []:
            if condition.type == "Ready":
                ready = condition.status == "True"
                break

        nodes.append({
            "id": f"node:{n.metadata.name}",
            "type": "node",
            "name": n.metadata.name,
            "role": role,
            "ip": ip,
            "ready": ready,
        })

    # Services
    for s in svc_list.items:
        # Skip the default/kubernetes API service
        if s.metadata.namespace == "default" and s.metadata.name == "kubernetes":
            continue

        svc_id = f"svc:{s.metadata.namespace}/{s.metadata.name}"
        # Format service ports
        svc_ports_str = None
        if s.spec.ports:
            port_strs = []
            for p in s.spec.ports:
                proto = p.protocol or "TCP"
                if p.target_port and p.target_port != p.port:
                    if p.name:
                        port_strs.append(f"{p.name}:{p.port}:{p.target_port}/{proto}")
                    else:
                        port_strs.append(f"{p.port}:{p.target_port}/{proto}")
                else:
                    if p.name:
                        port_strs.append(f"{p.name}:{p.port}/{proto}")
                    else:
                        port_strs.append(f"{p.port}/{proto}")
            if port_strs:
                svc_ports_str = ", ".join(port_strs)

        nodes.append({
            "id": svc_id,
            "type": "service",
            "namespace": s.metadata.namespace,
            "name": s.metadata.name,
            "ip": s.spec.cluster_ip if s.spec.cluster_ip and s.spec.cluster_ip != "None" else None,
            "ports": svc_ports_str,
        })
        services_data.append({
            "id": svc_id,
            "namespace": s.metadata.namespace,
            "selector": s.spec.selector or {},
        })

    # Pods
    for p in pods.items:
        pod_id = f"pod:{p.metadata.namespace}/{p.metadata.name}"
        node_name = getattr(p.spec, "node_name", None)
        # Collect container ports
        pod_ports_str = None
        ports_list = []
        for c in (p.spec.containers or []):
            if c.ports:
                for cp in c.ports:
                    proto = cp.protocol or "TCP"
                    if cp.name:
                        ports_list.append(f"{cp.name}:{cp.container_port}/{proto}")
                    else:
                        ports_list.append(f"{cp.container_port}/{proto}")
        if ports_list:
            pod_ports_str = ", ".join(ports_list)

        nodes.append({
            "id": pod_id,
            "type": "pod",
            "namespace": p.metadata.namespace,
            "name": p.metadata.name,
            "ip": getattr(p.status, "pod_ip", None),
            "labels": p.metadata.labels or {},
            "node_name": node_name,
            "ports": pod_ports_str,
        })
        pods_data.append({
            "id": pod_id,
            "namespace": p.metadata.namespace,
            "labels": p.metadata.labels or {},
            "node_name": node_name,
        })

    # ── Build edges ──────────────────────────────────────────────
    edges: List[Dict[str, Any]] = list(bgp_edges)

    # Group pods by namespace to avoid O(S × P) scanning for large clusters
    pods_by_ns: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for pod in pods_data:
        pods_by_ns[pod["namespace"]].append(pod)

    # Pod-to-service edges via label-selector matching
    for svc in services_data:
        svc_ns = svc["namespace"]
        for pod in pods_by_ns.get(svc_ns, []):
            if _label_selector_matches(pod["labels"], svc["selector"]):
                edges.append({
                    "id": f"{pod['id']}-to-{svc['id']}",
                    "source": pod["id"],
                    "target": svc["id"],
                })

    # Overlay edges between nodes with pods
    node_names_with_pods = list(dict.fromkeys(
        p["node_name"] for p in pods_data if p["node_name"]
    ))
    for i in range(len(node_names_with_pods)):
        for j in range(i + 1, len(node_names_with_pods)):
            edges.append({
                "id": f"overlay-{node_names_with_pods[i]}-to-{node_names_with_pods[j]}",
                "source": f"node:{node_names_with_pods[i]}",
                "target": f"node:{node_names_with_pods[j]}",
                "type": "overlay",
            })

    return {
        "nodes": nodes,
        "edges": edges,
    }


from services.utils import label_selector_matches as _label_selector_matches
