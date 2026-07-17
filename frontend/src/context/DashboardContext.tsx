import {
  createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, type ReactNode,
} from 'react'
import type {
  Pod, ThreatEvent, CalicoNodeStatus, BGPPeer, IPPool, IPAMBlockSummary,
  CniPolicy, CniTopologyNode, CniTopologyEdge, FelixMetrics,
  DataSourceStatus, ApiResponse, PodCoverageItem,
  RbacBinding, PrivilegedPod,
} from '../types'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''
const REFRESH_MS = 30_000  // 30s background refresh for core data
const STALE_MS = 30_000    // supplementary data refetched if older than this

// ─── Context shape ──────────────────────────────────────────────
export interface DashboardState {
  // Loading / error
  loading: boolean
  setLoading: (v: boolean) => void
  error: string | null
  setError: (v: string | null) => void

  // Core CNI data (always fetched on interval)
  pods: Pod[]
  cniNodes: CalicoNodeStatus[]
  bgpPeers: BGPPeer[]
  ipPools: IPPool[]
  ipamBlocks: IPAMBlockSummary[]
  cniPolicies: CniPolicy[]

  // Supplementary data (fetched per-tab)
  cniTopology: { nodes: CniTopologyNode[]; edges: CniTopologyEdge[] } | null
  felixMetrics: FelixMetrics | null
  policyCoverage: PodCoverageItem[]
  rbacBindings: RbacBinding[]
  privilegedPods: PrivilegedPod[]
  threats: ThreatEvent[]

  // Status tracking for data sources
  cniNodesStatus: DataSourceStatus
  ipPoolsStatus: DataSourceStatus
  ipamStatus: DataSourceStatus
  policiesStatus: DataSourceStatus
  felixStatus: DataSourceStatus
  topologyStatus: DataSourceStatus
  rbacBindingsStatus: DataSourceStatus
  privilegedPodsStatus: DataSourceStatus

  // WebSocket
  wsConnected: boolean

  // Active tab (panels use this to know when they're visible)
  activeTab: string
  setActiveTab: (tabId: string) => void

  // Actions
  fetchData: () => Promise<void>
  silentRefresh: () => Promise<void>
  connectWebSocket: () => void
  exportData: () => void
  clearThreats: () => void

  // Per-tab subscription triggers (called by tab panels)
  subscribeTab: (tabId: string) => void
}

const DashboardContext = createContext<DashboardState | null>(null)

export function useDashboard(): DashboardState {
  const ctx = useContext(DashboardContext)
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider')
  return ctx
}

// ─── useTabSubscription hook ────────────────────────────────────
// Each panel calls this on mount to subscribe to its supplementary data.
// The hook watches `activeTab` from context, fetches when the tab becomes
// visible, and tears down intervals when the tab is hidden.

export function useTabSubscription(
  tabId: string,
  options?: {
    /** Re-fetch at this interval (ms) while the tab is active */
    intervalMs?: number
    /** Re-fetch when the window regains focus */
    refetchOnFocus?: boolean
  }
) {
  const { activeTab, subscribeTab } = useDashboard()
  const isActive = activeTab === tabId
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Fetch when tab becomes active; clean up interval when hidden
  useEffect(() => {
    if (!isActive) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Fetch immediately (subscribeTab handles staleness internally)
    subscribeTab(tabId)

    // Set up periodic refresh while tab is active
    if (options?.intervalMs) {
      intervalRef.current = setInterval(() => subscribeTab(tabId), options.intervalMs)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isActive, tabId, options?.intervalMs, subscribeTab])

  // Refetch on window focus (only while tab is active)
  useEffect(() => {
    if (!isActive || !options?.refetchOnFocus) return

    const handleVisible = () => {
      if (document.visibilityState === 'visible') subscribeTab(tabId)
    }
    const handleFocus = () => subscribeTab(tabId)

    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('focus', handleFocus)
    return () => {
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('focus', handleFocus)
    }
  }, [isActive, tabId, options?.refetchOnFocus, subscribeTab])
}

// ─── Helper: fetch with retry ──────────────────────────────────
async function fetchWithRetry(url: string, retries = 2): Promise<Response | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url)
      if (res.ok || attempt === retries) return res
      await new Promise(r => setTimeout(r, 100 * 2 ** attempt))
    } catch {
      if (attempt === retries) return null
      await new Promise(r => setTimeout(r, 100 * 2 ** attempt))
    }
  }
  return null
}

// ─── Provider ───────────────────────────────────────────────────
export function DashboardProvider({ children }: { children: ReactNode }) {
  // ── Loading / error ─────────────────────────────────────────
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Core CNI data (always fetched) ──────────────────────────
  const [pods, setPods] = useState<Pod[]>([])
  const [cniNodes, setCniNodes] = useState<CalicoNodeStatus[]>([])
  const [bgpPeers, setBgpPeers] = useState<BGPPeer[]>([])
  const [ipPools, setIpPools] = useState<IPPool[]>([])
  const [ipamBlocks, setIpamBlocks] = useState<IPAMBlockSummary[]>([])
  const [cniPolicies, setCniPolicies] = useState<CniPolicy[]>([])

  // ── Supplementary data (per-tab) ────────────────────────────
  const [cniTopology, setCniTopology] = useState<{ nodes: CniTopologyNode[]; edges: CniTopologyEdge[] } | null>(null)
  const [felixMetrics, setFelixMetrics] = useState<FelixMetrics | null>(null)
  const [policyCoverage, setPolicyCoverage] = useState<PodCoverageItem[]>([])
  const [rbacBindings, setRbacBindings] = useState<RbacBinding[]>([])
  const [privilegedPods, setPrivilegedPods] = useState<PrivilegedPod[]>([])
  const [threats, setThreats] = useState<ThreatEvent[]>([])

  // ── Data source status tracking ─────────────────────────────
  const [cniNodesStatus, setCniNodesStatus] = useState<DataSourceStatus>('unknown')
  const [ipPoolsStatus, setIpPoolsStatus] = useState<DataSourceStatus>('unknown')
  const [ipamStatus, setIpamStatus] = useState<DataSourceStatus>('unknown')
  const [policiesStatus, setPoliciesStatus] = useState<DataSourceStatus>('unknown')
  const [felixStatus, setFelixStatus] = useState<DataSourceStatus>('unknown')
  const [topologyStatus, setTopologyStatus] = useState<DataSourceStatus>('unknown')
  const [rbacBindingsStatus, setRbacBindingsStatus] = useState<DataSourceStatus>('unknown')
  const [privilegedPodsStatus, setPrivilegedPodsStatus] = useState<DataSourceStatus>('unknown')

  // ── WebSocket ───────────────────────────────────────────────
  const [wsConnected, setWsConnected] = useState(false)

  // ── Active tab state ────────────────────────────────────────
  const [activeTab, setActiveTab] = useState(
    () => localStorage.getItem('k8s-dashboard-tab') || 'dashboard'
  )
  const handleSetActiveTab = useCallback((tabId: string) => {
    setActiveTab(tabId)
    localStorage.setItem('k8s-dashboard-tab', tabId)
  }, [])

  // ── Refs ────────────────────────────────────────────────────
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const threatIdRef = useRef(1)
  const reconnectRef = useRef(0)

  // Per-tab subscription tracking: stores the last-fetch timestamp per tab
  const tabLastFetch = useRef<Record<string, number>>({})

  // ── Core data fetch (always on interval) ────────────────────
  const fetchCoreData = useCallback(async () => {
    const [podsRes, nodesRes, poolsRes, ipamRes, policiesRes, bgpRes] = await Promise.all([
      fetchWithRetry(`${API_BASE_URL}/api/network/pods`),
      fetchWithRetry(`${API_BASE_URL}/api/cni/nodes`),
      fetchWithRetry(`${API_BASE_URL}/api/cni/ippools`),
      fetchWithRetry(`${API_BASE_URL}/api/cni/ipam/utilization`),
      fetchWithRetry(`${API_BASE_URL}/api/cni/policies`),
      fetchWithRetry(`${API_BASE_URL}/api/cni/bgp-peers`),
    ])

    if (podsRes?.ok) {
      const d = await podsRes.json()
      setPods(d.items || [])
    }
    if (nodesRes?.ok) {
      const d: ApiResponse<CalicoNodeStatus[]> = await nodesRes.json()
      setCniNodes(d.data || [])
      setCniNodesStatus(d.status === 'success' ? 'live' : d.status === 'mock' ? 'mock' : 'error')
    } else {
      setCniNodesStatus('error')
    }
    if (poolsRes?.ok) {
      const d: ApiResponse<IPPool[]> = await poolsRes.json()
      setIpPools(d.data || [])
      setIpPoolsStatus(d.status === 'success' ? 'live' : d.status === 'mock' ? 'mock' : 'error')
    } else {
      setIpPoolsStatus('error')
    }
    if (ipamRes?.ok) {
      const d: ApiResponse<IPAMBlockSummary[]> = await ipamRes.json()
      setIpamBlocks(d.data || [])
      setIpamStatus(d.status === 'success' ? 'live' : d.status === 'mock' ? 'mock' : 'error')
    } else {
      setIpamStatus('error')
    }
    if (policiesRes?.ok) {
      const d: ApiResponse<CniPolicy[]> = await policiesRes.json()
      setCniPolicies(d.data || [])
      setPoliciesStatus(d.status === 'success' ? 'live' : d.status === 'mock' ? 'mock' : 'error')
    } else {
      setPoliciesStatus('error')
    }
    if (bgpRes?.ok) {
      const d: ApiResponse<BGPPeer[]> = await bgpRes.json()
      setBgpPeers(d.data || [])
    }
  }, [])

  // ── Supplementary data fetchers (per-tab) ───────────────────
  const fetchTopology = useCallback(async () => {
    const res = await fetchWithRetry(`${API_BASE_URL}/api/cni/topology`)
    if (res?.ok) {
      const d: ApiResponse<{ nodes: CniTopologyNode[]; edges: CniTopologyEdge[] }> = await res.json()
      setCniTopology(d.data || null)
      setTopologyStatus(d.status === 'success' ? 'live' : d.status === 'mock' ? 'mock' : 'error')
    } else {
      setTopologyStatus('error')
    }
  }, [])

  const fetchFelix = useCallback(async () => {
    const res = await fetchWithRetry(`${API_BASE_URL}/api/cni/metrics/felix`)
    if (res?.ok) {
      const d: ApiResponse<FelixMetrics> = await res.json()
      setFelixMetrics(d.data || null)
      setFelixStatus(d.status === 'success' ? 'live' : d.status === 'mock' ? 'mock' : 'error')
    } else {
      setFelixStatus('error')
    }
  }, [])

  const fetchCoverage = useCallback(async () => {
    const res = await fetchWithRetry(`${API_BASE_URL}/api/cni/policies/coverage`)
    if (res?.ok) {
      const d: ApiResponse<PodCoverageItem[]> = await res.json()
      setPolicyCoverage(d.data || [])
    }
  }, [])

  const fetchSecurity = useCallback(async () => {
    const [rbacRes, privRes] = await Promise.all([
      fetchWithRetry(`${API_BASE_URL}/api/security/rbac`),
      fetchWithRetry(`${API_BASE_URL}/api/security/privileged-pods`),
    ])
    if (rbacRes?.ok) {
      const d: ApiResponse<RbacBinding[]> = await rbacRes.json()
      setRbacBindings(d.data || [])
      setRbacBindingsStatus(d.status === 'success' ? 'live' : d.status === 'mock' ? 'mock' : 'error')
    } else {
      setRbacBindingsStatus('error')
    }
    if (privRes?.ok) {
      const d: ApiResponse<PrivilegedPod[]> = await privRes.json()
      setPrivilegedPods(d.data || [])
      setPrivilegedPodsStatus(d.status === 'success' ? 'live' : d.status === 'mock' ? 'mock' : 'error')
    } else {
      setPrivilegedPodsStatus('error')
    }
  }, [])

  // Map tab IDs to their supplementary fetch function
  const tabDataFetchers = useMemo<Record<string, () => Promise<void>>>(() => ({
    'topology': fetchTopology,
    'dashboard': fetchTopology,   // dashboard shows topology summary
    'cni-health': fetchFelix,
    'policies': fetchCoverage,
    'security': fetchSecurity,
  }), [fetchTopology, fetchFelix, fetchCoverage, fetchSecurity])

  // ── Silent refresh (background — no loading overlay) ────────
  const silentRefresh = useCallback(async () => {
    try {
      await fetchCoreData()
      // Keep Felix metrics fresh for the dashboard (shown in Felix Performance card)
      await fetchFelix()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection lost'
      setError(`Data fetch failed: ${msg}`)
      setCniNodesStatus('error')
      setIpPoolsStatus('error')
      setIpamStatus('error')
      setPoliciesStatus('error')
      setFelixStatus('error')
      setTopologyStatus('error')
    }
  }, [fetchCoreData, fetchFelix])

  // ── Explicit fetch with loading overlay ─────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await fetchCoreData()
      // Also fetch supplementary data on initial load
      await Promise.all([
        fetchTopology(),
        fetchFelix(),
        fetchCoverage(),
        fetchSecurity(),
      ])
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }, [fetchCoreData, fetchTopology, fetchFelix, fetchCoverage, fetchSecurity])

  // ── Per-tab subscription: called when a tab becomes active ──
  const subscribeTab = useCallback((tabId: string) => {
    const now = Date.now()
    const lastFetch = tabLastFetch.current[tabId] ?? 0
    const fetcher = tabDataFetchers[tabId]

    if (fetcher && (now - lastFetch > STALE_MS)) {
      tabLastFetch.current[tabId] = now
      fetcher()
    }
  }, [tabDataFetchers])

  // ── WebSocket for threats ───────────────────────────────────
  const MAX_RECONNECT_ATTEMPTS = 10

  const connectWebSocket = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return
    }
    reconnectRef.current = 0
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/threats/ws/threats`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => { reconnectRef.current = 0; setWsConnected(true); setError(null) }
    ws.onmessage = (event) => {
      try {
        const threat = JSON.parse(event.data)
        threat.id = `threat-${threatIdRef.current++}`
        setThreats(prev => [threat, ...prev].slice(0, 50))
      } catch { /* ignore parse errors */ }
    }
    ws.onerror = () => { setWsConnected(false); setError('WebSocket connection failed') }
    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null
        setWsConnected(false)
        const attempt = reconnectRef.current
        if (attempt < MAX_RECONNECT_ATTEMPTS) {
          reconnectRef.current = attempt + 1
          const delay = Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500
          setTimeout(connectWebSocket, delay)
        }
      }
    }
  }, [])

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])

  // ── Export data as JSON ─────────────────────────────────────
  const exportData = useCallback(() => {
    const data = {
      exportedAt: new Date().toISOString(),
      dashboard: {
        pods,
        cniNodes,
        bgpPeers,
        ipPools,
        ipamBlocks,
        cniPolicies,
        cniTopology,
        felixMetrics,
        policyCoverage,
        rbacBindings,
        privilegedPods,
      },
      threats,
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `k8s-dashboard-export-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [pods, cniNodes, bgpPeers, ipPools, ipamBlocks, cniPolicies, cniTopology, felixMetrics, policyCoverage, rbacBindings, privilegedPods, threats])

  const clearThreats = useCallback(() => { setThreats([]) }, [])

  // ── Effects ─────────────────────────────────────────────────

  // Background refresh interval (core data only)
  useEffect(() => {
    if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
    refreshIntervalRef.current = setInterval(silentRefresh, REFRESH_MS)
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
    }
  }, [silentRefresh])

  // Initial data load
  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value: DashboardState = {
    loading, setLoading, error, setError,
    pods, cniNodes, bgpPeers, ipPools, ipamBlocks, cniPolicies,
    cniTopology, felixMetrics, policyCoverage, rbacBindings, privilegedPods, threats,
    cniNodesStatus, ipPoolsStatus, ipamStatus, policiesStatus,
    felixStatus, topologyStatus, rbacBindingsStatus, privilegedPodsStatus,
    wsConnected,
    activeTab, setActiveTab: handleSetActiveTab,
    fetchData, silentRefresh, connectWebSocket, exportData, clearThreats,
    subscribeTab,
  }

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  )
}
