import { useState, useEffect, useRef, useCallback } from 'react'
import { useDashboard, useTabSubscription } from '../context/DashboardContext'
import type { CalicoNodeStatus } from '../types'
import { DataSourceBadge } from './DataSourceBadge'
import { Skeleton } from './Skeleton'
import { Icon } from './Icon'

interface DashboardPanelProps {
  onNavigate?: (tabId: string) => void
}

// ── Animated counter hook ──────────────────────────────────────
function useCountUp(target: number, duration = 800, enabled = true) {
  const [value, setValue] = useState(0)
  const prevTargetRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const wasEnabledRef = useRef(enabled)

  useEffect(() => {
    // Reset animation start when re-enabled
    if (enabled && !wasEnabledRef.current) {
      prevTargetRef.current = 0
      setValue(0)
    }
    wasEnabledRef.current = enabled

    if (!enabled || target === prevTargetRef.current) {
      setValue(target)
      return
    }

    const startValue = prevTargetRef.current
    const diff = target - startValue
    const startTime = performance.now()

    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(startValue + diff * eased))

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    rafRef.current = requestAnimationFrame(animate)
    prevTargetRef.current = target

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [target, duration, enabled])

  return value
}

// ── SVG Donut Chart ───────────────────────────────────────────
function DonutChart({
  percentage,
  size = 80,
  strokeWidth = 8,
  color = 'var(--info)',
  bgColor = 'rgba(255, 255, 255, 0.06)',
  animated = true,
}: {
  percentage: number
  size?: number
  strokeWidth?: number
  color?: string
  bgColor?: string
  animated?: boolean
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const [offset, setOffset] = useState(animated ? circumference : circumference * (1 - percentage / 100))

  useEffect(() => {
    if (!animated) {
      setOffset(circumference * (1 - percentage / 100))
      return
    }
    const timer = setTimeout(() => {
      setOffset(circumference * (1 - percentage / 100))
    }, 100)
    return () => clearTimeout(timer)
  }, [percentage, circumference, animated])

  const pctColor =
    percentage >= 90 ? 'var(--danger)' :
    percentage >= 70 ? 'var(--warning)' :
    percentage >= 40 ? 'var(--primary)' :
    color

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut-chart" aria-hidden="true">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={bgColor}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={pctColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{
          transition: animated ? 'stroke-dashoffset 1s ease, stroke 0.4s ease' : 'none',
        }}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        fontSize={size * 0.22}
        fontWeight={700}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {Math.round(percentage)}%
      </text>
    </svg>
  )
}

// ── Mini Threat Summary ───────────────────────────────────────
function ThreatMiniSummary({ count, critical, onNavigate }: { count: number; critical: number; onNavigate?: (tab: string) => void }) {
  if (count === 0) return null
  return (
    <div
      className="dashboard-threat-mini"
      onClick={() => onNavigate?.('threats')}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate?.('threats') } }}
      title="View threats"
    >
      <div className="dashboard-threat-mini-icon">
        <Icon name="alert-triangle" size={16} />
      </div>
      <div className="dashboard-threat-mini-content">
        <span className="dashboard-threat-mini-count">{count}</span>
        <span className="dashboard-threat-mini-label">
          Threat{count !== 1 ? 's' : ''}
          {critical > 0 && <span className="dashboard-threat-mini-critical"> · {critical} critical</span>}
        </span>
      </div>
    </div>
  )
}

// ── Format relative time ──────────────────────────────────────
function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return date.toLocaleTimeString()
}

// ── Mini stat bar component ───────────────────────────────────
function MiniStatBar({ label, value, color, icon, onClick }: {
  label: string
  value: string | number
  color: string
  icon: React.ReactNode
  onClick?: () => void
}) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      className={`dashboard-mini-stat ${onClick ? 'dashboard-mini-stat-clickable' : ''}`}
      onClick={onClick}
      {...(onClick ? { type: 'button' as const } : {})}
      title={onClick ? `View ${label.toLowerCase()}` : undefined}
    >
      <span className="dashboard-mini-stat-icon" style={{ color }}>
        {icon}
      </span>
      <div className="dashboard-mini-stat-content">
        <span className="dashboard-mini-stat-value" style={{ color }}>{value}</span>
        <span className="dashboard-mini-stat-label">{label}</span>
      </div>
    </Wrapper>
  )
}

// ── Card wrapper with expandable content ──────────────────────
function ExpandableCard({
  className = '',
  header,
  headerIcon,
  children,
  expandedContent,
  defaultExpanded = true,
  onExpandedChange,
}: {
  className?: string
  header: string
  headerIcon?: React.ReactNode
  children: React.ReactNode
  expandedContent?: React.ReactNode
  defaultExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  // Sync with defaultExpanded when it changes (e.g. async data loads)
  const prevDefaultRef = useRef(defaultExpanded)
  useEffect(() => {
    if (defaultExpanded !== prevDefaultRef.current && defaultExpanded === true) {
      setExpanded(true)
      onExpandedChange?.(true)
    }
    prevDefaultRef.current = defaultExpanded
  }, [defaultExpanded, onExpandedChange])

  const toggle = useCallback(() => {
    setExpanded(prev => {
      const next = !prev
      onExpandedChange?.(next)
      return next
    })
  }, [onExpandedChange])

  return (
    <div className={`dashboard-card dashboard-card-wide ${className}`}>
      <button
        className="dashboard-card-header dashboard-card-header-btn"
        onClick={toggle}
        aria-expanded={expanded}
      >
        <div className="dashboard-card-header-left">
          {headerIcon}
          <span>{header}</span>
        </div>
        <span className="dashboard-card-expand-icon" style={{
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s ease',
        }}>
          <Icon name="chevron-down" size={16} />
        </span>
      </button>
      <div className="dashboard-card-expandable" style={{
        maxHeight: expanded ? '600px' : '0',
        opacity: expanded ? 1 : 0,
        overflow: 'hidden',
        transition: 'max-height 0.35s ease, opacity 0.25s ease',
      }}>
        <div className="dashboard-card-expandable-inner">
          {children}
          {expandedContent}
        </div>
      </div>
    </div>
  )
}

export function DashboardPanel({ onNavigate }: DashboardPanelProps) {
  useTabSubscription('dashboard')

  const {
    cniNodes, bgpPeers, ipPools, ipamBlocks, cniPolicies: policies,
    felixMetrics, cniTopology, loading, cniNodesStatus, ipamStatus,
    policiesStatus, felixStatus, threats, wsConnected,
  } = useDashboard()
  const cniTopologyEdges = cniTopology?.edges.length || 0
  const cniTopologyNodes = cniTopology?.nodes.length || 0
  const threatsCount = threats.length
  const threatsCritical = threats.filter(t => t.priority === 'Critical').length
  const bgpPeersCount = bgpPeers.length
  const ipPoolsCount = ipPools.length
  // Show content as soon as ANY data arrives, rather than waiting for
  // ALL endpoints to respond. This prevents the dashboard from getting
  // stuck on skeleton placeholders when one endpoint fails silently.
  const hasAnyData = cniNodes.length > 0 || ipPoolsCount > 0 ||
    ipamBlocks.length > 0 || policies.length > 0 || bgpPeersCount > 0
  const isLoading = loading && !hasAnyData

  const isReady = (n: CalicoNodeStatus) => n.calico_ready ?? n.felix_ready ?? false
  const healthyNodes = cniNodes.filter(isReady)
  const downNodes = cniNodes.filter(n => !isReady(n))
  const totalIPs = ipamBlocks.reduce((acc, b) => acc + b.total, 0)
  const allocatedIPs = ipamBlocks.reduce((acc, b) => acc + b.allocated, 0)
  const ipamPct = totalIPs > 0 ? (allocatedIPs / totalIPs) * 100 : 0
  const globalPolicies = policies.filter(p => p.type === 'GlobalNetworkPolicy').length

  // ── Animated counters ──────────────────────────────────────
  const animate = !loading && cniNodes.length > 0
  const animHealthyNodes = useCountUp(healthyNodes.length, 700, animate)
  const animBgpPeers = useCountUp(bgpPeersCount, 700, animate)
  const animIpPools = useCountUp(ipPoolsCount, 700, animate)
  const animIpamPct = useCountUp(Math.round(ipamPct), 800, animate)
  const animPolicies = useCountUp(policies.length, 700, animate)
  const animTopoEdges = useCountUp(cniTopologyEdges, 700, animate)

  // ── Last updated timer ─────────────────────────────────────
  const [lastUpdated, setLastUpdated] = useState(new Date())

  useEffect(() => {
    if (!loading) {
      setLastUpdated(new Date())
    }
  }, [cniNodes, bgpPeers, loading])

  // Re-render every 10s to keep relative timestamps fresh
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => forceUpdate(t => t + 1), 10000)
    return () => clearInterval(interval)
  }, [])

  const handleCardClick = useCallback((tabId: string) => {
    onNavigate?.(tabId)
  }, [onNavigate])

  // ── Data flash on update ─────────────────────────────────────
  const dashboardRef = useRef<HTMLDivElement>(null)
  const prevDataSigRef = useRef('')

  // Combines key data points into a signature that changes when data refreshes
  const dataSig = `${cniNodes.length}|${healthyNodes.length}|${bgpPeersCount}|${ipPoolsCount}|${policies.length}|${cniTopologyEdges}|${ipamBlocks.length}`

  useEffect(() => {
    if (prevDataSigRef.current && dataSig !== prevDataSigRef.current) {
      const el = dashboardRef.current
      if (el) {
        el.classList.add('data-flash')
        const timer = setTimeout(() => el.classList.remove('data-flash'), 700)
        return () => clearTimeout(timer)
      }
    }
    prevDataSigRef.current = dataSig
  }, [dataSig])

  // IPAM utilization color
  const ipamColor =
    ipamPct >= 90 ? 'var(--danger)' :
    ipamPct >= 70 ? 'var(--warning)' :
    ipamPct >= 40 ? 'var(--primary)' :
    'var(--info)'

  return (
    <div className="dashboard">
      {/* ── Compact Stats Bar ──────────────────────────────── */}
      <div className="dashboard-compact-bar">
        <MiniStatBar
          label="Healthy"
          value={`${animHealthyNodes}/${cniNodes.length}`}
          color={downNodes.length === 0 ? 'var(--success)' : 'var(--warning)'}
          icon={<Icon name="check" size={16} />}
          onClick={() => handleCardClick('cni-health')}
        />
        <MiniStatBar
          label="BGP Peers"
          value={animBgpPeers}
          color="var(--primary)"
          icon={<Icon name="network" size={16} />}
        />
        <MiniStatBar
          label="IP Pools"
          value={animIpPools}
          color="#8B5CF6"
          icon={<Icon name="hard-drive" size={16} />}
          onClick={() => handleCardClick('ipam')}
        />
        <MiniStatBar
          label="Policies"
          value={animPolicies}
          color="var(--warning)"
          icon={<Icon name="shield" size={16} />}
          onClick={() => handleCardClick('policies')}
        />
        <MiniStatBar
          label="Edges"
          value={animTopoEdges}
          color="var(--info)"
          icon={<Icon name="activity" size={16} />}
          onClick={() => handleCardClick('topology')}
        />

        {/* Refresh & last updated */}
        <div className="dashboard-compbar-actions">
          {wsConnected && (
            <span className="dashboard-live-dot" title="WebSocket connected" />
          )}
          <span className="dashboard-last-updated" title={lastUpdated.toLocaleString()}>
            <Icon name="clock" size={12} />
            {formatRelativeTime(lastUpdated)}
          </span>
        </div>
      </div>

      {/* ── Main header ──────────────────────────────────────── */}
      <div className="dashboard-header">
        <div className="dashboard-header-left">
          <h2>System Overview</h2>
          {threatsCount > 0 && (
            <ThreatMiniSummary count={threatsCount} critical={threatsCritical} onNavigate={onNavigate} />
          )}
        </div>
        <div className="dashboard-header-actions">
          <div className="dashboard-source-status">
            <DataSourceBadge status={cniNodesStatus} label="CNI nodes" />
            <DataSourceBadge status={ipamStatus} label="IPAM" />
            <DataSourceBadge status={policiesStatus} label="Policies" />
            <DataSourceBadge status={felixStatus} label="Felix" />
          </div>
        </div>
      </div>

      {/* ── Dashboard Grid ──────────────────────────────────── */}
      <div className="dashboard-grid" ref={dashboardRef}>
        {isLoading ? (
          <>
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="dashboard-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <Skeleton variant="custom" width="44px" height="44px" style={{ borderRadius: '8px' }} />
                <Skeleton variant="custom" width="60%" height="28px" />
                <Skeleton variant="custom" width="40%" height="14px" />
              </div>
            ))}
            {[5, 6].map(i => (
              <div key={i} className="dashboard-card dashboard-card-wide" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <Skeleton variant="custom" width="40%" height="18px" />
                <Skeleton variant="custom" width="100%" height="80px" />
              </div>
            ))}
          </>
        ) : (
          <>
            {/* ── Health + Donut ──────────────────────────── */}
            <div
              className="dashboard-card dashboard-card-clickable"
              onClick={() => handleCardClick('cni-health')}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick('cni-health') } }}
              title="View CNI Health details"
            >
              <div className="dashboard-card-icon" style={{
                backgroundColor: downNodes.length > 0 ? 'var(--danger-light)' : 'var(--success-light)',
                color: downNodes.length > 0 ? 'var(--danger)' : 'var(--success)',
              }}>
                <Icon name="check" size={24} />
              </div>
              <div className="dashboard-card-content">
                <span className="dashboard-card-value" style={{ color: downNodes.length > 0 ? 'var(--warning)' : 'var(--success)' }}>
                  {animHealthyNodes}<span style={{ fontSize: '16px', opacity: 0.5 }}>/{cniNodes.length}</span>
                </span>
                <span className="dashboard-card-label">Healthy Nodes</span>
                <span className="dashboard-card-sub">
                  {downNodes.length > 0 ? (
    
                    <span className="threat-badge high" style={{ animation: 'pulse-glow 2s infinite' }}>
                      {downNodes.length} down
                    </span>
                  ) : (
                    <span style={{ color: 'var(--success)' }}>All healthy</span>
                  )}
                </span>
              </div>
              {/* Mini donut */}
              {cniNodes.length > 0 && (
                <div className="dashboard-card-chart">
                  <DonutChart
                    percentage={cniNodes.length > 0 ? (healthyNodes.length / cniNodes.length) * 100 : 0}
                    size={64}
                    strokeWidth={6}
                    color={downNodes.length === 0 ? 'var(--success)' : 'var(--warning)'}
                  />
                </div>
              )}
            </div>

            {/* ── BGP Peers ────────────────────────────────── */}
            <div className="dashboard-card">
              <div className="dashboard-card-icon" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                <Icon name="network" size={24} />
              </div>
              <div className="dashboard-card-content">
                <span className="dashboard-card-value" style={{ color: 'var(--primary)' }}>{animBgpPeers}</span>
                <span className="dashboard-card-label">BGP Peers</span>
                <span className="dashboard-card-sub">{cniTopologyNodes} nodes in mesh</span>
              </div>
            </div>

            {/* ── IP Pools ──────────────────────────────────── */}
            <div
              className="dashboard-card dashboard-card-clickable"
              onClick={() => handleCardClick('ipam')}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick('ipam') } }}
              title="View IPAM details"
            >
              <div className="dashboard-card-icon" style={{ backgroundColor: 'rgba(139, 92, 246, 0.15)', color: '#8B5CF6' }}>
                <Icon name="hard-drive" size={24} />
              </div>
              <div className="dashboard-card-content">
                <span className="dashboard-card-value" style={{ color: '#8B5CF6' }}>{animIpPools}</span>
                <span className="dashboard-card-label">IP Pools</span>
                <span className="dashboard-card-sub">{ipamBlocks.length} blocks</span>
              </div>
            </div>

            {/* ── IPAM Utilization ──────────────────────────── */}
            <div className="dashboard-card">
              <div className="dashboard-card-chart-left">
                <DonutChart
                  percentage={Math.round(ipamPct)}
                  size={68}
                  strokeWidth={7}
                  color={ipamColor}
                />
              </div>
              <div className="dashboard-card-content">
                <span className="dashboard-card-value" style={{ color: ipamColor }}>
                  {animIpamPct}%
                </span>
                <span className="dashboard-card-label">IPAM Utilized</span>
                <span className="dashboard-card-sub">{allocatedIPs}/{totalIPs} IPs</span>
              </div>
            </div>

            {/* ── Network Policies (expandable) ───────────── */}
            <ExpandableCard
              header="Network Policies"
              headerIcon={<Icon name="shield" size={16} className="card-header-icon" />}
              defaultExpanded={true}
              expandedContent={
                <div className="dashboard-policy-breakdown">
                  <div className="dashboard-policy-bar">
                    <div className="dashboard-policy-bar-label">
                      <span>Global</span>
                      <span>{globalPolicies}</span>
                    </div>
                    <div className="dashboard-policy-bar-track">
                      <div
                        className="dashboard-policy-bar-fill"
                        style={{
                          width: policies.length > 0 ? `${(globalPolicies / policies.length) * 100}%` : '0%',
                          backgroundColor: globalPolicies > 0 ? 'var(--warning)' : 'var(--text-tertiary)',
                        }}
                      />
                    </div>
                  </div>
                  <div className="dashboard-policy-bar">
                    <div className="dashboard-policy-bar-label">
                      <span>Namespaced</span>
                      <span>{policies.length - globalPolicies}</span>
                    </div>
                    <div className="dashboard-policy-bar-track">
                      <div
                        className="dashboard-policy-bar-fill"
                        style={{
                          width: policies.length > 0 ? `${((policies.length - globalPolicies) / policies.length) * 100}%` : '0%',
                          backgroundColor: 'var(--primary)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              }
            >
              <div className="rbac-summary">
                <div className="rbac-summary-item">
                  <span className="rbac-summary-label">Total Policies</span>
                  <span className="rbac-summary-value" style={{ color: 'var(--primary)' }}>{animPolicies}</span>
                </div>
                <div className="rbac-summary-item">
                  <span className="rbac-summary-label">Global</span>
                  <span className="rbac-summary-value warning">{globalPolicies}</span>
                </div>
                <div className="rbac-summary-item">
                  <span className="rbac-summary-label">Namespaced</span>
                  <span className="rbac-summary-value">{policies.length - globalPolicies}</span>
                </div>
                <div className="rbac-summary-item">
                  <span className="rbac-summary-label">With Rules</span>
                  <span className="rbac-summary-value">{policies.filter(p => p.rules_count > 0).length}</span>
                </div>
              </div>
            </ExpandableCard>

            {/* ── Felix Performance (expandable) ──────────── */}
            <ExpandableCard
              header="Felix Performance"
              headerIcon={<Icon name="activity" size={16} className="card-header-icon" />}
              defaultExpanded={felixMetrics !== null}
            >
              {felixMetrics ? (
                <div className="rbac-summary">
                  <div className="rbac-summary-item">
                    <span className="rbac-summary-label">Active Endpoints</span>
                    <span className="rbac-summary-value">{felixMetrics.active_local_endpoints ?? '-'}</span>
                  </div>
                  <div className="rbac-summary-item">
                    <span className="rbac-summary-label">Cluster Policies</span>
                    <span className="rbac-summary-value">{felixMetrics.cluster_network_policies ?? '-'}</span>
                  </div>
                  <div className="rbac-summary-item">
                    <span className="rbac-summary-label">BGP Sessions Active</span>
                    <span className="rbac-summary-value">{felixMetrics.bgp_sessions_active ?? '-'}</span>
                  </div>
                  <div className="rbac-summary-item">
                    <span className="rbac-summary-label">Dataplane Failures</span>
                    <span className="rbac-summary-value" style={{
                      color: (felixMetrics.int_dataplane_failures ?? 0) === 0 ? 'var(--success)' :
                             (felixMetrics.int_dataplane_failures ?? 0) > 0 ? 'var(--danger)' : 'var(--text-tertiary)'
                    }}>
                      {felixMetrics.int_dataplane_failures != null ? felixMetrics.int_dataplane_failures : '-'}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="dashboard-empty">Install Prometheus and enable Felix metrics scraping to see performance data.</p>
              )}
            </ExpandableCard>

            {/* ── Topology Summary ────────────────────────── */}
            <div
              className="dashboard-card dashboard-card-wide dashboard-card-clickable"
              onClick={() => handleCardClick('topology')}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick('topology') } }}
              title="View Topology details"
            >
              <div className="dashboard-card-header">
                <Icon name="network" size={16} className="card-header-icon" />
                <span>Topology Summary</span>
              </div>
              <div className="rbac-summary">
                <div className="rbac-summary-item">
                  <span className="rbac-summary-label">Nodes in Topology</span>
                  <span className="rbac-summary-value">{cniTopologyNodes}</span>
                </div>
                <div className="rbac-summary-item">
                  <span className="rbac-summary-label">BGP + Overlay Edges</span>
                  <span className="rbac-summary-value">{cniTopologyEdges}</span>
                </div>
                <div className="rbac-summary-item">
                  <span className="rbac-summary-label">Felix Status</span>
                  <span className="rbac-summary-value" style={{ color: 'var(--success)' }}>
                    {felixStatus === 'live' ? 'Active' : felixStatus === 'mock' ? 'Mock' : 'Unknown'}
                  </span>
                </div>
                <div className="rbac-summary-item">
                  <span className="rbac-summary-label">Data Source</span>
                  <span className="rbac-summary-value">
                    {cniNodesStatus === 'live' ? 'Live' : cniNodesStatus === 'mock' ? 'Mock' : 'Unknown'}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
