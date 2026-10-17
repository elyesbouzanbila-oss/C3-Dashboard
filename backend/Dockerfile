FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    netcat-openbsd \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# --retries/--timeout make the build resilient to flaky PyPI connections
RUN pip install --no-cache-dir --retries 10 --timeout 120 -r requirements.txt

# Create a non-root user for the backend (C3: do not run as root).
# Fixed UID/GID 1000 so the compose `user: "1000:1000"` override and the
# Kubernetes securityContext (runAsUser: 1000) match the file ownership.
RUN groupadd -r -g 1000 dashboard && useradd -r -u 1000 -g dashboard -d /app -s /sbin/nologin dashboard
# chown the app dir so the non-root user can read the code.
RUN chown -R dashboard:dashboard /app
USER dashboard

EXPOSE 8000
# --no-proxy-headers: never let uvicorn rewrite the client address from
# client-supplied X-Forwarded-For (it trusts 127.0.0.1 sources by default,
# which lets a localhost caller spoof the peer IP and reset rate limits).
# The app keys rate limits on nginx-set X-Real-IP or the true socket peer.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
