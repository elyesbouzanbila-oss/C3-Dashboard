"""Super-user authentication helpers.

Constant-time password comparison and stateless signed session tokens
(HMAC-SHA256, stdlib only — no JWT dependency required). Tokens embed an
expiry timestamp so a leaked token is only usable for a short window.
"""

import base64
import hashlib
import hmac
import json
import time

# Super-user session lifetime: bounds the window a leaked token is usable.
TOKEN_TTL_SECONDS = 15 * 60

# Domain-separation constant for the HMAC key derivation.
_TOKEN_PURPOSE = b"k8s-dashboard-super-user-token-v1"


def _signing_key(password: str) -> bytes:
    """Derive a stable HMAC key from the super-user password.

    Deterministic across restarts so sessions survive backend deploys.
    An attacker who knows the password can mint tokens anyway (via
    POST /api/config/auth), so deriving from it adds no meaningful weakness.
    """
    return hmac.new(password.encode("utf-8"), _TOKEN_PURPOSE, hashlib.sha256).digest()


def passwords_match(candidate: str, expected: str) -> bool:
    """Constant-time string comparison — avoids timing side channels."""
    return hmac.compare_digest(
        candidate.encode("utf-8"),
        expected.encode("utf-8"),
    )


def create_token(password: str) -> str:
    """Mint a signed token valid for TOKEN_TTL_SECONDS."""
    now = int(time.time())
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": "super-user", "iat": now, "exp": now + TOKEN_TTL_SECONDS}).encode("utf-8")
    ).decode("ascii")
    signature = hmac.new(_signing_key(password), payload.encode("ascii"), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(signature).decode("ascii")
    return f"{payload}.{sig_b64}"


def verify_token(token: str, password: str) -> bool:
    """Verify a token's signature (constant-time) and expiry."""
    if not token or not password:
        return False
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        expected = hmac.new(
            _signing_key(password), payload_b64.encode("ascii"), hashlib.sha256
        ).digest()
        provided = base64.urlsafe_b64decode(sig_b64.encode("ascii"))
        if not hmac.compare_digest(provided, expected):
            return False
        payload = json.loads(base64.urlsafe_b64decode(payload_b64.encode("ascii")))
        return int(payload.get("exp", 0)) > int(time.time())
    except (ValueError, TypeError, json.JSONDecodeError):
        return False
