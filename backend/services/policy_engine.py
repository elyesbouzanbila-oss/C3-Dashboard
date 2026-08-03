"""Shared engine for the policy ↔ pod matrix.

Two views, one computation:
  - ``compute_workload_endpoints`` — per-pod state (selecting policies, exposure,
    interface status, per-direction rule digest).
  - ``compute_policy_impact`` — per-policy state (selected pods, rule-by-rule
    breakdown with the pods each peer selector matches).

Both functions are pure over plain dicts — no I/O — so they are unit-testable
in isolation. Selector evaluation reuses ``calico_selector_matches`` and the
namespace-scoping rules from ``services.utils``.
"""

from typing import Any, Dict, List

from services.utils import calico_selector_matches


def _policy_selects_pod(policy: Dict[str, Any], pod: Dict[str, Any]) -> bool:
    """True when a policy's selector matches a pod (with namespace scoping)."""
    selector = policy.get("selector", "")
    if not selector or not calico_selector_matches(pod.get("labels", {}) or {}, selector):
        return False
    # A namespaced NetworkPolicy only applies to pods in its own namespace
    if policy.get("type") == "NetworkPolicy" and policy.get("namespace") != pod.get("namespace"):
        return False
    return True


def _rule_action(rule: Dict[str, Any]) -> str:
    """Normalised rule action (Allow/Deny/Log/Pass, defaulting to Allow)."""
    return (rule.get("action") or "Allow").capitalize()


def _rule_ports(rule: Dict[str, Any]) -> List[str]:
    """Formatted ports (e.g. ``80/tcp``) from a rule's destination block."""
    dest = rule.get("destination") or {}
    ports = dest.get("ports") or []
    protocol = rule.get("protocol")
    out = []
    for p in ports:
        if isinstance(p, (int, float)):
            p = str(int(p))
        out.append(f"{p}/{protocol}" if protocol else str(p))
    return out


def _rule_peer_selector(rule: Dict[str, Any], direction: str) -> str:
    """Selector of the traffic peer for this direction.

    Ingress rules match traffic *from* ``source.selector``;
    egress rules match traffic *to* ``destination.selector``.
    """
    if direction == "ingress":
        return (rule.get("source") or {}).get("selector", "")
    return (rule.get("destination") or {}).get("selector", "")


# ─── Per-pod view ─────────────────────────────────────────────────

def compute_workload_endpoints(
    pods: List[Dict[str, Any]],
    policies: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Compute per-pod Calico endpoint state.

    For each pod: which policies select it (with namespace scoping), whether it
    is exposed (no policy selects it), a derived interface status (up when the
    pod is Running and has an IP, otherwise down), and a per-direction rule
    digest (allow/deny/log counts plus the ports involved).

    Args:
        pods: dicts with ``name``, ``namespace``, ``labels``, ``node_name``,
            ``pod_ip``, ``phase``.
        policies: detailed policy dicts (see ``get_cni_policies_detailed``)
            with ``ingress`` / ``egress`` rule lists.

    Returns:
        List of endpoint dicts.
    """
    endpoints = []
    for pod in pods:
        selecting = [p for p in policies if _policy_selects_pod(p, pod)]

        digest: Dict[str, Dict[str, Any]] = {
            "ingress": {"allow": 0, "deny": 0, "log": 0, "pass": 0, "ports": []},
            "egress": {"allow": 0, "deny": 0, "log": 0, "pass": 0, "ports": []},
        }
        for policy in selecting:
            for direction in ("ingress", "egress"):
                for rule in policy.get(direction, []) or []:
                    action = _rule_action(rule)
                    key = action.lower()
                    # Pass means "skip to next tier" — not a log action, so it
                    # gets its own bucket instead of polluting the log count.
                    if key not in ("allow", "deny", "log", "pass"):
                        key = "log"
                    digest[direction][key] += 1
                    for port in _rule_ports(rule):
                        if port not in digest[direction]["ports"]:
                            digest[direction]["ports"].append(port)

        phase = pod.get("phase") or ""
        pod_ip = pod.get("pod_ip")
        interface_status = "up" if (phase == "Running" and pod_ip) else "down"

        endpoints.append({
            "namespace": pod.get("namespace", ""),
            "pod_name": pod.get("name", ""),
            "labels": pod.get("labels", {}) or {},
            "node_name": pod.get("node_name"),
            "pod_ip": pod_ip,
            "phase": phase,
            "interface_status": interface_status,
            "selecting_policies": [
                {"name": p["name"], "type": p.get("type")} for p in selecting
            ],
            "exposed": len(selecting) == 0,
            "ingress": digest["ingress"],
            "egress": digest["egress"],
        })
    return endpoints


# ─── Per-policy view ──────────────────────────────────────────────

def compute_policy_impact(
    policies: List[Dict[str, Any]],
    pods: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Compute per-policy impact.

    For each policy: the exact pods its selector selects, and a rule-by-rule
    breakdown — each rule's direction, action, protocol, ports, peer selector,
    and which pods in the cluster that peer selector matches (with count).

    Args:
        policies: detailed policy dicts with ``ingress`` / ``egress`` rules.
        pods: dicts with ``name``, ``namespace``, ``labels``.

    Returns:
        List of policy impact dicts.

    Note:
        ``matched_pods`` is a static approximation: it lists every pod whose
        labels satisfy the rule's peer selector. It is NOT actual observed
        traffic — a rule may match pods that never talk, and the policy's own
        selected pods can appear (e.g. a self-scrape selector).
    """
    impacts = []
    for policy in policies:
        selected = [pod for pod in pods if _policy_selects_pod(policy, pod)]

        rules = []
        for direction in ("ingress", "egress"):
            for idx, rule in enumerate(policy.get(direction, []) or []):
                peer_selector = _rule_peer_selector(rule, direction)
                matched: List[Dict[str, str]] = []
                if peer_selector:
                    matched = [
                        {"namespace": pod.get("namespace", ""), "pod_name": pod.get("name", "")}
                        for pod in pods
                        if calico_selector_matches(pod.get("labels", {}) or {}, peer_selector)
                    ]
                rules.append({
                    "index": idx,
                    "direction": direction.capitalize(),
                    "action": _rule_action(rule),
                    "protocol": rule.get("protocol"),
                    "ports": _rule_ports(rule),
                    "source_selector": (rule.get("source") or {}).get("selector"),
                    "destination_selector": (rule.get("destination") or {}).get("selector"),
                    "matched_pods": matched,
                    "matched_count": len(matched),
                })

        impacts.append({
            "name": policy.get("name"),
            "namespace": policy.get("namespace"),
            "type": policy.get("type"),
            "selector": policy.get("selector"),
            "selected_pods": [
                {"namespace": pod.get("namespace", ""), "pod_name": pod.get("name", "")}
                for pod in selected
            ],
            "selected_count": len(selected),
            "rules": rules,
            "actions": sorted({r["action"] for r in rules}),
        })
    return impacts
