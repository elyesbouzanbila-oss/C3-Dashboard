"""AI chat endpoint — answers cluster-related questions using an LLM.

The AI fetches live cluster data on demand through read-only tools
(function calling) rather than receiving a pre-baked cluster snapshot
in its system prompt. The frontend contract is unchanged:

    POST /api/ai/chat  { messages, context?: bool } -> { reply }
    GET  /api/ai/status -> { enabled, model?, provider? }
"""

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, Request
from slowapi import Limiter

from dependencies import get_settings_dep, real_client_ip
from config import Settings
from services.ai_service import AIService

router = APIRouter(prefix="/api/ai", tags=["ai"])

# Rate limiter for the LLM chat endpoint. Interactive use is comfortably
# under 20/min; this caps runaway abuse (cost amplification / prompt-injection
# probing) without a real user noticing. Keyed on the real client IP.
ai_limiter = Limiter(key_func=real_client_ip)

# ── Input guardrails ───────────────────────────────────────────
# Chat history is client-supplied and therefore untrusted: cap its size and
# allow only user/assistant turns, so a request cannot replace the system
# prompt (role="system") or inflate the prompt into a cost amplification.
ALLOWED_ROLES = {"user", "assistant"}
MAX_HISTORY_MESSAGES = 20
MAX_MESSAGE_CHARS = 8_000


def _safe_messages(raw: Any) -> List[Dict[str, str]]:
    """Return the last MAX_HISTORY_MESSAGES valid user/assistant messages, each capped."""
    if not isinstance(raw, list):
        return []
    kept: List[Dict[str, str]] = []
    for msg in raw:
        if not isinstance(msg, dict):
            continue
        role, content = msg.get("role"), msg.get("content")
        if role not in ALLOWED_ROLES or not isinstance(content, str):
            continue
        content = content.strip()
        if content:
            kept.append({"role": role, "content": content[:MAX_MESSAGE_CHARS]})
    return kept[-MAX_HISTORY_MESSAGES:]


@router.post("/chat")
@ai_limiter.limit("20/minute")
async def ai_chat(
    request: Request,
    body: Dict[str, Any],
    settings: Settings = Depends(get_settings_dep),
) -> Dict[str, Any]:
    """Send a chat message to the AI assistant.

    The AI can fetch current cluster data (pods, policies, threats,
    IP pools, Felix metrics) on demand via read-only tools.

    Request body:
        messages: List[{role: str, content: str}] — chat history
        context: Optional[bool] — enable tools / cluster access (default: true)

    Returns:
        { reply: str }
    """
    messages: List[Dict[str, str]] = _safe_messages(body.get("messages"))
    use_tools = bool(body.get("context", True))

    if not messages:
        return {"reply": "No messages provided."}

    service = AIService(settings)
    reply = await service.chat(messages, use_tools=use_tools)

    return {"reply": reply}


@router.get("/status")
async def ai_status(
    settings: Settings = Depends(get_settings_dep),
) -> Dict[str, Any]:
    """Check whether the AI assistant is configured and ready."""
    service = AIService(settings)
    return {
        "enabled": service.enabled,
        "model": service.model if service.enabled else None,
        "provider": service.base_url.split("//")[1].split(".")[0] if service.enabled else None,
    }
