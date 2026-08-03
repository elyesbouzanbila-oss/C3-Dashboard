export interface ContainerPort {
  containerPort: number
  protocol?: string
  name?: string
}

export interface ServicePort {
  port: number
  targetPort?: number
  protocol?: string
  name?: string
  nodePort?: number
}

export interface Pod {
  name: string
  namespace: string
  pod_ip: string
  node_name: string
  phase: string
  labels: Record<string, string>
  containers: Array<{ name: string; image: string; ports?: ContainerPort[] | null }>
}

export interface TopologyNode {
  id: string
  type: 'pod' | 'service' | 'node'
  namespace?: string
  name: string
  ip?: string
  labels?: Record<string, string>
  node_name?: string
  role?: 'master' | 'worker'
  capacity?: Record<string, string>
  ready?: boolean
  ports?: string | null
}

export interface TopologyEdge {
  id: string
  source: string
  target: string
  label?: string
}

export interface ThreatEvent {
  id: string
  priority: 'Critical' | 'High' | 'Medium' | 'Warning'
  rule: string
  output: string
  time: string
}

export interface RbacBinding {
  name: string
  namespace?: string
  binding_type: string
  role_ref: { kind: string; name: string; api_group: string }
  subjects: Array<{ kind: string; name: string; namespace?: string }>
}

export interface PrivilegedPod {
  name: string
  namespace: string
  container: string
  image: string
  privileged: boolean
  run_as_user?: number
}

export interface NodeMetric {
  name: string
  os: string
  kubeletVersion: string
  capacity: { cpu: string; memory: string }
  usage: { cpu: string; memory: string }
}

export interface ContainerMetric {
  name: string
  image: string
  cpu: {
    usage: string
    request?: string
    limit?: string
  }
  memory: {
    usage: string
    request?: string
    limit?: string
  }
}

export interface PodMetric {
  namespace: string
  name: string
  node: string
  containers: ContainerMetric[]
  pod_cpu_usage: string
  pod_memory_usage: string
}

export interface StorageClass {
  metadata: { name: string; annotations?: Record<string, string> }
  provisioner: string
}

export interface PVC {
  metadata: { uid: string; name: string; namespace: string }
  status: { phase: string }
  spec: { resources: { requests: { storage: string } } }
}

export interface StorageData {
  storageClasses: StorageClass[]
  persistentVolumeClaims: PVC[]
}

export interface PromSeriesPoint {
  timestamp: number  // Unix seconds
  value: number
}

export interface PromSeries {
  label: string         // container name or pod name
  values: PromSeriesPoint[]
}

export interface PrometheusResponse {
  status: 'success' | 'mock' | 'error'
  data: {
    resultType: string
    result: Array<{
      metric: Record<string, string>
      values: Array<[number, string]>
    }>
  } | null
}

export type DataSourceStatus = 'live' | 'mock' | 'error' | 'unknown'

export interface MetricsResponse<T> {
  status: 'success' | 'mock' | 'error'
  data: T
}

// ─── CNI (Calico) Types ──────────────────────────────────────────

export interface CalicoNodeStatus {
  node: string
  calico_ready?: boolean      // consolidated indicator (felix + bird share one readiness probe)
  felix_ready: boolean         // legacy, kept for backward compat
  bird_ready: boolean          // legacy, kept for backward compat
  ip?: string | null
  uptime_seconds?: number | null
  last_reported?: string | null
}

export interface BGPPeer {
  name: string
  node?: string | null
  peer_ip?: string | null
  peer_as_number?: number | null
  node_as_number?: number | null
  session_state?: string | null
}

export interface IPPool {
  name: string
  cidr: string
  nat_outgoing: boolean
  disabled: boolean
  mode: string
  node_selector?: string | null
}

export interface IPAMBlockSummary {
  pool: string
  blocks: number
  allocated: number
  total: number
  utilization_pct: number
}

export interface CniPolicy {
  name: string
  namespace?: string | null
  type: 'NetworkPolicy' | 'GlobalNetworkPolicy'
  policy_type?: string[] | null
  selector?: string | null
  order?: number | null
  rules_count: number
  rule_actions?: string[] | null
}

export interface CniTopologyNode {
  id: string
  type?: 'node' | 'pod' | 'service'
  name: string
  role?: string | null
  ip?: string | null
  namespace?: string | null
  labels?: Record<string, string> | null
  node_name?: string | null
  ready?: boolean | null
  ports?: string | null
}

export interface CniTopologyEdge {
  id?: string
  source: string
  target: string
  type?: 'bgp' | 'overlay' | null
}

export interface CniTopologyResponse {
  nodes: CniTopologyNode[]
  edges: CniTopologyEdge[]
}

export interface FelixMetrics {
  active_local_endpoints?: number
  cluster_network_policies?: number
  iptables_restore_errors?: number
  bgp_sessions_active?: number
  int_dataplane_failures?: number
}

export interface PodCoverageItem {
  pod_name: string
  namespace: string
  labels: Record<string, string>
  selecting_policies: string[]
  exposed: boolean
}

// ─── Policy ↔ Pod Matrix (Workload Endpoints + Policy Impact) ────

export interface EndpointRuleDigest {
  allow: number
  deny: number
  log: number
  pass: number
  ports: string[]
}

export interface WorkloadEndpoint {
  namespace: string
  pod_name: string
  labels: Record<string, string>
  node_name?: string | null
  pod_ip?: string | null
  phase?: string | null
  interface_status: 'up' | 'down'
  selecting_policies: Array<{ name: string; type: string }>
  exposed: boolean
  ingress: EndpointRuleDigest
  egress: EndpointRuleDigest
}

export interface PolicyRuleDetail {
  index: number
  direction: 'Ingress' | 'Egress'
  action: string
  protocol?: string | null
  ports: string[]
  source_selector?: string | null
  destination_selector?: string | null
  matched_pods: Array<{ namespace: string; pod_name: string }>
  matched_count: number
}

export interface PolicyImpact {
  name: string
  namespace?: string | null
  type: 'NetworkPolicy' | 'GlobalNetworkPolicy'
  selector?: string | null
  selected_pods: Array<{ namespace: string; pod_name: string }>
  selected_count: number
  rules: PolicyRuleDetail[]
  actions: string[]
}

export interface PolicyMatrixData {
  workload_endpoints: WorkloadEndpoint[]
  policy_impacts: PolicyImpact[]
}

export interface ApiResponse<T> {
  status: 'success' | 'mock' | 'error'
  data: T
}

// ─── Cluster Management Types ─────────────────────────────────────

export interface K8sNamespace {
  name: string
  status?: string
  labels?: Record<string, string>
}

export interface K8sService {
  name: string
  namespace: string
  cluster_ip: string
  type: string
  ports: string
}

export interface K8sConfigMap {
  name: string
  namespace: string
  keys: string[]
}

export interface K8sSecret {
  name: string
  namespace: string
  type: string
  keys: string[]
}

export interface K8sDeployment {
  name: string
  namespace: string
  replicas: number
  ready_replicas: number
  image: string
}

export interface K8sNode {
  name: string
  role: string
  ip: string
  ready: boolean
  unschedulable: boolean
  kubelet_version: string
  os_image: string
}

export interface ConfigSettings {
  k8s_mode: string
  prometheus_url: string
  ai_enabled: boolean
  ai_model: string
  frontend_url: string
  has_api_key: boolean
  has_super_user_password: boolean
  has_redis_password: boolean
  has_falco_webhook_secret: boolean
}

export interface IPPoolFormData {
  name: string
  cidr: string
  nat_outgoing: boolean
  disabled: boolean
  mode: 'ipip' | 'vxlan' | 'none'
  node_selector: string
}

export interface BGPPeerFormData {
  name: string
  peer_ip: string
  peer_as_number: number
  node_as_number?: number | null
  node?: string | null
}
