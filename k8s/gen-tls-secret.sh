#!/usr/bin/env bash
# ── gen-tls-secret.sh ──────────────────────────────────────────────
# Generates a self-signed TLS certificate for the frontend nginx and
# creates the 'dashboard-tls' Secret in the current namespace.
#
# Usage:
#   chmod +x k8s/gen-tls-secret.sh
#   ./k8s/gen-tls-secret.sh                   # uses defaults
#   ./k8s/gen-tls-secret.sh dashboard.internal.example.com   # custom hostname
#
# For production, replace the self-signed cert with a real one from
# a trusted CA (e.g. Let's Encrypt via cert-manager).
# ──────────────────────────────────────────────────────────────────

set -euo pipefail

HOSTNAME="${1:-dashboard.local}"
NAMESPACE="${NAMESPACE:-k8s-dashboard}"
SECRET_NAME="dashboard-tls"
TMPDIR=$(mktemp -d)

echo "→ Generating self-signed TLS certificate for: ${HOSTNAME}"

# Generate CA key and cert
openssl req -x509 -nodes -new -sha256 \
  -days 3650 \
  -newkey rsa:2048 \
  -keyout "${TMPDIR}/ca.key" \
  -out "${TMPDIR}/ca.pem" \
  -subj "/O=Dashboard Local CA/CN=Dashboard Local CA"

# Generate device key
openssl req -nodes -new \
  -newkey rsa:2048 \
  -keyout "${TMPDIR}/tls.key" \
  -out "${TMPDIR}/cert.csr" \
  -subj "/O=Dashboard/CN=${HOSTNAME}"

# Write config for SAN
cat > "${TMPDIR}/cert.ext" << EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,nonRepudiation,keyEncipherment,dataEncipherment
subjectAltName=@alt_names

[alt_names]
DNS.1=${HOSTNAME}
DNS.2=localhost
EOF

# Sign the cert
openssl x509 -req -days 730 \
  -in "${TMPDIR}/cert.csr" \
  -CA "${TMPDIR}/ca.pem" \
  -CAkey "${TMPDIR}/ca.key" \
  -CAcreateserial \
  -extfile "${TMPDIR}/cert.ext" \
  -out "${TMPDIR}/tls.crt"

echo "→ Creating Kubernetes Secret '${SECRET_NAME}' in namespace '${NAMESPACE}'..."

kubectl create secret tls "${SECRET_NAME}" \
  --namespace="${NAMESPACE}" \
  --cert="${TMPDIR}/tls.crt" \
  --key="${TMPDIR}/tls.key" \
  --dry-run=client -o yaml \
  | kubectl apply -f -

# Clean up
rm -rf "${TMPDIR}"

echo "✔ Done! Secret '${SECRET_NAME}' is ready."
echo ""
echo "   The frontend deployment will automatically pick up the cert"
echo "   (the TLS volume mount references this secret). Restart pods"
echo "   if they were already running:"
echo ""
echo "     kubectl rollout restart deployment/dashboard-frontend -n ${NAMESPACE}"
