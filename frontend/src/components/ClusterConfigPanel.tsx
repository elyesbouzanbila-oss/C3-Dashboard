import { useState, useMemo, useCallback, useEffect } from 'react'
import { useDashboard } from '../context/DashboardContext'
import { Icon } from './Icon'
import { DonutChart } from './DonutChart'
import { EmptyState } from './EmptyState'
import { getNsColor } from '../utils'
import type { IPPool, BGPPeer, IPPoolFormData, BGPPeerFormData, ConfigSettings } from '../types'
import { config } from '../config'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

/** Helper: build headers with API key for write operations */
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const key = config.apiKey
  if (key) headers['X-API-Key'] = key
  return headers
}

/** Get a color for an IP pool based on mode */
function getPoolModeColor(mode: string): string {
  switch (mode) {
    case 'vxlan': return 'var(--info)'
    case 'ipip': return 'var(--warning)'
    case 'none': return 'var(--success)'
    default: return 'var(--text-tertiary)'
  }
}

export function ClusterConfigPanel() {
  const { ipPools, bgpPeers, ipPoolsStatus } = useDashboard()

  // ── IP Pool state ──────────────────────────────────────────
  const [poolFormOpen, setPoolFormOpen] = useState(false)
  const [editingPool, setEditingPool] = useState<string | null>(null)
  const [poolForm, setPoolForm] = useState<IPPoolFormData>({
    name: '',
    cidr: '',
    nat_outgoing: true,
    disabled: false,
    mode: 'vxlan',
    node_selector: 'all()',
  })
  const [poolSaving, setPoolSaving] = useState(false)
  const [poolError, setPoolError] = useState<string | null>(null)

  // ── BGP Peer state ─────────────────────────────────────────
  const [peerFormOpen, setPeerFormOpen] = useState(false)
  const [editingPeer, setEditingPeer] = useState<string | null>(null)
  const [peerForm, setPeerForm] = useState<BGPPeerFormData>({
    name: '',
    peer_ip: '',
    peer_as_number: 64512,
    node_as_number: null,
    node: null,
  })
  const [peerSaving, setPeerSaving] = useState(false)
  const [peerError, setPeerError] = useState<string | null>(null)

  // ── Settings state ─────────────────────────────────────────
  const [settings, setSettings] = useState<ConfigSettings | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(false)

  // Fetch settings on mount
  useEffect(() => {
    setSettingsLoading(true)
    fetch(`${API_BASE_URL}/api/config/settings`)
      .then(r => r.json())
      .then(d => setSettings(d.data || null))
      .catch(() => {})
      .finally(() => setSettingsLoading(false))
  }, [])

  // ── IP Pool CRUD ───────────────────────────────────────────
  const openPoolForm = useCallback((pool?: IPPool) => {
    if (pool) {
      setEditingPool(pool.name)
      setPoolForm({
        name: pool.name,
        cidr: pool.cidr,
        nat_outgoing: pool.nat_outgoing,
        disabled: pool.disabled,
        mode: (pool.mode as 'ipip' | 'vxlan' | 'none') || 'vxlan',
        node_selector: pool.node_selector || 'all()',
      })
    } else {
      setEditingPool(null)
      setPoolForm({ name: '', cidr: '', nat_outgoing: true, disabled: false, mode: 'vxlan', node_selector: 'all()' })
    }
    setPoolError(null)
    setPoolFormOpen(true)
  }, [])

  const closePoolForm = useCallback(() => {
    setPoolFormOpen(false)
    setEditingPool(null)
    setPoolError(null)
  }, [])

  const savePool = useCallback(async () => {
    setPoolSaving(true)
    setPoolError(null)
    try {
      const endpoint = editingPool
        ? `${API_BASE_URL}/api/config/ippools/${editingPool}`
        : `${API_BASE_URL}/api/config/ippools`
      const method = editingPool ? 'PUT' : 'POST'

      const body = editingPool
        ? { mode: poolForm.mode, nat_outgoing: poolForm.nat_outgoing, disabled: poolForm.disabled, node_selector: poolForm.node_selector }
        : poolForm

      const res = await fetch(endpoint, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(err || `HTTP ${res.status}`)
      }
      closePoolForm()
      window.location.reload()
    } catch (err) {
      setPoolError(err instanceof Error ? err.message : 'Failed to save IP pool')
    } finally {
      setPoolSaving(false)
    }
  }, [editingPool, poolForm, closePoolForm])

  const deletePool = useCallback(async (name: string) => {
    if (!window.confirm(`Delete IP pool "${name}"? This may affect running workloads.`)) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/config/ippools/${name}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      window.location.reload()
    } catch (err) {
      alert(`Failed to delete: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }, [])

  // ── BGP Peer CRUD ──────────────────────────────────────────
  const openPeerForm = useCallback((peer?: BGPPeer) => {
    if (peer) {
      setEditingPeer(peer.name)
      setPeerForm({
        name: peer.name,
        peer_ip: peer.peer_ip || '',
        peer_as_number: peer.peer_as_number || 64512,
        node_as_number: peer.node_as_number || null,
        node: peer.node || null,
      })
    } else {
      setEditingPeer(null)
      setPeerForm({ name: '', peer_ip: '', peer_as_number: 64512, node_as_number: null, node: null })
    }
    setPeerError(null)
    setPeerFormOpen(true)
  }, [])

  const closePeerForm = useCallback(() => {
    setPeerFormOpen(false)
    setEditingPeer(null)
    setPeerError(null)
  }, [])

  const savePeer = useCallback(async () => {
    setPeerSaving(true)
    setPeerError(null)
    try {
      const endpoint = editingPeer
        ? `${API_BASE_URL}/api/config/bgppeers/${editingPeer}`
        : `${API_BASE_URL}/api/config/bgppeers`
      const method = editingPeer ? 'PUT' : 'POST'

      const body = editingPeer
        ? { peer_ip: peerForm.peer_ip, peer_as_number: peerForm.peer_as_number, node_as_number: peerForm.node_as_number, node: peerForm.node }
        : peerForm

      const res = await fetch(endpoint, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(err || `HTTP ${res.status}`)
      }
      closePeerForm()
      window.location.reload()
    } catch (err) {
      setPeerError(err instanceof Error ? err.message : 'Failed to save BGP peer')
    } finally {
      setPeerSaving(false)
    }
  }, [editingPeer, peerForm, closePeerForm])

  const deletePeer = useCallback(async (name: string) => {
    if (!window.confirm(`Delete BGP peer "${name}"?`)) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/config/bgppeers/${name}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      window.location.reload()
    } catch (err) {
      alert(`Failed to delete: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }, [])

  // ── Pool stats ─────────────────────────────────────────────
  const enabledPools = ipPools.filter(p => !p.disabled)
  const vxlanPools = ipPools.filter(p => p.mode === 'vxlan')
  const ipipPools = ipPools.filter(p => p.mode === 'ipip')

  return (
    <div className="section config-section">
      <h2>Cluster Configuration</h2>

      {/* ── Summary Stats ── */}
      <div className="dashboard-compact-bar stagger-item" style={{ animationDelay: '0s' }}>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-icon" style={{ color: 'var(--primary)' }}>
            <Icon name="hard-drive" size={16} />
          </span>
          <div className="dashboard-mini-stat-content">
            <span className="dashboard-mini-stat-value" style={{ color: 'var(--primary)' }}>{ipPools.length}</span>
            <span className="dashboard-mini-stat-label">IP Pool{ipPools.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-icon" style={{ color: 'var(--success)' }}>
            <Icon name="check" size={16} />
          </span>
          <div className="dashboard-mini-stat-content">
            <span className="dashboard-mini-stat-value" style={{ color: 'var(--success)' }}>{enabledPools.length}</span>
            <span className="dashboard-mini-stat-label">Active</span>
          </div>
        </div>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-icon" style={{ color: 'var(--info)' }}>
            <Icon name="git-branch" size={16} />
          </span>
          <div className="dashboard-mini-stat-content">
            <span className="dashboard-mini-stat-value" style={{ color: 'var(--info)' }}>{bgpPeers.length}</span>
            <span className="dashboard-mini-stat-label">BGP Peer{bgpPeers.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="dashboard-compbar-actions">
          <span className="dashboard-last-updated">
            <Icon name="settings" size={14} />
            Calico {ipPoolsStatus === 'live' ? 'connected' : ipPoolsStatus}
          </span>
        </div>
      </div>

      {/* ── IP Pool Management ─────────────────────────────────── */}
      <div className="subsection">
        <div className="subsection-header">
          <h3>IP Pools</h3>
          <button className="refresh-btn" onClick={() => openPoolForm()} title="Create new IP pool">
            <Icon name="plus" size={16} />
            <span>Add Pool</span>
          </button>
        </div>

        {ipPools.length === 0 ? (
          <EmptyState
            icon={<Icon name="hard-drive" size={48} />}
            message="No IP pools defined"
            submessage="Create an IPPool CRD to define a CIDR range for pod IPs."
          />
        ) : (
          <div className="storage-table-wrapper">
            <table className="storage-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>CIDR</th>
                  <th>Mode</th>
                  <th>NAT</th>
                  <th>Status</th>
                  <th>Node Selector</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {ipPools.map((pool, idx) => (
                  <tr key={pool.name} className="stagger-item" style={{ animationDelay: `${idx * 0.04}s` }}>
                    <td className="cell-mono">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%',
                          backgroundColor: pool.disabled ? 'var(--danger)' : 'var(--success)',
                          display: 'inline-block', flexShrink: 0,
                        }} />
                        {pool.name}
                      </span>
                    </td>
                    <td className="cell-mono">{pool.cidr}</td>
                    <td>
                      <span className="badge badge-muted" style={{
                        color: getPoolModeColor(pool.mode),
                        borderColor: getPoolModeColor(pool.mode),
                      }}>
                        {pool.mode.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      {pool.nat_outgoing ? (
                        <span className="badge badge-success">Enabled</span>
                      ) : (
                        <span className="badge badge-muted">Disabled</span>
                      )}
                    </td>
                    <td>
                      {pool.disabled ? (
                        <span className="badge badge-warning">Disabled</span>
                      ) : (
                        <span className="badge badge-success">Active</span>
                      )}
                    </td>
                    <td className="cell-mono" style={{ fontSize: 11, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {pool.node_selector || <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>all()</span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="refresh-btn" onClick={() => openPoolForm(pool)} title="Edit pool" style={{ padding: '4px 8px' }}>
                          <Icon name="edit" size={14} />
                        </button>
                        <button className="refresh-btn" onClick={() => deletePool(pool.name)} title="Delete pool" style={{ padding: '4px 8px', color: 'var(--danger)' }}>
                          <Icon name="trash-2" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── BGP Peer Management ────────────────────────────────── */}
      <div className="subsection">
        <div className="subsection-header">
          <h3>BGP Peers</h3>
          <button className="refresh-btn" onClick={() => openPeerForm()} title="Create new BGP peer">
            <Icon name="plus" size={16} />
            <span>Add Peer</span>
          </button>
        </div>

        {bgpPeers.length === 0 ? (
          <EmptyState
            icon={<Icon name="git-branch" size={48} />}
            message="No BGP peers configured"
            submessage="Add a BGPPeer CRD to establish BGP sessions."
          />
        ) : (
          <div className="storage-table-wrapper">
            <table className="storage-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Peer IP</th>
                  <th>Peer ASN</th>
                  <th>Node ASN</th>
                  <th>Node</th>
                  <th>Session</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bgpPeers.map((peer, idx) => (
                  <tr key={peer.name} className="stagger-item" style={{ animationDelay: `${idx * 0.04}s` }}>
                    <td className="cell-mono">{peer.name}</td>
                    <td className="cell-mono">{peer.peer_ip || '-'}</td>
                    <td className="cell-mono">{peer.peer_as_number ?? '-'}</td>
                    <td className="cell-mono">{peer.node_as_number ?? '-'}</td>
                    <td className="cell-mono">{peer.node || <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>Global</span>}</td>
                    <td>
                      {peer.session_state === 'up' ? (
                        <span className="badge badge-success">UP</span>
                      ) : peer.session_state === 'down' ? (
                        <span className="badge badge-warning">DOWN</span>
                      ) : (
                        <span className="badge badge-muted">{peer.session_state || 'unknown'}</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="refresh-btn" onClick={() => openPeerForm(peer)} title="Edit peer" style={{ padding: '4px 8px' }}>
                          <Icon name="edit" size={14} />
                        </button>
                        <button className="refresh-btn" onClick={() => deletePeer(peer.name)} title="Delete peer" style={{ padding: '4px 8px', color: 'var(--danger)' }}>
                          <Icon name="trash-2" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Backend Status ─────────────────────────────────────── */}
      <div className="subsection">
        <div className="subsection-header">
          <h3>Backend Status</h3>
        </div>
        <div className="dashboard-card gradient-border-card" style={{ display: 'block', padding: '20px' }}>
          {settingsLoading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              Loading settings...
            </div>
          ) : settings ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="rbac-detail-row">
                <span className="rbac-detail-label">K8s Mode</span>
                <span className="rbac-detail-value mono">{settings.k8s_mode}</span>
              </div>
              <div className="rbac-detail-row">
                <span className="rbac-detail-label">Prometheus</span>
                <span className="rbac-detail-value mono">{settings.prometheus_url}</span>
              </div>
              <div className="rbac-detail-row">
                <span className="rbac-detail-label">AI Model</span>
                <span className="rbac-detail-value mono">
                  {settings.ai_enabled ? settings.ai_model : <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>Disabled</span>}
                </span>
              </div>
              <div className="rbac-detail-row">
                <span className="rbac-detail-label">API Key</span>
                <span className="rbac-detail-value">
                  {settings.has_api_key ? (
                    <span className="badge badge-success">Configured</span>
                  ) : (
                    <span className="badge badge-muted">Not set</span>
                  )}
                </span>
              </div>
              <div className="rbac-detail-row">
                <span className="rbac-detail-label">Falco Secret</span>
                <span className="rbac-detail-value">
                  {settings.has_falco_webhook_secret ? (
                    <span className="badge badge-success">Configured</span>
                  ) : (
                    <span className="badge badge-warning">Not set</span>
                  )}
                </span>
              </div>
              <div className="rbac-detail-row">
                <span className="rbac-detail-label">Redis Auth</span>
                <span className="rbac-detail-value">
                  {settings.has_redis_password ? (
                    <span className="badge badge-success">Configured</span>
                  ) : (
                    <span className="badge badge-muted">Not set</span>
                  )}
                </span>
              </div>
            </div>
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              Unable to load settings.
            </div>
          )}
        </div>
      </div>

      {/* ── Pool Create/Edit Modal ──────────────────────────────── */}
      {poolFormOpen && (
        <div className="config-modal-overlay" onClick={closePoolForm}>
          <div className="config-modal" onClick={e => e.stopPropagation()}>
            <div className="config-modal-header">
              <h3>{editingPool ? 'Edit IP Pool' : 'Create IP Pool'}</h3>
              <button className="refresh-btn" onClick={closePoolForm} style={{ padding: '4px 8px' }}>
                <Icon name="x" size={16} />
              </button>
            </div>
            <div className="config-modal-body">
              {!editingPool && (
                <>
                  <div className="config-form-group">
                    <label className="config-form-label">Name</label>
                    <input className="config-form-input" value={poolForm.name} onChange={e => setPoolForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. production-pool" />
                  </div>
                  <div className="config-form-group">
                    <label className="config-form-label">CIDR</label>
                    <input className="config-form-input" value={poolForm.cidr} onChange={e => setPoolForm(f => ({ ...f, cidr: e.target.value }))} placeholder="e.g. 10.244.0.0/16" />
                  </div>
                </>
              )}
              <div className="config-form-group">
                <label className="config-form-label">Encapsulation Mode</label>
                <div className="config-chip-group">
                  {(['vxlan', 'ipip', 'none'] as const).map(mode => (
                    <button
                      key={mode}
                      className={`security-chip ${poolForm.mode === mode ? 'active' : ''}`}
                      onClick={() => setPoolForm(f => ({ ...f, mode }))}
                    >
                      {mode.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="config-form-row">
                <div className="config-form-group" style={{ flex: 1 }}>
                  <label className="config-form-label">NAT Outgoing</label>
                  <div className="config-toggle-group">
                    <button
                      className={`security-chip ${poolForm.nat_outgoing ? 'active chip-success' : ''}`}
                      onClick={() => setPoolForm(f => ({ ...f, nat_outgoing: true }))}
                    >
                      Enabled
                    </button>
                    <button
                      className={`security-chip ${!poolForm.nat_outgoing ? 'active' : ''}`}
                      onClick={() => setPoolForm(f => ({ ...f, nat_outgoing: false }))}
                    >
                      Disabled
                    </button>
                  </div>
                </div>
                <div className="config-form-group" style={{ flex: 1 }}>
                  <label className="config-form-label">Status</label>
                  <div className="config-toggle-group">
                    <button
                      className={`security-chip ${!poolForm.disabled ? 'active chip-success' : ''}`}
                      onClick={() => setPoolForm(f => ({ ...f, disabled: false }))}
                    >
                      Active
                    </button>
                    <button
                      className={`security-chip ${poolForm.disabled ? 'active chip-danger' : ''}`}
                      onClick={() => setPoolForm(f => ({ ...f, disabled: true }))}
                    >
                      Disabled
                    </button>
                  </div>
                </div>
              </div>
              <div className="config-form-group">
                <label className="config-form-label">Node Selector</label>
                <input className="config-form-input" value={poolForm.node_selector} onChange={e => setPoolForm(f => ({ ...f, node_selector: e.target.value }))} placeholder="e.g. all()" />
              </div>

              {poolError && <div className="config-form-error">{poolError}</div>}

              <div className="config-modal-actions">
                <button className="refresh-btn" onClick={closePoolForm}>Cancel</button>
                <button
                  className="refresh-btn"
                  onClick={savePool}
                  disabled={poolSaving || (!editingPool && (!poolForm.name || !poolForm.cidr))}
                  style={{
                    backgroundColor: 'var(--primary)',
                    color: '#fff',
                    borderColor: 'var(--primary)',
                  }}
                >
                  {poolSaving ? <>Saving...</> : <>{editingPool ? 'Update Pool' : 'Create Pool'}</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── BGP Peer Create/Edit Modal ───────────────────────────── */}
      {peerFormOpen && (
        <div className="config-modal-overlay" onClick={closePeerForm}>
          <div className="config-modal" onClick={e => e.stopPropagation()}>
            <div className="config-modal-header">
              <h3>{editingPeer ? 'Edit BGP Peer' : 'Create BGP Peer'}</h3>
              <button className="refresh-btn" onClick={closePeerForm} style={{ padding: '4px 8px' }}>
                <Icon name="x" size={16} />
              </button>
            </div>
            <div className="config-modal-body">
              {!editingPeer && (
                <>
                  <div className="config-form-group">
                    <label className="config-form-label">Name</label>
                    <input className="config-form-input" value={peerForm.name} onChange={e => setPeerForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. peer-to-spine-1" />
                  </div>
                </>
              )}
              <div className="config-form-group">
                <label className="config-form-label">Peer IP</label>
                <input className="config-form-input" value={peerForm.peer_ip} onChange={e => setPeerForm(f => ({ ...f, peer_ip: e.target.value }))} placeholder="e.g. 10.0.0.1" />
              </div>
              <div className="config-form-row">
                <div className="config-form-group" style={{ flex: 1 }}>
                  <label className="config-form-label">Peer AS Number</label>
                  <input className="config-form-input" type="number" min={1} max={65535} value={peerForm.peer_as_number} onChange={e => setPeerForm(f => ({ ...f, peer_as_number: parseInt(e.target.value) || 64512 }))} />
                </div>
                <div className="config-form-group" style={{ flex: 1 }}>
                  <label className="config-form-label">Node AS Number</label>
                  <input className="config-form-input" type="number" min={1} max={65535} value={peerForm.node_as_number ?? ''} onChange={e => setPeerForm(f => ({ ...f, node_as_number: e.target.value ? parseInt(e.target.value) : null }))} placeholder="Optional" />
                </div>
              </div>
              <div className="config-form-group">
                <label className="config-form-label">Node (optional — blank = global peer)</label>
                <input className="config-form-input" value={peerForm.node ?? ''} onChange={e => setPeerForm(f => ({ ...f, node: e.target.value || null }))} placeholder="e.g. worker-1" />
              </div>

              {peerError && <div className="config-form-error">{peerError}</div>}

              <div className="config-modal-actions">
                <button className="refresh-btn" onClick={closePeerForm}>Cancel</button>
                <button
                  className="refresh-btn"
                  onClick={savePeer}
                  disabled={peerSaving || (!editingPeer && (!peerForm.name || !peerForm.peer_ip))}
                  style={{
                    backgroundColor: 'var(--primary)',
                    color: '#fff',
                    borderColor: 'var(--primary)',
                  }}
                >
                  {peerSaving ? <>Saving...</> : <>{editingPeer ? 'Update Peer' : 'Create Peer'}</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Scoped CSS ── */}
      <style>{`
        .config-section .dashboard-compact-bar {
          margin-bottom: 20px;
        }
        .config-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          animation: fadeIn 0.15s ease;
        }
        .config-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          width: 90%;
          max-width: 520px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
          animation: slideUp 0.2s ease;
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .config-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 18px 20px;
          border-bottom: 1px solid var(--border);
        }
        .config-modal-header h3 {
          font-size: 16px;
          font-weight: 600;
          color: var(--text);
          margin: 0;
        }
        .config-modal-body {
          padding: 20px;
        }
        .config-modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 20px;
          padding-top: 16px;
          border-top: 1px solid var(--border);
        }
        .config-form-group {
          margin-bottom: 14px;
        }
        .config-form-label {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.4px;
          margin-bottom: 6px;
        }
        .config-form-input {
          width: 100%;
          padding: 9px 12px;
          background-color: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          color: var(--text);
          font-size: 13px;
          font-family: inherit;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .config-form-input:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.3);
        }
        .config-form-row {
          display: flex;
          gap: 12px;
        }
        .config-chip-group {
          display: flex;
          gap: 6px;
        }
        .config-form-error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: var(--radius);
          padding: 10px 14px;
          font-size: 13px;
          color: var(--danger);
          margin-bottom: 12px;
        }
        .config-modal .security-chip.chip-success.active {
          background-color: var(--success);
          border-color: var(--success);
          color: white;
        }
        @media (max-width: 768px) {
          .config-modal {
            width: 95%;
            max-width: 100%;
          }
          .config-form-row {
            flex-direction: column;
            gap: 0;
          }
          .config-chip-group {
            flex-wrap: wrap;
          }
        }
      `}</style>
    </div>
  )
}
