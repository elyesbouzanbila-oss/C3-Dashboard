"""AI / LLM service for the floating chat panel.

Calls any OpenAI-compatible API (Together AI, Groq, OpenAI, etc.)
based on environment configuration.

Instead of stuffing a full cluster snapshot into the system prompt,
the model fetches live cluster data on demand through read-only
tools (function calling). A dispatch loop in `chat()` executes
tool calls and feeds the results back to the model.
"""

import json
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

import httpx

from config import Settings
from connection.factory import create_api_client
from connection.models import ConnectionConfig
from services.logging_service import get_logger

logger = get_logger(__name__)

# ── Read-only tools the model may call ─────────────────────────
# Schemas use the OpenAI function-calling format (supported by
# Groq, Together AI, OpenAI, etc.).
TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_pods",
            "description": (
                "List pods across all namespaces, optionally filtered by namespace "
                "or phase. Returns name, namespace, pod IP, node, phase, labels and "
                "container images."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "namespace": {
                        "type": "string",
                        "description": "Optional namespace to filter by (e.g. 'kube-system').",
                    },
                    "status": {
                        "type": "string",
                        "description": "Optional pod phase to filter by (e.g. 'Running', 'Pending', 'Failed').",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_policies",
            "description": (
                "List network policies: Calico GlobalNetworkPolicies and namespaced "
                "Calico NetworkPolicies, including selectors, order and rule counts."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": ["GlobalNetworkPolicy", "NetworkPolicy", "all"],
                        "description": "Filter by policy kind (default 'all').",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_threats",
            "description": (
                "List the most recent Falco security threat events (priority, rule, "
                "process, container, output)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of events to return (default 20, max 50).",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_ip_pools",
            "description": (
                "List Calico IP pools (CIDR, NAT outgoing, disabled state, "
                "encapsulation mode, node selector)."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_felix_metrics",
            "description": (
                "Fetch Felix dataplane metrics from Prometheus "
                "(active local endpoints, cluster network policies, iptables restore "
                "errors, active BGP sessions, dataplane failures)."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

# ── Safety caps ─────────────────────────────────────────────────
# Tool results and the context dump are truncated so they can never
# blow up the context window.
MAX_TOOL_ITERATIONS = 5
MAX_TOOL_RESULT_CHARS = 60_000
MAX_PODS = 100

# ── System prompt: tells the AI how to use tools ────────────────
SYSTEM_PROMPT = """You are an AI assistant for the CNI Command Center, a Kubernetes cluster \
monitoring and diagnostics dashboard.

You can fetch live cluster data on demand using the following read-only tools:
- get_pods — pods and their status (optional namespace / status filters)
- get_policies — Calico network policies
- get_threats — recent Falco security events
- get_ip_pools — Calico IP pools
- get_felix_metrics — Felix dataplane metrics

Rules:
- When a question needs cluster data, call the relevant tool instead of guessing.
- Use the available filters to keep results small when possible.
- If a tool returns an error or says the data is unavailable, tell the user the \
cluster data could not be fetched and suggest what to check manually.
- Answer concisely and accurately. When discussing threats or security issues, \
provide context about severity and recommended remediation when possible."""


SYSTEM_PROMPT_NO_TOOLS = """You are an AI assistant for the CNI Command Center, a Kubernetes cluster \
monitoring and diagnostics dashboard.

You do not currently have live cluster data access. Answer general questions \
concisely and accurately. If the user asks about specific cluster state (pods, \
policies, threats, IP pools, Felix metrics), explain that the live data \
connection is unavailable and suggest checking the dashboard tabs manually."""


def _truncate(text: str, limit: int = MAX_TOOL_RESULT_CHARS) -> str:
    """Truncate long strings, marking the cut so the model knows data was dropped."""
    if len(text) <= limit:
        return text
    return text[:limit] + "\n...[truncated]"


def _serialize_tool_result(data: Any) -> str:
    """Serialize tool output to compact JSON for the model.

    The result stays valid JSON even when it is too large: rather than cutting
    the string mid-way (which would produce malformed JSON), a small JSON error
    object with a preview is returned so the model knows to refine its query.
    """
    try:
        text = json.dumps(data, default=str)
    except (TypeError, ValueError):
        return json.dumps({"error": "Tool result could not be serialized."})
    if len(text) <= MAX_TOOL_RESULT_CHARS:
        return text
    logger.warning(f"AI tool result truncated: {len(text)} chars")
    return json.dumps({
        "error": f"Result too large ({len(text)} chars). Refine the query or use filters.",
        "result_preview": text[:20_000],
    })


class AIService:
    """Thin wrapper around an OpenAI-compatible chat-completion API with tool calling."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.api_key = settings.AI_API_KEY
        self.model = settings.AI_MODEL
        self.base_url = settings.AI_BASE_URL
        self.enabled = settings.AI_ENABLED and bool(self.api_key)

    # ── Kubernetes client lifecycle ─────────────────────────────
    @asynccontextmanager
    async def _k8s_client(self):
        """Yield a configured Kubernetes ApiClient, always closing it afterwards."""
        api_client = await create_api_client(ConnectionConfig.from_env())
        try:
            yield api_client
        finally:
            try:
                await api_client.close()
            except Exception:
                pass

    # ── Tool execution ──────────────────────────────────────────
    async def _execute_tool(self, name: str, args: Dict[str, Any]) -> str:
        """Execute a read-only tool and return a JSON string for the model.

        Never raises: failures are returned as {"error": ...} so the model
        can relay them to the user instead of the whole request dying.
        """
        try:
            if name == "get_pods":
                data = await self._tool_pods(args)
            elif name == "get_policies":
                data = await self._tool_policies(args)
            elif name == "get_threats":
                data = await self._tool_threats(args)
            elif name == "get_ip_pools":
                data = await self._tool_ip_pools()
            elif name == "get_felix_metrics":
                data = await self._tool_felix_metrics()
            else:
                return json.dumps({"error": f"Unknown tool: {name}"})
        except Exception as e:
            logger.warning(f"AI tool '{name}' failed: {e}")
            return json.dumps({"error": f"Failed to fetch {name}: {e}"})
        return _serialize_tool_result(data)

    async def _tool_pods(self, args: Dict[str, Any]) -> List[Dict[str, Any]]:
        from services.network_service import get_pods

        namespace = (args.get("namespace") or "").strip() or None
        status = (args.get("status") or "").strip() or None

        async with self._k8s_client() as api_client:
            pods = await get_pods(api_client)

        result = []
        for p in pods:
            if namespace and p.namespace != namespace:
                continue
            if status and (p.phase or "") != status:
                continue
            result.append({
                "name": getattr(p, "name", None),
                "namespace": getattr(p, "namespace", None),
                "pod_ip": getattr(p, "pod_ip", None),
                "node_name": getattr(p, "node_name", None),
                "phase": getattr(p, "phase", None),
                "labels": getattr(p, "labels", None) or {},
                "containers": getattr(p, "containers", None) or [],
            })
        return result[:MAX_PODS]

    async def _tool_policies(self, args: Dict[str, Any]) -> List[Dict[str, Any]]:
        from services.calico_service import get_cni_policies

        kind = (args.get("kind") or "all").strip() or "all"

        async with self._k8s_client() as api_client:
            policies = await get_cni_policies(api_client)

        if kind != "all":
            policies = [p for p in policies if p.get("type") == kind]
        return policies

    async def _tool_threats(self, args: Dict[str, Any]) -> List[Dict[str, Any]]:
        from services.threat_service import ThreatService

        try:
            limit = max(1, min(int(args.get("limit") or 20), 50))
        except (TypeError, ValueError):
            limit = 20

        threat_svc = ThreatService(self.settings)
        return await threat_svc.get_recent_events(limit=limit)

    async def _tool_ip_pools(self) -> List[Dict[str, Any]]:
        from services.calico_service import get_ip_pools

        async with self._k8s_client() as api_client:
            return await get_ip_pools(api_client)

    async def _tool_felix_metrics(self) -> Dict[str, Any]:
        from services.felix_metrics_service import get_felix_metrics

        return await get_felix_metrics(self.settings)

    # ── Chat with tool-calling dispatch loop ────────────────────
    async def chat(
        self,
        messages: List[Dict[str, str]],
        cluster_context: Optional[Dict[str, Any]] = None,
        use_tools: bool = True,
        timeout: float = 30.0,
    ) -> str:
        """Send a chat request to the LLM and return the response text.

        The model may call read-only tools to fetch live cluster data on
        demand. Tool results are appended as `tool` messages and the request
        is re-sent until the model answers or the iteration cap is hit.

        If the provider rejects the tools payload (e.g. an endpoint without
        function-calling support), the request is retried once without tools
        so the chat keeps working.

        Args:
            messages: A list of message dicts with 'role' and 'content' keys.
            cluster_context: Deprecated. If provided (backwards compatibility),
                appended as supplementary context instead of a full snapshot.
            use_tools: Whether to enable the read-only tools (default: True).
            timeout: Request timeout in seconds.

        Returns:
            The LLM's response text.
        """
        if not self.enabled:
            return (
                "⚠️ **AI assistant is not configured.**\n\n"
                "To enable it, set the following environment variables:\n"
                "- `AI_API_KEY` — your API key (Together AI, Groq, OpenAI, etc.)\n"
                "- `AI_ENABLED=true`\n"
                "- `AI_MODEL` — model name (optional, defaults to Mixtral-8x7B)\n"
                "- `AI_BASE_URL` — API base URL (optional, defaults to Together AI)\n\n"
                "Get a free API key at [Together AI](https://together.ai) or use any "
                "OpenAI-compatible provider."
            )

        supplementary = ""
        if cluster_context:
            supplementary = (
                "\n\n## Supplementary Context\n```json\n"
                + _truncate(json.dumps(cluster_context, default=str))
                + "\n```"
            )

        system_prompt = (SYSTEM_PROMPT if use_tools else SYSTEM_PROMPT_NO_TOOLS) + supplementary
        full_messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        full_messages.extend(messages)

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        base_payload: Dict[str, Any] = {
            "model": self.model,
            "max_tokens": 1024,
            "temperature": 0.7,
        }
        if use_tools:
            base_payload["tools"] = TOOLS
            base_payload["tool_choice"] = "auto"

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                return await self._run_conversation(client, full_messages, headers, base_payload)
        except httpx.HTTPStatusError as e:
            # Some providers reject the tools schema (400/404/422) — degrade to
            # plain chat once. Auth/rate-limit/server errors aren't fixed by
            # dropping tools, so don't waste a retry on them.
            if use_tools and e.response.status_code in (400, 404, 422):
                logger.warning(
                    f"AI API rejected tools payload (HTTP {e.response.status_code}); "
                    "retrying without tools"
                )
                fallback_messages: List[Dict[str, Any]] = [
                    {"role": "system", "content": SYSTEM_PROMPT_NO_TOOLS + supplementary}
                ]
                fallback_messages.extend(messages)
                fallback_payload = {**base_payload}
                fallback_payload.pop("tools", None)
                fallback_payload.pop("tool_choice", None)
                try:
                    async with httpx.AsyncClient(timeout=timeout) as client:
                        return await self._run_conversation(
                            client, fallback_messages, headers, fallback_payload
                        )
                except httpx.HTTPStatusError as e2:
                    logger.error(f"AI API error: {e2.response.status_code} {e2.response.text[:300]}")
                    return f"⚠️ AI request failed (HTTP {e2.response.status_code}). Check your API key and model name."
                except httpx.TimeoutException:
                    logger.warning("AI API request timed out")
                    return "⚠️ AI request timed out. The model may be overloaded — try again later."
                except Exception as e2:
                    logger.error(f"AI API unexpected error: {e2}")
                    return f"⚠️ An unexpected error occurred: {str(e2)}"

            logger.error(f"AI API error: {e.response.status_code} {e.response.text[:300]}")
            return f"⚠️ AI request failed (HTTP {e.response.status_code}). Check your API key and model name."
        except httpx.TimeoutException:
            logger.warning("AI API request timed out")
            return "⚠️ AI request timed out. The model may be overloaded — try again later."
        except Exception as e:
            logger.error(f"AI API unexpected error: {e}")
            return f"⚠️ An unexpected error occurred: {str(e)}"

    async def _run_conversation(
        self,
        client: httpx.AsyncClient,
        full_messages: List[Dict[str, Any]],
        headers: Dict[str, str],
        payload: Dict[str, Any],
    ) -> str:
        """Run the dispatch loop against a single httpx client.

        Posts the conversation, executes any tool calls the model requests,
        appends the results, and re-posts until the model answers or the
        iteration cap is reached.
        """
        last_content = ""
        for _ in range(MAX_TOOL_ITERATIONS):
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json={**payload, "messages": full_messages},
            )
            resp.raise_for_status()
            data = resp.json()
            choice = data["choices"][0]
            msg = choice["message"]
            content = (msg.get("content") or "").strip()
            tool_calls = msg.get("tool_calls") or []

            assistant_msg: Dict[str, Any] = {
                "role": "assistant",
                "content": msg.get("content") or "",
            }
            if tool_calls:
                assistant_msg["tool_calls"] = tool_calls
            full_messages.append(assistant_msg)

            if not tool_calls:
                return content or "..."

            last_content = content or last_content

            for tc in tool_calls:
                fn = tc.get("function") or {}
                name = fn.get("name", "")
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                    if not isinstance(args, dict):
                        args = {}
                except json.JSONDecodeError:
                    args = {}
                result = await self._execute_tool(name, args)
                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", ""),
                    "content": result,
                })

        # Iteration cap reached — the model kept requesting tools.
        return last_content or "⚠️ The assistant made too many tool calls and was stopped."
