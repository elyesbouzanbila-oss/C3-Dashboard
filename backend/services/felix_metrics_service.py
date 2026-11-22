"""Felix metrics service — queries Prometheus for calico-node Felix metrics."""

from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta, timezone

from config import Settings
from services.prometheus_service import query_prometheus
from services.logging_service import get_logger

logger = get_logger(__name__)


# Gauges that report the same cluster-wide value on every calico-node; summing
# them multiplies the real number by the node count.
CLUSTER_WIDE_METRICS = {"cluster_network_policies"}


FELIX_METRICS_QUERIES = {
    "active_local_endpoints": "felix_active_local_endpoints",
    "cluster_network_policies": "felix_cluster_network_policies",
    "iptables_restore_errors": "felix_iptables_restore_errors",
    "bgp_sessions_active": "felix_bgp_sessions_active",
    "int_dataplane_failures": "felix_int_dataplane_failures",
}


async def get_felix_metrics(settings: Settings) -> Dict[str, Any]:
    """Fetch current Felix gauge metrics from Prometheus.

    Returns a dict mapping metric names to their scalar values.
    For any metric that fails or returns no data, the value is omitted.
    """
    result: Dict[str, Any] = {}

    for key, promql in FELIX_METRICS_QUERIES.items():
        try:
            data = await query_prometheus(settings, promql)
            if data and data.get("result"):
                # Expecting a vector result: [{ "metric": {...}, "value": [ts, val] }]
                values = []
                for r in data["result"]:
                    val = float(r.get("value", [0, 0])[1])
                    values.append(val)

                if values:
                    # Per-node gauges/counters add up; cluster-wide gauges repeat.
                    result[key] = max(values) if key in CLUSTER_WIDE_METRICS else sum(values)
            else:
                result[key] = None
        except Exception as e:
            logger.warning(f"Felix metric '{key}' query failed: {e}")
            result[key] = None

    return result


async def get_felix_metrics_time_series(
    settings: Settings,
    duration_minutes: int = 60,
) -> Dict[str, List[Dict[str, Any]]]:
    """Fetch Felix Prometheus metrics as time-series data.

    Returns a dict mapping metric names to lists of {timestamp, value} points.
    """
    from services.prometheus_service import query_range_prometheus

    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=duration_minutes)
    step = "30s"

    series: Dict[str, List[Dict[str, Any]]] = {}
    for key, promql in FELIX_METRICS_QUERIES.items():
        try:
            data = await query_range_prometheus(
                settings,
                promql,
                start=start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                end=end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                step=step,
            )
            if data and data.get("result"):
                points = []
                for r in data["result"]:
                    for ts_str, val_str in r.get("values", []):
                        points.append({
                            "timestamp": datetime.fromtimestamp(float(ts_str), tz=timezone.utc).isoformat().replace("+00:00", "Z"),
                            "value": float(val_str),
                        })
                series[key] = points
            else:
                series[key] = []
        except Exception as e:
            logger.warning(f"Felix time-series '{key}' query failed: {e}")
            series[key] = []

    return series
