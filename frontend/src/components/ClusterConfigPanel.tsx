import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useDashboard } from '../context/DashboardContext'
import { Icon } from './Icon'
import { EmptyState } from './EmptyState'
import { SuperUserModal } from './SuperUserModal'
import type {
  IPPool, BGPPeer, K8sNamespace, K8sService, K8sConfigMap,
  K8sSecret, K8sDeployment, K8sNode, ConfigSettings,
} from '../types'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

// ═══════════════════════════════════════════════════════════════════
//  Super User auth helpers
// ═══════════════════════════════════════════════════════════════════

let _superUserPassword = ''
let _superUserSession = false

function getAuthHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (_superUserPassword) h['X-Super-User-Password'] = _superUserPassword
  return h
}

// ═══════════════════════════════════════════════════════════════════
//  Fetch helpers
// ═══════════════════════════════════════════════════════════════════

async function listResource<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`)
    if (!res.ok) return []
    const d = await res.json()
    return d.data || []
  } catch { return [] }
}

async function deleteResource(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { method: 'DELETE', headers: getAuthHeaders() })
    if (!res.ok) {
      const txt = await res.text()
      return txt || `HTTP ${res.status}`
    }
    return null
  } catch (e) { return e instanceof Error ? e.message : 'Network error' }
}

async function writeResource(path: string, method: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method, headers: getAuthHeaders(), body: JSON.stringify(body),
    })
    if (!res.ok) {
      const txt = await res.text()
      return txt || `HTTP ${res.status}`
    }
    return null
  } catch (e) { return e instanceof Error ? e.message : 'Network error' }
}

// ═══════════════════════════════════════════════════════════════════
//  Color helpers
// ═══════════════════════════════════════════════════════════════════

const MODE_COLORS: Record<string, string> = {
  vxlan: 'var(--info)', ipip: 'var(--warning)', none: 'var(--success)',
}

interface SectionProps {
  title: string
  icon: string
  iconColor: string
  expanded: boolean
  onToggle: () => void
  addLabel?: string
  onAdd?: () => void
  children: React.ReactNode
}

function ConfigSection({ title, icon, iconColor, expanded, onToggle, addLabel, onAdd, children }: SectionProps) {
  return (
    <div className="config-section-card">
      <button className="dashboard-card-header-btn config-section-toggle" onClick={onToggle} aria-expanded={expanded}>
        <div className="dashboard-card-header-left">
          <Icon name={icon as any} size={16} style={{ color: iconColor }} />
          <span>{title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {addLabel && expanded && (
            <button className="refresh-btn" onClick={e => { e.stopPropagation(); onAdd?.() }} style={{ padding: '4px 10px', fontSize: 11, zIndex: 2, position: 'relative' }}>
              <Icon name="plus" size={12} />
              <span>{addLabel}</span>
            </button>
          )}
          <span className="dashboard-card-expand-icon" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s ease' }}>
            <Icon name="chevron-right" size={14} />
          </span>
        </div>
      </button>
      {expanded && <div className="config-section-body">{children}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
//  Main Component
// ═══════════════════════════════════════════════════════════════════

export function ClusterConfigPanel() {
  const { ipPools, bgpPeers, ipPoolsStatus } = useDashboard()

  // ── Super user state ──────────────────────────────────────────
  const [showAuth, setShowAuth] = useState(false)
  const [superUserActive, setSuperUserActive] = useState(false)
  const authTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const superUserSessionDuration = 15 * 60 * 1000 // 15 minutes

  const handleAuthenticated = useCallback((password: string) => {
    _superUserPassword = password
    _superUserSession = true
    setSuperUserActive(true)
    setShowAuth(false)

    if (authTimerRef.current) clearTimeout(authTimerRef.current)
    authTimerRef.current = setTimeout(() => {
      _superUserPassword = ''
      _superUserSession = false
      setSuperUserActive(false)
    }, superUserSessionDuration)
  }, [])

  const handleAuthCancel = useCallback(() => {
    setShowAuth(false)
  }, [])

  const requireAuth = useCallback((action: () => void) => {
    if (_superUserSession && _superUserPassword) {
      action()
    } else {
      // Store the action to run after auth
      setPendingAction(() => action)
      setShowAuth(true)
    }
  }, [])

  // This ref holds the pending action to run after auth
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  // Run pending action after auth succeeds
  useEffect(() => {
    if (superUserActive && pendingAction) {
      pendingAction()
      setPendingAction(null)
    }
  }, [superUserActive, pendingAction])

  // Cleanup auth timer on unmount
  useEffect(() => {
    return () => { if (authTimerRef.current) clearTimeout(authTimerRef.current) }
  }, [])

  // ── Section expand state ──────────────────────────────────────
  const [sections, setSections] = useState<Record<string, boolean>>({
    ippools: true, bgppeers: true, namespaces: false,
    services: false, configmaps: false, secrets: false,
    deployments: false, nodes: false,
  })
  const toggleSection = useCallback((key: string) => {
    setSections(s => ({ ...s, [key]: !s[key] }))
  }, [])

  // ── Resource data ─────────────────────────────────────────────
  const [namespaces, setNamespaces] = useState<K8sNamespace[]>([])
  const [services, setServices] = useState<K8sService[]>([])
  const [configMaps, setConfigMaps] = useState<K8sConfigMap[]>([])
  const [secrets, setSecrets] = useState<K8sSecret[]>([])
  const [deployments, setDeployments] = useState<K8sDeployment[]>([])
  const [k8sNodes, setK8sNodes] = useState<K8sNode[]>([])
  const [settings, setSettings] = useState<ConfigSettings | null>(null)
  const [loadingData, setLoadingData] = useState(false)

  const loadAll = useCallback(async () => {
    setLoadingData(true)
    const data = await Promise.all([
      listResource<K8sNamespace>('/api/config/namespaces'),
      listResource<K8sService>('/api/config/services'),
      listResource<K8sConfigMap>('/api/config/configmaps'),
      listResource<K8sSecret>('/api/config/secrets'),
      listResource<K8sDeployment>('/api/config/deployments'),
      listResource<K8sNode>('/api/config/nodes'),
      listResource<ConfigSettings>('/api/config/settings'),
    ])
    setNamespaces(data[0])
    setServices(data[1])
    setConfigMaps(data[2])
    setSecrets(data[3])
    setDeployments(data[4])
    setK8sNodes(data[5])
    if (data[6]?.length) setSettings(data[6] as unknown as ConfigSettings)
    else {
      try {
        const r = await fetch(`${API_BASE_URL}/api/config/settings`)
        const d = await r.json()
        if (d.data) setSettings(d.data)
      } catch {}
    }
    setLoadingData(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // ── Modal state ───────────────────────────────────────────────
  const [modal, setModal] = useState<{ type: string; data?: any; editing?: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  const openModal = useCallback((type: string, data?: any) => {
    setModal({ type, data, editing: !!data })
    setModalError(null)
  }, [])
  const closeModal = useCallback(() => { setModal(null); setModalError(null) }, [])

  // ── Write actions wrapped in auth ─────────────────────────────
  const withAuth = useCallback((fn: () => Promise<string | null>, onSuccess: () => void) => {
    if (!_superUserSession || !_superUserPassword) {
      setPendingAction(() => () => withAuth(fn, onSuccess))
      setShowAuth(true)
      return
    }
    setSaving(true)
    setModalError(null)
    fn().then(err => {
      if (err) setModalError(err)
      else { closeModal(); loadAll() }
    }).catch(e => setModalError(e.message || 'Error')).finally(() => setSaving(false))
  }, [closeModal, loadAll])

  // ── Namespace form state ──────────────────────────────────────
  const [nsName, setNsName] = useState('')

  const renderModal = () => {
    if (!modal) return null
    const { type, data, editing } = modal

    const close = () => { closeModal(); if (type === 'namespace') setNsName('') }

    const renderForm = () => {
      switch (type) {
        case 'namespace': return (
          <div className="config-form-group">
            <label className="config-form-label">Namespace Name</label>
            <input className="config-form-input" value={nsName} onChange={e => setNsName(e.target.value)} placeholder="e.g. my-app" autoFocus />
          </div>
        )
        default: return null
      }
    }

    const handleSave = () => {
      let path = '', method = '', body: any = {}
      switch (type) {
        case 'namespace':
          if (!nsName.trim()) { setModalError('Name is required'); return }
          path = '/api/config/namespaces'; method = 'POST'; body = { name: nsName.trim() }
          break
      }
      withAuth(() => writeResource(path, method, body), () => {
        if (type === 'namespace') setNsName('')
      })
    }

    const titles: Record<string, string> = {
      namespace: 'Create Namespace',
    }

    return (
      <div className="config-modal-overlay" onClick={close}>
        <div className="config-modal" onClick={e => e.stopPropagation()}>
          <div className="config-modal-header">
            <h3>{titles[type] || 'Action'}</h3>
            <button className="refresh-btn" onClick={close} style={{ padding: '4px 8px' }}><Icon name="x" size={16} /></button>
          </div>
          <div className="config-modal-body">
            {renderForm()}
            {modalError && <div className="config-form-error">{modalError}</div>}
            <div className="config-modal-actions">
              <button className="refresh-btn" onClick={close}>Cancel</button>
              <button className="refresh-btn" onClick={handleSave} disabled={saving} style={{ backgroundColor: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' }}>
                {saving ? 'Saving...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className="section config-section">
      <h2>Cluster Management</h2>

      {/* ── Super User Auth Bar ── */}
      <div className={`dashboard-compact-bar su-bar ${superUserActive ? 'su-authenticated' : ''}`}>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-icon" style={{ color: superUserActive ? 'var(--success)' : 'var(--text-tertiary)' }}>
            <Icon name={superUserActive ? 'unlock' : 'lock'} size={16} />
          </span>
          <div className="dashboard-mini-stat-content">
            <span className="dashboard-mini-stat-value" style={{ color: superUserActive ? 'var(--success)' : 'var(--text-tertiary)', fontSize: 12, fontWeight: 600 }}>
              {superUserActive ? 'Super User Active' : 'Read Only'}
            </span>
            <span className="dashboard-mini-stat-label">
              {superUserActive ? 'Write operations enabled' : 'Write operations require authentication'}
            </span>
          </div>
        </div>
        {!superUserActive && (
          <div className="dashboard-compbar-actions">
            <button className="refresh-btn" onClick={() => setShowAuth(true)} style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}>
              <Icon name="unlock" size={14} />
              <span>Unlock</span>
            </button>
          </div>
        )}
        {superUserActive && (
          <div className="dashboard-compbar-actions">
            <span className="dashboard-last-updated">
              <Icon name="check" size={14} />
              Session active
            </span>
            <button className="refresh-btn" onClick={() => {
              _superUserPassword = ''; _superUserSession = false; setSuperUserActive(false)
              if (authTimerRef.current) clearTimeout(authTimerRef.current)
            }} style={{ color: 'var(--text-tertiary)' }}>
              <Icon name="lock" size={14} />
              <span>Lock</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Summary Stats ── */}
      <div className="dashboard-compact-bar stagger-item" style={{ animationDelay: '0s' }}>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-icon" style={{ color: 'var(--primary)' }}><Icon name="hard-drive" size={16} /></span>
          <div className="dashboard-mini-stat-content">
            <span className="dashboard-mini-stat-value" style={{ color: 'var(--primary)' }}>{ipPools.length}</span>
            <span className="dashboard-mini-stat-label">IP Pools</span>
          </div>
        </div>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-icon" style={{ color: 'var(--info)' }}><Icon name="git-branch" size={16} /></span>
          <div className="dashboard-mini-stat-content">
            <span className="dashboard-mini-stat-value" style={{ color: 'var(--info)' }}>{bgpPeers.length}</span>
            <span className="dashboard-mini-stat-label">BGP Peers</span>
          </div>
        </div>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-icon" style={{ color: 'var(--success)' }}><Icon name="layout-dashboard" size={16} /></span>
          <div className="dashboard-mini-stat-content">
            <span className="dashboard-mini-stat-value" style={{ color: 'var(--success)' }}>{namespaces.length}</span>
            <span className="dashboard-mini-stat-label">Namespaces</span>
          </div>
        </div>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-icon" style={{ color: 'var(--info)' }}><Icon name="zap" size={16} /></span>
          <div className="dashboard-mini-stat-content">
            <span className="dashboard-mini-stat-value" style={{ color: 'var(--info)' }}>{services.length}</span>
            <span className="dashboard-mini-stat-label">Services</span>
          </div>
        </div>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-icon" style={{ color: 'var(--warning)' }}><Icon name="layers" size={16} /></span>
          <div className="dashboard-mini-stat-content">
            <span className="dashboard-mini-stat-value" style={{ color: 'var(--warning)' }}>{deployments.length}</span>
            <span className="dashboard-mini-stat-label">Deployments</span>
          </div>
        </div>
        <div className="dashboard-mini-stat">
          <span className="dashboard-mini-stat-icon" style={{ color: 'var(--text-secondary)' }}><Icon name="server" size={16} /></span>
          <div className="dashboard-mini-stat-content">
            <span className="dashboard-mini-stat-value" style={{ color: 'var(--text-secondary)' }}>{k8sNodes.length}</span>
            <span className="dashboard-mini-stat-label">Nodes</span>
          </div>
        </div>
      </div>

      {loadingData && (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          Loading cluster resources...
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/*  IP Pools */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <ConfigSection title="IP Pools" icon="hard-drive" iconColor="var(--primary)" expanded={sections.ippools} onToggle={() => toggleSection('ippools')}>
        {ipPools.length === 0 ? (
          <EmptyState icon={<Icon name="hard-drive" size={32} />} message="No IP pools" submessage="" />
        ) : (
          <div className="storage-table-wrapper">
            <table className="storage-table"><thead><tr><th>Name</th><th>CIDR</th><th>Mode</th><th>NAT</th><th>Status</th></tr></thead>
              <tbody>{ipPools.map(p => (
                <tr key={p.name}><td className="cell-mono"><span style={{ display:'flex',alignItems:'center',gap:6 }}><span style={{ width:8,height:8,borderRadius:'50%',backgroundColor:p.disabled?'var(--danger)':'var(--success)',display:'inline-block' }}/>{p.name}</span></td>
                  <td className="cell-mono">{p.cidr}</td>
                  <td><span className="badge badge-muted" style={{ color:MODE_COLORS[p.mode]||'var(--text-tertiary)',borderColor:MODE_COLORS[p.mode]||'var(--border)' }}>{p.mode.toUpperCase()}</span></td>
                  <td>{p.nat_outgoing ? <span className="badge badge-success">Enabled</span> : <span className="badge badge-muted">Disabled</span>}</td>
                  <td>{p.disabled ? <span className="badge badge-warning">Disabled</span> : <span className="badge badge-success">Active</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </ConfigSection>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/*  BGP Peers */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <ConfigSection title="BGP Peers" icon="git-branch" iconColor="var(--info)" expanded={sections.bgppeers} onToggle={() => toggleSection('bgppeers')}>
        {bgpPeers.length === 0 ? (
          <EmptyState icon={<Icon name="git-branch" size={32} />} message="No BGP peers" submessage="" />
        ) : (
          <div className="storage-table-wrapper">
            <table className="storage-table"><thead><tr><th>Name</th><th>Peer IP</th><th>Peer ASN</th><th>Node</th><th>Session</th></tr></thead>
              <tbody>{bgpPeers.map(p => (
                <tr key={p.name}><td className="cell-mono">{p.name}</td><td className="cell-mono">{p.peer_ip||'-'}</td><td className="cell-mono">{p.peer_as_number??'-'}</td>
                  <td className="cell-mono">{p.node||<span style={{color:'var(--text-tertiary)',fontStyle:'italic'}}>Global</span>}</td>
                  <td>{p.session_state==='up'?<span className="badge badge-success">UP</span>:p.session_state==='down'?<span className="badge badge-warning">DOWN</span>:<span className="badge badge-muted">{p.session_state||'unknown'}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </ConfigSection>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/*  Namespaces */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <ConfigSection title="Namespaces" icon="layout-dashboard" iconColor="var(--success)" expanded={sections.namespaces} onToggle={() => toggleSection('namespaces')} addLabel="Create" onAdd={() => requireAuth(() => openModal('namespace'))}>
        {namespaces.length === 0 ? (
          <EmptyState icon={<Icon name="layout-dashboard" size={32} />} message="No namespaces" submessage="" />
        ) : (
          <div className="storage-table-wrapper">
            <table className="storage-table"><thead><tr><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{namespaces.map(ns => (
                <tr key={ns.name}><td className="cell-mono">{ns.name}</td>
                  <td><span className={`badge ${ns.status === 'Active' ? 'badge-success' : 'badge-muted'}`}>{ns.status || 'Active'}</span></td>
                  <td>
                    <button className="refresh-btn" onClick={() => requireAuth(async () => {
                      const err = await deleteResource(`/api/config/namespaces/${ns.name}`)
                      if (err) alert(err); else loadAll()
                    })} style={{ padding:'4px 8px',color:'var(--danger)' }} title="Delete namespace"><Icon name="trash-2" size={14} /></button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </ConfigSection>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/*  Services */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <ConfigSection title="Services" icon="zap" iconColor="var(--info)" expanded={sections.services} onToggle={() => toggleSection('services')}>
        {services.length === 0 ? (
          <EmptyState icon={<Icon name="zap" size={32} />} message="No services" submessage="" />
        ) : (
          <div className="storage-table-wrapper">
            <table className="storage-table"><thead><tr><th>Name</th><th>Namespace</th><th>Cluster IP</th><th>Type</th><th>Ports</th><th>Actions</th></tr></thead>
              <tbody>{services.map(s => (
                <tr key={`${s.namespace}/${s.name}`}><td className="cell-mono">{s.name}</td><td className="cell-mono">{s.namespace}</td>
                  <td className="cell-mono">{s.cluster_ip}</td><td>{s.type}</td><td className="cell-mono" style={{fontSize:11}}>{s.ports}</td>
                  <td>
                    <button className="refresh-btn" onClick={() => requireAuth(async () => {
                      const err = await deleteResource(`/api/config/services/${s.namespace}/${s.name}`)
                      if (err) alert(err); else loadAll()
                    })} style={{ padding:'4px 8px',color:'var(--danger)' }} title="Delete service"><Icon name="trash-2" size={14} /></button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </ConfigSection>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/*  ConfigMaps */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <ConfigSection title="ConfigMaps" icon="layers" iconColor="var(--warning)" expanded={sections.configmaps} onToggle={() => toggleSection('configmaps')}>
        {configMaps.length === 0 ? (
          <EmptyState icon={<Icon name="layers" size={32} />} message="No ConfigMaps" submessage="" />
        ) : (
          <div className="storage-table-wrapper">
            <table className="storage-table"><thead><tr><th>Name</th><th>Namespace</th><th>Keys</th><th>Actions</th></tr></thead>
              <tbody>{configMaps.map(cm => (
                <tr key={`${cm.namespace}/${cm.name}`}><td className="cell-mono">{cm.name}</td><td className="cell-mono">{cm.namespace}</td>
                  <td className="cell-mono" style={{fontSize:11}}>{(cm.keys||[]).join(', ') || <span style={{color:'var(--text-tertiary)'}}>—</span>}</td>
                  <td>
                    <button className="refresh-btn" onClick={() => requireAuth(async () => {
                      const err = await deleteResource(`/api/config/configmaps/${cm.namespace}/${cm.name}`)
                      if (err) alert(err); else loadAll()
                    })} style={{ padding:'4px 8px',color:'var(--danger)' }} title="Delete ConfigMap"><Icon name="trash-2" size={14} /></button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </ConfigSection>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/*  Secrets */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <ConfigSection title="Secrets" icon="lock" iconColor="var(--danger)" expanded={sections.secrets} onToggle={() => toggleSection('secrets')}>
        {secrets.length === 0 ? (
          <EmptyState icon={<Icon name="lock" size={32} />} message="No Secrets" submessage="" />
        ) : (
          <div className="storage-table-wrapper">
            <table className="storage-table"><thead><tr><th>Name</th><th>Namespace</th><th>Type</th><th>Keys</th><th>Actions</th></tr></thead>
              <tbody>{secrets.map(s => (
                <tr key={`${s.namespace}/${s.name}`}><td className="cell-mono">{s.name}</td><td className="cell-mono">{s.namespace}</td><td>{s.type}</td>
                  <td className="cell-mono" style={{fontSize:11}}>{(s.keys||[]).join(', ') || <span style={{color:'var(--text-tertiary)'}}>—</span>}</td>
                  <td>
                    <button className="refresh-btn" onClick={() => requireAuth(async () => {
                      const err = await deleteResource(`/api/config/secrets/${s.namespace}/${s.name}`)
                      if (err) alert(err); else loadAll()
                    })} style={{ padding:'4px 8px',color:'var(--danger)' }} title="Delete Secret"><Icon name="trash-2" size={14} /></button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </ConfigSection>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/*  Deployments */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <ConfigSection title="Deployments" icon="layers" iconColor="var(--warning)" expanded={sections.deployments} onToggle={() => toggleSection('deployments')}>
        {deployments.length === 0 ? (
          <EmptyState icon={<Icon name="layers" size={32} />} message="No deployments" submessage="" />
        ) : (
          <div className="storage-table-wrapper">
            <table className="storage-table"><thead><tr><th>Name</th><th>Namespace</th><th>Replicas</th><th>Ready</th><th>Image</th><th>Actions</th></tr></thead>
              <tbody>{deployments.map(d => (
                <tr key={`${d.namespace}/${d.name}`}><td className="cell-mono">{d.name}</td><td className="cell-mono">{d.namespace}</td>
                  <td className="cell-mono">{d.replicas}</td>
                  <td><span className={`badge ${d.ready_replicas === d.replicas && d.replicas > 0 ? 'badge-success' : 'badge-warning'}`}>{d.ready_replicas}/{d.replicas}</span></td>
                  <td className="cell-mono" style={{fontSize:11,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis'}}>{d.image||'-'}</td>
                  <td>
                    <div style={{display:'flex',gap:4}}>
                      <button className="refresh-btn" onClick={() => requireAuth(async () => {
                        const replicas = prompt('New replica count:', String(d.replicas))
                        if (!replicas) return
                        const err = await writeResource(`/api/config/deployments/${d.namespace}/${d.name}/scale`, 'POST', { replicas: parseInt(replicas) })
                        if (err) alert(err); else loadAll()
                      })} style={{padding:'4px 8px'}} title="Scale">🔢</button>
                      <button className="refresh-btn" onClick={() => requireAuth(async () => {
                        const err = await writeResource(`/api/config/deployments/${d.namespace}/${d.name}/restart`, 'POST', {})
                        if (err) alert(err); else loadAll()
                      })} style={{padding:'4px 8px'}} title="Restart">🔄</button>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </ConfigSection>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/*  Nodes */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <ConfigSection title="Nodes" icon="server" iconColor="var(--text-secondary)" expanded={sections.nodes} onToggle={() => toggleSection('nodes')}>
        {k8sNodes.length === 0 ? (
          <EmptyState icon={<Icon name="server" size={32} />} message="No node data" submessage="" />
        ) : (
          <div className="storage-table-wrapper">
            <table className="storage-table"><thead><tr><th>Name</th><th>Role</th><th>IP</th><th>Status</th><th>Scheduling</th><th>Version</th><th>Actions</th></tr></thead>
              <tbody>{k8sNodes.map(n => (
                <tr key={n.name}><td className="cell-mono">{n.name}</td>
                  <td><span className="badge badge-muted" style={{color:n.role==='master'?'#EC4899':'#3B82F6',borderColor:n.role==='master'?'rgba(236,72,153,0.3)':'rgba(59,130,246,0.3)'}}>{n.role}</span></td>
                  <td className="cell-mono">{n.ip}</td>
                  <td>{n.ready ? <span className="badge badge-success">Ready</span> : <span className="badge badge-muted" style={{color:'var(--danger)',borderColor:'rgba(239,68,68,0.3)'}}>Not Ready</span>}</td>
                  <td>{n.unschedulable ? <span className="badge badge-warning">Cordoned</span> : <span className="badge badge-success">Schedulable</span>}</td>
                  <td className="cell-mono" style={{fontSize:11}}>{n.kubelet_version}</td>
                  <td>
                    {n.unschedulable ? (
                      <button className="refresh-btn" onClick={() => requireAuth(async () => {
                        const err = await writeResource(`/api/config/nodes/${n.name}/uncordon`, 'POST', {})
                        if (err) alert(err); else loadAll()
                      })} style={{padding:'4px 8px',color:'var(--success)'}} title="Uncordon">Uncordon</button>
                    ) : (
                      <button className="refresh-btn" onClick={() => requireAuth(async () => {
                        const err = await writeResource(`/api/config/nodes/${n.name}/cordon`, 'POST', {})
                        if (err) alert(err); else loadAll()
                      })} style={{padding:'4px 8px',color:'var(--warning)'}} title="Cordon">Cordon</button>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </ConfigSection>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/*  Backend Status */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="subsection">
        <div className="subsection-header"><h3>Backend Status</h3></div>
        <div className="dashboard-card gradient-border-card" style={{ display:'block', padding:'20px' }}>
          {settings ? (
            <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
              <div className="rbac-detail-row"><span className="rbac-detail-label">K8s Mode</span><span className="rbac-detail-value mono">{settings.k8s_mode}</span></div>
              <div className="rbac-detail-row"><span className="rbac-detail-label">Prometheus</span><span className="rbac-detail-value mono">{settings.prometheus_url}</span></div>
              <div className="rbac-detail-row"><span className="rbac-detail-label">AI Model</span><span className="rbac-detail-value mono">{settings.ai_enabled ? settings.ai_model : <span style={{color:'var(--text-tertiary)',fontStyle:'italic'}}>Disabled</span>}</span></div>
              <div className="rbac-detail-row"><span className="rbac-detail-label">Super User PW</span><span className="rbac-detail-value">{settings.has_super_user_password ? <span className="badge badge-success">Configured</span> : <span className="badge badge-muted">Not set</span>}</span></div>
              <div className="rbac-detail-row"><span className="rbac-detail-label">API Key</span><span className="rbac-detail-value">{settings.has_api_key ? <span className="badge badge-success">Configured</span> : <span className="badge badge-muted">Not set</span>}</span></div>
              <div className="rbac-detail-row"><span className="rbac-detail-label">Falco Secret</span><span className="rbac-detail-value">{settings.has_falco_webhook_secret ? <span className="badge badge-success">Configured</span> : <span className="badge badge-warning">Not set</span>}</span></div>
            </div>
          ) : (
            <div style={{padding:'20px',textAlign:'center',color:'var(--text-tertiary)'}}><div className="spinner" style={{margin:'0 auto 12px'}}/>Loading settings...</div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      {modal && renderModal()}
      {showAuth && <SuperUserModal onAuthenticated={handleAuthenticated} onCancel={handleAuthCancel} />}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/*  Scoped CSS */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <style>{`
        .config-section-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          margin-bottom: 12px;
          overflow: hidden;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .config-section-card:hover {
          border-color: var(--border-hover);
          box-shadow: var(--shadow-hover);
        }
        .config-section-toggle {
          padding: 14px 18px !important;
        }
        .config-section-body {
          border-top: 1px solid var(--border);
          padding: 16px;
          animation: fadeSlideIn 0.2s ease-out;
        }
        .config-section .storage-table-wrapper {
          margin: 0;
        }
        .su-bar {
          transition: border-color 0.3s ease;
        }
        .su-bar.su-authenticated {
          border-color: rgba(16, 185, 129, 0.3);
          background: rgba(16, 185, 129, 0.03);
        }
        .config-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.6);
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
          box-shadow: 0 16px 48px rgba(0,0,0,0.5);
          animation: slideUp 0.2s ease;
        }
        @keyframes slideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes fadeSlideIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
        .config-modal-header { display:flex; justify-content:space-between; align-items:center; padding:18px 20px; border-bottom:1px solid var(--border); }
        .config-modal-header h3 { font-size:16px; font-weight:600; color:var(--text); margin:0; }
        .config-modal-body { padding:20px; }
        .config-modal-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:20px; padding-top:16px; border-top:1px solid var(--border); }
        .config-form-group { margin-bottom:14px; }
        .config-form-label { display:block; font-size:11px; font-weight:600; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.4px; margin-bottom:6px; }
        .config-form-input { width:100%; padding:9px 12px; background-color:var(--bg); border:1px solid var(--border); border-radius:var(--radius); color:var(--text); font-size:13px; font-family:inherit; transition:border-color 0.2s ease, box-shadow 0.2s ease; }
        .config-form-input:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 1px rgba(59,130,246,0.3); }
        .config-form-error { background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:var(--radius); padding:10px 14px; font-size:13px; color:var(--danger); margin-bottom:12px; }
        .config-section .dashboard-compact-bar { margin-bottom:20px; }
      `}</style>
    </div>
  )
}
