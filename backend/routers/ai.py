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
    messages: List[Dict[str, str]] = body.get("messages", [])
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
