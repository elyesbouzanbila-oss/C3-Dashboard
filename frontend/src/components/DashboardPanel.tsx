import { useState, useEffect, useRef, useCallback } from 'react'
import { useDashboard, useTabSubscription } from '../context/DashboardContext'
import type { CalicoNodeStatus } from '../types'
import { DataSourceBadge } from './DataSourceBadge'
import { Skeleton } from './Skeleton'
import { Icon } from './Icon'
import { DonutChart } from './DonutChart'

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

export function DashboardPanel({ onNavigate }: DashboardPanelProps) {
  useTabSubscription('dashboard')

  const {
    cniNodes, bgpPeers, ipPools, ipamBlocks, cniPolicies: policies,
    cniTopology, loading, cniNodesStatus, ipamStatus,
    policiesStatus, felixStatus, threats, wsConnected,
    exportData, silentRefresh,
  } = useDashboard()
  
  const cniTopologyEdges = cniTopology?.edges.length || 0
  const threatsCount = threats.length
  const threatsCritical = threats.filter(t => t.priority === 'Critical').length
  const bgpPeersCount = bgpPeers.length
  const ipPoolsCount = ipPools.length
  
  const hasAnyData = cniNodes.length > 0 || ipPoolsCount > 0 ||
    ipamBlocks.length > 0 || policies.length > 0 || bgpPeersCount > 0
  const isLoading = loading && !hasAnyData

  const isReady = (n: CalicoNodeStatus) => n.calico_ready ?? n.felix_ready ?? false
  const healthyNodes = cniNodes.filter(isReady)
  const downNodes = cniNodes.filter(n => !isReady(n))
  const totalIPs = ipamBlocks.reduce((acc, b) => acc + b.total, 0)
  const allocatedIPs = ipamBlocks.reduce((acc, b) => acc + b.allocated, 0)
  const ipamPct = totalIPs > 0 ? (allocatedIPs / totalIPs) * 100 : 0

  // Animated counters
  const animate = !loading && cniNodes.length > 0
  const animHealthyNodes = useCountUp(healthyNodes.length, 700, animate)
  const animBgpPeers = useCountUp(bgpPeersCount, 700, animate)
  const animIpPools = useCountUp(ipPoolsCount, 700, animate)
  const animPolicies = useCountUp(policies.length, 700, animate)

  const [lastUpdated, setLastUpdated] = useState(new Date())

  useEffect(() => {
    if (!loading) {
      setLastUpdated(new Date())
    }
  }, [cniNodes, bgpPeers, loading])

  const handleCardClick = useCallback((section: string) => {
    onNavigate?.(section)
  }, [onNavigate])

  const ipamColor =
    ipamPct >= 90 ? 'var(--danger)' :
    ipamPct >= 70 ? 'var(--warning)' :
    ipamPct >= 40 ? 'var(--primary)' :
    'var(--info)'

  if (isLoading) {
    return (
      <div className="dashboard">
        <div className="dashboard-grid">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="dashboard-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Skeleton variant="custom" width="44px" height="44px" style={{ borderRadius: '8px' }} />
              <Skeleton variant="custom" width="60%" height="28px" />
              <Skeleton variant="custom" width="40%" height="14px" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard">
      {/* ── Hero Health Card ───────────────────────────────── */}
      <div
        className={`dashboard-hero ${downNodes.length > 0 ? 'is-degraded' : 'is-healthy'}`}
        onClick={() => handleCardClick('cni-health')}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick('cni-health') } }}
      >
        <div className="dashboard-hero-left">
          <div className="dashboard-hero-icon" style={{
            backgroundColor: downNodes.length > 0 ? 'var(--danger-light)' : 'var(--success-light)',
            color: downNodes.length > 0 ? 'var(--danger)' : 'var(--success)',
          }}>
            <Icon name="check" size={28} />
          </div>
          <div className="dashboard-hero-content">
            <span className="dashboard-hero-value" style={{ color: downNodes.length > 0 ? 'var(--warning)' : 'var(--success)' }}>
              {animHealthyNodes}<span className="dashboard-hero-total">/{cniNodes.length}</span>
            </span>
            <span className="dashboard-hero-label">Healthy Nodes</span>
            {downNodes.length > 0 ? (
              <span className="dashboard-hero-status degraded">{downNodes.length} down</span>
            ) : (
              <span className="dashboard-hero-status healthy">All systems nominal</span>
            )}
          </div>
        </div>
        <div className="dashboard-hero-right">
          {cniNodes.length > 0 && (
            <DonutChart
              percentage={(healthyNodes.length / cniNodes.length) * 100}
              size={80}
              strokeWidth={8}
              color={downNodes.length === 0 ? 'var(--success)' : 'var(--warning)'}
            />
          )}
        </div>
      </div>

      {/* ── Key Metrics Grid ──────────────────────────────── */}
      <div className="dashboard-metrics">
        {/* Threats */}
        {threatsCount > 0 && (
          <div
            className="dashboard-metric threat"
            onClick={() => handleCardClick('security')}
            role="button"
            tabIndex={0}
          >
            <div className="dashboard-metric-icon threat">
              <Icon name="alert-triangle" size={20} />
            </div>
            <div className="dashboard-metric-content">
              <span className="dashboard-metric-value">{threatsCount}</span>
              <span className="dashboard-metric-label">Threats</span>
              {threatsCritical > 0 && (
                <span className="dashboard-metric-sub critical">{threatsCritical} critical</span>
              )}
            </div>
          </div>
        )}

        {/* BGP Peers */}
        <div className="dashboard-metric">
          <div className="dashboard-metric-icon">
            <Icon name="network" size={20} />
          </div>
          <div className="dashboard-metric-content">
            <span className="dashboard-metric-value">{animBgpPeers}</span>
            <span className="dashboard-metric-label">BGP Peers</span>
          </div>
        </div>

        {/* IP Pools */}
        <div
          className="dashboard-metric clickable"
          onClick={() => handleCardClick('network')}
          role="button"
          tabIndex={0}
        >
          <div className="dashboard-metric-icon purple">
            <Icon name="hard-drive" size={20} />
          </div>
          <div className="dashboard-metric-content">
            <span className="dashboard-metric-value">{animIpPools}</span>
            <span className="dashboard-metric-label">IP Pools</span>
          </div>
        </div>

        {/* IPAM Utilization */}
        <div className="dashboard-metric">
          <div className="dashboard-metric-chart">
            <DonutChart
              percentage={Math.round(ipamPct)}
              size={48}
              strokeWidth={5}
              color={ipamColor}
              showLabel={false}
            />
          </div>
          <div className="dashboard-metric-content">
            <span className="dashboard-metric-value" style={{ color: ipamColor }}>{Math.round(ipamPct)}%</span>
            <span className="dashboard-metric-label">IPAM Used</span>
            <span className="dashboard-metric-sub">{allocatedIPs}/{totalIPs} IPs</span>
          </div>
        </div>

        {/* Policies */}
        <div
          className="dashboard-metric clickable"
          onClick={() => handleCardClick('network')}
          role="button"
          tabIndex={0}
        >
          <div className="dashboard-metric-icon warning">
            <Icon name="shield" size={20} />
          </div>
          <div className="dashboard-metric-content">
            <span className="dashboard-metric-value">{animPolicies}</span>
            <span className="dashboard-metric-label">Policies</span>
          </div>
        </div>

        {/* Topology Edges */}
        <div
          className="dashboard-metric clickable"
          onClick={() => handleCardClick('network')}
          role="button"
          tabIndex={0}
        >
          <div className="dashboard-metric-icon info">
            <Icon name="activity" size={20} />
          </div>
          <div className="dashboard-metric-content">
            <span className="dashboard-metric-value">{cniTopologyEdges}</span>
            <span className="dashboard-metric-label">Topology Edges</span>
          </div>
        </div>
      </div>

      {/* ── Quick Actions & Status ────────────────────────── */}
      <div className="dashboard-actions">
        <div className="dashboard-status-bar">
          <DataSourceBadge status={cniNodesStatus} label="CNI nodes" />
          <DataSourceBadge status={ipamStatus} label="IPAM" />
          <DataSourceBadge status={policiesStatus} label="Policies" />
          <DataSourceBadge status={felixStatus} label="Felix" />
        </div>
        <div className="dashboard-quick-actions">
          <button className="dashboard-action-btn" onClick={silentRefresh} title="Refresh data">
            <Icon name="refresh-cw" size={14} />
            <span>Refresh</span>
          </button>
          <button className="dashboard-action-btn" onClick={exportData} title="Export data as JSON">
            <Icon name="download" size={14} />
            <span>Export</span>
          </button>
          <span className="dashboard-last-updated">
            <Icon name="clock" size={12} />
            {formatRelativeTime(lastUpdated)}
          </span>
        </div>
      </div>
    </div>
  )
}
