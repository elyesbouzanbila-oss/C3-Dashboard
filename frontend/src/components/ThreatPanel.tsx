import { useState, useMemo, useCallback, useEffect } from 'react'
import { useDashboard } from '../context/DashboardContext'
import type { ThreatEvent } from '../types'
import { EmptyState } from './EmptyState'
import { Skeleton } from './Skeleton'
import { getPriorityColor } from '../utils'
import { Icon } from './Icon'

const SEVERITIES = ['Critical', 'High', 'Medium', 'Warning'] as const

function getRelativeTime(timestamp: string): string {
  const now = Date.now()
  const time = new Date(timestamp).getTime()
  const diff = Math.floor((now - time) / 1000)
  if (diff < 0) return 'just now'
  if (diff < 5) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(timestamp).toLocaleDateString()
}

export function ThreatPanel() {
  const { threats, wsConnected, loading, clearThreats } = useDashboard()
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

  return (
    <div className="section threats-section">
      <h2>Threat Detection</h2>

      <div className="threat-status">
        <span className={`indicator ${wsConnected ? 'connected' : 'disconnected'}`}></span>
        {wsConnected ? (
          <span>Real-time threat monitoring active</span>
        ) : (
          <span>Connecting to threat stream...</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-tertiary)' }}>
          {paused ? 'Stream paused' : `Showing ${filteredThreats.length} of ${displayThreats.length} events`}
        </span>
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
              className={`security-chip ${severityFilter === sev ? 'active' : ''}`}
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
        <div className="threat-list">
          {filteredThreats.map((threat) => (
            <div key={threat.id} className={`threat-card ${(threat.priority || '').toLowerCase()}`}>
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
