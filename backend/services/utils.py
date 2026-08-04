"""Shared utility functions for CNI Command Center services."""

import re
from typing import Dict, List, Tuple


def label_selector_matches(pod_labels: Dict[str, str], selector: Dict[str, str]) -> bool:
    """Check if pod labels match a service's label selector.

    Returns True only when every key in *selector* has an identical value in
    *pod_labels*. An empty selector returns False.
    """
    if not selector:
        return False
    for key, value in selector.items():
        if pod_labels.get(key) != value:
            return False
    return True


# ─── Calico selector parsing ─────────────────────────────────────
#
# calico_selector_matches() evaluates Calico policy label selectors with a
# small tokenizer + recursive-descent parser. Supported syntax:
#
#   - all()                      — matches everything
#   - has(label)                 — pod has the label key (label may be quoted)
#   - 'label.key' == 'value'     — quoted label keys (slashes/dots) supported
#   - !has(label)                — pod does not have the label key
#   - label == 'value' / =       — exact match (single or double quotes)
#   - label != 'value'           — exact mismatch
#   - label in {'v1', 'v2'}      — value in set
#   - label not in {'v1', 'v2'}  — value not in set
#   - label contains 'substr'    — substring match (+ not contains)
#   - label startsWith 'prefix'  — prefix match (+ not startsWith)
#   - label endsWith 'suffix'    — suffix match (+ not endsWith)
#   - label matches /regex/      — regex match (+ not matches; i/m/s flags)
#   - bare label                 — presence check
#   - && / || / ! / parentheses  — arbitrary nesting
#
# A selector that cannot be parsed raises SelectorParseError. Callers that
# need to tell the difference between "doesn't match" and "can't evaluate"
# should use selector_is_supported() / find_unsupported_selectors(); the
# coverage endpoint surfaces the latter to the UI instead of silently
# misclassifying policies.


class SelectorParseError(ValueError):
    """Raised when a Calico selector expression cannot be parsed."""


_TOKEN_RE = re.compile(
    r"(?P<AND>\&\&)"
    r"|(?P<OR>\|\|)"
    r"|(?P<EQ>==)"
    r"|(?P<NE>!=)"
    r"|(?P<ASSIGN>=)"
    r"|(?P<LPAREN>\()"
    r"|(?P<RPAREN>\))"
    r"|(?P<LBRACE>\{)"
    r"|(?P<RBRACE>\})"
    r"|(?P<COMMA>,)"
    r"|(?P<NOT>!)"
    r"|(?P<STRING>'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\")"
    r"|(?P<WS>\s+)"
    r"|(?P<REGEX>/[^/\n]*(?:\\/[^/\n]*)*/[a-z]*)"
    r"|(?P<IDENT>[^\s(){}&|,!'\"=]+)"
)

# Operators that can follow a ``not`` keyword
_NEGATABLE_OPS = ("in", "contains", "startsWith", "endsWith", "matches")

# Node kind -> evaluation is done in _eval(); these are the comparison ops
_STRING_OPS = (
    "eq", "neq",
    "contains", "neg_contains",
    "startsWith", "neg_startsWith",
    "endsWith", "neg_endsWith",
)


def _tokenize(selector: str) -> List[Tuple[str, str]]:
    """Split a selector into (kind, value) tokens, skipping whitespace."""
    tokens: List[Tuple[str, str]] = []
    pos = 0
    while pos < len(selector):
        m = _TOKEN_RE.match(selector, pos)
        if not m:
            raise SelectorParseError(
                f"Unrecognized selector text at offset {pos}: {selector[pos:]!r}"
            )
        kind = m.lastgroup
        value = m.group()
        pos = m.end()
        if kind == "WS":
            continue
        if kind == "STRING":
            # Strip the surrounding quotes; keep inner escapes verbatim
            tokens.append((kind, value[1:-1]))
        else:
            tokens.append((kind, value))
    tokens.append(("EOF", ""))
    return tokens


class _SelectorParser:
    """Recursive-descent parser producing a small evaluation tree."""

    def __init__(self, selector: str):
        self._tokens = _tokenize(selector)
        self._pos = 0

    def _peek(self) -> Tuple[str, str]:
        return self._tokens[self._pos]

    def _pop(self) -> Tuple[str, str]:
        tok = self._tokens[self._pos]
        self._pos += 1
        return tok

    def _expect(self, kind: str) -> Tuple[str, str]:
        tok = self._peek()
        if tok[0] != kind:
            raise SelectorParseError(
                f"Expected {kind!r}, got {tok[0]!r} ({tok[1]!r})"
            )
        return self._pop()

    def parse(self):
        """Parse the full selector and return the evaluation tree."""
        node = self._parse_or()
        if self._peek()[0] != "EOF":
            raise SelectorParseError(f"Unexpected token {self._peek()!r}")
        return node

    def _parse_or(self):
        node = self._parse_and()
        while self._peek()[0] == "OR":
            self._pop()
            node = ("or", node, self._parse_and())
        return node

    def _parse_and(self):
        node = self._parse_unary()
        while self._peek()[0] == "AND":
            self._pop()
            node = ("and", node, self._parse_unary())
        return node

    def _parse_unary(self):
        if self._peek()[0] == "NOT":
            self._pop()
            return ("not", self._parse_unary())
        return self._parse_primary()

    def _parse_primary(self):
        tok = self._peek()
        if tok[0] == "LPAREN":
            self._pop()
            node = self._parse_or()
            self._expect("RPAREN")
            return node
        # Label names may be bare identifiers or quoted (e.g. keys containing
        # slashes/dots are often written as 'app.kubernetes.io/name').
        if tok[0] in ("IDENT", "STRING"):
            return self._parse_predicate()
        raise SelectorParseError(f"Unexpected token {tok!r}")

    def _parse_predicate(self):
        name = self._pop()[1]

        # ``all()`` — matches everything
        if name == "all" and self._peek()[0] == "LPAREN":
            self._pop()
            self._expect("RPAREN")
            return ("const", True)

        # ``has(label)`` — key exists (label may be bare or quoted)
        if name == "has" and self._peek()[0] == "LPAREN":
            self._pop()
            key_tok = self._peek()
            if key_tok[0] not in ("IDENT", "STRING"):
                raise SelectorParseError(f"Expected label name, got {key_tok!r}")
            key = self._pop()[1]
            self._expect("RPAREN")
            return ("has", key)

        # No operator follows — bare label presence check
        if self._peek()[0] in ("AND", "OR", "RPAREN", "RBRACE", "COMMA", "EOF"):
            return ("has", name)

        op_tok = self._peek()
        if op_tok[0] == "IDENT" and op_tok[1] in ("in", "not", "contains", "startsWith", "endsWith", "matches"):
            if op_tok[1] == "not":
                self._pop()
                nxt = self._peek()
                if nxt[0] != "IDENT" or nxt[1] not in _NEGATABLE_OPS:
                    raise SelectorParseError(
                        f"'not' must be followed by in/contains/startsWith/endsWith/matches, got {nxt!r}"
                    )
                self._pop()
                op = f"neg_{nxt[1]}"
            else:
                self._pop()
                op = op_tok[1]
        elif op_tok[0] in ("EQ", "NE", "ASSIGN"):
            self._pop()
            op = {"EQ": "eq", "NE": "neq", "ASSIGN": "eq"}[op_tok[0]]
        else:
            raise SelectorParseError(f"Unexpected token {op_tok!r} after label {name!r}")

        if op in _STRING_OPS:
            value = self._expect("STRING")[1]
            return (op, name, value)
        if op in ("in", "neg_in"):
            self._expect("LBRACE")
            values = []
            while self._peek()[0] != "RBRACE":
                values.append(self._expect("STRING")[1])
                if self._peek()[0] == "COMMA":
                    self._pop()
            self._expect("RBRACE")
            return (op, name, values)
        if op in ("matches", "neg_matches"):
            raw = self._expect("REGEX")[1]
            # Validate the regex now (not just at eval time) so that
            # selector_is_supported() reports these as unsupported and the
            # coverage endpoint surfaces them instead of silently never
            # matching (or crashing evaluation later).
            _compile_regex(raw)
            return (op, name, raw)
        raise SelectorParseError(f"Unknown operator {op!r}")


_REGEX_CACHE: Dict[Tuple[str, str], "re.Pattern"] = {}


def _compile_regex(raw: str) -> "re.Pattern":
    """Compile a ``/body/flags`` regex literal, caching the result."""
    m = re.match(r"/(.*)/\s*([a-z]*)\Z", raw, re.DOTALL)
    if not m:
        raise SelectorParseError(f"Invalid regex literal {raw!r}")
    body, flags = m.groups()
    fl = 0
    if "i" in flags:
        fl |= re.IGNORECASE
    if "m" in flags:
        fl |= re.MULTILINE
    if "s" in flags:
        fl |= re.DOTALL
    key = (body, flags)
    if key not in _REGEX_CACHE:
        try:
            _REGEX_CACHE[key] = re.compile(body, fl)
        except re.error as e:
            raise SelectorParseError(f"Invalid regex {raw!r}: {e}") from e
    return _REGEX_CACHE[key]


def _eval(node, labels: Dict[str, str]) -> bool:
    """Evaluate a parsed selector tree against pod labels."""
    kind = node[0]
    if kind == "const":
        return node[1]
    if kind == "has":
        return node[1] in labels
    if kind == "eq":
        return labels.get(node[1]) == node[2]
    if kind == "neq":
        return labels.get(node[1]) != node[2]
    if kind == "in":
        return labels.get(node[1]) in node[2]
    if kind == "neg_in":
        return labels.get(node[1]) not in node[2]
    if kind in _STRING_OPS:
        value = labels.get(node[1]) or ""
        if kind == "contains":
            return node[2] in value
        if kind == "neg_contains":
            return node[2] not in value
        if kind == "startsWith":
            return value.startswith(node[2])
        if kind == "neg_startsWith":
            return not value.startswith(node[2])
        if kind == "endsWith":
            return value.endswith(node[2])
        return not value.endswith(node[2])
    if kind == "matches":
        return bool(_compile_regex(node[2]).search(labels.get(node[1]) or ""))
    if kind == "neg_matches":
        return not bool(_compile_regex(node[2]).search(labels.get(node[1]) or ""))
    if kind == "and":
        return _eval(node[1], labels) and _eval(node[2], labels)
    if kind == "or":
        return _eval(node[1], labels) or _eval(node[2], labels)
    if kind == "not":
        return not _eval(node[1], labels)
    raise SelectorParseError(f"Unknown node {kind!r}")


def selector_is_supported(selector: str) -> bool:
    """True when *selector* parses cleanly (all syntax is understood).

    Empty / whitespace-only selectors count as supported. This is the gate
    the coverage endpoint uses to decide whether a policy needs a warning.
    """
    if not selector or not selector.strip():
        return True
    try:
        _SelectorParser(selector.strip()).parse()
        return True
    except SelectorParseError:
        return False


def find_unsupported_selectors(policies: list) -> List[Dict[str, str]]:
    """Collect policies whose selector this analyzer cannot evaluate.

    Returns a list of ``{"policy_name": ..., "selector": ...}`` dicts, one
    per policy with a non-empty selector that fails to parse. Used to surface
    a targeted warning instead of silently misclassifying those policies.
    """
    unsupported = []
    for policy in policies:
        selector = policy.get("selector", "")
        if selector and not selector_is_supported(selector):
            unsupported.append({
                "policy_name": policy.get("name", ""),
                "selector": selector,
            })
    return unsupported


def calico_selector_matches(pod_labels: Dict[str, str], selector: str) -> bool:
    """Check if pod labels match a Calico policy selector expression.

    Handles common Calico selector patterns:
      - ``all()`` — matches everything
      - ``has(label)`` / ``!has(label)`` — key presence (quoted keys allowed)
      - ``'label.key' == 'value'`` — quoted label names supported
      - ``label == 'value'`` / ``!=`` / ``in {...}`` / ``not in {...}``
      - ``label contains 'substr'`` / ``startsWith`` / ``endsWith``
      - ``label matches /regex/`` (with optional ``i``/``m``/``s`` flags)
      - ``not`` variants of in/contains/startsWith/endsWith/matches
      - Combinations with ``&&`` (AND), ``||`` (OR), ``!`` (NOT), and
        arbitrarily nested parentheses

    Returns True if the pod labels satisfy the selector, False otherwise.
    An empty or ``all()`` selector returns True (matches everything).

    A selector using syntax this parser does not understand is treated as
    *not matching* (safe default) — callers can detect that case up front
    with :func:`selector_is_supported` to surface it in the UI.
    """
    if not selector or not selector.strip() or selector.strip() == "all()":
        return True
    try:
        tree = _SelectorParser(selector.strip()).parse()
        return _eval(tree, pod_labels or {})
    except SelectorParseError:
        # Unsupported syntax — conservatively treat as not matching.
        return False


def compute_policy_coverage(pods: list, policies: list) -> list:
    """Compute per-pod policy coverage.

    For each pod, determine which policies select it and whether it is
    exposed (no policies select it).

    Args:
        pods: List of dicts with keys ``name``, ``namespace``, ``labels``
        policies: List of dicts with keys ``name``, ``namespace``, ``type``, ``selector``

    Returns:
        List of dicts with keys ``pod_name``, ``namespace``, ``labels``,
        ``selecting_policies`` (list of policy names), ``exposed`` (bool)
    """
    coverage = []
    for pod in pods:
        pod_labels = pod.get("labels", {}) or {}
        pod_ns = pod.get("namespace", "")
        selecting = []
        for policy in policies:
            policy_selector = policy.get("selector", "")
            if not policy_selector or not calico_selector_matches(pod_labels, policy_selector):
                continue
            # Namespace-scoping: NetworkPolicy only applies to pods in the same namespace
            if policy.get("type") == "NetworkPolicy" and policy.get("namespace") != pod_ns:
                continue
            selecting.append(policy["name"])
        coverage.append({
            "pod_name": pod["name"],
            "namespace": pod_ns,
            "labels": pod_labels,
            "selecting_policies": selecting,
            "exposed": len(selecting) == 0,
        })
    return coverage
