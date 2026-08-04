# CNI Command Center

![CI](https://github.com/elyesbouzanbila-oss/k8s-cluster-dashboard/actions/workflows/ci.yml/badge.svg)

A dedicated Kubernetes command center built around Calico CNI diagnostics: cluster/network overview,
Calico CNI health, IPAM, network policy inspection and coverage, topology, connectivity diagnostics,
threat streaming, security audits, an AI assistant, and cluster resource management.
General cluster/resource monitoring (node CPU/mem, pod resources, storage) is handled by Grafana
(via kube-prometheus-stack), deployed separately.

## Features

- **Dashboard** — CNI Command Center overview: Calico agent health, BGP peers, IPAM utilization, policy counts, Felix performance
- **CNI Health** — Per-node Felix and BIRD/BGP agent status cards with color-coded health indicators
- **IPAM** — IP pool utilization bars, block allocation statistics, pool definition tables
- **Policies** — Searchable/filterable Calico NetworkPolicy and GlobalNetworkPolicy table with Allow/Deny badges; sub-view toggle for **Policy Coverage** analysis (per-pod exposed/covered detection with namespace-level summaries)
- **Endpoints** — Per-pod Calico workload endpoint state: selecting policies, exposed/covered status, interface status, and per-direction (ingress/egress) rule digests
- **Policy Impact** — Select a policy to see the exact pods it selects and a rule-by-rule breakdown (action, protocol, ports, peer selector, matched pods)
- **Topology** — Interactive node-to-node BGP mesh + pod overlay topology graph
- **Diagnostics** — On-demand pod-to-pod / pod-to-service connectivity test runner
- **Threats** — Real-time network-scoped threat event streaming via WebSocket (Falco webhook ingestion, with recent-event history)
- **Security** — RBAC binding audit and privileged / root-container pod detection
- **AI Assistant** — chat with an LLM that fetches live cluster data on demand (Tools section)
- **Cluster Config** — super-user-protected management of IP pools, BGP peers, namespaces, services, configmaps, secrets, deployments and node cordoning, with an audit log of every write

The UI is organized into four sidebar sections — **Overview, Network, Security, Tools** — with a live/demo indicator and an export button in the sidebar footer.

> **Note:** General cluster monitoring (node CPU/memory, pod resource consumption, storage) is handled by **Grafana** via `kube-prometheus-stack` — deployed separately from this project.
For deeper Felix performance charts, import Grafana dashboard [ID `12175`](https://grafana.com/grafana/dashboards/12175-calico-felix/).

## RBAC Permissions

The dashboard requires the following ClusterRole permissions to operate. These are defined in
[`k8s/clusterrole.yaml`](k8s/clusterrole.yaml).

| API Group | Resources | Verbs | Purpose |
|-----------|-----------|-------|---------|
| `(core)` | `pods`, `services`, `nodes`, `endpoints`, `namespaces` | `get, list, watch` | Pod discovery, topology, diagnostics |
| `rbac.authorization.k8s.io` | `clusterrolebindings`, `rolebindings`, `clusterroles`, `roles` | `get, list` | RBAC audit |
| `metrics.k8s.io` | `pods`, `nodes` | `get, list, watch` | Resource usage panels (if metrics-server installed) |
| `storage.k8s.io` | `storageclasses` | `get, list` | Storage class discovery |
| `(core)` | `persistentvolumes`, `persistentvolumeclaims` | `get, list, watch` | PVC/PV overview |
| `networking.k8s.io` | `networkpolicies` | `get, list` | Kubernetes NetworkPolicy discovery |
| `crd.projectcalico.org` | `ippools`, `ipamblocks`, `ipamconfigs`, `bgppeers`, `bgpconfigurations`, `felixconfigurations`, `networkpolicies`, `globalnetworkpolicies`, `hostendpoints`, `clusterinformations` | `get, list, watch` | Calico CNI diagnostics — IPAM, BGP, policies, Felix |
| `(core)` | `pods` | `create, delete` | Ephemeral connectivity test pods (Diagnostics tab) |
| `(core)` | `pods/log` | `get` | Read diagnostic pod output |

> **Note:** The `pods` `create/delete` and `pods/log` `get` permissions are the only write/mutate
> permissions required. They are scoped cluster-wide for convenience but can be narrowed to a
> specific namespace via a `Role` + `RoleBinding` instead.

### Verify RBAC

```bash
kubectl auth can-i list ippools --as=system:serviceaccount:k8s-dashboard:dashboard-sa
kubectl auth can-i create pods --as=system:serviceaccount:k8s-dashboard:dashboard-sa
kubectl auth can-i get pods/log --as=system:serviceaccount:k8s-dashboard:dashboard-sa
```

---

## Quick Start

### Prerequisites
- Docker & Docker Compose
- A Kubernetes cluster (local, cloud, or on-prem)
- `kubectl` configured or a service account token with cluster-wide read permissions
- (Optional) Prometheus deployed for time-series monitoring charts
- (Optional) Falco + Falcosidekick for real-time threat ingestion

### Run
```bash
docker compose up --build
```

Visit: http://localhost:5173

### Services
| Service  | URL                        |
|----------|----------------------------|
| Frontend | http://localhost:5173       |
| Backend  | http://localhost:8000       |
| Redis    | localhost:6379              |

### Deploying to a Kubernetes Cluster

Deploy all components (frontend, backend, Redis) into your cluster:

```bash
kubectl apply -k k8s/
```

This creates a namespace `k8s-dashboard` and deploys everything under it.
The frontend is exposed as a **NodePort** service (HTTP + HTTPS). Find the
assigned ports and browse to the node:

```bash
kubectl get svc -n k8s-dashboard dashboard-frontend
# then visit https://<any-node-ip>:<https-node-port>
```

> **Note:** The backend (`dashboard-backend`) uses `ClusterIP` and is only reachable
> internally through the nginx reverse proxy on the frontend pod. External calls to
> the backend API must go through the frontend's NodePort.

### Building Container Images

If deploying to a local cluster (kind, minikube, etc.), build the images first so they're
available locally (the deployments use `imagePullPolicy: IfNotPresent` — the image is used if present locally, otherwise pulled from a registry):

```bash
docker compose build
# Or build individually:
docker build -t dashboard-backend:latest ./backend
docker build -t dashboard-frontend:latest ./frontend
```

Then load them into your cluster:

```bash
# kind
kind load docker-image dashboard-backend:latest dashboard-frontend:latest

# minikube
minikube image load dashboard-backend:latest
minikube image load dashboard-frontend:latest
```

## Configuration

The backend supports four modes for connecting to your Kubernetes cluster (or none, for the demo).

### Mode 1: kubeconfig (default, recommended for local dev)

Mount your kubeconfig into the backend container (already configured in `docker-compose.yml`):
```env
K8S_MODE=kubeconfig
```

### Mode 2: Token-based (for remote clusters)

```env
K8S_MODE=token
K8S_SERVER=https://<your-cluster>:6443
K8S_TOKEN=<your-service-account-token>
```

### Mode 3: In-cluster (when deployed inside Kubernetes)

```env
K8S_MODE=incluster
```

### Mode 4: Mock / demo (no cluster required)

```env
K8S_MODE=mock
```

Serves fabricated demo data from `models/mock_data.py`. **Mock is opt-in** —
without this mode, endpoints that can't reach the cluster return an error
envelope instead of fake data. The frontend shows a **DEMO** badge only when
mock mode is active.

### Environment Variables

#### Backend (`.env`)
```env
# ❗ API_KEY is required — no default value is provided.
# Generate a strong key: openssl rand -base64 32
API_KEY=

# Separate secret for Falco webhook HMAC signature (optional)
# Configure Falcosidekick with webhook.CustomHeaders: X-Falco-Signature=<hmac>
FALCO_WEBHOOK_SECRET=

FRONTEND_URL=http://localhost:5173
REDIS_URL=redis://redis:6379/0

# K8s connection (pick one mode)
K8S_MODE=kubeconfig          # kubeconfig | token | incluster | mock
K8S_SERVER=                  # Required for token mode
K8S_TOKEN=                   # Required for token mode

# Prometheus (optional — enables time-series charts)
PROMETHEUS_URL=http://prometheus-k8s.monitoring.svc:9090

# Super-user password for Cluster Config write endpoints (optional).
# When empty, writes are allowed without a password but still audited.
SUPER_USER_PASSWORD=

# Redis auth (optional — must match the Redis deployment)
REDIS_PASSWORD=

# AI assistant (optional — enables Tools → AI chat)
AI_API_KEY=
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.3-70b-versatile
AI_ENABLED=true
```

#### Frontend (`.env.local`)
```env
# API key has been removed from the frontend for security.
# The frontend communicates with the backend through the nginx reverse proxy
# (same-origin). No API key is needed in the browser.
VITE_API_URL=http://localhost:8000
```

## API Endpoints

> **Security note:** The API key has been removed from the frontend. In production,
> the backend should be deployed behind an authenticating reverse proxy (nginx + OIDC/mTLS,
> Istio authz policy, or a sidecar like oauth2-proxy). For local development, the nginx
> reverse proxy provides same-origin isolation. The Falco webhook (`/api/threats/falco`)
> can be authenticated via HMAC-SHA256 signature using `FALCO_WEBHOOK_SECRET`.
>
> **Rate limiting:** `slowapi` protects the mutating / high-traffic endpoints:
> Falco webhook (600 POST/min/IP), threat history (30/min/IP), connectivity
> diagnostics (10/min/IP) and super-user auth (5/min/IP).

| Endpoint                         | Method     | Description                              | Rate-Limited? |
|----------------------------------|------------|------------------------------------------|---------------|
| `/` `/healthz` `/readyz`         | GET        | Health/probe endpoints (liveness + readiness) | No |
| `/mock/pods` `/mock/topology` `/mock/rbac` `/mock/privileged` | GET | Demo data — **served only in `K8S_MODE=mock`** | No |
| `/api/network/pods`              | GET        | List all pods across namespaces         | No |
| `/api/network/topology`          | GET        | Cluster topology graph (nodes + edges)  | No |
| `/api/threats/falco`             | POST       | Falco webhook — ingest threat events (HMAC-signed) | 600/min per IP |
| `/api/threats/history`           | GET        | Recent threat events (vault history)    | 30/min per IP |
| `/api/threats/ws/threats`        | WebSocket  | Real-time threat stream                | No |
| `/api/security/rbac`             | GET        | RBAC bindings audit                    | No |
| `/api/security/privileged-pods`  | GET        | Privileged / root containers           | No |
| `/api/ai/status`                 | GET        | AI assistant availability              | No |
| `/api/ai/chat`                   | POST       | Chat with the cluster-aware assistant  | No |
| `/api/cni/nodes`                 | GET        | Per-node Calico agent status           | No |
| `/api/cni/bgp-peers`             | GET        | BGP peer list + session state          | No |
| `/api/cni/ippools`               | GET        | IP pool definitions                    | No |
| `/api/cni/ipam/utilization`      | GET        | Allocated vs. free IPs per pool        | No |
| `/api/cni/policies`              | GET        | Calico NetworkPolicy + GlobalNetworkPolicy | No |
| `/api/cni/policies/coverage`     | GET        | Per-pod policy coverage analysis (exposed vs. covered, unsupported-selector warnings) | No |
| `/api/cni/policy-matrix`         | GET        | Workload endpoints + policy impact (per-pod selecting policies, rule-by-rule breakdown) | No |
| `/api/cni/topology`              | GET        | BGP mesh + overlay topology            | No |
| `/api/cni/metrics/felix`         | GET        | Felix performance counters             | No |
| `/api/cni/diagnostics/connectivity` | POST    | On-demand connectivity test (requires `X-API-Key`) | 10/min per IP |
| `/api/config/auth`               | POST       | Mint super-user session token (15-min TTL) | 5/min per IP |
| `/api/config/...`                | GET        | Read-only: ippools, bgppeers, namespaces, services, configmaps, secrets, deployments, nodes, settings | No |
| `/api/config/...`                | POST/PUT/DELETE | Write ops: CRUD on the resources above + image/scale/restart, node cordon/uncordon (requires `X-Super-User-Token`; all writes audited) | No |
| `/api/config/audit`              | GET        | Super-user write audit log (requires `X-Super-User-Token`) | No |

## Architecture

```
┌────────────────────┐         HTTP (same-origin)      ┌──────────────────┐
│  CNI Command Center │ ───────────────────────────────▶│   Backend        │
│  (React+Vite)      │◀───────────────────────────────│ (FastAPI)        │
│    served by        │                                 │    behind        │
│  nginx reverse      │                                 │  authenticating  │
│      proxy          │                                 │   reverse proxy  │
└────────────────────┘                                 └────────┬─────────┘
                                                          │
                         ┌───────────────────────────────┼──────────────┐
                         ▼                               ▼              ▼
                  ┌──────────────┐              ┌──────────────┐  ┌──────┐
                  │  Kubernetes  │              │  Prometheus  │  │Redis │
                  │  API (CRDs)  │              │ (Felix + k8s)│  └──────┘
                  └──────────────┘              └──────────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │  Calico CRDs │
                  │ (IPPool, BGP,│
                  │  IPAM, Pol.) │
                  └──────────────┘

📊 Cluster monitoring (node/pod resources, storage) → **Grafana** (separate, via kube-prometheus-stack)
```

Mock/demo data is **opt-in** (`K8S_MODE=mock`) — without it, endpoints that
can't reach the cluster return error envelopes, never fabricated data.

## Project Structure

```
.
├── docker-compose.yml             # Service orchestration (frontend + backend + redis)
├── deploy.sh                      # Kind-cluster deploy helper (applies kustomization)
├── .github/workflows/ci.yml       # CI: backend tests, frontend tests, lint, build
├── backend/
│   ├── main.py                    # FastAPI entry point (+ /healthz, /readyz probe endpoints)
│   ├── config.py                  # Settings via Pydantic (K8S_MODE, AI, secrets)
│   ├── dependencies.py            # K8s client dependency + mock-mode fallback gate
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── connection/                # K8s API client factory (kubeconfig/token/in-cluster)
│   │   ├── factory.py
│   │   └── models.py
│   ├── models/
│   │   ├── cni_models.py          # CNI Pydantic schemas
│   │   ├── mock_data.py           # Opt-in demo data (K8S_MODE=mock only)
│   │   ├── network.py             # Pod/topology models
│   │   └── threat.py              # Falco event schema
│   ├── routers/
│   │   ├── cni.py                 # CNI diagnostics (Calico CRDs, IPAM, BGP, Felix, coverage, matrix)
│   │   ├── network.py             # Pod discovery, topology
│   │   ├── threats.py             # Falco webhook + WebSocket + history
│   │   ├── security.py            # RBAC audit + privileged pods
│   │   ├── ai.py                  # AI assistant chat + status
│   │   ├── config.py              # Cluster management CRUD (super-user protected)
│   │   └── mock.py                # /mock/* demo endpoints
│   ├── services/
│   │   ├── calico_service.py      # Calico CRD access (IPPool, BGP, IPAM, policies)
│   │   ├── network_service.py     # Pod & service discovery
│   │   ├── prometheus_service.py  # PromQL query proxy
│   │   ├── felix_metrics_service.py # Felix PromQL via Prometheus
│   │   ├── threat_service.py      # Redis pub/sub for Falco events
│   │   ├── security_service.py    # RBAC / privileged-pod queries
│   │   ├── ai_service.py          # LLM chat with cluster tools
│   │   ├── config_service.py      # CRUD ops for cluster resources
│   │   ├── auth_service.py        # Super-user session tokens
│   │   ├── audit_service.py       # Write-op audit log
│   │   ├── logging_service.py     # Structured logger
│   │   └── utils.py               # Calico selector parser + policy coverage engine
│   └── tests/                     # pytest suites (routers, services, utils, models)
├── frontend/
│   ├── src/
│   │   ├── main.tsx               # React entry
│   │   ├── App.tsx                # Sidebar navigation (Overview/Network/Security/Tools)
│   │   ├── App.css / index.css    # Theme + styles
│   │   ├── config.ts              # Runtime env config
│   │   ├── types.ts               # TypeScript interfaces (+ CNI types)
│   │   ├── utils.ts               # Helpers (namespace colors, priority colors, …)
│   │   ├── Topology.tsx / Topology.css  # Cytoscape.js topology graph
│   │   ├── context/DashboardContext.tsx # Shared data fetching + WebSocket state
│   │   └── components/
│   │       ├── DashboardPanel.tsx        # Overview metrics
│   │       ├── NetworkSection.tsx        # Network section shell
│   │       ├── CniHealthPanel.tsx        # Per-node Felix/BIRD status cards
│   │       ├── IpamPanel.tsx             # IP pool utilization + block table
│   │       ├── PolicyInspectorPanel.tsx  # Searchable policy table
│   │       ├── PolicyCoveragePanel.tsx   # Per-pod coverage analysis
│   │       ├── WorkloadEndpointsPanel.tsx # Per-pod endpoint state
│   │       ├── PolicyImpactPanel.tsx     # Policy → selected pods + rule breakdown
│   │       ├── CniTopologyPanel.tsx      # BGP mesh + overlay topology
│   │       ├── DiagnosticsPanel.tsx      # Connectivity test runner
│   │       ├── ThreatPanel.tsx           # Real-time threat stream
│   │       ├── SecuritySection.tsx       # Security section shell
│   │       ├── SecurityPanel.tsx         # RBAC + privileged pods
│   │       ├── ToolsSection.tsx          # Tools section shell
│   │       ├── ChatPanel.tsx             # AI assistant
│   │       ├── ClusterConfigPanel.tsx    # Resource CRUD + super-user modal
│   │       ├── SuperUserModal.tsx        # Super-user authentication
│   │       ├── DataSourceBadge.tsx       # Live/mock/error source badge
│   │       ├── DonutChart.tsx            # Utilization donut
│   │       ├── Icon.tsx                  # SVG icon registry
│   │       ├── Skeleton.tsx              # Loading placeholders
│   │       ├── EmptyState.tsx            # Empty states
│   │       └── ErrorBoundary.tsx
│   ├── index.html, vite.config.ts, tsconfig*.json, eslint.config.js
│   ├── nginx.conf               # SPA reverse proxy config
│   ├── docker-entrypoint.sh     # Runtime env injection for nginx
│   ├── Dockerfile               # Multi-stage build (Vite → nginx)
│   └── package.json
├── k8s/                          # Kubernetes manifests (kustomization-driven)
│   ├── kustomization.yaml       # `kubectl apply -k k8s/`
│   ├── namespace.yaml, sa.yaml, clusterrole.yaml, clusterrolebinding.yaml
│   ├── deploy-backend.yaml, svc-backend.yaml
│   ├── deploy-frontend.yaml, svc-frontend.yaml
│   ├── deploy-redis.yaml, svc-redis.yaml, pvc-redis.yaml
│   ├── networkpolicy-backend.yaml      # Calico NetworkPolicy CRDs
│   ├── networkpolicy-redis.yaml
│   ├── networkpolicy-frontend.yaml
│   ├── networkpolicy-falco.yaml        # Apply separately (falco namespace)
│   ├── cert-issuer.yaml                # Applied conditionally by deploy.sh
│   ├── gen-tls-secret.sh               # Generates TLS + API-key secrets
│   └── secret.yaml, secret-redis.yaml  # Generated locally (gitignored)
└── README.md
```

## Development

### Backend
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Extending

- **Adding a new CNI panel** — create a new service function in `backend/services/calico_service.py`, a route in `backend/routers/cni.py`, and a React component in `frontend/src/components/` following the existing patterns
- **Adding a new Prometheus chart** — add a new PromQL function in `backend/services/prometheus_service.py` and a chart card in the relevant frontend component
- **Adding a new data source** — create a new service + router in the backend following the existing patterns (K8s API client is injected via FastAPI dependency)
- **Mock data is opt-in demo mode** — add fabricated data to `models/mock_data.py`; it is served only when the backend runs with `K8S_MODE=mock`. A real cluster never receives mock responses.

## License

Internal project.