from fastapi import APIRouter, Depends
from typing import List, Dict, Any

from connection.models import ConnectionConfig
from dependencies import get_k8s_client, get_connection_config, fallback_response
from models.mock_data import MOCK_PODS as _MOCK_PODS, build_mock_topology
from services.logging_service import get_logger

logger = get_logger(__name__)

router = APIRouter()

MOCK_PODS = _MOCK_PODS


@router.get("/pods")
async def list_pods(
	connection: ConnectionConfig = Depends(get_connection_config),
	api_client=Depends(get_k8s_client),
) -> Dict[str, Any]:
	"""Return a lightweight list of pods across namespaces."""
	try:
		from kubernetes_asyncio import client as k8s_client

		v1 = k8s_client.CoreV1Api(api_client)
		pods = await v1.list_pod_for_all_namespaces(watch=False)

		items: List[Dict[str, Any]] = []
		for p in pods.items:
			items.append(
				{
					"name": p.metadata.name,
					"namespace": p.metadata.namespace,
					"pod_ip": getattr(p.status, "pod_ip", None),
					"node_name": getattr(p.spec, "node_name", None),
					"phase": getattr(p.status, "phase", None),
					"labels": p.metadata.labels or {},
					"containers": [
						{
							"name": c.name,
							"image": c.image,
							"ports": [
								{
									"containerPort": cp.container_port,
									"protocol": cp.protocol or "TCP",
									"name": cp.name,
								}
								for cp in (c.ports or [])
							] if c.ports else None,
						} for c in (p.spec.containers or [])
					],
				}
			)

		return {"status": "success", "items": items}
	except Exception as e:
		# Fabricated data only in opt-in demo mode; otherwise surface the error.
		logger.warning(f"K8s connection failed: {e}")
		return fallback_response(
			{"status": "mock", "items": MOCK_PODS},
			{"status": "error", "items": [], "error": str(e)},
		)

from services.utils import label_selector_matches


@router.get("/topology")
async def get_topology(
	connection: ConnectionConfig = Depends(get_connection_config), api_client=Depends(get_k8s_client)
):
	"""Return topology with cluster nodes (master + worker), pods, services, and smart edges."""
	try:
		from kubernetes_asyncio import client as k8s_client

		v1 = k8s_client.CoreV1Api(api_client)
		svc_list = await v1.list_service_for_all_namespaces()
		pod_list = await v1.list_pod_for_all_namespaces()
		node_list = await v1.list_node()

		nodes = []
		services_data = []

		# Add cluster nodes (master + workers) with their network info
		node_name_to_role = {}
		for n in node_list.items:
			name = n.metadata.name
			# Determine role from labels
			labels = n.metadata.labels or {}
			role = "worker"
			if labels.get("node-role.kubernetes.io/control-plane") == "" or \
			   labels.get("node-role.kubernetes.io/master") == "":
				role = "master"
			node_name_to_role[name] = role

			# Get internal IP
			ip = None
			for addr in n.status.addresses or []:
				if addr.type == "InternalIP":
					ip = addr.address
					break

			# Determine if node is ready
			ready = True
			for condition in n.status.conditions or []:
				if condition.type == "Ready":
					ready = condition.status == "True"
					break

			nodes.append({
				"id": f"node:{name}",
				"type": "node",
				"name": name,
				"role": role,
				"ip": ip,
				"ready": ready,
				"capacity": {
					"cpu": str(n.status.capacity.get("cpu", "")),
					"memory": str(n.status.capacity.get("memory", ""))
				} if n.status.capacity else None
			})

		# Add services
		for s in svc_list.items:
			if s.metadata.namespace == "default" and s.metadata.name == "kubernetes":
				continue

			service_id = f"svc:{s.metadata.namespace}/{s.metadata.name}"
			# Format service ports
			svc_ports_str = None
			if s.spec.ports:
				port_strs = []
				for p in s.spec.ports:
					proto = p.protocol or "TCP"
					if p.target_port and p.target_port != p.port:
						if p.name:
							port_strs.append(f"{p.name}:{p.port}:{p.target_port}/{proto}")
						else:
							port_strs.append(f"{p.port}:{p.target_port}/{proto}")
					else:
						if p.name:
							port_strs.append(f"{p.name}:{p.port}/{proto}")
						else:
							port_strs.append(f"{p.port}/{proto}")
				if port_strs:
					svc_ports_str = ", ".join(port_strs)

			nodes.append({
				"id": service_id,
				"type": "service",
				"namespace": s.metadata.namespace,
				"name": s.metadata.name,
				"ip": s.spec.cluster_ip if s.spec.cluster_ip and s.spec.cluster_ip != "None" else None,
				"ports": svc_ports_str,
			})
			services_data.append({
				"id": service_id,
				"namespace": s.metadata.namespace,
				"selector": s.spec.selector or {}
			})

		# Add pods
		pods_data = []
		for p in pod_list.items:
			pod_id = f"pod:{p.metadata.namespace}/{p.metadata.name}"
			node_name = getattr(p.spec, "node_name", None)
			# Collect container ports
			pod_ports_str = None
			ports_list = []
			for c in (p.spec.containers or []):
				if c.ports:
					for cp in c.ports:
						proto = cp.protocol or "TCP"
						if cp.name:
							ports_list.append(f"{cp.name}:{cp.container_port}/{proto}")
						else:
							ports_list.append(f"{cp.container_port}/{proto}")
			if ports_list:
				pod_ports_str = ", ".join(ports_list)

			nodes.append({
				"id": pod_id,
				"type": "pod",
				"namespace": p.metadata.namespace,
				"name": p.metadata.name,
				"ip": getattr(p.status, "pod_ip", None),
				"labels": p.metadata.labels or {},
				"node_name": node_name,
				"ports": pod_ports_str,
			})
			pods_data.append({
				"id": pod_id,
				"namespace": p.metadata.namespace,
				"labels": p.metadata.labels or {},
				"node_name": node_name
			})

		# Build edges: connect pods to services based on label matching
		edges = []
		for svc in services_data:
			for pod in pods_data:
				if pod["namespace"] == svc["namespace"] and label_selector_matches(pod["labels"], svc["selector"]):
					edges.append({
						"id": f"{pod['id']}-to-{svc['id']}",
						"source": pod["id"],
						"target": svc["id"]
					})

		return {"status": "success", "nodes": nodes, "edges": edges}
	except Exception as e:
		# Fabricated data only in opt-in demo mode; otherwise surface the error.
		logger.warning(f"K8s connection failed: {e}")
		mock = build_mock_topology()
		return fallback_response(
			{"status": "mock", "nodes": mock["nodes"], "edges": mock["edges"]},
			{"status": "error", "nodes": [], "edges": [], "error": str(e)},
		)
