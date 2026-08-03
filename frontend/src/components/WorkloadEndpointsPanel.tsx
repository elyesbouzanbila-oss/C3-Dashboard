import { useState, useMemo } from 'react'
import { useDashboard, useTabSubscription } from '../context/DashboardContext'
import { DataSourceBadge } from './DataSourceBadge'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'

export type EndpointFilter = 'all' | 'exposed' | 'covered'

function DigestChip({ digest }: { digest: { allow: number; deny: number; log: number; pass: number; ports: string[] } }) {
  const parts: React.ReactNode[] = []
  if (digest.allow > 0) {
    parts.push(<span key="a" className="digest-chip digest-allow">{digest.allow} allow</span>)
  }
  if (digest.deny > 0) {
    parts.push(<span key="d" className="digest-chip digest-deny">{digest.deny} deny</span>)
  }
  if (digest.log > 0) {
    parts.push(<span key="l" className="digest-chip digest-log">{digest.log} log</span>)
  }
  if (digest.pass > 0) {
    parts.push(<span key="p" className="digest-chip digest-pass">{digest.pass} pass</span>)
  }
  if (parts.length === 0) {
    return <span className="coverage-no-policies">(none)</span>
  }
  const ports = digest.ports.slice(0, 3).join(', ')
  return (
    <span className="digest-group" title={ports ? `Ports: ${ports}` : undefined}>
      {parts}
    </span>
  )
}

interface WorkloadEndpointsPanelProps {
  /** Pre-filled search query when returning to this view. */
  initialSearch?: string
  /** Pre-selected filter chip when returning to this view. */
  initialFilter?: EndpointFilter
  /** Reports filter changes up so cross-navigation can preserve them. */
  onFilterChange?: (filter: EndpointFilter) => void
  /** Reports search changes up so cross-navigation can preserve them. */
  onSearchChange?: (search: string) => void
  /** Called when a selecting-policy tag is clicked. */
  onOpenImpact?: (policyName: string) => void
}

export function WorkloadEndpointsPanel({
  initialSearch = '',
  initialFilter = 'all',
  onFilterChange,
  onSearchChange,
  onOpenImpact,
}: WorkloadEndpointsPanelProps) {
  useTabSubscription('policies')

  const { policyMatrix, policyMatrixStatus: status } = useDashboard()
  const endpoints = useMemo(() => policyMatrix?.workload_endpoints ?? [], [policyMatrix])

  // The panel remounts on every subview switch (conditional render in
  // NetworkSection), so it initializes from the props each time. Changes
  // are reported up so the parent can hand them back on the next mount.
  const [filter, setFilter] = useState<EndpointFilter>(initialFilter)
  const [searchQuery, setSearchQuery] = useState(initialSearch)

  const handleFilterChange = (next: EndpointFilter) => {
    setFilter(next)
    onFilterChange?.(next)
  }

  const handleSearchChange = (next: string) => {
    setSearchQuery(next)
    onSearchChange?.(next)
  }

  const exposedCount = endpoints.filter(e => e.exposed).length
  const coveredCount = endpoints.length - exposedCount

  const filteredEndpoints = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return endpoints.filter(ep => {
      if (filter === 'exposed' && !ep.exposed) return false
      if (filter === 'covered' && ep.exposed) return false
      if (!q) return true
      const ns = (ep.namespace || '').toLowerCase()
      const pod = (ep.pod_name || '').toLowerCase()
      // Support "namespace/pod" queries coming from the Impact view's pod chips.
      if (q.includes('/')) {
        const [nsPart, podPart] = q.split('/')
        return ns.includes((nsPart || '').trim()) && pod.includes((podPart || '').trim())
      }
      return (
        pod.includes(q) ||
        ns.includes(q) ||
        (ep.node_name || '').toLowerCase().includes(q) ||
        Object.entries(ep.labels || {}).some(([k, v]) => `${k}:${v}`.toLowerCase().includes(q))
      )
    })
  }, [endpoints, filter, searchQuery])

  const isFiltered = filter !== 'all' || searchQuery.trim().length > 0

  return (
    <div className="subsection">
      <div className="subsection-header">
        <h3>Workload Endpoints</h3>
        <DataSourceBadge status={status} label="Policy matrix data" />
      </div>

      {/* Summary cards */}
      <div className="coverage-summary-cards">
        <div className="coverage-summary-card">
          <div className="coverage-summary-icon" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
            <Icon name="pod" size={24} />
          </div>
          <div className="coverage-summary-content">
            <span className="coverage-summary-value" style={{ color: 'var(--primary)' }}>{endpoints.length}</span>
            <span className="coverage-summary-label">Total Endpoints</span>
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
            <Icon name="activity" size={24} />
          </div>
          <div className="coverage-summary-content">
            <span className="coverage-summary-value" style={{ color: '#8B5CF6' }}>
              {endpoints.length > 0 ? Math.round((coveredCount / endpoints.length) * 100) : 100}%
            </span>
            <span className="coverage-summary-label">Coverage Rate</span>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="security-toolbar" style={{ marginBottom: '16px' }}>
        <div className="security-search">
          <Icon name="search" className="security-search-icon" />
          <input
            type="text"
            className="security-search-input"
            placeholder="Search endpoints by pod, namespace, node, or label..."
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
            aria-label="Search endpoints"
          />
          {searchQuery && (
            <button className="security-search-clear" onClick={() => handleSearchChange('')} aria-label="Clear search">
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
        <div className="security-filter-chips">
          <button className={`security-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => handleFilterChange('all')}>
            All
          </button>
          <button className={`security-chip chip-danger ${filter === 'exposed' ? 'active' : ''}`} onClick={() => handleFilterChange('exposed')}>
            Exposed Only
          </button>
          <button className={`security-chip ${filter === 'covered' ? 'active' : ''}`} onClick={() => handleFilterChange('covered')}>
            Covered Only
          </button>
        </div>
      </div>

      {isFiltered && (
        <div className="security-results-meta">
          Found {filteredEndpoints.length} endpoint{filteredEndpoints.length !== 1 ? 's' : ''}
          {filter === 'exposed' && <span> · Exposed only</span>}
          {filter === 'covered' && <span> · Covered only</span>}
          {searchQuery && <span> · "<strong>{searchQuery}</strong>"</span>}
        </div>
      )}

      {/* Table */}
      {endpoints.length === 0 ? (
        <EmptyState
          icon={<Icon name="pod" size={48} />}
          message="No endpoint data available"
          submessage="Workload endpoints will appear when pods and policies are loaded."
        />
      ) : filteredEndpoints.length === 0 ? (
        <EmptyState
          icon={<Icon name="search" size={48} />}
          message="No matching endpoints"
          submessage={filter === 'exposed' ? 'No exposed endpoints found.' : 'Try adjusting your filter or search.'}
        />
      ) : (
        <div className="storage-table-wrapper">
          <table className="storage-table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Pod</th>
                <th>Interface</th>
                <th>Status</th>
                <th>Selecting Policies</th>
                <th>Ingress</th>
                <th>Egress</th>
              </tr>
            </thead>
            <tbody>
              {filteredEndpoints.map(ep => (
                <tr key={`${ep.namespace}/${ep.pod_name}`} className={ep.exposed ? 'coverage-row-exposed' : ''}>
                  <td>
                    <span className="coverage-ns-tag">{ep.namespace}</span>
                  </td>
                  <td className="cell-mono">
                    {ep.pod_name}
                    <div className="endpoint-sub">
                      {ep.node_name && <span>{ep.node_name}</span>}
                      {ep.pod_ip && <span>{ep.pod_ip}</span>}
                    </div>
                  </td>
                  <td>
                    <span className={`endpoint-interface ${ep.interface_status === 'up' ? 'up' : 'down'}`}>
                      <span className="endpoint-interface-dot" />
                      {ep.interface_status === 'up' ? 'UP' : 'DOWN'}
                    </span>
                  </td>
                  <td>
                    {ep.exposed ? (
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
                    {ep.selecting_policies.length === 0 ? (
                      <span className="coverage-no-policies">(none)</span>
                    ) : (
                      <div className="coverage-policy-list">
                        {ep.selecting_policies.slice(0, 3).map(p => (
                          <button
                            key={p.name}
                            type="button"
                            className="coverage-policy-tag coverage-policy-tag-link"
                            title={`Open impact view for ${p.name}`}
                            onClick={() => onOpenImpact?.(p.name)}
                          >
                            {p.name}
                          </button>
                        ))}
                        {ep.selecting_policies.length > 3 && (
                          <span className="coverage-policy-more">+{ep.selecting_policies.length - 3}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td><DigestChip digest={ep.ingress} /></td>
                  <td><DigestChip digest={ep.egress} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
