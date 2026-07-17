import { useState, useMemo } from 'react'
import { useDashboard, useTabSubscription } from '../context/DashboardContext'
import { DataSourceBadge } from './DataSourceBadge'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'
import { getNsColor } from '../utils'

export function SecurityPanel() {
  useTabSubscription('security', { refetchOnFocus: true })

  const { rbacBindings, privilegedPods, rbacBindingsStatus, privilegedPodsStatus } = useDashboard()
  const [rbacSearch, setRbacSearch] = useState('')
  const [rbacTypeFilter, setRbacTypeFilter] = useState<'all' | 'ClusterRoleBinding' | 'RoleBinding'>('all')
  const [privSearch, setPrivSearch] = useState('')

  // ── RBAC Stats ───────────────────────────────────────────────
  const clusterBindings = rbacBindings.filter(b => b.binding_type === 'ClusterRoleBinding')
  const adminBindings = rbacBindings.filter(b =>
    b.role_ref.name === 'cluster-admin' || b.role_ref.name === 'admin'
  )
  const privilegedCount = privilegedPods.filter(p => p.privileged).length
  const rootCount = privilegedPods.filter(p => (p.run_as_user ?? 0) === 0).length

  // ── Filtered RBAC ────────────────────────────────────────────
  const filteredRbac = useMemo(() => {
    const q = rbacSearch.toLowerCase().trim()
    return rbacBindings.filter(b => {
      if (rbacTypeFilter !== 'all' && b.binding_type !== rbacTypeFilter) return false
      if (!q) return true
      return (
        (b.name || '').toLowerCase().includes(q) ||
        (b.namespace || '').toLowerCase().includes(q) ||
        (b.role_ref.name || '').toLowerCase().includes(q) ||
        b.subjects.some(s =>
          (s.name || '').toLowerCase().includes(q) ||
          (s.kind || '').toLowerCase().includes(q)
        )
      )
    })
  }, [rbacBindings, rbacSearch, rbacTypeFilter])

  // ── Filtered Privileged Pods ─────────────────────────────────
  const filteredPrivileged = useMemo(() => {
    const q = privSearch.toLowerCase().trim()
    if (!q) return privilegedPods
    return privilegedPods.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.namespace || '').toLowerCase().includes(q) ||
      (p.container || '').toLowerCase().includes(q) ||
      (p.image || '').toLowerCase().includes(q)
    )
  }, [privilegedPods, privSearch])

  // ── Subject Icon ─────────────────────────────────────────────
  function SubjectIcon({ kind, className }: { kind: string; className?: string }) {
    const props = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
      strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, width: 14, height: 14, className }
    if (kind === 'User') {
      return (
        <svg {...props}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      )
    }
    if (kind === 'Group') {
      return (
        <svg {...props}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )
    }
    // ServiceAccount
    return (
      <svg {...props}>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="9" y1="21" x2="9" y2="9" />
      </svg>
    )
  }

  return (
    <div className="section security-audit-section">
      <h2>Security Audit</h2>

      {/* ── Summary Stats ─────────────────────────────────────── */}
      <div className="security-stats" style={{ marginBottom: '20px' }}>
        <div className="security-stat-card">
          <div className="security-stat-icon stat-icon-bindings">
            <Icon name="layers" size={24} />
          </div>
          <div className="security-stat-content">
            <span className="security-stat-value">{rbacBindings.length}</span>
            <span className="security-stat-label">Total Bindings</span>
          </div>
        </div>
        <div className="security-stat-card">
          <div className="security-stat-icon stat-icon-admin">
            <Icon name="shield" size={24} />
          </div>
          <div className="security-stat-content">
            <span className="security-stat-value security-stat-value-danger">{adminBindings.length}</span>
            <span className="security-stat-label">Admin-Level</span>
            <span className="security-stat-sub">{clusterBindings.length} cluster-wide</span>
          </div>
        </div>
        <div className="security-stat-card">
          <div className="security-stat-icon stat-icon-privileged">
            <Icon name="unlock" size={24} />
          </div>
          <div className="security-stat-content">
            <span className="security-stat-value" style={{ color: privilegedCount > 0 ? 'var(--danger)' : 'var(--success)' }}>
              {privilegedCount}
            </span>
            <span className="security-stat-label">Privileged Pods</span>
          </div>
        </div>
        <div className="security-stat-card">
          <div className="security-stat-icon" style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)' }}>
            <Icon name="server" size={24} />
          </div>
          <div className="security-stat-content">
            <span className="security-stat-value" style={{ color: rootCount > 0 ? 'var(--warning)' : 'var(--success)' }}>
              {rootCount}
            </span>
            <span className="security-stat-label">Root Containers</span>
          </div>
        </div>
      </div>

      {/* ── RBAC Bindings ─────────────────────────────────────── */}
      <div className="subsection">
        <div className="subsection-header">
          <h3>RBAC Bindings</h3>
          <DataSourceBadge status={rbacBindingsStatus} label="RBAC data" />
        </div>

        {/* Toolbar */}
        <div className="security-toolbar" style={{ marginBottom: '16px' }}>
          <div className="security-search">
            <Icon name="search" className="security-search-icon" />
            <input
              type="text"
              className="security-search-input"
              placeholder="Search by name, namespace, role, or subject..."
              value={rbacSearch}
              onChange={e => setRbacSearch(e.target.value)}
              aria-label="Search RBAC bindings"
            />
            {rbacSearch && (
              <button className="security-search-clear" onClick={() => setRbacSearch('')} aria-label="Clear search">
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
          <div className="security-filter-chips">
            <button className={`security-chip ${rbacTypeFilter === 'all' ? 'active' : ''}`} onClick={() => setRbacTypeFilter('all')}>All</button>
            <button className={`security-chip ${rbacTypeFilter === 'ClusterRoleBinding' ? 'active' : ''}`} onClick={() => setRbacTypeFilter('ClusterRoleBinding')}>Cluster</button>
            <button className={`security-chip ${rbacTypeFilter === 'RoleBinding' ? 'active' : ''}`} onClick={() => setRbacTypeFilter('RoleBinding')}>Namespaced</button>
          </div>
        </div>

        {rbacBindings.length === 0 ? (
          <EmptyState
            icon={<Icon name="layers" size={48} />}
            message="No RBAC binding data"
            submessage="RBAC bindings will appear once the backend connects to the K8s API."
          />
        ) : filteredRbac.length === 0 ? (
          <EmptyState
            icon={<Icon name="search" size={48} />}
            message="No matching bindings"
            submessage="Try adjusting your search or filter."
          />
        ) : (
          <div className="rbac-list">
            {filteredRbac.map(b => {
              const isAdmin = b.role_ref.name === 'cluster-admin' || b.role_ref.name === 'admin'
              const isCluster = b.binding_type === 'ClusterRoleBinding'
              return (
                <div
                  key={`${b.namespace || 'cluster'}-${b.name}`}
                  className={`rbac-card ${isAdmin && isCluster ? 'admin' : ''}`}
                >
                  <div className="rbac-header">
                    <div className="rbac-name-row">
                      <h4>{b.name}</h4>
                      {isAdmin && isCluster && <span className="admin-badge"><Icon name="alert-triangle" size={10} /> ADMIN</span>}
                    </div>
                    <span className="binding-type">{b.binding_type}</span>
                  </div>

                  <div className="rbac-details">
                    <div className="rbac-detail-row">
                      <span className="rbac-detail-label">Role</span>
                      <span className="rbac-detail-value mono">
                        <span className="role-kind">{b.role_ref.kind} /</span>{' '}
                        <span className="role-name">{b.role_ref.name}</span>
                      </span>
                    </div>
                    <div className="rbac-detail-row">
                      <span className="rbac-detail-label">Scope</span>
                      <span className="rbac-detail-value">
                        {b.namespace ? (
                          <><Icon name="box" size={12} /> namespace: <strong>{b.namespace}</strong></>
                        ) : (
                          <span className="cluster-wide-label"><Icon name="globe" size={12} /> Cluster-wide</span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="rbac-subjects">
                    <div className="rbac-subjects-header">
                      <Icon name="users" size={12} />
                      <span>Subjects</span>
                      <span className="subject-badge">{b.subjects.length}</span>
                    </div>
                    <div className="rbac-subject-list">
                      {b.subjects.map((s, i) => {
                        const kindLower = (s.kind || '').toLowerCase()
                        return (
                          <div
                            key={i}
                            className={`rbac-subject subject-${kindLower === 'user' ? 'user' : kindLower === 'group' ? 'group' : kindLower === 'serviceaccount' ? 'sa' : 'other'}`}
                          >
                            <SubjectIcon kind={s.kind} className="subject-icon-svg" />
                            <span className="subject-kind">{s.kind}</span>
                            <span className="subject-name">{s.name}</span>
                            {s.namespace && <span className="subject-ns">{s.namespace}</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Privileged Pods ────────────────────────────────────── */}
      <div className="subsection">
        <div className="subsection-header">
          <h3>Privileged & Root Containers</h3>
          <DataSourceBadge status={privilegedPodsStatus} label="Privileged pods" />
        </div>

        {/* Search */}
        <div className="security-toolbar" style={{ marginBottom: '16px' }}>
          <div className="security-search">
            <Icon name="search" className="security-search-icon" />
            <input
              type="text"
              className="security-search-input"
              placeholder="Search by pod name, namespace, or image..."
              value={privSearch}
              onChange={e => setPrivSearch(e.target.value)}
              aria-label="Search privileged pods"
            />
            {privSearch && (
              <button className="security-search-clear" onClick={() => setPrivSearch('')} aria-label="Clear search">
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
        </div>

        {privilegedPods.length === 0 ? (
          <EmptyState
            icon={<Icon name="shield" size={48} />}
            message="No privileged or root containers detected"
            submessage="Containers running with elevated privileges or as root will appear here."
          />
        ) : filteredPrivileged.length === 0 ? (
          <EmptyState
            icon={<Icon name="search" size={48} />}
            message="No matching containers"
            submessage="Try adjusting your search."
          />
        ) : (
          <div className="privileged-list">
            {filteredPrivileged.map(p => {
              const isPrivileged = p.privileged
              const isRoot = (p.run_as_user ?? 0) === 0
              const risk = isPrivileged && isRoot ? 'critical' : (isPrivileged || isRoot) ? 'high' : 'low'
              return (
                <div
                  key={`${p.namespace}/${p.container}`}
                  className={`privileged-card risk-${risk}`}
                >
                  <div className="rbac-header">
                    <div className="rbac-name-row">
                      <h4>{p.name}</h4>
                      <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                        / {p.container}
                      </span>
                    </div>
                    <span className={`risk-badge risk-${risk}`}>
                      {risk === 'critical' ? 'CRITICAL' : risk === 'high' ? 'HIGH' : 'LOW'}
                    </span>
                  </div>

                  <div className="rbac-details">
                    <div className="rbac-detail-row">
                      <span className="rbac-detail-label">Image</span>
                      <span className="rbac-detail-value mono">{p.image}</span>
                    </div>
                    <div className="rbac-detail-row">
                      <span className="rbac-detail-label">Namespace</span>
                      <span className="rbac-detail-value">
                        <span style={{
                          backgroundColor: getNsColor(p.namespace),
                          color: '#fff',
                          padding: '1px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                        }}>
                          {p.namespace}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="risk-factors">
                    {isPrivileged && (
                      <span className="risk-factor factor-privileged">
                        <Icon name="unlock" size={12} /> Privileged
                      </span>
                    )}
                    {isRoot && (
                      <span className="risk-factor factor-root">
                        <Icon name="alert-triangle" size={12} /> Runs as Root (UID {p.run_as_user ?? 0})
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
