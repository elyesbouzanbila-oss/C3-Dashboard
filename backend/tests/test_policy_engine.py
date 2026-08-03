"""
Tests for the policy ↔ pod matrix engine (services/policy_engine.py).

Covers both orientations produced by the single shared engine:
  - compute_workload_endpoints — per-pod selecting policies, exposure,
    interface status, per-direction rule digests
  - compute_policy_impact — per-policy selected pods + rule-by-rule breakdown
    with matched peers
"""

import pytest

from services.policy_engine import compute_policy_impact, compute_workload_endpoints


# ─── Fixtures ──────────────────────────────────────────────────────

def sample_pods():
    return [
        {
            "name": "api-1",
            "namespace": "production",
            "labels": {"app": "api-server"},
            "node_name": "worker-1",
            "pod_ip": "10.244.1.10",
            "phase": "Running",
        },
        {
            "name": "frontend-1",
            "namespace": "production",
            "labels": {"app": "frontend"},
            "node_name": "worker-1",
            "pod_ip": "10.244.1.11",
            "phase": "Running",
        },
        {
            "name": "db-1",
            "namespace": "production",
            "labels": {"app": "database"},
            "node_name": "worker-2",
            "pod_ip": "10.244.2.10",
            "phase": "Running",
        },
        {
            "name": "pending-1",
            "namespace": "default",
            "labels": {"app": "sandbox"},
            "node_name": None,
            "pod_ip": None,
            "phase": "Pending",
        },
    ]


def sample_policies():
    return [
        {
            "name": "allow-frontend-ingress",
            "namespace": "production",
            "type": "NetworkPolicy",
            "policy_type": ["Ingress"],
            "selector": "app == 'frontend'",
            "order": 500.0,
            "ingress": [
                {
                    "action": "Allow",
                    "protocol": "TCP",
                    "source": {"selector": "app == 'api-server'"},
                    "destination": {"ports": [8080]},
                }
            ],
            "egress": [],
        },
        {
            "name": "allow-api-egress",
            "namespace": "production",
            "type": "NetworkPolicy",
            "policy_type": ["Ingress", "Egress"],
            "selector": "app == 'api-server'",
            "order": 400.0,
            "ingress": [
                {
                    "action": "Allow",
                    "protocol": "TCP",
                    "source": {"selector": "app == 'frontend'"},
                    "destination": {"ports": [8080]},
                }
            ],
            "egress": [
                {
                    "action": "Allow",
                    "protocol": "TCP",
                    "source": {},
                    "destination": {"selector": "app == 'database'", "ports": [5432]},
                }
            ],
        },
    ]


# ─── compute_workload_endpoints ───────────────────────────────────

class TestComputeWorkloadEndpoints:
    def test_pod_selected_by_namespaced_policy(self):
        endpoints = compute_workload_endpoints(sample_pods(), sample_policies())
        api = next(e for e in endpoints if e["pod_name"] == "api-1")
        assert api["exposed"] is False
        assert {"name": "allow-api-egress", "type": "NetworkPolicy"} in api["selecting_policies"]
        assert "allow-frontend-ingress" not in [p["name"] for p in api["selecting_policies"]]

    def test_rule_digest_counts_directions(self):
        endpoints = compute_workload_endpoints(sample_pods(), sample_policies())
        api = next(e for e in endpoints if e["pod_name"] == "api-1")
        # ingress: allow from frontend; egress: allow to database
        assert api["ingress"]["allow"] == 1
        assert api["ingress"]["deny"] == 0
        assert api["egress"]["allow"] == 1
        assert "8080/TCP" in api["ingress"]["ports"]
        assert "5432/TCP" in api["egress"]["ports"]

    def test_exposed_pod_when_no_policy_selects(self):
        endpoints = compute_workload_endpoints(sample_pods(), sample_policies())
        db = next(e for e in endpoints if e["pod_name"] == "db-1")
        # No policy selects app=database in the fixtures
        assert db["exposed"] is True
        assert db["selecting_policies"] == []
        assert db["ingress"]["allow"] == 0
        assert db["egress"]["allow"] == 0

    def test_interface_status_up_when_running_with_ip(self):
        endpoints = compute_workload_endpoints(sample_pods(), sample_policies())
        api = next(e for e in endpoints if e["pod_name"] == "api-1")
        assert api["interface_status"] == "up"

    def test_interface_status_down_when_pending(self):
        endpoints = compute_workload_endpoints(sample_pods(), sample_policies())
        pending = next(e for e in endpoints if e["pod_name"] == "pending-1")
        assert pending["interface_status"] == "down"

    def test_deny_rules_are_counted(self):
        pods = [sample_pods()[0]]
        policies = [
            {
                "name": "deny-all",
                "namespace": None,
                "type": "GlobalNetworkPolicy",
                "selector": "all()",
                "ingress": [{"action": "Deny"}],
                "egress": [{"action": "Deny"}, {"action": "Log"}],
            }
        ]
        endpoints = compute_workload_endpoints(pods, policies)
        ep = endpoints[0]
        assert ep["ingress"]["deny"] == 1
        assert ep["egress"]["deny"] == 1
        assert ep["egress"]["log"] == 1

    def test_namespaced_policy_does_not_cross_namespace(self):
        endpoints = compute_workload_endpoints(sample_pods(), sample_policies())
        pending = next(e for e in endpoints if e["pod_name"] == "pending-1")
        # allow-frontend-ingress lives in 'production'; pending-1 is in 'default'
        assert pending["exposed"] is True

    def test_empty_inputs(self):
        assert compute_workload_endpoints([], []) == []


# ─── compute_policy_impact ────────────────────────────────────────

class TestComputePolicyImpact:
    def test_selected_pods_per_policy(self):
        impacts = compute_policy_impact(sample_policies(), sample_pods())
        frontend = next(i for i in impacts if i["name"] == "allow-frontend-ingress")
        assert frontend["selected_count"] == 1
        assert frontend["selected_pods"] == [
            {"namespace": "production", "pod_name": "frontend-1"}
        ]

    def test_rule_breakdown_with_matched_peers(self):
        impacts = compute_policy_impact(sample_policies(), sample_pods())
        frontend = next(i for i in impacts if i["name"] == "allow-frontend-ingress")
        rule = frontend["rules"][0]
        assert rule["direction"] == "Ingress"
        assert rule["action"] == "Allow"
        assert rule["protocol"] == "TCP"
        assert rule["ports"] == ["8080/TCP"]
        # Peer selector app == 'api-server' matches api-1
        assert rule["matched_count"] == 1
        assert rule["matched_pods"] == [{"namespace": "production", "pod_name": "api-1"}]

    def test_egress_rule_uses_destination_selector(self):
        impacts = compute_policy_impact(sample_policies(), sample_pods())
        api = next(i for i in impacts if i["name"] == "allow-api-egress")
        egress_rule = next(r for r in api["rules"] if r["direction"] == "Egress")
        assert egress_rule["source_selector"] is None
        assert egress_rule["destination_selector"] == "app == 'database'"
        assert egress_rule["matched_count"] == 1
        assert egress_rule["matched_pods"][0]["pod_name"] == "db-1"

    def test_rule_without_peer_selector_matches_nothing(self):
        policies = [
            {
                "name": "deny-all-egress",
                "namespace": None,
                "type": "GlobalNetworkPolicy",
                "selector": "all()",
                "ingress": [],
                "egress": [{"action": "Deny"}],
            }
        ]
        impacts = compute_policy_impact(policies, sample_pods())
        policy = impacts[0]
        assert policy["selected_count"] == len(sample_pods())
        egress_rule = policy["rules"][0]
        assert egress_rule["matched_count"] == 0
        assert egress_rule["matched_pods"] == []

    def test_actions_are_collected(self):
        impacts = compute_policy_impact(sample_policies(), sample_pods())
        api = next(i for i in impacts if i["name"] == "allow-api-egress")
        assert api["actions"] == ["Allow"]

    def test_empty_policies(self):
        assert compute_policy_impact([], sample_pods()) == []
