"""Shared mock cluster data for all routers — single source of truth."""

MOCK_NAMESPACES = [
    {"name": "default", "status": "Active", "labels": {"kubernetes.io/metadata.name": "default"}},
    {"name": "kube-system", "status": "Active", "labels": {"kubernetes.io/metadata.name": "kube-system"}},
    {"name": "kube-public", "status": "Active", "labels": {"kubernetes.io/metadata.name": "kube-public"}},
    {"name": "kube-node-lease", "status": "Active", "labels": {"kubernetes.io/metadata.name": "kube-node-lease"}},
    {"name": "production", "status": "Active", "labels": {"kubernetes.io/metadata.name": "production"}},
    {"name": "monitoring", "status": "Active", "labels": {"kubernetes.io/metadata.name": "monitoring"}},
]


MOCK_NODES = [
    {
        "name": "master-1",
        "role": "master",
        "ip": "192.168.1.10",
        "kubelet_version": "v1.28.2",
        "os_image": "Ubuntu 22.04 LTS",
        "capacity": {"cpu": "4", "memory": "16Gi"},
        "ready": True
    },
    {
        "name": "worker-1",
        "role": "worker",
        "ip": "192.168.1.20",
        "kubelet_version": "v1.28.2",
        "os_image": "Ubuntu 22.04 LTS",
        "capacity": {"cpu": "8", "memory": "32Gi"},
        "ready": True
    },
    {
        "name": "worker-2",
        "role": "worker",
        "ip": "192.168.1.21",
        "kubelet_version": "v1.28.2",
        "os_image": "Ubuntu 22.04 LTS",
        "capacity": {"cpu": "8", "memory": "32Gi"},
        "ready": False
    }
]

MOCK_PODS = [
    {
        "name": "kube-apiserver",
        "namespace": "kube-system",
        "pod_ip": "10.244.0.10",
        "node_name": "master-1",
        "phase": "Running",
        "labels": {"app": "kube-apiserver", "component": "control-plane"},
        "containers": [
            {
                "name": "kube-apiserver",
                "image": "registry.k8s.io/kube-apiserver:v1.28.2",
                "ports": [{"containerPort": 6443, "protocol": "TCP", "name": "https"}]
            }
        ]
    },
    {
        "name": "kube-scheduler",
        "namespace": "kube-system",
        "pod_ip": "10.244.0.11",
        "node_name": "master-1",
        "phase": "Running",
        "labels": {"app": "kube-scheduler", "component": "control-plane"},
        "containers": [
            {
                "name": "kube-scheduler",
                "image": "registry.k8s.io/kube-scheduler:v1.28.2",
                "ports": [{"containerPort": 10259, "protocol": "TCP", "name": "https"}]
            }
        ]
    },
    {
        "name": "etcd-operator",
        "namespace": "kube-system",
        "pod_ip": "10.244.0.12",
        "node_name": "master-1",
        "phase": "Running",
        "labels": {"app": "etcd", "component": "control-plane"},
        "containers": [
            {
                "name": "etcd",
                "image": "registry.k8s.io/etcd:3.5.9",
                "ports": [
                    {"containerPort": 2379, "protocol": "TCP", "name": "client"},
                    {"containerPort": 2380, "protocol": "TCP", "name": "peer"}
                ]
            }
        ]
    },
    {
        "name": "coredns-7d5c8f5d6f-abc12",
        "namespace": "kube-system",
        "pod_ip": "10.244.0.13",
        "node_name": "master-1",
        "phase": "Running",
        "labels": {"app": "coredns", "k8s-app": "kube-dns"},
        "containers": [
            {
                "name": "coredns",
                "image": "registry.k8s.io/coredns:v1.10.1",
                "ports": [
                    {"containerPort": 53, "protocol": "UDP", "name": "dns-udp"},
                    {"containerPort": 53, "protocol": "TCP", "name": "dns-tcp"},
                    {"containerPort": 9153, "protocol": "TCP", "name": "metrics"}
                ]
            }
        ]
    },
    {
        "name": "api-server-prod-1",
        "namespace": "production",
        "pod_ip": "10.244.1.10",
        "node_name": "worker-1",
        "phase": "Running",
        "labels": {"app": "api-server", "version": "v2.1.0"},
        "containers": [
            {
                "name": "main",
                "image": "myapp:v2.1.0",
                "ports": [{"containerPort": 8080, "protocol": "TCP", "name": "http"}]
            },
            {
                "name": "sidecar",
                "image": "envoyproxy:latest",
                "ports": [{"containerPort": 9901, "protocol": "TCP", "name": "admin"}]
            }
        ]
    },
    {
        "name": "redis-cache",
        "namespace": "production",
        "pod_ip": "10.244.1.20",
        "node_name": "worker-1",
        "phase": "Running",
        "labels": {"app": "redis"},
        "containers": [
            {
                "name": "redis",
                "image": "redis:7-alpine",
                "ports": [{"containerPort": 6379, "protocol": "TCP", "name": "redis"}]
            }
        ]
    },
    {
        "name": "database-backup",
        "namespace": "production",
        "pod_ip": "10.244.2.15",
        "node_name": "worker-2",
        "phase": "Running",
        "labels": {"app": "database", "job": "backup"},
        "containers": [
            {
                "name": "postgres-backup",
                "image": "postgres:15",
                "ports": [{"containerPort": 5432, "protocol": "TCP", "name": "postgresql"}]
            }
        ]
    },
    {
        "name": "prometheus-0",
        "namespace": "monitoring",
        "pod_ip": "10.244.2.20",
        "node_name": "worker-2",
        "phase": "Running",
        "labels": {"app": "prometheus"},
        "containers": [
            {
                "name": "prometheus",
                "image": "prom/prometheus:latest",
                "ports": [{"containerPort": 9090, "protocol": "TCP", "name": "http"}]
            }
        ]
    }
]

MOCK_SERVICES = [
    {
        "namespace": "kube-system", "name": "kube-dns", "cluster_ip": "10.100.0.10",
        "selector": {"k8s-app": "kube-dns"},
        "ports": [
            {"port": 53, "protocol": "UDP", "name": "dns-udp", "targetPort": 53},
            {"port": 53, "protocol": "TCP", "name": "dns-tcp", "targetPort": 53},
            {"port": 9153, "protocol": "TCP", "name": "metrics", "targetPort": 9153}
        ]
    },
    {
        "namespace": "production", "name": "api-service", "cluster_ip": "10.100.1.1",
        "selector": {"app": "api-server"},
        "ports": [
            {"port": 80, "protocol": "TCP", "name": "http", "targetPort": 8080}
        ]
    },
    {
        "namespace": "production", "name": "database-service", "cluster_ip": "10.100.1.2",
        "selector": {"app": "database"},
        "ports": [
            {"port": 5432, "protocol": "TCP", "name": "postgresql", "targetPort": 5432}
        ]
    },
    {
        "namespace": "monitoring", "name": "prometheus", "cluster_ip": "10.100.2.1",
        "selector": {"app": "prometheus"},
        "ports": [
            {"port": 9090, "protocol": "TCP", "name": "http", "targetPort": 9090}
        ]
    }
]

MOCK_RBAC = [
    {
        "name": "admin-binding",
        "namespace": None,
        "binding_type": "ClusterRoleBinding",
        "role_ref": {"kind": "ClusterRole", "name": "cluster-admin", "api_group": "rbac.authorization.k8s.io"},
        "subjects": [{"kind": "User", "name": "admin@example.com", "namespace": None}]
    },
    {
        "name": "developers-edit",
        "namespace": "production",
        "binding_type": "RoleBinding",
        "role_ref": {"kind": "Role", "name": "editor", "api_group": "rbac.authorization.k8s.io"},
        "subjects": [{"kind": "Group", "name": "developers", "namespace": None}]
    },
    {
        "name": "monitoring-viewer",
        "namespace": "monitoring",
        "binding_type": "RoleBinding",
        "role_ref": {"kind": "Role", "name": "viewer", "api_group": "rbac.authorization.k8s.io"},
        "subjects": [{"kind": "ServiceAccount", "name": "prometheus", "namespace": "monitoring"}]
    }
]

MOCK_PRIVILEGED = [
    {
        "name": "prometheus-0",
        "namespace": "monitoring",
        "container": "prometheus",
        "image": "prom/prometheus:latest",
        "privileged": False,
        "run_as_user": None
    }
]


MOCK_POD_METRICS = [
    {
        "namespace": "kube-system",
        "name": "kube-apiserver",
        "node": "master-1",
        "containers": [
            {
                "name": "kube-apiserver",
                "image": "registry.k8s.io/kube-apiserver:v1.28.2",
                "cpu": {"usage": "120m", "request": "250m", "limit": "500m"},
                "memory": {"usage": "384Mi", "request": "512Mi", "limit": "1Gi"}
            }
        ],
        "pod_cpu_usage": "120m",
        "pod_memory_usage": "384Mi"
    },
    {
        "namespace": "kube-system",
        "name": "kube-scheduler",
        "node": "master-1",
        "containers": [
            {
                "name": "kube-scheduler",
                "image": "registry.k8s.io/kube-scheduler:v1.28.2",
                "cpu": {"usage": "25m", "request": "100m", "limit": "200m"},
                "memory": {"usage": "64Mi", "request": "128Mi", "limit": "256Mi"}
            }
        ],
        "pod_cpu_usage": "25m",
        "pod_memory_usage": "64Mi"
    },
    {
        "namespace": "kube-system",
        "name": "etcd-operator",
        "node": "master-1",
        "containers": [
            {
                "name": "etcd",
                "image": "registry.k8s.io/etcd:3.5.9",
                "cpu": {"usage": "40m", "request": "100m", "limit": "300m"},
                "memory": {"usage": "128Mi", "request": "256Mi", "limit": "512Mi"}
            }
        ],
        "pod_cpu_usage": "40m",
        "pod_memory_usage": "128Mi"
    },
    {
        "namespace": "kube-system",
        "name": "coredns-7d5c8f5d6f-abc12",
        "node": "master-1",
        "containers": [
            {
                "name": "coredns",
                "image": "registry.k8s.io/coredns:v1.10.1",
                "cpu": {"usage": "8m", "request": "50m", "limit": "100m"},
                "memory": {"usage": "24Mi", "request": "64Mi", "limit": "128Mi"}
            }
        ],
        "pod_cpu_usage": "8m",
        "pod_memory_usage": "24Mi"
    },
    {
        "namespace": "production",
        "name": "api-server-prod-1",
        "node": "worker-1",
        "containers": [
            {
                "name": "main",
                "image": "myapp:v2.1.0",
                "cpu": {"usage": "150m", "request": "200m", "limit": "500m"},
                "memory": {"usage": "256Mi", "request": "512Mi", "limit": "1Gi"}
            },
            {
                "name": "sidecar",
                "image": "envoyproxy:latest",
                "cpu": {"usage": "30m", "request": "100m", "limit": "200m"},
                "memory": {"usage": "48Mi", "request": "128Mi", "limit": "256Mi"}
            }
        ],
        "pod_cpu_usage": "180m",
        "pod_memory_usage": "304Mi"
    },
    {
        "namespace": "production",
        "name": "redis-cache",
        "node": "worker-1",
        "containers": [
            {
                "name": "redis",
                "image": "redis:7-alpine",
                "cpu": {"usage": "15m", "request": "50m", "limit": "100m"},
                "memory": {"usage": "8Mi", "request": "32Mi", "limit": "64Mi"}
            }
        ],
        "pod_cpu_usage": "15m",
        "pod_memory_usage": "8Mi"
    },
    {
        "namespace": "production",
        "name": "database-backup",
        "node": "worker-2",
        "containers": [
            {
                "name": "postgres-backup",
                "image": "postgres:15",
                "cpu": {"usage": "85m", "request": "100m", "limit": "250m"},
                "memory": {"usage": "192Mi", "request": "256Mi", "limit": "512Mi"}
            }
        ],
        "pod_cpu_usage": "85m",
        "pod_memory_usage": "192Mi"
    },
    {
        "namespace": "monitoring",
        "name": "prometheus-0",
        "node": "worker-2",
        "containers": [
            {
                "name": "prometheus",
                "image": "prom/prometheus:latest",
                "cpu": {"usage": "210m", "request": "300m", "limit": "1"},
                "memory": {"usage": "512Mi", "request": "1Gi", "limit": "2Gi"}
            }
        ],
        "pod_cpu_usage": "210m",
        "pod_memory_usage": "512Mi"
    }
]


# ─── CNI (Calico) Mock Data ─────────────────────────────────────────────

MOCK_CALICO_NODES = [
    {
        "node": "master-1",
        "felix_ready": True,
        "bird_ready": True,
        "ip": "192.168.1.10",
        "uptime_seconds": 86400 * 14,  # 14 days
        "last_reported": "2025-07-03T12:00:00Z"
    },
    {
        "node": "worker-1",
        "felix_ready": True,
        "bird_ready": True,
        "ip": "192.168.1.20",
        "uptime_seconds": 86400 * 7,
        "last_reported": "2025-07-03T12:00:00Z"
    },
    {
        "node": "worker-2",
        "felix_ready": False,
        "bird_ready": False,
        "ip": "192.168.1.21",
        "uptime_seconds": 3600 * 3,  # 3 hours
        "last_reported": "2025-07-03T09:00:00Z"
    }
]

MOCK_BGP_PEERS = [
    {
        "name": "bgppeer-global-64512",
        "node": None,
        "peer_ip": "10.0.0.1",
        "peer_as_number": 64512,
        "node_as_number": 64513,
        "session_state": "up"
    },
    {
        "name": "bgppeer-worker-1-to-spine",
        "node": "worker-1",
        "peer_ip": "10.0.0.2",
        "peer_as_number": 64512,
        "node_as_number": 64513,
        "session_state": "up"
    },
    {
        "name": "bgppeer-worker-2-to-spine",
        "node": "worker-2",
        "peer_ip": "10.0.0.3",
        "peer_as_number": 64512,
        "node_as_number": 64513,
        "session_state": "down"
    }
]

MOCK_IP_POOLS = [
    {
        "name": "default-ipv4-ippool",
        "cidr": "10.244.0.0/16",
        "nat_outgoing": True,
        "disabled": False,
        "mode": "vxlan",
        "node_selector": "all()"
    },
    {
        "name": "infra-pool",
        "cidr": "10.245.0.0/24",
        "nat_outgoing": False,
        "disabled": False,
        "mode": "ipip",
        "node_selector": "has(role-infra)"
    }
]

MOCK_IPAM_BLOCKS = [
    {
        "pool": "default-ipv4-ippool",
        "blocks": 3,
        "allocated": 24,
        "total": 256,
        "utilization_pct": 9.4
    },
    {
        "pool": "infra-pool",
        "blocks": 1,
        "allocated": 2,
        "total": 256,
        "utilization_pct": 0.8
    }
]

MOCK_CNI_POLICIES = [
    {
        "name": "default-deny",
        "namespace": None,
        "type": "GlobalNetworkPolicy",
        "policy_type": ["Ingress", "Egress"],
        "selector": "all()",
        "order": 1000.0,
        "rules_count": 2,
        "rule_actions": ["Deny"]
    },
    {
        "name": "allow-kube-dns",
        "namespace": None,
        "type": "GlobalNetworkPolicy",
        "policy_type": ["Egress"],
        "selector": "all()",
        "order": 900.0,
        "rules_count": 1,
        "rule_actions": ["Allow"]
    },
    {
        "name": "allow-frontend-ingress",
        "namespace": "production",
        "type": "NetworkPolicy",
        "policy_type": ["Ingress"],
        "selector": "app == 'frontend'",
        "order": 500.0,
        "rules_count": 3,
        "rule_actions": ["Allow"]
    },
    {
        "name": "allow-monitoring-scrape",
        "namespace": "monitoring",
        "type": "NetworkPolicy",
        "policy_type": ["Ingress"],
        "selector": "app == 'prometheus'",
        "order": 400.0,
        "rules_count": 1,
        "rule_actions": ["Allow"]
    }
]

MOCK_FELIX_METRICS = {
    "active_local_endpoints": 14,
    "cluster_network_policies": 2,
    "iptables_restore_errors": 0,
    "bgp_sessions_active": 2,
    "int_dataplane_failures": 0
}

# ─── Policy Coverage Mock Data ────────────────────────────────────────
# Pre-computed coverage for demo purposes. Matches MOCK_PODS against
# MOCK_CNI_POLICIES using calico_selector_matches.
# Pods with no specific policy (non-"all()") selecting them are "exposed".
MOCK_COVERAGE = [
    {
        "pod_name": "kube-apiserver",
        "namespace": "kube-system",
        "labels": {"app": "kube-apiserver", "component": "control-plane"},
        "selecting_policies": ["default-deny", "allow-kube-dns"],
        "exposed": False,
    },
    {
        "pod_name": "kube-scheduler",
        "namespace": "kube-system",
        "labels": {"app": "kube-scheduler", "component": "control-plane"},
        "selecting_policies": ["default-deny", "allow-kube-dns"],
        "exposed": False,
    },
    {
        "pod_name": "etcd-operator",
        "namespace": "kube-system",
        "labels": {"app": "etcd", "component": "control-plane"},
        "selecting_policies": ["default-deny", "allow-kube-dns"],
        "exposed": False,
    },
    {
        "pod_name": "coredns-7d5c8f5d6f-abc12",
        "namespace": "kube-system",
        "labels": {"app": "coredns", "k8s-app": "kube-dns"},
        "selecting_policies": ["default-deny", "allow-kube-dns"],
        "exposed": False,
    },
    {
        "pod_name": "api-server-prod-1",
        "namespace": "production",
        "labels": {"app": "api-server", "version": "v2.1.0"},
        "selecting_policies": ["default-deny", "allow-kube-dns"],
        "exposed": False,
    },
    {
        "pod_name": "redis-cache",
        "namespace": "production",
        "labels": {"app": "redis"},
        "selecting_policies": ["default-deny", "allow-kube-dns"],
        "exposed": False,
    },
    {
        "pod_name": "database-backup",
        "namespace": "production",
        "labels": {"app": "database", "job": "backup"},
        "selecting_policies": ["default-deny", "allow-kube-dns"],
        "exposed": False,
    },
    {
        "pod_name": "prometheus-0",
        "namespace": "monitoring",
        "labels": {"app": "prometheus"},
        "selecting_policies": ["default-deny", "allow-kube-dns", "allow-monitoring-scrape"],
        "exposed": False,
    },
    {
        "pod_name": "nginx-frontend-7d8",
        "namespace": "production",
        "labels": {"app": "frontend"},
        "selecting_policies": ["default-deny", "allow-kube-dns", "allow-frontend-ingress"],
        "exposed": False,
    },
    {
        "pod_name": "unpatched-sidecar",
        "namespace": "production",
        "labels": {"app": "legacy", "tier": "cache"},
        "selecting_policies": [],
        "exposed": True,
    },
    {
        "pod_name": "experimental-worker",
        "namespace": "default",
        "labels": {"app": "sandbox", "owner": "dev"},
        "selecting_policies": [],
        "exposed": True,
    },
]

def build_mock_topology():
    """Build mock topology dict from shared mock data."""
    nodes = []
    for n in MOCK_NODES:
        nodes.append({
            "id": f"node:{n['name']}",
            "type": "node",
            "name": n["name"],
            "role": n["role"],
            "ip": n["ip"],
            "kubelet_version": n.get("kubelet_version"),
            "os_image": n.get("os_image"),
            "capacity": n.get("capacity"),
            "ready": n.get("ready", True)
        })

    services_data = []
    for svc in MOCK_SERVICES:
        svc_id = f"svc:{svc['namespace']}/{svc['name']}"
        # Format service ports for display
        svc_ports = []
        for p in svc.get("ports", []):
            port_str = f"{p['port']}/{p.get('protocol', 'TCP')}"
            if p.get('targetPort') and p['targetPort'] != p['port']:
                port_str = f"{p['port']}:{p['targetPort']}/{p.get('protocol', 'TCP')}"
            if p.get('name'):
                port_str = f"{p['name']}:{port_str}"
            svc_ports.append(port_str)
        nodes.append({
            "id": svc_id,
            "type": "service",
            "namespace": svc["namespace"],
            "name": svc["name"],
            "ip": svc.get("cluster_ip"),
            "ports": ", ".join(svc_ports) if svc_ports else None
        })
        services_data.append({
            "id": svc_id,
            "namespace": svc["namespace"],
            "selector": svc.get("selector", {})
        })

    pods_data = []
    for pod in MOCK_PODS:
        pod_id = f"pod:{pod['namespace']}/{pod['name']}"
        # Collect all container ports for this pod
        pod_ports = []
        for c in pod.get("containers", []):
            for p in c.get("ports", []):
                port_str = f"{p['containerPort']}/{p.get('protocol', 'TCP')}"
                if p.get('name'):
                    port_str = f"{p['name']}:{port_str}"
                pod_ports.append(port_str)
        nodes.append({
            "id": pod_id,
            "type": "pod",
            "namespace": pod["namespace"],
            "name": pod["name"],
            "ip": pod["pod_ip"],
            "node_name": pod["node_name"],
            "ports": ", ".join(pod_ports) if pod_ports else None
        })
        pods_data.append({
            "id": pod_id,
            "namespace": pod["namespace"],
            "labels": pod.get("labels", {}),
            "node_name": pod["node_name"]
        })

    from services.utils import label_selector_matches

    edges = []
    for svc in services_data:
        for pod in pods_data:
            if pod["namespace"] == svc["namespace"] and label_selector_matches(pod["labels"], svc["selector"]):
                edges.append({
                    "id": f"{pod['id']}-to-{svc['id']}",
                    "source": pod["id"],
                    "target": svc["id"]
                })

    return {"nodes": nodes, "edges": edges}
