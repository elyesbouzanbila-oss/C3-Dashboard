#!/usr/bin/env bash
# ── deploy.sh ──────────────────────────────────────────────────────
# Full deploy script for k8s-cluster-dashboard.
# Handles TLS automatically — uses cert-manager if available,
# falls back to self-signed cert if not.
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh                        # deploy with defaults
#   ./deploy.sh dashboard.internal.com # custom hostname
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

HOSTNAME="${1:-dashboard.local}"
NAMESPACE="${NAMESPACE:-k8s-dashboard}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Export so sub-scripts (gen-tls-secret.sh) inherit the namespace
export NAMESPACE

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  k8s-cluster-dashboard deploy"
echo "  Namespace : ${NAMESPACE}"
echo "  Hostname  : ${HOSTNAME}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Ensure namespace exists ─────────────────────────────────────
echo ""
echo "→ [1/4] Ensuring namespace '${NAMESPACE}' exists..."
kubectl apply -f "${SCRIPT_DIR}/k8s/namespace.yaml"

# ── 2. TLS setup ──────────────────────────────────────────────────
echo ""
echo "→ [2/4] Checking TLS setup..."

if kubectl get secret dashboard-tls -n "${NAMESPACE}" > /dev/null 2>&1; then
    echo "   ✔ Secret 'dashboard-tls' already exists, skipping TLS setup."

elif kubectl api-resources 2>/dev/null | grep -q "cert-manager.io"; then
    echo "   ✔ cert-manager detected."

    # Wait for cert-manager to be fully ready
    echo "   → Waiting for cert-manager to be ready..."
    kubectl wait --for=condition=ready pod \
        -l app.kubernetes.io/instance=cert-manager \
        -n cert-manager \
        --timeout=120s 2>/dev/null || echo "   ⚠ cert-manager pods not found — proceeding anyway."

    # Apply the Certificate + ClusterIssuer if the file exists
    if [ -f "${SCRIPT_DIR}/k8s/cert-issuer.yaml" ]; then
        kubectl apply -f "${SCRIPT_DIR}/k8s/cert-issuer.yaml"
        echo "   → Waiting for cert-manager to issue the certificate..."
        kubectl wait certificate/dashboard-tls \
            -n "${NAMESPACE}" \
            --for=condition=Ready \
            --timeout=60s && \
            echo "   ✔ Certificate issued successfully." || \
            echo "   ⚠ Certificate not ready yet — check: kubectl describe certificate/dashboard-tls -n ${NAMESPACE}"
    else
        echo "   ℹ cert-issuer.yaml not found — falling back to self-signed cert."
        echo "     (Create k8s/cert-issuer.yaml later for automatic certificate renewal)"
        "${SCRIPT_DIR}/k8s/gen-tls-secret.sh" "${HOSTNAME}"
    fi

else
    echo "   ℹ cert-manager not found — falling back to self-signed cert."
    echo "     (For production, install cert-manager for automatic renewal)"
    "${SCRIPT_DIR}/k8s/gen-tls-secret.sh" "${HOSTNAME}"
fi

# ── 3. Apply all manifests ─────────────────────────────────────────
echo ""
echo "→ [3/4] Applying Kubernetes manifests..."
kubectl apply -k "${SCRIPT_DIR}/k8s/"

# ── 4. Wait for rollout ────────────────────────────────────────────
echo ""
echo "→ [4/4] Waiting for deployments to roll out..."

deployments=("dashboard-frontend" "dashboard-backend" "dashboard-redis")
for dep in "${deployments[@]}"; do
    echo "   → Waiting for ${dep}..."
    kubectl rollout status deployment/"${dep}" \
        -n "${NAMESPACE}" \
        --timeout=120s && \
        echo "   ✔ ${dep} is ready." || \
        echo "   ✘ ${dep} failed to roll out — check: kubectl logs -n ${NAMESPACE} deploy/${dep}"
done

# ── Summary ────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deploy complete!"
echo ""
echo "  Pods:"
kubectl get pods -n "${NAMESPACE}"
echo ""
echo "  Access:"
FRONTEND_PORT=$(kubectl get svc dashboard-frontend -n "${NAMESPACE}" \
    -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null || echo "unknown")
echo "  https://<node-ip>:${FRONTEND_PORT}"
echo ""
echo "  If using self-signed cert, your browser will warn —"
echo "  this is expected for internal clusters."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
