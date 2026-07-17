import { useState, useMemo } from 'react'
import type { Pod, TopologyNode, TopologyEdge as TopologyEdgeType } from '../types'
import { useDashboard, useTabSubscription } from '../context/DashboardContext'
import { DataSourceBadge } from './DataSourceBadge'
import { Topology } from '../Topology'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'
import { getNsColor } from '../utils'

const COMMON_PORT_CHIPS = [
  { port: 53, tooltip: 'DNS' },
  { port: 80, tooltip: 'HTTP' },
  { port: 443, tooltip: 'HTTPS' },
  { port: 5432, tooltip: 'PostgreSQL' },
  { port: 6379, tooltip: 'Redis' },
  { port: 6443, tooltip: 'K8s API' },
  { port: 8080, tooltip: 'HTTP-alt' },
  { port: 9090, tooltip: 'Prometheus' },
] as const

export function CniTopologyPanel() {
  useTabSubscription('topology', { intervalMs: 60_000, refetchOnFocus: true })

  const { pods, cniTopology, topologyStatus } = useDashboard()
  const [inventoryFilter, setInventoryFilter] = useState('')
  const [filterFocused, setFilterFocused] = useState(false)
  const [showPods, setShowPods] = useState(true)
  const [showServices, setShowServices] = useState(true)

  // Convert CNI topology to the format expected by Topology component
  const adaptedTopology = useMemo(() => {
    const nodes: TopologyNode[] = []
    const edges: TopologyEdgeType[] = []

    if (cniTopology) {
      // Add all nodes from the topology (cluster nodes, pods, services)
      for (const n of cniTopology.nodes) {
        const nodeType = n.type || 'node'
        if (nodeType === 'node') {
          nodes.push({
            id: n.id,
            type: 'node' as const,
            name: n.name,
            role: (n.role as 'master' | 'worker') || 'worker',
            ip: n.ip || undefined,
            ready: n.ready ?? true,
          })
        } else if (nodeType === 'pod') {
          nodes.push({
            id: n.id,
            type: 'pod' as const,
            namespace: n.namespace || undefined,
            name: n.name,
            ip: n.ip || undefined,
            labels: n.labels || undefined,
            node_name: n.node_name || undefined,
            ports: n.ports || undefined,
          })
        } else if (nodeType === 'service') {
          nodes.push({
            id: n.id,
            type: 'service' as const,
            namespace: n.namespace || undefined,
            name: n.name,
            ip: n.ip || undefined,
            ports: n.ports || undefined,
          })
        }
      }

      // Add edges - convert to TopologyEdge format
      for (const e of cniTopology.edges) {
        if (e.type === 'bgp') {
          // BGP edges get a label and may need synthetic BGP peer nodes
          const edgeId = e.id || `cni-${e.source}-to-${e.target}-bgp`
          edges.push({
            id: edgeId,
            source: e.source,
            target: e.target,
            label: 'BGP',
          })

          // If BGP peer target is a bgp:IP address, add it as a node so it renders
          if (e.target.startsWith('bgp:')) {
            const ip = e.target.replace('bgp:', '')
            if (!nodes.some(n => n.id === e.target)) {
              nodes.push({
                id: e.target,
                type: 'service' as const,
                name: `BGP ${ip}`,
                ip,
              })
            }
          }
        } else if (e.type === 'overlay') {
          const edgeId = e.id || `cni-${e.source}-to-${e.target}-overlay`
          edges.push({
            id: edgeId,
            source: e.source,
            target: e.target,
            label: 'Overlay',
          })
        } else {
          // Pod-to-service edges (no type field) — use the edge's id directly
          edges.push({
            id: e.id || `${e.source}-to-${e.target}`,
            source: e.source,
            target: e.target,
          })
        }
      }
    }

    return { nodes, edges }
  }, [cniTopology])

  // ── Derive services from topology nodes ───────────────────────
  const services = useMemo(() => {
    if (!cniTopology) return []
    return cniTopology.nodes.filter(n => n.type === 'service' && !n.id.startsWith('bgp:')).map(s => ({
      id: s.id,
      namespace: s.namespace || 'unknown',
      name: s.name,
      clusterIp: s.ip || '-',
      ports: s.ports || null,
    }))
  }, [cniTopology])

  // Compute matched pod count per service from edges
  const servicePodCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    if (cniTopology) {
      for (const e of cniTopology.edges) {
        if (!e.type && e.target.startsWith('svc:')) {
          counts[e.target] = (counts[e.target] || 0) + 1
        }
      }
    }
    return counts
  }, [cniTopology])

  // ── Helper: collect all port search strings from pod containers ─
  const getPodPortStrings = (p: Pod): string[] => {
    const parts: string[] = []
    for (const c of p.containers || []) {
      for (const port of c.ports || []) {
        if (port.name) parts.push(port.name.toLowerCase())
        parts.push(String(port.containerPort))
        if (port.protocol) parts.push(port.protocol.toLowerCase())
      }
    }
    return parts
  }

  // ── Filtered inventories ──────────────────────────────────────
  const filterLower = inventoryFilter.toLowerCase()

  const filteredPods = useMemo(() => {
    if (!filterLower) return pods
    return pods.filter(p =>
      (p.name || '').toLowerCase().includes(filterLower) ||
      (p.namespace || '').toLowerCase().includes(filterLower) ||
      (p.node_name || '').toLowerCase().includes(filterLower) ||
      (p.pod_ip || '').toLowerCase().includes(filterLower) ||
      (p.phase || '').toLowerCase().includes(filterLower) ||
      getPodPortStrings(p).some(s => s.includes(filterLower))
    )
  }, [pods, filterLower])

  const filteredServices = useMemo(() => {
    if (!filterLower) return services
    return services.filter(s =>
      (s.name || '').toLowerCase().includes(filterLower) ||
      (s.namespace || '').toLowerCase().includes(filterLower) ||
      (s.clusterIp || '').toLowerCase().includes(filterLower) ||
      (s.ports || '').toLowerCase().includes(filterLower)
    )
  }, [services, filterLower])

  // ── Port chip match counts ────────────────────────────────────
  const portChipCounts = useMemo(() => {
    const counts: Record<number, { pods: number; services: number }> = {}
    for (const chip of COMMON_PORT_CHIPS) {
      const portStr = String(chip.port)
      let podCount = 0
      let svcCount = 0

      for (const p of pods) {
        let podFound = false
        for (const c of p.containers || []) {
          for (const port of c.ports || []) {
            if (port.containerPort === chip.port) {
              podCount++
              podFound = true
              break
            }
          }
          if (podFound) break
        }
      }

      for (const s of services) {
        if (s.ports) {
          // Split by comma and check each port entry for exact number match
          const entries = s.ports.split(', ')
          if (entries.some(e => {
            const num = e.match(/\d+/)?.[0]
            return num === portStr
          })) {
            svcCount++
          }
        }
      }

      counts[chip.port] = { pods: podCount, services: svcCount }
    }
    return counts
  }, [pods, services])

  // ── Namespace grouping ────────────────────────────────────────
  const nsCounts = useMemo(() => {
    const counts: Record<string, { pods: number; services: number }> = {}
    for (const p of pods) {
      if (!counts[p.namespace]) counts[p.namespace] = { pods: 0, services: 0 }
      counts[p.namespace].pods++
    }
    for (const s of services) {
      if (!counts[s.namespace]) counts[s.namespace] = { pods: 0, services: 0 }
      counts[s.namespace].services++
    }
    return counts
  }, [pods, services])

  const bgpPeerCount = cniTopology?.edges.filter(e => e.type === 'bgp').length || 0
  const overlayCount = cniTopology?.edges.filter(e => e.type === 'overlay').length || 0
  const nodeCount = cniTopology?.nodes.length || 0

  return (
    <div className="section cni-topology-section">
      <h2>CNI Topology</h2>

      <div className="subsection">
        <div className="subsection-header">
          <h3>Network Map</h3>
          <DataSourceBadge status={topologyStatus} label="Topology data" />
        </div>

        {/* Extended stats bar */}
        <div className="cni-topology-stats" style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <div className="cni-topology-stat">
            <span className="cni-topology-stat-value">{nodeCount}</span>
            <span className="cni-topology-stat-label">Nodes</span>
          </div>
          <div className="cni-topology-stat">
            <span className="cni-topology-stat-value">{pods.length}</span>
            <span className="cni-topology-stat-label">Pods</span>
          </div>
          <div className="cni-topology-stat">
            <span className="cni-topology-stat-value">{bgpPeerCount}</span>
            <span className="cni-topology-stat-label">BGP Peers</span>
          </div>
          <div className="cni-topology-stat">
            <span className="cni-topology-stat-value">{overlayCount}</span>
            <span className="cni-topology-stat-label">Overlay Links</span>
          </div>
        </div>

        {!cniTopology || (adaptedTopology.nodes.length === 0) ? (
          <EmptyState
            icon={<Icon name="network" size={48} />}
            message="No topology data available"
            submessage="Ensure Calico is configured and the backend can access the K8s API."
          />
        ) : (
          <Topology
            nodes={adaptedTopology.nodes}
            edges={adaptedTopology.edges}
          />
        )}
      </div>

      {/* ── Pod & Service Inventory ────────────────────────────────── */}
      <div className="subsection" style={{ marginTop: '24px' }}>
        <div className="subsection-header">
          <h3>Cluster Inventory</h3>
          <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
            {Object.keys(nsCounts).length} namespaces · {pods.length} pods · {services.length} services
          </span>
        </div>

        {/* Search filter */}
        <div className="inventory-search">
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Filter by name, namespace, IP, port, or node…"
              value={inventoryFilter}
              onChange={e => setInventoryFilter(e.target.value)}
              onFocus={() => setFilterFocused(true)}
              onBlur={() => setTimeout(() => setFilterFocused(false), 220)}
              className="inventory-filter-input"
              aria-label="Filter pods and services"
            />
            {inventoryFilter && (
              <button
                className="inventory-filter-clear"
                onClick={() => setInventoryFilter('')}
                aria-label="Clear filter"
              >
                <Icon name="x" size={14} />
              </button>
            )}
            {!inventoryFilter && !filterFocused && (
              <span style={{
                position: 'absolute',
                right: '10px',
                color: 'var(--text-tertiary)',
                fontSize: '11px',
                pointerEvents: 'none',
                opacity: 0.4,
              }}>
                <Icon name="search" size={14} />
              </span>
            )}
          </div>

          {/* Port quick-filter chips */}
          {filterFocused && !inventoryFilter && (
            <div style={{
              display: 'flex',
              gap: '6px',
              flexWrap: 'wrap',
              padding: '8px 0 4px',
            }}>
              <span style={{
                fontSize: '11px',
                color: 'var(--text-tertiary)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                alignSelf: 'center',
                marginRight: '4px',
              }}>Ports</span>
              {COMMON_PORT_CHIPS.map(chip => {
                const counts = portChipCounts[chip.port]
                const hasMatches = (counts?.pods ?? 0) + (counts?.services ?? 0) > 0
                return (
                  <button
                    key={chip.port}
                    onClick={() => setInventoryFilter(String(chip.port))}
                    title={`${chip.tooltip} — ${counts?.pods ?? 0} pods, ${counts?.services ?? 0} services`}
                    style={{
                      cursor: 'pointer',
                      background: hasMatches ? 'rgba(59, 130, 246, 0.12)' : 'rgba(148, 163, 184, 0.06)',
                      color: hasMatches ? '#60A5FA' : 'var(--text-tertiary)',
                      border: `1px solid ${hasMatches ? 'rgba(59, 130, 246, 0.25)' : 'rgba(148, 163, 184, 0.12)'}`,
                      borderRadius: '14px',
                      padding: '3px 10px',
                      fontSize: '11px',
                      fontWeight: hasMatches ? 600 : 400,
                      fontFamily: 'monospace',
                      transition: 'all 0.15s ease',
                      opacity: hasMatches ? 1 : 0.4,
                    }}
                    onMouseEnter={e => {
                      if (hasMatches) {
                        e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)'
                        e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.4)'
                      }
                    }}
                    onMouseLeave={e => {
                      if (hasMatches) {
                        e.currentTarget.style.background = 'rgba(59, 130, 246, 0.12)'
                        e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.25)'
                      }
                    }}
                  >
                    {String(chip.port)}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Namespace summary chips ──────────────────────────── */}
        <div className="namespace-chips">
          {Object.entries(nsCounts).sort().map(([ns, counts]) => (
            <span
              key={ns}
              className="namespace-chip"
              style={{
                backgroundColor: getNsColor(ns),
                color: '#fff',
                padding: '2px 10px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
              title={`${counts.pods} pods · ${counts.services} services`}
            >
              {ns} ({counts.pods}p / {counts.services}s)
            </span>
          ))}
        </div>

        {/* ── Pods table ───────────────────────────────────────── */}
        <div className="inventory-section">
          <button
            className="inventory-toggle"
            onClick={() => setShowPods(!showPods)}
            aria-expanded={showPods}
            style={{
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--text)',
              padding: '8px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
            }}
          >
            <span style={{ transform: showPods ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
            <span>Pods</span>
            <span className="inventory-count" style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
              {filteredPods.length}{inventoryFilter ? ` / ${pods.length}` : ''}
            </span>
          </button>

          {showPods && filteredPods.length > 0 && (
            <div className="inventory-table-wrapper" style={{ overflowX: 'auto' }}>
              <table className="inventory-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>Name</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>Namespace</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>IP</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>Ports</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>Node</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>Phase</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPods.map(p => (
                    <tr key={`${p.namespace}/${p.name}`} className="inventory-row" style={{ transition: 'background 0.1s' }}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', fontFamily: 'monospace', fontSize: '12px' }}>{p.name}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
                        <span style={{
                          backgroundColor: getNsColor(p.namespace),
                          color: '#fff',
                          padding: '1px 6px',
                          borderRadius: '8px',
                          fontSize: '11px',
                          fontWeight: 600,
                        }}>{p.namespace}</span>
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>{p.pod_ip}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>
                        <PodPortsBadge containers={p.containers} />
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>{p.node_name}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
                        <PhaseBadge phase={p.phase} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {showPods && filteredPods.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
              {inventoryFilter ? 'No pods match your filter.' : 'No pod data available.'}
            </div>
          )}
        </div>

        {/* ── Services table ───────────────────────────────────── */}
        <div className="inventory-section">
          <button
            className="inventory-toggle"
            onClick={() => setShowServices(!showServices)}
            aria-expanded={showServices}
            style={{
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--text)',
              padding: '8px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
            }}
          >
            <span style={{ transform: showServices ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
            <span>Services</span>
            <span className="inventory-count" style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
              {filteredServices.length}{inventoryFilter ? ` / ${services.length}` : ''}
            </span>
          </button>

          {showServices && filteredServices.length > 0 && (
            <div className="inventory-table-wrapper" style={{ overflowX: 'auto' }}>
              <table className="inventory-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>Name</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>Namespace</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>Cluster IP</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>Ports</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>Endpoints</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredServices.map(s => (
                    <tr key={s.id} className="inventory-row" style={{ transition: 'background 0.1s' }}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', fontFamily: 'monospace', fontSize: '12px' }}>{s.name}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
                        <span style={{
                          backgroundColor: getNsColor(s.namespace),
                          color: '#fff',
                          padding: '1px 6px',
                          borderRadius: '8px',
                          fontSize: '11px',
                          fontWeight: 600,
                        }}>{s.namespace}</span>
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>{s.clusterIp}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>
                        {s.ports ? (
                          <span title={s.ports} style={{ cursor: 'help' }}>
                            {s.ports.length > 30 ? s.ports.slice(0, 28) + '…' : s.ports}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
                        <span style={{
                          backgroundColor: servicePodCounts[s.id] ? 'var(--accent-bg, rgba(59,130,246,0.12))' : 'transparent',
                          color: servicePodCounts[s.id] ? 'var(--accent, #3B82F6)' : 'var(--text-tertiary)',
                          padding: '1px 8px',
                          borderRadius: '10px',
                          fontSize: '12px',
                          fontWeight: 600,
                        }}>
                          {servicePodCounts[s.id] ?? 0} pods
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {showServices && filteredServices.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
              {inventoryFilter ? 'No services match your filter.' : 'No service data available.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PodPortsBadge({ containers }: { containers: Array<{ name: string; image: string; ports?: Array<{ containerPort: number; protocol?: string; name?: string }> | null }> }) {
  // Collect all unique ports from all containers
  const ports = containers.reduce<string[]>((acc, c) => {
    for (const p of c.ports || []) {
      const label = p.name
        ? `${p.name}:${p.containerPort}/${p.protocol || 'TCP'}`
        : `${p.containerPort}/${p.protocol || 'TCP'}`
      if (!acc.includes(label)) acc.push(label)
    }
    return acc
  }, [])

  if (ports.length === 0) {
    return <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic', fontSize: '11px' }}>—</span>
  }

  const displayText = ports.join(', ')
  return (
    <span
      title={ports.map(p => p.replace(':', ' → ')).join('\n')}
      style={{ cursor: 'help', fontSize: '11px' }}
    >
      {displayText.length > 36 ? displayText.slice(0, 34) + '…' : displayText}
    </span>
  )
}

function PhaseBadge({ phase }: { phase: string }) {
  const colorMap: Record<string, string> = {
    Running: 'var(--success, #22C55E)',
    Pending: 'var(--warning, #F59E0B)',
    Succeeded: 'var(--text-tertiary, #94A3B8)',
    Failed: 'var(--danger, #EF4444)',
    Unknown: 'var(--text-tertiary, #94A3B8)',
  }
  const bgMap: Record<string, string> = {
    Running: 'rgba(34, 197, 94, 0.1)',
    Pending: 'rgba(245, 158, 11, 0.1)',
    Succeeded: 'rgba(148, 163, 184, 0.1)',
    Failed: 'rgba(239, 68, 68, 0.1)',
    Unknown: 'rgba(148, 163, 184, 0.1)',
  }
  const color = colorMap[phase] || colorMap.Unknown
  const bg = bgMap[phase] || bgMap.Unknown
  return (
    <span style={{
      backgroundColor: bg,
      color: color,
      padding: '1px 8px',
      borderRadius: '10px',
      fontSize: '11px',
      fontWeight: 600,
    }}>
      {phase}
    </span>
  )
}
