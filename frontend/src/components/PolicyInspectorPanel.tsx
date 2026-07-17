import { useState, useMemo } from 'react'
import { useDashboard } from '../context/DashboardContext'
import { DataSourceBadge } from './DataSourceBadge'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'

const ACTION_COLORS: Record<string, string> = {
  Allow: 'var(--success)',
  Deny: 'var(--danger)',
  Log: 'var(--warning)',
  Pass: 'var(--info)',
}

const ACTION_BG: Record<string, string> = {
  Allow: 'var(--success-light)',
  Deny: 'var(--danger-light)',
  Log: 'rgba(234, 179, 8, 0.15)',
  Pass: 'rgba(6, 182, 212, 0.15)',
}

function ActionBadge({ actions }: { actions: string[] | null | undefined }) {
  if (!actions || actions.length === 0) {
    return (
      <span className="badge" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
        Deny
      </span>
    )
  }

  // Multiple actions — show mixed
  if (actions.length > 1) {
    return (
      <span className="badge" style={{ backgroundColor: 'rgba(139, 92, 246, 0.15)', color: '#8B5CF6' }}>
        Mixed
      </span>
    )
  }

  const action = actions[0]
  return (
    <span className="badge" style={{
      backgroundColor: ACTION_BG[action] || 'var(--danger-light)',
      color: ACTION_COLORS[action] || 'var(--danger)',
    }}>
      {action}
    </span>
  )
}

export function PolicyInspectorPanel() {
  const { cniPolicies: policies, policiesStatus: status } = useDashboard()
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'NetworkPolicy' | 'GlobalNetworkPolicy'>('all')

  const filteredPolicies = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return policies.filter(p => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false
      if (!q) return true
      return (
        (p.name || '').toLowerCase().includes(q) ||
        (p.namespace || '').toLowerCase().includes(q) ||
        (p.selector || '').toLowerCase().includes(q)
      )
    })
  }, [policies, searchQuery, typeFilter])

  const globalPolicies = filteredPolicies.filter(p => p.type === 'GlobalNetworkPolicy')
  const namespacedPolicies = filteredPolicies.filter(p => p.type === 'NetworkPolicy')

  const isFiltered = searchQuery.trim().length > 0 || typeFilter !== 'all'

  // Derive rule_actions stats from all policies
  const allActions = useMemo(() => {
    const count: Record<string, number> = {}
    for (const p of policies) {
      for (const a of p.rule_actions || []) {
        count[a] = (count[a] || 0) + 1
      }
    }
    return count
  }, [policies])

  return (
    <div className="section policies-section">
      <h2>Network Policies</h2>

      {/* Summary */}
      <div className="security-stats" style={{ marginBottom: '20px' }}>
        <div className="security-stat-card">
          <div className="security-stat-icon" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
            <Icon name="shield" size={24} />
          </div>
          <div className="security-stat-content">
            <span className="security-stat-value" style={{ color: 'var(--primary)' }}>{policies.length}</span>
            <span className="security-stat-label">Total Policies</span>
          </div>
        </div>
        <div className="security-stat-card">
          <div className="security-stat-icon" style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}>
            <Icon name="check" size={24} />
          </div>
          <div className="security-stat-content">
            <span className="security-stat-value" style={{ color: 'var(--success)' }}>
              {allActions['Allow'] || 0}
            </span>
            <span className="security-stat-label">Allow Rules</span>
          </div>
        </div>
        <div className="security-stat-card">
          <div className="security-stat-icon" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
            <Icon name="x" size={24} />
          </div>
          <div className="security-stat-content">
            <span className="security-stat-value" style={{ color: 'var(--danger)' }}>
              {allActions['Deny'] || 0}
            </span>
            <span className="security-stat-label">Deny Rules</span>
          </div>
        </div>
        <div className="security-stat-card">
          <div className="security-stat-icon" style={{ backgroundColor: 'rgba(139, 92, 246, 0.15)', color: '#8B5CF6' }}>
            <Icon name="network" size={24} />
          </div>
          <div className="security-stat-content">
            <span className="security-stat-value" style={{ color: '#8B5CF6' }}>
              {policies.filter(p => p.type === 'GlobalNetworkPolicy').length}
            </span>
            <span className="security-stat-label">Global Policies</span>
          </div>
        </div>
      </div>

      <div className="subsection">
        <div className="subsection-header">
          <h3>Policy Definitions</h3>
          <DataSourceBadge status={status} label="Policy data" />
        </div>

        {/* Search & filter */}
        <div className="security-toolbar" style={{ marginBottom: '16px' }}>
          <div className="security-search">
            <Icon name="search" className="security-search-icon" />
            <input
              type="text"
              className="security-search-input"
              placeholder="Search policies by name, namespace, or selector..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              aria-label="Search policies"
            />
            {searchQuery && (
              <button className="security-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search">
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
          <div className="security-filter-chips">
            <button className={`security-chip ${typeFilter === 'all' ? 'active' : ''}`} onClick={() => setTypeFilter('all')}>
              All
            </button>
            <button className={`security-chip ${typeFilter === 'GlobalNetworkPolicy' ? 'active' : ''}`} onClick={() => setTypeFilter('GlobalNetworkPolicy')}>
              Global
            </button>
            <button className={`security-chip ${typeFilter === 'NetworkPolicy' ? 'active' : ''}`} onClick={() => setTypeFilter('NetworkPolicy')}>
              Namespaced
            </button>
          </div>
        </div>

        {isFiltered && (
          <div className="security-results-meta">
            Found {filteredPolicies.length} polic{filteredPolicies.length !== 1 ? 'ies' : 'y'}
            {searchQuery && <span> · "<strong>{searchQuery}</strong>"</span>}
            {typeFilter !== 'all' && <span> · {typeFilter === 'GlobalNetworkPolicy' ? 'Global' : 'Namespaced'} only</span>}
          </div>
        )}

        {policies.length === 0 ? (
          <EmptyState
            icon={<Icon name="shield" size={48} />}
            message="No network policies found"
            submessage="Calico GlobalNetworkPolicies and NetworkPolicies will appear here."
          />
        ) : filteredPolicies.length === 0 ? (
          <EmptyState
            icon={<Icon name="search" size={48} />}
            message="No matching policies"
            submessage="Try adjusting your search or filter."
          />
        ) : (
          <div className="storage-table-wrapper">
            <table className="storage-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Namespace</th>
                  <th>Selector</th>
                  <th>Order</th>
                  <th>Actions</th>
                  <th>Rules</th>
                </tr>
              </thead>
              <tbody>
                {globalPolicies.map(p => (
                  <tr key={`global-${p.name}`}>
                    <td className="cell-mono">{p.name}</td>
                    <td><span className="badge badge-muted">Global</span></td>
                    <td className="cell-mono" style={{ color: 'var(--text-tertiary)' }}>—</td>
                    <td className="cell-mono" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.selector || 'all()'}</td>
                    <td>{p.order != null ? p.order.toFixed(1) : '—'}</td>
                    <td><ActionBadge actions={p.rule_actions} /></td>
                    <td>{p.rules_count}</td>
                  </tr>
                ))}
                {namespacedPolicies.map(p => (
                  <tr key={`${p.namespace}-${p.name}`}>
                    <td className="cell-mono">{p.name}</td>
                    <td><span className="badge badge-muted">Namespaced</span></td>
                    <td>{p.namespace}</td>
                    <td className="cell-mono" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.selector || 'all()'}</td>
                    <td>{p.order != null ? p.order.toFixed(1) : '—'}</td>
                    <td><ActionBadge actions={p.rule_actions} /></td>
                    <td>{p.rules_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
