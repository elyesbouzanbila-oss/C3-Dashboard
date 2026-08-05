FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    netcat-openbsd \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# --retries/--timeout make the build resilient to flaky PyPI connections
RUN pip install --no-cache-dir --retries 10 --timeout 120 -r requirements.txt

COPY . .

EXPOSE 8000
# --no-proxy-headers: never let uvicorn rewrite the client address from
# client-supplied X-Forwarded-For (it trusts 127.0.0.1 sources by default,
# which lets a localhost caller spoof the peer IP and reset rate limits).
# The app keys rate limits on nginx-set X-Real-IP or the true socket peer.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
