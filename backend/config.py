import warnings
from functools import lru_cache
from typing import Optional
from urllib.parse import quote_plus

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_PLACEHOLDER = "your-secret-api-key-change-this"


class Settings(BaseSettings):
    REDIS_URL: str = "redis://redis:6379/0"
    REDIS_PASSWORD: Optional[str] = None
    # API_KEY is no longer validated at startup — the frontend communicates with the
    # backend through the same-origin nginx proxy so no API key is needed in the browser.
    # In production, put the backend behind an authenticating reverse proxy (nginx+OIDC,
    # Istio, oauth2-proxy, etc.) instead.
    API_KEY: str = ""
    FRONTEND_URL: str = "http://localhost:5173"

    # Super user password for elevated cluster management operations.
    # Set this in production to require authentication for all write operations.
    SUPER_USER_PASSWORD: str = ""

    # Separate secret for the Falco webhook (not exposed to browsers)
    FALCO_WEBHOOK_SECRET: Optional[str] = None

    # K8s connection settings
    K8S_MODE: str = "kubeconfig"
    K8S_SERVER: Optional[str] = None
    K8S_TOKEN: Optional[str] = None
    K8S_CA_CERT: Optional[str] = None
    K8S_KUBECONFIG: Optional[str] = None
    K8S_KUBECONFIG_PATH: Optional[str] = None

    # Prometheus connection settings
    PROMETHEUS_URL: str = "http://prometheus-k8s.monitoring.svc:9090"
    PROMETHEUS_TIMEOUT: int = 10

    # AI / LLM settings
    AI_API_KEY: Optional[str] = None
    AI_MODEL: str = "mistralai/Mixtral-8x7B-Instruct-v0.1"
    AI_BASE_URL: str = "https://api.together.xyz/v1"
    AI_ENABLED: bool = False

    @field_validator("API_KEY")
    @classmethod
    def warn_placeholder(cls, v: str) -> str:
        if v == _PLACEHOLDER:
            warnings.warn(
                f"API_KEY is still the placeholder {_PLACEHOLDER!r} — set a real value "
                "via the API_KEY environment variable or .env file. "
                "The API key is no longer required for normal operation, but having it "
                "at the placeholder value is insecure."
            )
        return v

    @model_validator(mode="after")
    def _embed_redis_password(self) -> "Settings":
        """Embed REDIS_PASSWORD into REDIS_URL so the redis client doesn't need
        separate password handling. No-op if REDIS_PASSWORD is not set or if
        the URL already contains credentials (has '@' before the host).

        URL-encodes the password to handle special characters (e.g. '+' from
        base64-generated passwords) that would otherwise break URL parsing."""
        if self.REDIS_PASSWORD and "@" not in self.REDIS_URL:
            encoded = quote_plus(self.REDIS_PASSWORD)
            self.REDIS_URL = self.REDIS_URL.replace(
                "redis://", f"redis://:{encoded}@"
            )
        return self

    model_config = SettingsConfigDict(env_file=".env")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()