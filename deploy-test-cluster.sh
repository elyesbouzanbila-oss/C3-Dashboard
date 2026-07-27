#!/usr/bin/env bash
# ── deploy-test-cluster.sh ──────────────────────────────────────
# Builds on workernode1 (avoids masternode VirtualBox TLS corruption),
# ships images to all nodes, and rolls out updates.
# ────────────────────────────────────────────────────────────────
set -euo pipefail

WORKER="workernode1"
WORKER_USER="vboxuser"
NAMESPACE="k8s-dashboard"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  k8s-cluster-dashboard deploy"
echo "  Building on: ${WORKER}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 0. Verify Docker is available on the worker ──────────────────
echo ""
echo "→ [0/6] Checking Docker on ${WORKER}..."
ssh "${WORKER_USER}@${WORKER}" "docker info >/dev/null 2>&1" || {
  echo "✘ Docker not available on ${WORKER}. Install Docker first."
  exit 1
}

# ── 1. Pull latest code on ALL nodes ─────────────────────────────
echo ""
echo "→ [1/6] Pulling latest code..."
git pull
for N in workernode1 workernode2; do
  echo "   → Pulling on ${N}..."
  ssh "${WORKER_USER}@${N}" "cd ~/k8s-cluster-dashboard && git pull"
done

# ── 2. Ensure K8s secrets exist ──────────────────────────────────
echo ""
echo "→ [2/6] Ensuring K8s secrets..."
kubectl create secret generic dashboard-api-key \
  --namespace "${NAMESPACE}" \
  --from-literal=api-key='your-secret-key' \
  --dry-run=client -o yaml | kubectl apply -f -

# ── 3. Build images on the worker node ───────────────────────────
echo ""
echo "→ [3/6] Building images on ${WORKER}..."
ssh -t "${WORKER_USER}@${WORKER}" \
  "cd ~/k8s-cluster-dashboard && \
   docker build --no-cache -t dashboard-frontend:latest ./frontend && \
   docker build --no-cache -t dashboard-backend:latest ./backend"

# ── 4. Save & transfer images to all other nodes ─────────────────
echo ""
echo "→ [4/6] Saving images on ${WORKER}..."
ssh "${WORKER_USER}@${WORKER}" \
  "docker save dashboard-frontend:latest | gzip > /tmp/frontend.tar.gz && \
   docker save dashboard-backend:latest | gzip > /tmp/backend.tar.gz"

for N in workernode1 workernode2; do
  echo "   → Transferring to ${N}..."
  for TAG in frontend backend; do
    scp "${WORKER_USER}@${WORKER}:/tmp/${TAG}.tar.gz" "${WORKER_USER}@${N}:/tmp/"
  done
  echo "   → Importing into containerd on ${N}..."
  ssh -t "${WORKER_USER}@${N}" \
    "gunzip -c /tmp/frontend.tar.gz | sudo ctr -n k8s.io images import - && \
     gunzip -c /tmp/backend.tar.gz | sudo ctr -n k8s.io images import -"
done

# ── 5. Apply updated manifests ──────────────────────────────────
echo ""
echo "→ [5/6] Applying manifests..."
kubectl apply -k k8s/

# ── 6. Roll pods to use the new images ───────────────────────────
echo ""
echo "→ [6/6] Rolling pods..."
kubectl rollout restart deployment/dashboard-frontend -n "${NAMESPACE}"
kubectl rollout restart deployment/dashboard-backend -n "${NAMESPACE}"
kubectl rollout status deployment/dashboard-frontend -n "${NAMESPACE}" --timeout=120s
kubectl rollout status deployment/dashboard-backend -n "${NAMESPACE}" --timeout=120s

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Done! Watch pods: kubectl get pods -n ${NAMESPACE} -w"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
