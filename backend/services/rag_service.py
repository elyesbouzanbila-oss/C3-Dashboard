'''Small grounded knowledge retrieval for the AI chat.

A tiny in-memory knowledge store of CNI Command Center facts, each tagged
with keywords and a source location. On a query it returns the most relevant
chunks verbatim so the model can cite the codebase instead of recalling from
training memory.

This is intentionally small: no vector DB, no embeddings, no cache. The
chunks are hand-curated from things verified during code review, so the
content is grounded rather than hallucinated.
'''

# Each entry: (chunk_text, keywords, source)
# Keywords are lowercase words/phrases the query may contain.
KNOWLEDGE = [
    (
        'IPAM utilization is reported per IP pool (blocks, allocated, total, percent), '
        'not per node. A pool-level utilization near 100% means new pods in that pool '
        'cannot get an IP; check which pool the pods use and whether a pool is disabled or '
        'has a restrictive node selector. Per-node IP exhaustion is not available.',
        ['ipam', 'ip', 'address', 'exhaustion', 'no ip', 'pod ip', 'utilization'],
        'backend/services/calico_service.py:get_ipam_utilization',
    ),
    (
        'BGP peers in the dashboard are Calico BGPConfiguration / BGPPeer CRD config only. '
        'The CRD carries peer config (peer IP, AS number, hold time), not a live session '
        'state, so the dashboard cannot tell you whether a BGP session is established. '
        'Felix metrics expose active BGP sessions only when Prometheus is reachable.',
        ['bgp', 'peer', 'session', 'established', 'route', 'border'],
        'backend/routers/cni.py:list_bgp_peers ; backend/services/calico_service.py:get_bgp_peers',
    ),
    (
        'The live cluster snapshot answers inventory questions (pod count, namespaces, '
        'pods by phase, nodes and which are Calico-not-ready, policy counts by type, IP pool '
        'names/CIDR/mode). It does not contain per-pod detail, per-rule policy impact, '
        'per-pool IPAM utilization, or live BGP session state -- use the tools for those.',
        ['snapshot', 'inventory', 'count', 'ready', 'unavailable', 'ground truth'],
        'backend/services/ai_service.py:_cluster_snapshot',
    ),
    (
        'To explain why a pod or workload is failing, call get_events first (recent '
        'scheduling, image pull, crash, probe, OOM, network-setup events) and then '
        'get_pod_logs for the application error output. Do not speculate about a '
        'cause that these can check.',
        ['why', 'failing', 'crash', 'oom', 'probe', 'event', 'logs', 'error'],
        'backend/services/ai_service.py:_tool_events / _tool_pod_logs',
    ),
    (
        'check_pod_policies answers reachability for one pod: the Calico policies that select '
        'it, whether it is exposed, and the rules of each policy with the peer pods they match. '
        'Use for can pod A reach pod B questions.',
        ['reach', 'can', 'access', 'policy', 'selector', 'ingress', 'egress', 'peer'],
        'backend/services/ai_service.py:_tool_pod_policies',
    ),
    (
        'Felix dataplane metrics come from Prometheus (active local endpoints, cluster network '
        'policies, iptables-restore errors, active BGP sessions, dataplane failures). If Prometheus '
        'is unreachable the Felix tool returns an error and the model should tell the user the metrics '
        'could not be fetched rather than inventing gauge values.',
        ['felix', 'prometheus', 'metric', 'iptables', 'endpoint', 'dataplane'],
        'backend/services/felix_metrics_service.py:get_felix_metrics',
    ),
    (
        'Environment variables that change backend behavior: K8S_MODE (real vs mock K8s client), '
        'TRUST_PROXY_HEADERS (whether X-Real-IP is trusted for rate limits and audit), AI_API_KEY / '
        'AI_ENABLED / AI_MODEL / AI_BASE_URL (LLM), DB/DB_PATH (SQLite), and the kubernetes config '
        'tower (KUBERNETES_*). Settings defaults and per-environment overrides live in config.py.',
        ['environment', 'config', 'setting', 'mock', 'proxy', 'auth', 'db', 'enable'],
        'backend/routers/config.py; backend/services/ai_service.py:AIService.__init__',
    ),
    (
        'Rate limits and audit use the real client IP from X-Real-IP when TRUST_PROXY_HEADERS is on '
        '(default). AI chat is capped at 20 messages per turn, 8,000 chars per message, 20 requests '
        'per minute per IP, and tool dispatch is capped at 5 iterations. Non user/assistant message '
        'roles are dropped before the LLM sees them.',
        ['rate', 'limit', 'audit', 'ip', 'message', 'cap', 'tool iteration'],
        'backend/routers/ai.py; backend/services/ai_service.py',
    ),
]


def retrieve(query, k=3):
    '''Return the k most relevant knowledge chunks for a user query.

    Relevance is keyword overlap between the query and each chunk keywords.
    An empty query returns nothing. Ties are broken by chunk order (most important
    first). Returns verbatim text with a source location so the model can cite
    instead of invent.
    '''
    q = (query or '').lower().strip()
    if not q:
        return []
    scored = []
    for idx, (text, keywords, source) in enumerate(KNOWLEDGE):
        hits = sum(1 for kw in keywords if kw in q)
        if hits:
            scored.append((hits, -idx, {'text': text, 'source': source}))
    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    return [item for _, _, item in scored[:k]]
