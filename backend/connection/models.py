from pydantic import BaseModel, Field, ConfigDict
from typing import Literal, Optional
import os
from dotenv import load_dotenv


# Load .env file so os.getenv() can access environment variables
load_dotenv()


class ConnectionConfig(BaseModel):
	"""Configuration for connecting to a Kubernetes cluster.

	mode: one of 'kubeconfig', 'token', or 'incluster'.
	- kubeconfig: provide `kubeconfig` (raw YAML) or `kubeconfig_path`.
	- token: provide `server` (API server URL) and `token` (bearer token).
	- incluster: run inside a cluster and use the serviceaccount mounted credentials.
	"""

	mode: Literal["kubeconfig", "token", "incluster", "mock"] = Field(
		default="kubeconfig",
		description=(
			"Connection mode. 'mock' is the opt-in demo mode: endpoints serve "
			"fabricated data instead of querying a real cluster."
		)
	)
	kubeconfig: Optional[str] = Field(
		default=None,
		description="Raw kubeconfig YAML (use instead of a file)"
	)
	kubeconfig_path: Optional[str] = Field(
		default=None,
		description="Path to a kubeconfig file on disk"
	)
	server: Optional[str] = Field(
		default=None,
		description="API server URL (token mode)"
	)
	token: Optional[str] = Field(
		default=None,
		description="Bearer token (token mode)"
	)
	ca_cert: Optional[str] = Field(
		default=None,
		description="CA certificate PEM (optional for token mode)"
	)
	namespace: Optional[str] = Field("default", description="Cluster namespace")

	model_config = ConfigDict(extra="ignore")  # Allow extra fields from environment but ignore them

	@classmethod
	def from_env(cls) -> "ConnectionConfig":
		"""Create ConnectionConfig from environment variables."""
		return cls(
			mode=os.getenv("K8S_MODE", "kubeconfig"),
			server=os.getenv("K8S_SERVER"),
			token=os.getenv("K8S_TOKEN"),
			ca_cert=os.getenv("K8S_CA_CERT"),
			kubeconfig=os.getenv("K8S_KUBECONFIG"),
			kubeconfig_path=os.getenv("K8S_KUBECONFIG_PATH"),
		)
