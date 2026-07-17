import { useState, useMemo } from 'react'
import { useDashboard, useTabSubscription } from '../context/DashboardContext'
import { DataSourceBadge } from './DataSourceBadge'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'

type CoverageFilter = 'all' | 'exposed' | 'covered'

export function PolicyCoveragePanel() {
  useTabSubscription('policies')

  const { policyCoverage: coverage, policiesStatus: status } = useDashboard()
  const [filter, setFilter] = useState<CoverageFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const exposedCount = coverage.filter(c => c.exposed).length
  const coveredCount = coverage.filter(c => !c.exposed).length

  // Compute namespace-level summary
  const nsSummary = useMemo(() => {
    const map = new Map<string, { total: number; exposed: number }>()
    for (const item of coverage) {
      const entry = map.get(item.namespace) || { total: 0, exposed: 0 }
      entry.total++
      if (item.exposed) entry.exposed++
      map.set(item.namespace, entry)
    }
    return Array.from(map.entries())
      .map(([namespace, stats]) => ({
        namespace,
        total: stats.total,
        exposed: stats.exposed,
        covered: stats.total - stats.exposed,
        coveragePct: stats.total > 0 ? Math.round(((stats.total - stats.exposed) / stats.total) * 100) : 100,
      }))
      .sort((a, b) => b.total - a.total)
  }, [coverage])

  // Filter and search
  const filteredCoverage = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return coverage.filter(item => {
      if (filter === 'exposed' && !item.exposed) return false
      if (filter === 'covered' && item.exposed) return false
      if (!q) return true
      return (
        (item.pod_name || '').toLowerCase().includes(q) ||
        (item.namespace || '').toLowerCase().includes(q) ||
        Object.entries(item.labels || {}).some(([k, v]) =>
          `${k}:${v}`.toLowerCase().includes(q)
        )
      )
    })
  }, [coverage, filter, searchQuery])

  const isFiltered = filter !== 'all' || searchQuery.trim().length > 0

  return (
    <div className="subsection">
      <div className="subsection-header">
        <h3>Policy Coverage</h3>
        <DataSourceBadge status={status} label="Coverage data" />
      </div>

      {/* M10: Warning about selector parser limitations */}
      <div className="info-banner" style={{ marginBottom: '16px', padding: '10px 14px', backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '8px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
        <Icon name="alert-triangle" size={16} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: '2px' }} />
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Coverage analysis supports basic Calico selectors only (<code>has</code>, <code>==</code>, <code>!=</code>, <code>in</code>, <code>&&</code>, <code>||</code>).
          Advanced selectors like <code>contains</code>, <code>matches</code>, <code>startsWith</code>, <code>endsWith</code>, or nested parentheses may be misclassified.
        </span>
      </div>

      {/* Summary cards */}
      <div className="coverage-summary-cards">
        <div className="coverage-summary-card">
          <div className="coverage-summary-icon" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
            <Icon name="layers" size={24} />
          </div>
          <div className="coverage-summary-content">
            <span className="coverage-summary-value" style={{ color: 'var(--primary)' }}>{coverage.length}</span>
            <span className="coverage-summary-label">Total Pods</span>
          </div>
        </div>
        <div className="coverage-summary-card">
          <div className="coverage-summary-icon" style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}>
            <Icon name="shield" size={24} />
          </div>
          <div className="coverage-summary-content">
            <span className="coverage-summary-value" style={{ color: 'var(--success)' }}>{coveredCount}</span>
            <span className="coverage-summary-label">Covered</span>
          </div>
        </div>
        <div className="coverage-summary-card coverage-card-danger">
          <div className="coverage-summary-icon" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
            <Icon name="unlock" size={24} />
          </div>
          <div className="coverage-summary-content">
            <span className="coverage-summary-value" style={{ color: 'var(--danger)' }}>{exposedCount}</span>
            <span className="coverage-summary-label">Exposed</span>
          </div>
        </div>
        <div className="coverage-summary-card">
          <div className="coverage-summary-icon" style={{ backgroundColor: 'rgba(139, 92, 246, 0.15)', color: '#8B5CF6' }}>
            <Icon name="globe" size={24} />
          </div>
          <div className="coverage-summary-content">
            <span className="coverage-summary-value" style={{ color: '#8B5CF6' }}>
              {coverage.length > 0 ? Math.round((coveredCount / coverage.length) * 100) : 100}%
            </span>
            <span className="coverage-summary-label">Coverage Rate</span>
          </div>
        </div>
      </div>

      {/* Namespace cards */}
      <div className="coverage-ns-cards">
        {nsSummary.map(ns => (
          <div
            key={ns.namespace}
            className={`coverage-ns-card ${ns.exposed > 0 ? 'coverage-ns-card-warn' : 'coverage-ns-card-safe'}`}
          >
            <div className="coverage-ns-card-header">
              <span className="coverage-ns-name">{ns.namespace}</span>
              <span className="coverage-ns-count">
                {ns.total} pod{ns.total !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="coverage-ns-stats">
              <div className="coverage-ns-stat">
                <span className="coverage-ns-stat-value coverage-ns-stat-covered">{ns.covered}</span>
                <span className="coverage-ns-stat-label">Covered</span>
              </div>
              <div className="coverage-ns-stat">
                <span className={`coverage-ns-stat-value ${ns.exposed > 0 ? 'coverage-ns-stat-exposed' : ''}`}>
                  {ns.exposed}
                </span>
                <span className="coverage-ns-stat-label">Exposed</span>
              </div>
            </div>
            <div className="coverage-ns-bar">
              <div
                className="coverage-ns-bar-fill"
                style={{ width: `${ns.coveragePct}%` }}
              />
            </div>
            <div className="coverage-ns-pct" style={{ color: ns.exposed > 0 ? 'var(--danger)' : 'var(--success)' }}>
              {ns.coveragePct}% covered
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="security-toolbar" style={{ marginBottom: '16px' }}>
        <div className="security-search">
          <Icon name="search" className="security-search-icon" />
          <input
            type="text"
            className="security-search-input"
            placeholder="Search pods by name, namespace, or label..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Search pods"
          />
          {searchQuery && (
            <button className="security-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search">
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
        <div className="security-filter-chips">
          <button
            className={`security-chip ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            className={`security-chip chip-danger ${filter === 'exposed' ? 'active' : ''}`}
            onClick={() => setFilter('exposed')}
          >
            Exposed Only
          </button>
          <button
            className={`security-chip ${filter === 'covered' ? 'active' : ''}`}
            onClick={() => setFilter('covered')}
          >
            Covered Only
          </button>
        </div>
      </div>

      {isFiltered && (
        <div className="security-results-meta">
          Found {filteredCoverage.length} pod{filteredCoverage.length !== 1 ? 's' : ''}
          {filter === 'exposed' && <span> · Exposed only</span>}
          {filter === 'covered' && <span> · Covered only</span>}
          {searchQuery && <span> · "<strong>{searchQuery}</strong>"</span>}
        </div>
      )}

      {/* Pod coverage table */}
      {coverage.length === 0 ? (
        <EmptyState
          icon={<Icon name="shield" size={48} />}
          message="No pod data available"
          submessage="Coverage data will appear when pods and policies are loaded."
        />
      ) : filteredCoverage.length === 0 ? (
        <EmptyState
          icon={<Icon name="search" size={48} />}
          message="No matching pods"
          submessage={filter === 'exposed' ? 'No exposed pods found.' : 'Try adjusting your filter or search.'}
        />
      ) : (
        <div className="storage-table-wrapper">
          <table className="storage-table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Pod</th>
                <th>Status</th>
                <th>Selecting Policies</th>
                <th>Labels</th>
              </tr>
            </thead>
            <tbody>
              {filteredCoverage.map(item => (
                <tr key={`${item.namespace}/${item.pod_name}`} className={item.exposed ? 'coverage-row-exposed' : ''}>
                  <td>
                    <span className="coverage-ns-tag">{item.namespace}</span>
                  </td>
                  <td className="cell-mono">{item.pod_name}</td>
                  <td>
                    {item.exposed ? (
                      <span className="coverage-badge coverage-badge-danger">
                        <Icon name="alert-triangle" size={12} /> EXPOSED
                      </span>
                    ) : (
                      <span className="coverage-badge badge-success">
                        <Icon name="shield" size={12} /> COVERED
                      </span>
                    )}
                  </td>
                  <td>
                    {(item.selecting_policies || []).length === 0 ? (
                      <span className="coverage-no-policies">(none)</span>
                    ) : (
                      <div className="coverage-policy-list">
                        {(item.selecting_policies || []).slice(0, 3).map(p => (
                          <span key={p} className="coverage-policy-tag">{p}</span>
                        ))}
                        {(item.selecting_policies || []).length > 3 && (
                          <span className="coverage-policy-more">+{(item.selecting_policies || []).length - 3}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="coverage-label-list">
                      {Object.entries(item.labels || {}).slice(0, 3).map(([k, v]) => (
                        <span key={k} className="label">{k}={v}</span>
                      ))}
                      {Object.keys(item.labels || {}).length > 3 && (
                        <span className="coverage-policy-more">+{Object.keys(item.labels || {}).length - 3}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
