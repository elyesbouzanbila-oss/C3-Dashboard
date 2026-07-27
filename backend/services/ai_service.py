"""AI / LLM service for the floating chat panel.

Calls any OpenAI-compatible API (Together AI, Groq, OpenAI, etc.)
based on environment configuration.
"""

import json
from typing import Any, Dict, List, Optional

import httpx

from config import Settings
from services.logging_service import get_logger

logger = get_logger(__name__)

# ── System prompt: tells the AI what data is available ───────────
SYSTEM_PROMPT = """You are an AI assistant for the CNI Command Center, a Kubernetes cluster \
monitoring and diagnostics dashboard. You have access to real-time cluster data.

You can answer questions about:
- Pods, namespaces, and their status
- Calico CNI health (node status, BGP peers, IP pools, IPAM utilization)
- Network policies (Calico GlobalNetworkPolicies and Kubernetes NetworkPolicies)
- Security posture (RBAC bindings, privileged pods, root containers)
- Threat events from Falco (real-time security events)
- Felix metrics (Calico dataplane stats)
- Cluster topology and connectivity

Answer concisely and accurately. If you don't have enough data to answer \
a question, say so and suggest what the user could check manually. \
When discussing threats or security issues, provide context about \
the severity and recommended remediation steps when possible."""


class AIService:
    """Thin wrapper around an OpenAI-compatible chat-completion API."""

    def __init__(self, settings: Settings):
        self.api_key = settings.AI_API_KEY
        self.model = settings.AI_MODEL
        self.base_url = settings.AI_BASE_URL
        self.enabled = settings.AI_ENABLED and bool(self.api_key)

    async def chat(
        self,
        messages: List[Dict[str, str]],
        cluster_context: Optional[Dict[str, Any]] = None,
        timeout: float = 30.0,
    ) -> str:
        """Send a chat request to the LLM and return the response text.

        Args:
            messages: A list of message dicts with 'role' and 'content' keys.
            cluster_context: Optional dict with cluster data to enrich the
                system prompt.
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

        system_content = SYSTEM_PROMPT
        if cluster_context:
            system_content += f"\n\n## Current Cluster Snapshot\n```json\n{json.dumps(cluster_context, indent=2, default=str)}\n```"

        full_messages = [{"role": "system", "content": system_content}] + messages

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": self.model,
            "messages": full_messages,
            "max_tokens": 1024,
            "temperature": 0.7,
        }

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
                choice = data["choices"][0]
                return choice["message"]["content"].strip()
        except httpx.HTTPStatusError as e:
            logger.error(f"AI API error: {e.response.status_code} {e.response.text[:300]}")
            return f"⚠️ AI request failed (HTTP {e.response.status_code}). Check your API key and model name."
        except httpx.TimeoutException:
            logger.warning("AI API request timed out")
            return "⚠️ AI request timed out. The model may be overloaded — try again later."
        except Exception as e:
            logger.error(f"AI API unexpected error: {e}")
            return f"⚠️ An unexpected error occurred: {str(e)}"
