"""
Tests for shared utility functions in services/utils.py.

Covers:
  - calico_selector_matches() — all 8+ selector patterns + edge cases
  - compute_policy_coverage() — namespace-scoping, exposed/covered, edge cases
"""

import pytest
from typing import Dict
from services.utils import calico_selector_matches, compute_policy_coverage


# ───── calico_selector_matches ─────────────────────────────────────

class TestCalicoSelectorMatches:
    """12-15 tests covering all Calico selector patterns and edge cases."""

    @staticmethod
    def match(selector: str, labels: Dict[str, str] = None) -> bool:
        return calico_selector_matches(labels or {}, selector)

    # ── all() ──────────────────────────────────────────────────────

    def test_all_matches_any_pod(self):
        assert self.match("all()", {"app": "nginx"}) is True

    def test_all_empty_labels(self):
        assert self.match("all()", {}) is True

    def test_empty_selector_matches_everything(self):
        assert self.match("", {"app": "nginx"}) is True

    def test_whitespace_only_selector_matches_everything(self):
        assert self.match("  ", {"app": "nginx"}) is True

    def test_all_with_whitespace(self):
        assert self.match("  all()  ", {"app": "nginx"}) is True

    # ── has(label) ────────────────────────────────────────────────

    def test_has_matching_key(self):
        assert self.match("has(app)", {"app": "nginx"}) is True

    def test_has_missing_key(self):
        assert self.match("has(app)", {"tier": "frontend"}) is False

    def test_has_empty_labels(self):
        assert self.match("has(app)", {}) is False

    def test_has_with_extra_whitespace(self):
        assert self.match("has( app )", {"app": "nginx"}) is True

    # ── !has(label) ───────────────────────────────────────────────

    def test_nothas_missing_key(self):
        assert self.match("!has(app)", {"tier": "frontend"}) is True

    def test_nothas_present_key(self):
        assert self.match("!has(app)", {"app": "nginx"}) is False

    # ── label == 'value' ──────────────────────────────────────────

    def test_eq_exact_match(self):
        assert self.match("app == 'nginx'", {"app": "nginx"}) is True

    def test_eq_mismatch(self):
        assert self.match("app == 'nginx'", {"app": "redis"}) is False

    def test_eq_missing_label(self):
        assert self.match("app == 'nginx'", {"tier": "frontend"}) is False

    def test_eq_single_equals(self):
        """Calico allows single = as well as ==."""
        assert self.match("app = 'nginx'", {"app": "nginx"}) is True

    def test_eq_with_leading_trailing_spaces(self):
        assert self.match("  app == 'nginx'  ", {"app": "nginx"}) is True

    # ── label != 'value' ──────────────────────────────────────────

    def test_neq_not_equal(self):
        assert self.match("app != 'nginx'", {"app": "redis"}) is True

    def test_neq_equal(self):
        assert self.match("app != 'nginx'", {"app": "nginx"}) is False

    def test_neq_missing_label(self):
        """If the label key doesn't exist, != returns True (not equal)."""
        assert self.match("app != 'nginx'", {"tier": "frontend"}) is True

    # ── label in {'v1', 'v2'} ─────────────────────────────────────

    def test_in_member(self):
        assert self.match("app in {'nginx', 'redis'}", {"app": "nginx"}) is True

    def test_in_other_member(self):
        assert self.match("app in {'nginx', 'redis'}", {"app": "redis"}) is True

    def test_in_non_member(self):
        assert self.match("app in {'nginx', 'redis'}", {"app": "postgres"}) is False

    def test_in_missing_label(self):
        assert self.match("app in {'nginx', 'redis'}", {}) is False

    def test_in_single_value_set(self):
        assert self.match("app in {'nginx'}", {"app": "nginx"}) is True

    # ── label not in {'v1', 'v2'} ─────────────────────────────────

    def test_not_in_non_member(self):
        assert self.match("app not in {'nginx', 'redis'}", {"app": "postgres"}) is True

    def test_not_in_member(self):
        assert self.match("app not in {'nginx', 'redis'}", {"app": "nginx"}) is False

    # ── AND combination (&&) ──────────────────────────────────────

    def test_and_both_match(self):
        assert self.match("app == 'nginx' && tier == 'frontend'",
                          {"app": "nginx", "tier": "frontend"}) is True

    def test_and_first_fails(self):
        assert self.match("app == 'nginx' && tier == 'frontend'",
                          {"app": "redis", "tier": "frontend"}) is False

    def test_and_second_fails(self):
        assert self.match("app == 'nginx' && tier == 'frontend'",
                          {"app": "nginx", "tier": "backend"}) is False

    def test_and_multiple_patterns(self):
        assert self.match("has(app) && app == 'nginx' && has(tier)",
                          {"app": "nginx", "tier": "frontend"}) is True

    # ── OR combination (||) ───────────────────────────────────────

    def test_or_first_matches(self):
        assert self.match("app == 'nginx' || app == 'redis'",
                          {"app": "nginx"}) is True

    def test_or_second_matches(self):
        assert self.match("app == 'nginx' || app == 'redis'",
                          {"app": "redis"}) is True

    def test_or_neither_matches(self):
        assert self.match("app == 'nginx' || app == 'redis'",
                          {"app": "postgres"}) is False

    # ── Fallback: bare label name ─────────────────────────────────

    def test_bare_label_present(self):
        """If the selector is just a label name, check its presence."""
        assert self.match("app", {"app": "nginx"}) is True

    def test_bare_label_absent(self):
        assert self.match("app", {"tier": "frontend"}) is False

    # ── contains / startsWith / endsWith ──────────────────────────

    def test_contains_substring_match(self):
        assert self.match("app contains 'ngin'", {"app": "nginx"}) is True

    def test_contains_no_match(self):
        assert self.match("app contains 'redis'", {"app": "nginx"}) is False

    def test_contains_missing_label(self):
        assert self.match("app contains 'x'", {"tier": "frontend"}) is False

    def test_not_contains(self):
        assert self.match("app not contains 'db'", {"app": "nginx"}) is True
        assert self.match("app not contains 'ng'", {"app": "nginx"}) is False

    def test_startswith_match(self):
        assert self.match("app startsWith 'ng'", {"app": "nginx"}) is True

    def test_startswith_no_match(self):
        assert self.match("app startsWith 'web'", {"app": "nginx"}) is False

    def test_not_startswith(self):
        assert self.match("app not startsWith 'ng'", {"app": "nginx"}) is False

    def test_endswith_match(self):
        assert self.match("app endsWith 'inx'", {"app": "nginx"}) is True

    def test_endswith_no_match(self):
        assert self.match("app endsWith 'ng'", {"app": "nginx"}) is False

    def test_not_endswith(self):
        assert self.match("app not endsWith 'inx'", {"app": "nginx"}) is False

    def test_contains_single_equals_is_still_eq(self):
        """A plain = is equality, not a startsWith shorthand."""
        assert self.match("app = 'nginx'", {"app": "nginx"}) is True

    # ── matches /regex/ ───────────────────────────────────────────

    def test_matches_regex(self):
        assert self.match("app matches /^ng/", {"app": "nginx"}) is True

    def test_matches_regex_no_match(self):
        assert self.match("app matches /^db/", {"app": "nginx"}) is False

    def test_not_matches_regex(self):
        assert self.match("app not matches /^db/", {"app": "nginx"}) is True

    def test_matches_case_insensitive_flag(self):
        assert self.match("app matches /^NG/i", {"app": "nginx"}) is True

    def test_matches_escaped_slash(self):
        assert self.match(r"app matches /ngi.x/", {"app": "nginx"}) is True

    # ── Nested parentheses & NOT ──────────────────────────────────

    def test_nested_parentheses_compound(self):
        assert self.match(
            "(app == 'nginx' || app == 'redis') && has(tier)",
            {"app": "nginx", "tier": "frontend"},
        ) is True

    def test_nested_parentheses_or_branch_fails(self):
        assert self.match(
            "(app == 'nginx' || app == 'redis') && has(tier)",
            {"app": "nginx"},
        ) is False

    def test_nested_parentheses_fully_nested(self):
        assert self.match(
            "((app == 'nginx' && has(tier)) || app == 'redis')",
            {"app": "nginx", "tier": "frontend"},
        ) is True

    def test_not_operator_on_group(self):
        assert self.match("!(app == 'nginx')", {"app": "redis"}) is True

    def test_not_operator_matches_nothing_extra(self):
        assert self.match("!(app == 'nginx')", {"app": "nginx"}) is False

    def test_not_has_inside_compound(self):
        assert self.match("!has(app) && has(tier)", {"tier": "frontend"}) is True

    # ── Edge cases ────────────────────────────────────────────────

    def test_selector_with_double_quotes(self):
        """Double-quoted values are supported (previously a limitation)."""
        assert self.match('app == "nginx"', {"app": "nginx"}) is True

    def test_labels_with_none_values(self):
        """Pod with None (null) label value should not crash."""
        labels_with_none: Dict[str, str] = {"app": "nginx", "extra": None}  # type: ignore
        # In practice labels are str->str, but defensive handling
        assert self.match("has(extra)", dict(labels_with_none)) is True

    def test_case_sensitivity(self):
        """Calico selectors are case-sensitive for both label keys and values."""
        assert self.match("app == 'Nginx'", {"app": "nginx"}) is False

    def test_has_with_hyphenated_key(self):
        assert self.match("has(k8s-app)", {"k8s-app": "kube-dns"}) is True

    def test_unsupported_selector_treated_as_no_match(self):
        """A selector that can't be parsed is treated as not matching (safe)."""
        assert self.match("app == 'web' &&", {"app": "web"}) is False
        assert self.match("has(app", {"app": "nginx"}) is False

    def test_invalid_regex_treated_as_no_match(self):
        """A malformed regex must not crash evaluation — it is not matching."""
        assert self.match("app matches /foo(/", {"app": "foo"}) is False
        assert self.match("app not matches /foo(/", {"app": "foo"}) is False


# ───── selector_is_supported ────────────────────────────────────────

class TestSelectorIsSupported:
    """Gate used by the coverage endpoint to surface parser limitations."""

    def test_empty_is_supported(self):
        from services.utils import selector_is_supported
        assert selector_is_supported("") is True
        assert selector_is_supported("   ") is True

    def test_basic_syntax_supported(self):
        from services.utils import selector_is_supported
        assert selector_is_supported("app == 'nginx'") is True
        assert selector_is_supported("has(app) && app != 'redis'") is True

    def test_advanced_syntax_supported(self):
        from services.utils import selector_is_supported
        assert selector_is_supported("app contains 'ng'") is True
        assert selector_is_supported("app startsWith 'ng'") is True
        assert selector_is_supported("app endsWith 'inx'") is True
        assert selector_is_supported("app matches /^ng/") is True
        assert selector_is_supported("(app == 'a' || app == 'b') && has(tier)") is True

    def test_broken_syntax_unsupported(self):
        from services.utils import selector_is_supported
        assert selector_is_supported("app == 'web' &&") is False
        assert selector_is_supported("has(app") is False
        assert selector_is_supported("app in {") is False
        assert selector_is_supported("app ==") is False
        assert selector_is_supported("app matches /foo(/") is False


# ───── find_unsupported_selectors ───────────────────────────────────

class TestFindUnsupportedSelectors:
    def test_returns_only_broken_policies(self):
        from services.utils import find_unsupported_selectors
        policies = [
            {"name": "good", "selector": "app == 'nginx'"},
            {"name": "bad", "selector": "app == 'web' &&"},
            {"name": "empty", "selector": ""},
        ]
        result = find_unsupported_selectors(policies)
        assert result == [{"policy_name": "bad", "selector": "app == 'web' &&"}]

    def test_empty_when_all_parse(self):
        from services.utils import find_unsupported_selectors
        assert find_unsupported_selectors([{"name": "a", "selector": "all()"}]) == []


# ───── compute_policy_coverage ─────────────────────────────────────

class TestComputePolicyCoverage:
    """5-6 tests covering exposed/covered/empty/namespace-scoping scenarios."""

    @staticmethod
    def pods():
        return [
            {"name": "nginx-1", "namespace": "default", "labels": {"app": "nginx"}},
            {"name": "redis-1", "namespace": "default", "labels": {"app": "redis"}},
            {"name": "unlabeled-1", "namespace": "default", "labels": {}},
        ]

    @staticmethod
    def policies():
        return [
            {"name": "allow-nginx", "namespace": "default", "type": "NetworkPolicy",
             "selector": "app == 'nginx'"},
            {"name": "allow-all-default", "namespace": "default", "type": "NetworkPolicy",
             "selector": "all()"},
        ]

    def test_pod_with_matching_policy_is_covered(self):
        """Pod selected by a policy should have exposed: False."""
        result = compute_policy_coverage(
            [{"name": "nginx-1", "namespace": "default", "labels": {"app": "nginx"}}],
            [{"name": "allow-nginx", "namespace": "default", "type": "NetworkPolicy",
              "selector": "app == 'nginx'"}],
        )
        assert result[0]["exposed"] is False
        assert "allow-nginx" in result[0]["selecting_policies"]

    def test_pod_with_no_matching_policy_is_exposed(self):
        """Pod not selected by any policy should have exposed: True."""
        result = compute_policy_coverage(
            [{"name": "redis-1", "namespace": "default", "labels": {"app": "redis"}}],
            [{"name": "allow-nginx", "namespace": "default", "type": "NetworkPolicy",
              "selector": "app == 'nginx'"}],
        )
        assert result[0]["exposed"] is True
        assert result[0]["selecting_policies"] == []

    def test_pod_with_multiple_matching_policies_lists_all(self):
        """Pod matching multiple policies should list all of them."""
        result = compute_policy_coverage(
            [{"name": "nginx-1", "namespace": "default", "labels": {"app": "nginx"}}],
            [
                {"name": "allow-nginx", "namespace": "default", "type": "NetworkPolicy",
                 "selector": "app == 'nginx'"},
                {"name": "allow-all-default", "namespace": "default", "type": "NetworkPolicy",
                 "selector": "all()"},
            ],
        )
        assert result[0]["exposed"] is False
        assert len(result[0]["selecting_policies"]) == 2
        assert "allow-nginx" in result[0]["selecting_policies"]
        assert "allow-all-default" in result[0]["selecting_policies"]

    def test_empty_pods_returns_empty_list(self):
        assert compute_policy_coverage([], [{"name": "p", "selector": "all()", "type": "GlobalNetworkPolicy"}]) == []

    def test_no_policies_all_pods_exposed(self):
        """If policies list is empty, every pod should be exposed."""
        pods = [
            {"name": "a", "namespace": "default", "labels": {"app": "a"}},
            {"name": "b", "namespace": "default", "labels": {"app": "b"}},
        ]
        result = compute_policy_coverage(pods, [])
        assert len(result) == 2
        assert all(r["exposed"] is True for r in result)
        assert all(r["selecting_policies"] == [] for r in result)

    def test_pod_with_no_labels_only_all_matches(self):
        """Pod with no labels should only be matched by all()."""
        result = compute_policy_coverage(
            [{"name": "empty", "namespace": "default", "labels": {}}],
            [
                {"name": "all-pods", "namespace": None, "type": "GlobalNetworkPolicy",
                 "selector": "all()"},
                {"name": "specific", "namespace": "default", "type": "NetworkPolicy",
                 "selector": "has(app)"},
            ],
        )
        assert result[0]["exposed"] is False
        assert "all-pods" in result[0]["selecting_policies"]
        assert "specific" not in result[0]["selecting_policies"]

    def test_networkpolicy_does_not_cross_namespace(self):
        """Namespaced NetworkPolicy should not match pods in other namespaces.

        A NetworkPolicy in 'production' with selector all() should NOT match
        a pod in 'default'.
        """
        result = compute_policy_coverage(
            [
                {"name": "prod-pod", "namespace": "production", "labels": {"app": "nginx"}},
                {"name": "default-pod", "namespace": "default", "labels": {"app": "nginx"}},
            ],
            [
                {"name": "prod-network-policy", "namespace": "production", "type": "NetworkPolicy",
                 "selector": "app == 'nginx'"},
            ],
        )
        # The production pod should be covered
        prod = next(r for r in result if r["pod_name"] == "prod-pod")
        assert prod["exposed"] is False
        assert "prod-network-policy" in prod["selecting_policies"]

        # The default pod should NOT be covered (different namespace)
        default = next(r for r in result if r["pod_name"] == "default-pod")
        assert default["exposed"] is True
        assert default["selecting_policies"] == []

    def test_globalnetworkpolicy_crosses_namespace(self):
        """GlobalNetworkPolicy should match pods in ALL namespaces."""
        result = compute_policy_coverage(
            [
                {"name": "pod-a", "namespace": "ns1", "labels": {"app": "nginx"}},
                {"name": "pod-b", "namespace": "ns2", "labels": {"app": "nginx"}},
            ],
            [
                {"name": "global-allow", "namespace": None, "type": "GlobalNetworkPolicy",
                 "selector": "app == 'nginx'"},
            ],
        )
        assert all(r["exposed"] is False for r in result)
        assert all("global-allow" in r["selecting_policies"] for r in result)

    def test_mixed_policy_types_respect_namespace_scoping(self):
        """Mix of GlobalNetworkPolicy and NetworkPolicy should scope correctly."""
        result = compute_policy_coverage(
            [
                {"name": "prod-pod", "namespace": "production", "labels": {"app": "nginx"}},
                {"name": "mon-pod", "namespace": "monitoring", "labels": {"app": "nginx"}},
            ],
            [
                {"name": "global-deny", "namespace": None, "type": "GlobalNetworkPolicy",
                 "selector": "all()"},
                {"name": "prod-allow", "namespace": "production", "type": "NetworkPolicy",
                 "selector": "app == 'nginx'"},
            ],
        )

        prod = next(r for r in result if r["pod_name"] == "prod-pod")
        assert len(prod["selecting_policies"]) == 2  # global-deny + prod-allow

        mon = next(r for r in result if r["pod_name"] == "mon-pod")
        assert mon["selecting_policies"] == ["global-deny"]  # only the global one
