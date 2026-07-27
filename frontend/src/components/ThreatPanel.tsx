import { useState, useMemo, useCallback, useEffect } from 'react'
import { useDashboard, useTabSubscription } from '../context/DashboardContext'
import type { ThreatEvent } from '../types'
import { EmptyState } from './EmptyState'
import { Skeleton } from './Skeleton'
import { getPriorityColor } from '../utils'
import { Icon } from './Icon'

const SEVERITIES = ['Critical', 'High', 'Medium', 'Warning'] as const

function getRelativeTime(timestamp: string): string {
  const now = Date.now()
  const time = new Date(timestamp).getTime()
  if (isNaN(time)) return 'just now'
  const diff = Math.floor((now - time) / 1000)
  if (diff < 5) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(timestamp).toLocaleDateString()
}

export function ThreatPanel() {
  const { threats, wsConnected, loading, clearThreats } = useDashboard()

  // Fetch threat history from the vault when this tab becomes active
  useTabSubscription('threats')
  const onClear = clearThreats
  const [searchQuery, setSearchQuery] = useState('')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [paused, setPaused] = useState(false)
  const [pausedSnapshot, setPausedSnapshot] = useState<ThreatEvent[] | null>(null)
  const [tick, setTick] = useState(0)

  // Re-render periodically to keep relative timestamps fresh
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(prev => prev + 1)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Take snapshot when pausing
  const handlePauseToggle = useCallback(() => {
    setPaused(prev => {
      if (!prev) {
        setPausedSnapshot(threats)
      }
      return !prev
    })
  }, [threats])

  const handleClear = useCallback(() => {
    setPausedSnapshot(null)
    setPaused(false)
    onClear?.()
  }, [onClear])

  // Use snapshot when paused, live data otherwise
  const displayThreats = paused && pausedSnapshot ? pausedSnapshot : threats

  const filteredThreats = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return displayThreats.filter(t => {
      if (severityFilter !== 'all' && t.priority !== severityFilter) return false
      if (!q) return true
      return (
        (t.rule || '').toLowerCase().includes(q) ||
        (t.output || '').toLowerCase().includes(q) ||
        (t.priority || '').toLowerCase().includes(q)
      )
    })
  }, [displayThreats, searchQuery, severityFilter])

  const isFiltered = searchQuery.trim().length > 0 || severityFilter !== 'all'

  // Compute severity counts
  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const sev of SEVERITIES) {
      counts[sev] = displayThreats.filter(t => t.priority === sev).length
    }
    return counts
  }, [displayThreats])

  return (
    <div className="section threats-section">
      <h2>Threat Detection</h2>

      {/* ── Polished status bar (compact-bar pattern) ── */}
      <div className="dashboard-compact-bar stagger-item" style={{ animationDelay: '0s' }}>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-icon" style={{ color: wsConnected ? 'var(--success)' : 'var(--danger)' }}>
            <Icon name={wsConnected ? 'radio' : 'alert-triangle'} size={16} />
          </span>
          <div className="dashboard-mini-stat-content">
            <span className="dashboard-mini-stat-value" style={{
              color: wsConnected ? 'var(--success)' : 'var(--danger)',
              fontSize: '12px',
              fontWeight: 600,
            }}>
              {wsConnected ? 'Live' : 'Disconnected'}
            </span>
            <span className="dashboard-mini-stat-label">
              {wsConnected ? 'Real-time monitoring active' : 'Connecting to threat stream...'}
            </span>
          </div>
        </div>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-icon" style={{ color: 'var(--danger)' }}>
            <Icon name="alert-triangle" size={16} />
          </span>
          <div className="dashboard-mini-stat-content">
            <span className="dashboard-mini-stat-value" style={{ color: 'var(--danger)' }}>
              {severityCounts.Critical || 0}
            </span>
            <span className="dashboard-mini-stat-label">Critical</span>
          </div>
        </div>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-icon" style={{ color: 'var(--warning)' }}>
            <Icon name="alert-triangle" size={16} />
          </span>
          <div className="dashboard-mini-stat-content">
            <span className="dashboard-mini-stat-value" style={{ color: 'var(--warning)' }}>
              {severityCounts.High || 0}
            </span>
            <span className="dashboard-mini-stat-label">High</span>
          </div>
        </div>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-icon" style={{ color: 'var(--info)' }}>
            <Icon name="info" size={16} />
          </span>
          <div className="dashboard-mini-stat-content">
            <span className="dashboard-mini-stat-value" style={{ color: 'var(--info)' }}>
              {(severityCounts.Medium || 0) + (severityCounts.Warning || 0)}
            </span>
            <span className="dashboard-mini-stat-label">Medium/Warning</span>
          </div>
        </div>
        <div className="dashboard-compbar-actions">
          <span className="dashboard-last-updated">
            {paused ? 'Stream paused' : `${filteredThreats.length} of ${displayThreats.length} events`}
          </span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="security-toolbar" style={{ marginBottom: '16px' }}>
        <div className="security-search" style={{ flex: 1 }}>
          <Icon name="search" size={16} className="security-search-icon" />
          <input
            type="text"
            className="security-search-input"
            placeholder="Search by rule, output, or priority..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Search threats"
          />
          {searchQuery && (
            <button
              className="security-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
        <div className="security-filter-chips">
          <button
            className={`security-chip ${severityFilter === 'all' ? 'active' : ''}`}
            onClick={() => setSeverityFilter('all')}
          >
            All
          </button>
          {SEVERITIES.map(sev => (
            <button
              key={sev}
              className={`security-chip chip-danger ${severityFilter === sev ? 'active' : ''}`}
              onClick={() => setSeverityFilter(sev)}
              style={severityFilter === sev ? {
                backgroundColor: getPriorityColor(sev),
                borderColor: getPriorityColor(sev),
                color: sev === 'Warning' || sev === 'Medium' ? '#000' : '#fff'
              } : undefined}
            >
              {sev}
            </button>
          ))}
        </div>
        <button
          className="refresh-btn"
          onClick={handlePauseToggle}
          title={paused ? 'Resume threat stream' : 'Pause threat stream'}
          aria-label={paused ? 'Resume' : 'Pause'}
          style={{ color: paused ? 'var(--warning)' : undefined, borderColor: paused ? 'var(--warning)' : undefined }}
        >
          <Icon name={paused ? 'play' : 'pause'} size={16} />
          <span>{paused ? 'Resume' : 'Pause'}</span>
        </button>
        <button
          className="refresh-btn"
          onClick={handleClear}
          title="Clear all threat events"
          aria-label="Clear threats"
        >
          <Icon name="trash-2" size={16} />
          <span>Clear</span>
        </button>
      </div>

      {/* Results meta */}
      {isFiltered && (
        <div className="security-results-meta">
          Found {filteredThreats.length} event{filteredThreats.length !== 1 ? 's' : ''}
          {searchQuery && <span> · <strong>"{searchQuery}"</strong></span>}
          {severityFilter !== 'all' && <span> · {severityFilter} only</span>}
        </div>
      )}

      {loading && displayThreats.length === 0 ? (
        <div className="threat-list" aria-label="Loading threats" data-tick={tick}>
          <Skeleton variant="threat" count={5} />
        </div>
      ) : displayThreats.length === 0 && !paused ? (
        <EmptyState
          icon={<Icon name="alert-triangle" size={48} />}
          message="No threats detected"
          submessage="All clear — no security events captured yet."
        />
      ) : paused && pausedSnapshot && displayThreats.length === 0 ? (
        <EmptyState
          icon={<Icon name="info" size={48} />}
          message="Threat stream paused — no events captured yet"
          submessage="Resume the stream to start receiving events."
        />
      ) : filteredThreats.length === 0 ? (
        <EmptyState
          icon={<Icon name="search" size={48} />}
          message="No matching threats"
          submessage="Try adjusting your search or filter criteria."
        />
      ) : (
        <div className="threat-list stagger-container" style={{ display: 'flex', flexDirection: 'column' }}>
          {filteredThreats.map((threat, idx) => (
            <div
              key={threat.id}
              className={`threat-card ${(threat.priority || '').toLowerCase()} gradient-border-card stagger-item`}
              style={{ animationDelay: `${0.03 + idx * 0.04}s` }}
            >
              <div className="threat-header">
                <span className="priority-dot" style={{ backgroundColor: getPriorityColor(threat.priority) }} role="img" aria-label={threat.priority}></span>
                <span className="priority">{threat.priority}</span>
                <span className="rule" title={threat.rule}>{threat.rule}</span>
                <span className="time" title={new Date(threat.time).toLocaleString()}>{getRelativeTime(threat.time)}</span>
              </div>
              <p className="output" title={threat.output}>{threat.output}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
