import { useState, useMemo } from 'react'
import { useDashboard, useTabSubscription } from '../context/DashboardContext'
import { DataSourceBadge } from './DataSourceBadge'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'
import type { PolicyImpact } from '../types'

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

function ActionBadge({ action }: { action: string }) {
  return (
    <span className="badge" style={{ backgroundColor: ACTION_BG[action] || 'var(--danger-light)', color: ACTION_COLORS[action] || 'var(--danger)' }}>
      {action}
    </span>
  )
}

function PeerSelector({ selector }: { selector?: string | null }) {
  if (!selector) return <span className="coverage-no-policies">—</span>
  return <code className="impact-selector">{selector}</code>
}

interface PolicyImpactPanelProps {
  /** Policy to preselect when navigating from the Endpoints view. */
  initialPolicyName?: string
  /** Called when a pod chip is clicked. */
  onOpenEndpoint?: (podQuery: string) => void
  /** Shows a back-link that returns to the view this panel was opened from. */
  onBack?: () => void
}

export function PolicyImpactPanel({ initialPolicyName = '', onOpenEndpoint, onBack }: PolicyImpactPanelProps) {
  useTabSubscription('policies')

  const { policyMatrix, policyMatrixStatus: status } = useDashboard()
  const impacts = useMemo(() => policyMatrix?.policy_impacts ?? [], [policyMatrix])

  // The panel remounts on every subview switch (conditional render in
  // NetworkSection), so initializing from the prop is always fresh.
  const [selectedName, setSelectedName] = useState<string>(initialPolicyName)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredImpacts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return impacts.filter(p => {
      if (!q) return true
      return (
        (p.name || '').toLowerCase().includes(q) ||
        (p.namespace || '').toLowerCase().includes(q) ||
        (p.selector || '').toLowerCase().includes(q)
      )
    })
  }, [impacts, searchQuery])

  // Auto-select the first policy when data arrives / search resets
  const selected: PolicyImpact | undefined =
    impacts.find(p => p.name === selectedName) ||
    filteredImpacts[0]

  const effectiveSelectedName = selected?.name ?? ''
  const isFiltered = searchQuery.trim().length > 0
  const totalSelected = impacts.reduce((sum, p) => sum + p.selected_count, 0)

  return (
    <div className="subsection">
      <div className="subsection-header">
        <h3>Policy Impact</h3>
        {onBack && (
          <button type="button" className="impact-back-link" onClick={onBack}>
            <Icon name="arrow-left" size={14} /> Back to Endpoints
          </button>
        )}
        <DataSourceBadge status={status} label="Policy matrix data" />
      </div>

      {/* Summary */}
      <div className="coverage-summary-cards">
        <div className="coverage-summary-card">
          <div className="coverage-summary-icon" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
            <Icon name="shield" size={24} />
          </div>
          <div className="coverage-summary-content">
            <span className="coverage-summary-value" style={{ color: 'var(--primary)' }}>{impacts.length}</span>
            <span className="coverage-summary-label">Policies</span>
          </div>
        </div>
        <div className="coverage-summary-card">
          <div className="coverage-summary-icon" style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}>
            <Icon name="pod" size={24} />
          </div>
          <div className="coverage-summary-content">
            <span className="coverage-summary-value" style={{ color: 'var(--success)' }}>{totalSelected}</span>
            <span className="coverage-summary-label">Pods Selected</span>
          </div>
        </div>
        <div className="coverage-summary-card">
          <div className="coverage-summary-icon" style={{ backgroundColor: 'rgba(139, 92, 246, 0.15)', color: '#8B5CF6' }}>
            <Icon name="list" size={24} />
          </div>
          <div className="coverage-summary-content">
            <span className="coverage-summary-value" style={{ color: '#8B5CF6' }}>
              {impacts.reduce((sum, p) => sum + p.rules.length, 0)}
            </span>
            <span className="coverage-summary-label">Rules</span>
          </div>
        </div>
        <div className="coverage-summary-card">
          <div className="coverage-summary-icon" style={{ backgroundColor: 'rgba(6, 182, 212, 0.15)', color: '#06B6D4' }}>
            <Icon name="network" size={24} />
          </div>
          <div className="coverage-summary-content">
            <span className="coverage-summary-value" style={{ color: '#06B6D4' }}>
              {impacts.filter(p => p.type === 'GlobalNetworkPolicy').length}
            </span>
            <span className="coverage-summary-label">Global</span>
          </div>
        </div>
      </div>

      {/* Policy picker */}
      <div className="impact-picker">
        <div className="security-search" style={{ flex: '1' }}>
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
        <select
          className="impact-select"
          value={effectiveSelectedName}
          onChange={e => setSelectedName(e.target.value)}
          aria-label="Select policy"
        >
          {filteredImpacts.map(p => (
            <option key={p.name} value={p.name}>
              {p.namespace ? `${p.namespace}/${p.name}` : p.name}
            </option>
          ))}
        </select>
      </div>

      {isFiltered && (
        <div className="security-results-meta">
          Found {filteredImpacts.length} polic{filteredImpacts.length !== 1 ? 'ies' : 'y'}
          {searchQuery && <span> · "<strong>{searchQuery}</strong>"</span>}
        </div>
      )}

      {impacts.length === 0 ? (
        <EmptyState
          icon={<Icon name="shield" size={48} />}
          message="No policy impact data available"
          submessage="Select a policy to see the pods it applies to and its rule-by-rule effect."
        />
      ) : !selected ? (
        <EmptyState
          icon={<Icon name="search" size={48} />}
          message="No matching policies"
          submessage="Try adjusting your search."
        />
      ) : (
        <>
          {/* Selected policy header */}
          <div className="impact-policy-header">
            <div className="impact-policy-title">
              <span className="badge badge-muted">
                {selected.type === 'GlobalNetworkPolicy' ? 'Global' : 'Namespaced'}
              </span>
              <span className="impact-policy-name cell-mono">{selected.name}</span>
              {selected.namespace && <span className="coverage-ns-tag">{selected.namespace}</span>}
              <span className="impact-policy-selector">
                selector: <code className="impact-selector">{selected.selector || 'all()'}</code>
              </span>
            </div>
            <div className="impact-policy-meta">
              <span className="coverage-summary-label">{selected.selected_count} pod{selected.selected_count !== 1 ? 's' : ''} selected</span>
            </div>
          </div>

          {/* Selected pods */}
          <div className="impact-pods">
            {selected.selected_pods.length === 0 ? (
              <span className="coverage-no-policies">This policy selects no pods.</span>
            ) : (
              selected.selected_pods.slice(0, 12).map(pod => (
                <button
                  key={`${pod.namespace}/${pod.pod_name}`}
                  type="button"
                  className="impact-pod-chip impact-pod-chip-link"
                  title={`Open endpoint for ${pod.namespace}/${pod.pod_name}`}
                  onClick={() => onOpenEndpoint?.(`${pod.namespace}/${pod.pod_name}`)}
                >
                  {pod.namespace}/{pod.pod_name}
                </button>
              ))
            )}
            {selected.selected_pods.length > 12 && (
              <span className="coverage-policy-more">+{selected.selected_pods.length - 12} more</span>
            )}
          </div>

          {/* Rule breakdown */}
          {selected.rules.length === 0 ? (
            <div className="info-banner" style={{ marginTop: '16px', padding: '10px 14px', backgroundColor: 'rgba(6, 182, 212, 0.08)', border: '1px solid rgba(6, 182, 212, 0.25)', borderRadius: '8px' }}>
              <Icon name="info" size={16} style={{ color: 'var(--info)', flexShrink: 0 }} />
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                This policy has no explicit rules — its effect comes from Calico's default action.
              </span>
            </div>
          ) : (
            <div className="storage-table-wrapper" style={{ marginTop: '16px' }}>
              <table className="storage-table">
                <thead>
                  <tr>
                    <th>Dir</th>
                    <th>Action</th>
                    <th>Protocol</th>
                    <th>Ports</th>
                    <th>Source</th>
                    <th>Destination</th>
                    <th>Matched Pods</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.rules.map(rule => (
                    <tr key={`${rule.direction}-${rule.index}`}>
                      <td>
                        <span className={`impact-dir ${rule.direction === 'Ingress' ? 'in' : 'out'}`}>
                          {rule.direction === 'Ingress' ? 'IN' : 'OUT'}
                        </span>
                      </td>
                      <td><ActionBadge action={rule.action} /></td>
                      <td>{rule.protocol || <span className="coverage-no-policies">any</span>}</td>
                      <td className="cell-mono">
                        {rule.ports.length > 0 ? rule.ports.join(', ') : <span className="coverage-no-policies">all</span>}
                      </td>
                      <td><PeerSelector selector={rule.source_selector} /></td>
                      <td><PeerSelector selector={rule.destination_selector} /></td>
                      <td>
                        {rule.matched_count === 0 ? (
                          <span className="coverage-no-policies">(none)</span>
                        ) : (
                          <span className="impact-matched">
                            {rule.matched_pods.slice(0, 2).map(p => (
                              <button
                                key={`${p.namespace}/${p.pod_name}`}
                                type="button"
                                className="impact-pod-chip impact-pod-chip-link"
                                title={`Open endpoint for ${p.namespace}/${p.pod_name}`}
                                onClick={() => onOpenEndpoint?.(`${p.namespace}/${p.pod_name}`)}
                              >
                                {p.pod_name}
                              </button>
                            ))}
                            {rule.matched_pods.length > 2 && (
                              <span className="coverage-policy-more">+{rule.matched_pods.length - 2}</span>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
