# CNI Command Center

![CI](https://github.com/elyesbouzanbila-oss/k8s-cluster-dashboard/actions/workflows/ci.yml/badge.svg)

A dedicated Calico CNI diagnostics and command center for Kubernetes clusters.
General cluster/resource monitoring (node CPU/mem, pod resources, storage) is handled by Grafana
(via kube-prometheus-stack). This app focuses exclusively on Calico CNI health, IPAM, network policy
inspection, topology, and connectivity diagnostics.

## Features

- **Dashboard** — CNI Command Center overview: Calico agent health, BGP peers, IPAM utilization, policy counts, Felix performance
- **CNI Health** — Per-node Felix and BIRD/BGP agent status cards with color-coded health indicators
- **IPAM** — IP pool utilization bars, block allocation statistics, pool definition tables
- **Policies** — Searchable/filterable Calico NetworkPolicy and GlobalNetworkPolicy table with Allow/Deny badges; sub-view toggle for **Policy Coverage** analysis (per-pod exposed/covered detection with namespace-level summaries)
- **Endpoints** — Per-pod Calico workload endpoint state: selecting policies, exposed/covered status, interface status, and per-direction (ingress/egress) rule digests
- **Policy Impact** — Select a policy to see the exact pods it selects and a rule-by-rule breakdown (action, protocol, ports, peer selector, matched pods)
- **Topology** — Interactive node-to-node BGP mesh + pod overlay topology graph
- **Diagnostics** — On-demand pod-to-pod / pod-to-service connectivity test runner
- **Threats** — Real-time network-scoped threat event streaming via WebSocket (Falco webhook ingestion)

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
The frontend is exposed as a **NodePort** service — access the dashboard at:

```
http://<any-node-ip>:30080
```

> **Note:** The backend (`dashboard-backend`) uses `ClusterIP` and is only reachable
> internally through the nginx reverse proxy on the frontend pod. External calls to
> the backend API must go through the frontend's NodePort.

### Building Container Images

If deploying to a local cluster (kind, minikube, etc.), build the images first so they're
available locally (the deployments use `imagePullPolicy: Never`):

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

The backend supports three modes for connecting to your Kubernetes cluster.

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
K8S_MODE=kubeconfig          # kubeconfig | token | incluster
K8S_SERVER=                  # Required for token mode
K8S_TOKEN=                   # Required for token mode

# Prometheus (optional — enables time-series charts)
PROMETHEUS_URL=http://prometheus-k8s.monitoring.svc:9090
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
> **Rate limiting:** The backend uses `slowapi` to rate-limit the Falco webhook endpoint
> (10 POST requests per minute per IP). All other endpoints are currently unthrottled.

| Endpoint                         | Method     | Description                              | Rate-Limited? |
|----------------------------------|------------|------------------------------------------|---------------|
| `/mock/pods`                     | GET        | Mock pod data                           | No |
| `/mock/topology`                 | GET        | Mock topology                           | No |
| `/mock/rbac`                     | GET        | Mock RBAC bindings                      | No |
| `/mock/privileged`               | GET        | Mock privileged pod data                | No |
| `/api/network/pods`              | GET        | List all pods across namespaces         | No |
| `/api/network/topology`          | GET        | Cluster topology graph (nodes + edges)  | No |
| `/api/threats/falco`             | POST       | Falco webhook — ingest threat events   | 10/min per IP |
| `/api/threats/ws/threats`        | WebSocket  | Real-time threat stream                | No |
| `/api/cni/nodes`                 | GET        | Per-node Calico agent status           | No |
| `/api/cni/bgp-peers`             | GET        | BGP peer list + session state          | No |
| `/api/cni/ippools`               | GET        | IP pool definitions                    | No |
| `/api/cni/ipam/utilization`      | GET        | Allocated vs. free IPs per pool        | No |
| `/api/cni/policies`              | GET        | Calico NetworkPolicy + GlobalNetworkPolicy | No |
| `/api/cni/policies/coverage`      | GET        | Per-pod policy coverage analysis (exposed vs. covered) | No |
| `/api/cni/policy-matrix`          | GET        | Policy ↔ pod matrix: workload endpoints (per-pod selecting policies, exposure, interface status, rule digests) + policy impact (selected pods, rule-by-rule breakdown) | No |
| `/api/cni/topology`              | GET        | BGP mesh + overlay topology            | No |
| `/api/cni/metrics/felix`         | GET        | Felix performance counters             | No |
| `/api/cni/diagnostics/connectivity` | POST    | On-demand connectivity test            | No |

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

All data sources have mock fallbacks — the dashboard works without a live cluster for development and evaluation.

## Project Structure

```
.
├── docker-compose.yml           # Service orchestration (frontend + backend + redis)
├── backend/
│   ├── main.py                  # FastAPI entry point
│   ├── config.py                # Settings via Pydantic
│   ├── dependencies.py          # Auth middleware (X-API-Key)
│   ├── routers/
│   │   ├── cni.py               # CNI diagnostics (Calico CRDs, IPAM, BGP, Felix)
│   │   ├── network.py           # Pod discovery, topology
│   │   ├── threats.py           # Falco webhook + WebSocket
│   │   └── mock.py              # Mock fallback endpoints
│   ├── services/
│   │   ├── calico_service.py    # Calico CRD access (IPPool, BGP, IPAM, policies)
│   │   ├── felix_metrics_service.py # Felix PromQL via Prometheus
│   │   ├── network_service.py   # Pod & service discovery
│   │   ├── prometheus_service.py # PromQL query proxy
│   │   └── threat_service.py    # Redis pub/sub for Falco events
│   ├── models/
│   │   ├── cni_models.py        # CNI Pydantic schemas
│   │   ├── network.py           # Pod/topology models
│   │   ├── threat.py            # Falco event schema
│   │   └── mock_data.py         # Shared mock data (including CNI mocks)
│   ├── connection/              # K8s client factory (kubeconfig/token/in-cluster)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # CNI Command Center tab routing
│   │   ├── App.css              # Dark-theme styles + CNI panel styles
│   │   ├── Topology.tsx         # Cytoscape.js topology graph
│   │   ├── components/
│   │   │   ├── CniHealthPanel.tsx         # Per-node Felix/BIRD status cards
│   │   │   ├── IpamPanel.tsx              # IP pool utilization + block table
│   │   │   ├── PolicyInspectorPanel.tsx   # Searchable policy table
│   │   │   ├── PolicyCoveragePanel.tsx    # Per-pod policy coverage analysis
│   │   │   ├── CniTopologyPanel.tsx       # BGP mesh + overlay topology
│   │   │   ├── DiagnosticsPanel.tsx       # Connectivity test runner
│   │   │   ├── DashboardPanel.tsx         # CNI Command Center overview
│   │   │   ├── ThreatPanel.tsx            # Real-time threat stream
│   │   │   └── shared/ (DataSourceBadge, EmptyState, Icon, Skeleton, ErrorBoundary)
│   │   ├── types.ts             # TypeScript interfaces (+ CNI types)
│   │   └── utils.ts             # Utility functions (ns colors, priority colors, etc.)
│   ├── Topology.tsx             # Cytoscape.js interactive topology graph
│   ├── Topology.css             # Topology graph styles
│   ├── nginx.conf               # SPA reverse proxy config
│   ├── docker-entrypoint.sh     # Runtime env injection for nginx build
│   ├── Dockerfile               # Multi-stage build (Vite → nginx)
│   └── package.json
├── k8s/                          # K8s deployment manifests
│   ├── deploy-backend.yaml      # Backend deployment + service
│   ├── deploy-frontend.yaml     # Frontend deployment + service
│   ├── deploy-redis.yaml        # Redis deployment + service
│   ├── namespace.yaml
│   ├── sa.yaml                  # ServiceAccount
│   ├── clusterrole.yaml         # RBAC: Calico CRDs, pods, network policies
│   ├── clusterrolebinding.yaml
│   └── secret.yaml              # API key secret
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
- **All data sources fall back to mock data** — add mock data to `models/mock_data.py` to keep the dashboard functional without a live cluster

## License

Internal project.