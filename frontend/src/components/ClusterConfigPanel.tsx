import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useDashboard } from '../context/DashboardContext'
import { Icon, type IconName } from './Icon'
import { EmptyState } from './EmptyState'
import { SuperUserModal } from './SuperUserModal'
import type {
  K8sNamespace, K8sService, K8sConfigMap,
  K8sSecret, K8sDeployment, K8sNode, ConfigSettings,
} from '../types'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

// Values stored in the shared modal form: strings, numbers, booleans, and the
// key-array passed in from resource rows. Kept explicit (no `any`) so the
// form can be typed without opting out of the type checker.
type FormValue = string | number | boolean | string[] | null | undefined

// ═══════════════════════════════════════════════════════════════════
//  Super User auth helpers
// ═══════════════════════════════════════════════════════════════════

let _superUserToken = ''
let _superUserSession = false

function getAuthHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  // Short-lived session token minted by POST /api/config/auth (15-min TTL).
  // The raw super-user password is never sent on write requests.
  if (_superUserToken) h['X-Super-User-Token'] = _superUserToken
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

/** Extract a human-readable message from a FastAPI / K8s error response. */
async function extractError(res: Response): Promise<string> {
  // Read the body ONCE as text, then try JSON.parse — avoids the double-consume
  // bug where res.json() throws after reading the stream and res.text() returns ''.
  const txt = await res.text().catch(() => '')
  try {
    const data = JSON.parse(txt)
    // FastAPI 422: {detail: [{loc: [...], msg, type}]}
    if (data?.detail && Array.isArray(data.detail)) {
      const parts = (data.detail as Array<{ loc?: unknown[]; msg?: string }>)
        .map(d => {
          const field = Array.isArray(d.loc) ? d.loc.slice(1).join('.') : 'field'
          return `${field}: ${d.msg}`
        })
        .filter(Boolean)
      return parts.join('; ') || `Validation error (HTTP ${res.status})`
    }
    // FastAPI HTTPException: {detail: "..."}
    if (typeof data?.detail === 'string') return data.detail
    if (typeof data?.message === 'string') return data.message
    return JSON.stringify(data).slice(0, 400) || txt || `HTTP ${res.status}`
  } catch {
    return txt || `HTTP ${res.status}`
  }
}

async function deleteResource(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { method: 'DELETE', headers: getAuthHeaders() })
    if (!res.ok) return extractError(res)
    return null
  } catch (e) { return e instanceof Error ? e.message : 'Network error' }
}

async function writeResource(path: string, method: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method, headers: getAuthHeaders(), body: JSON.stringify(body),
    })
    if (!res.ok) return extractError(res)
    return null
  } catch (e) { return e instanceof Error ? e.message : 'Network error' }
}

// ═══════════════════════════════════════════════════════════════════
//  Form helpers
// ═══════════════════════════════════════════════════════════════════

/** UTF-8-safe base64 decode (handles non-ASCII secret values like PEM certs). */
function decodeB64(s: string): string {
  try {
    const bin = atob(s)
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch { return s }
}
/** UTF-8-safe base64 encode (handles non-ASCII secret values like PEM certs). */
function encodeB64(s: string): string {
  try {
    const bytes = new TextEncoder().encode(s)
    let bin = ''
    bytes.forEach(b => { bin += String.fromCharCode(b) })
    return btoa(bin)
  } catch { return s }
}

/** Parse "key=value" lines from a textarea into a dict. */
function parseDataLines(text: string): { data: Record<string, string>; error?: string } {
  const data: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const idx = t.indexOf('=')
    if (idx <= 0) return { data, error: `Invalid line: "${line}" (expected key=value)` }
    data[t.slice(0, idx).trim()] = t.slice(idx + 1)
  }
  return { data }
}

// ── Client-side validation (mirrors the backend + K8s DNS-1123 rules) ──

const K8S_NAME_RE = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/
const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/

/** Validate a Kubernetes resource name. Returns an error message or null. */
function validateName(name: string): string | null {
  const n = (name || '').trim()
  if (!n) return 'Name is required'
  if (n.length > 253) return 'Name must be 253 characters or fewer'
  if (!K8S_NAME_RE.test(n)) {
    return 'Name must be lowercase letters, numbers, dashes or dots (e.g. my-app-1)'
  }
  return null
}

/** Validate a CIDR string. Returns an error message or null. */
function validateCIDR(cidr: string): string | null {
  const c = (cidr || '').trim()
  if (!c) return 'CIDR is required'
  if (!CIDR_RE.test(c)) return 'Invalid CIDR — use format like 10.244.0.0/16'
  return null
}

/** Validate an IP address (IPv4 or IPv6). Returns an error message or null. */
function validateIP(ip: string): string | null {
  const v = (ip || '').trim()
  if (!v) return 'Peer IP is required'
  // IPv6 addresses contain colons; IPv4 must be dotted-quad.
  if (v.includes(':')) {
    if (v.split(':').length < 3) return 'Invalid IPv6 address — use format like fd00::1'
    return null
  }
  if (!IPV4_RE.test(v)) return 'Invalid IP address — use format like 192.168.1.254'
  return null
}

// ═══════════════════════════════════════════════════════════════════
//  Color helpers
// ═══════════════════════════════════════════════════════════════════

const MODE_COLORS: Record<string, string> = {
  vxlan: 'var(--info)', ipip: 'var(--warning)', none: 'var(--success)',
}

interface SectionProps {
  title: string
  icon: IconName
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
          <Icon name={icon} size={16} style={{ color: iconColor }} />
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
  const { ipPools, bgpPeers, refreshSignal } = useDashboard()

  // ── Super user state ──────────────────────────────────────────
  const [showAuth, setShowAuth] = useState(false)
  const [superUserActive, setSuperUserActive] = useState(false)
  const authTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const superUserSessionDuration = 15 * 60 * 1000 // 15 minutes

  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  const handleAuthenticated = useCallback((token: string) => {
    _superUserToken = token
    _superUserSession = true
    setSuperUserActive(true)
    setShowAuth(false)

    if (authTimerRef.current) clearTimeout(authTimerRef.current)
    authTimerRef.current = setTimeout(() => {
      _superUserToken = ''
      _superUserSession = false
      setSuperUserActive(false)
    }, superUserSessionDuration)

    if (pendingAction) {
      const action = pendingAction
      setPendingAction(null)
      action()
    }
  }, [pendingAction, superUserSessionDuration])

  const handleAuthCancel = useCallback(() => {
    setShowAuth(false)
  }, [])

  const requireAuth = useCallback((action: () => void) => {
    if (_superUserSession) {
      action()
    } else {
      // Store the action to run after auth
      setPendingAction(() => action)
      setShowAuth(true)
    }
  }, [])

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
      } catch { /* ignore */ }
    }
    setLoadingData(false)
  }, [])

  // Reload on mount and whenever the topbar refresh button is pressed
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAll()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAll, refreshSignal])

  // ── Modal state ───────────────────────────────────────────────
  const [modal, setModal] = useState<{ type: string; data?: object; editing?: boolean } | null>(null)
  const [form, setForm] = useState<Record<string, FormValue>>({})
  const [saving, setSaving] = useState(false)

  // Read a form field as text (booleans / arrays fall back to '').
  const s = (key: string): string => {
    const v = form[key]
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
  }
  // Read a numeric form field (non-numbers fall back to the default).
  const num = (key: string, fallback: number): number => {
    const v = form[key]
    return typeof v === 'number' ? v : fallback
  }
  const [modalError, setModalError] = useState<string | null>(null)

  const closeModal = useCallback(() => { setModal(null); setModalError(null); setForm({}) }, [])

  const openModal = useCallback((type: string, data?: object) => {
    // Coerce an unknown API value into a string form field ('' fallback).
    const ds = (v: unknown, fb = ''): string => {
      if (typeof v === 'string') return v
      if (typeof v === 'number') return String(v)
      return fb
    }
    const rec = data as Record<string, unknown> | undefined
    setModal({ type, data, editing: !!data })
    setModalError(null)

    if (type === 'ippool') {
      setForm({
        name: ds(rec?.name),
        cidr: ds(rec?.cidr),
        mode: ds(rec?.mode, 'vxlan'),
        nat_outgoing: rec?.nat_outgoing !== false,
        disabled: rec?.disabled === true,
        node_selector: ds(rec?.node_selector, 'all()'),
      })
    } else if (type === 'bgppeer') {
      setForm({
        name: ds(rec?.name),
        peer_ip: ds(rec?.peer_ip),
        peer_as_number: Number(rec?.peer_as_number) || 64512,
        node_as_number: ds(rec?.node_as_number),
        node: ds(rec?.node),
      })
    } else if (type === 'configmap') {
      setForm({ name: ds(rec?.name), namespace: ds(rec?.namespace, 'default'), dataLines: '' })
      if (rec) {
        // Fetch full detail (with values) for editing
        fetch(`${API_BASE_URL}/api/config/configmaps/${rec.namespace}/${rec.name}`)
          .then(r => r.json())
          .then(d => {
            const obj = d?.data?.data || {}
            setForm(f => ({
              ...f,
              dataLines: Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n'),
            }))
          })
          .catch(() => {})
      }
    } else if (type === 'secret') {
      setForm({ name: ds(rec?.name), namespace: ds(rec?.namespace, 'default'), secretType: ds(rec?.type, 'Opaque'), dataLines: '' })
      if (rec) {
        // Reading secret VALUES is super-user-gated on the backend, so the
        // detail fetch must carry the session token (present because the
        // Edit button runs through requireAuth).
        fetch(`${API_BASE_URL}/api/config/secrets/${rec.namespace}/${rec.name}`, { headers: getAuthHeaders() })
          .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
          .then(d => {
            const obj = d?.data?.data || {}
            setForm(f => ({
              ...f,
              secretType: d?.data?.type || f.secretType,
              dataLines: Object.entries(obj).map(([k, v]) => `${k}=${decodeB64(String(v))}`).join('\n'),
            }))
          })
          .catch(() => setModalError('Could not load secret values — session expired or backend unavailable'))
      }
    } else if (type === 'deployment') {
      setForm({
        name: ds(rec?.name),
        namespace: ds(rec?.namespace, 'default'),
        replicas: Number(rec?.replicas) || 1,
        image: ds(rec?.image),
      })
    }
  }, [])

  // ── Write actions wrapped in auth ─────────────────────────────
  const executeWithAuth = useCallback((fn: () => Promise<string | null>, onSuccess?: () => void) => {
    setSaving(true)
    setModalError(null)
    fn().then(err => {
      if (err) setModalError(err)
      else {
        closeModal()
        loadAll()
        onSuccess?.()
      }
    }).catch(e => setModalError(e.message || 'Error')).finally(() => setSaving(false))
  }, [closeModal, loadAll])

  const withAuth = useCallback((fn: () => Promise<string | null>, onSuccess?: () => void) => {
    if (!_superUserSession) {
      setPendingAction(() => () => executeWithAuth(fn, onSuccess))
      setShowAuth(true)
      return
    }
    executeWithAuth(fn, onSuccess)
  }, [executeWithAuth])

  // ── Namespace form state ──────────────────────────────────────
  const [nsName, setNsName] = useState('')

  const namespaceNames = useMemo(() => namespaces.map(n => n.name), [namespaces])

  const renderModal = () => {
    if (!modal) return null
    const { type, editing } = modal

    const close = () => { closeModal(); if (type === 'namespace') setNsName('') }

    const renderForm = () => {
      const upd = (patch: Record<string, FormValue>) => setForm(f => ({ ...f, ...patch }))

      switch (type) {
        case 'namespace': return (
          <div className="config-form-group">
            <label className="config-form-label">Namespace Name</label>
            <input className="config-form-input" value={nsName} onChange={e => setNsName(e.target.value)} placeholder="e.g. my-app" autoFocus />
          </div>
        )
        case 'ippool': return (
          <>
            <div className="config-form-group">
              <label className="config-form-label">Name</label>
              <input className="config-form-input" value={s('name')} onChange={e => upd({ name: e.target.value })} placeholder="e.g. pool-prod" disabled={!!editing} autoFocus />
            </div>
            <div className="config-form-group">
              <label className="config-form-label">CIDR</label>
              <input className="config-form-input" value={s('cidr')} onChange={e => upd({ cidr: e.target.value })} placeholder="e.g. 10.244.0.0/16" disabled={!!editing} />
            </div>
            <div className="config-form-group">
              <label className="config-form-label">Encapsulation Mode</label>
              <select className="config-form-input" value={s('mode') || 'vxlan'} onChange={e => upd({ mode: e.target.value })}>
                <option value="vxlan">VXLAN</option>
                <option value="ipip">IPIP</option>
                <option value="none">None (BGP only)</option>
              </select>
            </div>
            <div className="config-form-checkbox-row">
              <label className="config-form-checkbox">
                <input type="checkbox" checked={!!form.nat_outgoing} onChange={e => upd({ nat_outgoing: e.target.checked })} />
                NAT outgoing
              </label>
              <label className="config-form-checkbox">
                <input type="checkbox" checked={!!form.disabled} onChange={e => upd({ disabled: e.target.checked })} />
                Disabled
              </label>
            </div>
            <div className="config-form-group">
              <label className="config-form-label">Node Selector</label>
              <input className="config-form-input" value={s('node_selector') || 'all()'} onChange={e => upd({ node_selector: e.target.value })} placeholder="all()" />
            </div>
          </>
        )
        case 'bgppeer': return (
          <>
            <div className="config-form-group">
              <label className="config-form-label">Name</label>
              <input className="config-form-input" value={s('name')} onChange={e => upd({ name: e.target.value })} placeholder="e.g. peer-rack-1" disabled={!!editing} autoFocus />
            </div>
            <div className="config-form-group">
              <label className="config-form-label">Peer IP</label>
              <input className="config-form-input" value={s('peer_ip')} onChange={e => upd({ peer_ip: e.target.value })} placeholder="e.g. 192.168.1.254" />
            </div>
            <div className="config-form-group">
              <label className="config-form-label">Peer AS Number</label>
              <input className="config-form-input" type="number" value={num('peer_as_number', 64512)} onChange={e => upd({ peer_as_number: Number(e.target.value) })} />
            </div>
            <div className="config-form-group">
              <label className="config-form-label">Node AS Number (optional)</label>
              <input className="config-form-input" type="number" value={s('node_as_number')} onChange={e => upd({ node_as_number: e.target.value })}
                placeholder={form.node_as_number ? String(form.node_as_number) : 'Inherit from node'} />
            </div>
            <div className="config-form-group">
              <label className="config-form-label">Node (optional)</label>
              <input className="config-form-input" value={s('node')} onChange={e => upd({ node: e.target.value })} placeholder="e.g. worker-1 (blank = global)" />
            </div>
          </>
        )
        case 'configmap': return (
          <>
            <div className="config-form-row">
              <div className="config-form-group config-form-grow">
                <label className="config-form-label">Name</label>
                <input className="config-form-input" value={s('name')} onChange={e => upd({ name: e.target.value })} placeholder="e.g. app-config" disabled={!!editing} autoFocus />
              </div>
              <div className="config-form-group config-form-grow">
                <label className="config-form-label">Namespace</label>
                <input className="config-form-input" list="config-ns-list" value={s('namespace') || 'default'} onChange={e => upd({ namespace: e.target.value })} disabled={!!editing} />
              </div>
            </div>
            <datalist id="config-ns-list">{namespaceNames.map(n => <option key={n} value={n} />)}</datalist>
            <div className="config-form-group">
              <label className="config-form-label">Data (one <code>key=value</code> per line)</label>
              <textarea className="config-form-input config-form-textarea" rows={10} value={s('dataLines')} onChange={e => upd({ dataLines: e.target.value })}
                placeholder={'KEY=value\nfeatureFlag=true\nmaxRetries=3'} spellCheck={false} />
            </div>
          </>
        )
        case 'secret': return (
          <>
            <div className="config-form-row">
              <div className="config-form-group config-form-grow">
                <label className="config-form-label">Name</label>
                <input className="config-form-input" value={s('name')} onChange={e => upd({ name: e.target.value })} placeholder="e.g. db-credentials" disabled={!!editing} autoFocus />
              </div>
              <div className="config-form-group config-form-grow">
                <label className="config-form-label">Namespace</label>
                <input className="config-form-input" list="config-ns-list" value={s('namespace') || 'default'} onChange={e => upd({ namespace: e.target.value })} disabled={!!editing} />
              </div>
            </div>
            <datalist id="config-ns-list">{namespaceNames.map(n => <option key={n} value={n} />)}</datalist>
            <div className="config-form-group">
              <label className="config-form-label">Type</label>
              <select className="config-form-input" value={s('secretType') || 'Opaque'} onChange={e => upd({ secretType: e.target.value })}>
                <option value="Opaque">Opaque</option>
                <option value="kubernetes.io/tls">TLS</option>
                <option value="kubernetes.io/basic-auth">Basic Auth</option>
                <option value="kubernetes.io/dockerconfigjson">Docker Config</option>
                <option value="kubernetes.io/ssh-auth">SSH Auth</option>
              </select>
            </div>
            <div className="config-form-group">
              <label className="config-form-label">Data (one <code>key=value</code> per line, base64-encoded automatically)</label>
              <textarea className="config-form-input config-form-textarea" rows={8} value={s('dataLines')} onChange={e => upd({ dataLines: e.target.value })}
                placeholder={'username=admin\npassword=s3cret'} spellCheck={false} />
              <div className="config-form-hint" style={{ marginTop: 8 }}>
                Values are base64-encoded on save. For multi-line values (e.g. PEM certificates), paste the value in a single line — the encoder handles it.
              </div>
            </div>
          </>
        )
        case 'deployment': return (
          <>
            <div className="config-form-row">
              <div className="config-form-group config-form-grow">
                <label className="config-form-label">Name</label>
                <input className="config-form-input" value={s('name')} onChange={e => upd({ name: e.target.value })} placeholder="e.g. api-server" disabled={!!editing} autoFocus />
              </div>
              <div className="config-form-group config-form-grow">
                <label className="config-form-label">Namespace</label>
                <input className="config-form-input" list="config-ns-list" value={s('namespace') || 'default'} onChange={e => upd({ namespace: e.target.value })} disabled={!!editing} />
              </div>
            </div>
            <datalist id="config-ns-list">{namespaceNames.map(n => <option key={n} value={n} />)}</datalist>
            <div className="config-form-row">
              <div className="config-form-group config-form-grow">
                <label className="config-form-label">Image</label>
                <input className="config-form-input" value={s('image')} onChange={e => upd({ image: e.target.value })} placeholder="e.g. nginx:1.27" />
              </div>
              <div className="config-form-group config-form-grow">
                <label className="config-form-label">Replicas</label>
                <input className="config-form-input" type="number" min={0} value={num('replicas', 1)} onChange={e => upd({ replicas: Number(e.target.value) })} disabled={!!editing} />
              </div>
            </div>
            {editing && (
              <div className="config-form-hint">
                Editing updates the container image. To change replica count, use the <strong>Scale</strong> action in the table.
              </div>
            )}
          </>
        )
        default: return null
      }
    }

    const handleSave = () => {
      let path = '', method = '', body: Record<string, unknown> = {}
      switch (type) {
        case 'namespace': {
          const err = validateName(nsName)
          if (err) { setModalError(err); return }
          path = '/api/config/namespaces'; method = 'POST'; body = { name: nsName.trim() }
          break
        }
        case 'ippool': {
          const nameErr = validateName(s('name'))
          if (nameErr) { setModalError(nameErr); return }
          if (!editing) {
            const cidrErr = validateCIDR(s('cidr'))
            if (cidrErr) { setModalError(cidrErr); return }
          }
          if (editing) {
            path = `/api/config/ippools/${encodeURIComponent(s('name'))}`; method = 'PUT'
            body = { nat_outgoing: !!form.nat_outgoing, disabled: !!form.disabled, mode: form.mode, node_selector: form.node_selector }
          } else {
            path = '/api/config/ippools'; method = 'POST'
            body = { name: s('name').trim(), cidr: s('cidr').trim(), mode: form.mode, nat_outgoing: !!form.nat_outgoing, disabled: !!form.disabled, node_selector: form.node_selector }
          }
          break
        }
        case 'bgppeer': {
          const nameErr = validateName(s('name'))
          if (nameErr) { setModalError(nameErr); return }
          const ipErr = validateIP(s('peer_ip'))
          if (ipErr) { setModalError(ipErr); return }
          const bodyPartial: Record<string, unknown> = {
            peer_ip: s('peer_ip').trim(),
            peer_as_number: Number(form.peer_as_number) || 64512,
          }
          if (form.node_as_number !== undefined && form.node_as_number !== null && form.node_as_number !== '') bodyPartial.node_as_number = Number(form.node_as_number)
          if (s('node').trim()) bodyPartial.node = s('node').trim()
          if (editing) {
            path = `/api/config/bgppeers/${encodeURIComponent(s('name'))}`; method = 'PUT'
          } else {
            path = '/api/config/bgppeers'; method = 'POST'
            bodyPartial.name = s('name').trim()
          }
          body = bodyPartial
          break
        }
        case 'configmap': {
          if (!editing) {
            const nameErr = validateName(s('name'))
            if (nameErr) { setModalError(nameErr); return }
          }
          const { data: kv, error } = parseDataLines(s('dataLines'))
          if (error) { setModalError(error); return }
          if (editing) {
            path = `/api/config/configmaps/${form.namespace}/${form.name}`; method = 'PUT'; body = { data: kv }
          } else {
            path = '/api/config/configmaps'; method = 'POST'
            body = { name: s('name').trim(), namespace: s('namespace').trim() || 'default', data: kv }
          }
          break
        }
        case 'secret': {
          if (!editing) {
            const nameErr = validateName(s('name'))
            if (nameErr) { setModalError(nameErr); return }
          }
          const { data: kv, error } = parseDataLines(s('dataLines'))
          if (error) { setModalError(error); return }
          const encoded = Object.fromEntries(Object.entries(kv).map(([k, v]) => [k, encodeB64(v)]))
          if (editing) {
            path = `/api/config/secrets/${form.namespace}/${form.name}`; method = 'PUT'
            body = { type: form.secretType || 'Opaque', data: encoded }
          } else {
            path = '/api/config/secrets'; method = 'POST'
            body = { name: s('name').trim(), namespace: s('namespace').trim() || 'default', type: form.secretType || 'Opaque', data: encoded }
          }
          break
        }
        case 'deployment': {
          if (!editing) {
            const nameErr = validateName(s('name'))
            if (nameErr) { setModalError(nameErr); return }
          }
          if (!s('image').trim()) { setModalError('Image is required'); return }
          if (editing) {
            path = `/api/config/deployments/${form.namespace}/${form.name}/image`; method = 'PUT'; body = { image: s('image').trim() }
          } else {
            path = '/api/config/deployments'; method = 'POST'
            const replicasRaw = String(form.replicas ?? '').trim()
            const parsedReplicas = Number(replicasRaw)
            body = { name: s('name').trim(), namespace: s('namespace').trim() || 'default', replicas: replicasRaw !== '' && Number.isFinite(parsedReplicas) ? parsedReplicas : 1, image: s('image').trim() }
          }
          break
        }
      }
      withAuth(() => writeResource(path, method, body), () => {
        if (type === 'namespace') setNsName('')
      })
    }

    const titles: Record<string, string> = {
      namespace: 'Namespace', ippool: 'IP Pool', bgppeer: 'BGP Peer',
      configmap: 'ConfigMap', secret: 'Secret', deployment: 'Deployment',
    }

    return (
      <div className="config-modal-overlay" onClick={close}>
        <div className="config-modal" onClick={e => e.stopPropagation()}>
          <div className="config-modal-header">
            <h3>{titles[type] || 'Action'} — {editing ? 'Edit' : 'Create'}</h3>
            <button className="refresh-btn" onClick={close} style={{ padding: '4px 8px' }}><Icon name="x" size={16} /></button>
          </div>
          <div className="config-modal-body">
            {renderForm()}
            {modalError && <div className="config-form-error">{modalError}</div>}
            <div className="config-modal-actions">
              <button className="refresh-btn" onClick={close}>Cancel</button>
              <button className="refresh-btn" onClick={handleSave} disabled={saving} style={{ backgroundColor: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' }}>
                {saving ? 'Saving...' : (editing ? 'Save' : 'Create')}
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
              _superUserToken = ''; _superUserSession = false; setSuperUserActive(false)
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
      <ConfigSection title="IP Pools" icon="hard-drive" iconColor="var(--primary)" expanded={sections.ippools} onToggle={() => toggleSection('ippools')}
        addLabel="Create" onAdd={() => requireAuth(() => openModal('ippool'))}>
        {ipPools.length === 0 ? (
          <EmptyState icon={<Icon name="hard-drive" size={32} />} message="No IP pools" submessage="Click Create to add a pool" />
        ) : (
          <div className="storage-table-wrapper">
            <table className="storage-table"><thead><tr><th>Name</th><th>CIDR</th><th>Mode</th><th>NAT</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{ipPools.map(p => (
                <tr key={p.name}><td className="cell-mono"><span style={{ display:'flex',alignItems:'center',gap:6 }}><span style={{ width:8,height:8,borderRadius:'50%',backgroundColor:p.disabled?'var(--danger)':'var(--success)',display:'inline-block' }}/>{p.name}</span></td>
                  <td className="cell-mono">{p.cidr}</td>
                  <td><span className="badge badge-muted" style={{ color:MODE_COLORS[p.mode]||'var(--text-tertiary)',borderColor:MODE_COLORS[p.mode]||'var(--border)' }}>{p.mode.toUpperCase()}</span></td>
                  <td>{p.nat_outgoing ? <span className="badge badge-success">Enabled</span> : <span className="badge badge-muted">Disabled</span>}</td>
                  <td>{p.disabled ? <span className="badge badge-warning">Disabled</span> : <span className="badge badge-success">Active</span>}</td>
                  <td>
                    <div style={{display:'flex',gap:4}}>
                      <button className="refresh-btn" onClick={() => openModal('ippool', p)} style={{ padding:'4px 8px' }} title="Edit IP pool"><Icon name="edit" size={14} /></button>
                      <button className="refresh-btn" onClick={() => requireAuth(async () => {
                        const err = await deleteResource(`/api/config/ippools/${p.name}`)
                        if (err) alert(err); else loadAll()
                      })} style={{ padding:'4px 8px',color:'var(--danger)' }} title="Delete IP pool"><Icon name="trash-2" size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </ConfigSection>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/*  BGP Peers */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <ConfigSection title="BGP Peers" icon="git-branch" iconColor="var(--info)" expanded={sections.bgppeers} onToggle={() => toggleSection('bgppeers')}
        addLabel="Create" onAdd={() => requireAuth(() => openModal('bgppeer'))}>
        {bgpPeers.length === 0 ? (
          <EmptyState icon={<Icon name="git-branch" size={32} />} message="No BGP peers" submessage="Click Create to add a peer" />
        ) : (
          <div className="storage-table-wrapper">
            <table className="storage-table"><thead><tr><th>Name</th><th>Peer IP</th><th>Peer ASN</th><th>Node</th><th>Session</th><th>Actions</th></tr></thead>
              <tbody>{bgpPeers.map(p => (
                <tr key={p.name}><td className="cell-mono">{p.name}</td><td className="cell-mono">{p.peer_ip||'-'}</td><td className="cell-mono">{p.peer_as_number??'-'}</td>
                  <td className="cell-mono">{p.node||<span style={{color:'var(--text-tertiary)',fontStyle:'italic'}}>Global</span>}</td>
                  <td>{p.session_state==='up'?<span className="badge badge-success">UP</span>:p.session_state==='down'?<span className="badge badge-warning">DOWN</span>:<span className="badge badge-muted">{p.session_state||'unknown'}</span>}</td>
                  <td>
                    <div style={{display:'flex',gap:4}}>
                      <button className="refresh-btn" onClick={() => openModal('bgppeer', p)} style={{ padding:'4px 8px' }} title="Edit BGP peer"><Icon name="edit" size={14} /></button>
                      <button className="refresh-btn" onClick={() => requireAuth(async () => {
                        const err = await deleteResource(`/api/config/bgppeers/${p.name}`)
                        if (err) alert(err); else loadAll()
                      })} style={{ padding:'4px 8px',color:'var(--danger)' }} title="Delete BGP peer"><Icon name="trash-2" size={14} /></button>
                    </div>
                  </td>
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
      <ConfigSection title="ConfigMaps" icon="layers" iconColor="var(--warning)" expanded={sections.configmaps} onToggle={() => toggleSection('configmaps')}
        addLabel="Create" onAdd={() => requireAuth(() => openModal('configmap'))}>
        {configMaps.length === 0 ? (
          <EmptyState icon={<Icon name="layers" size={32} />} message="No ConfigMaps" submessage="Click Create to add one" />
        ) : (
          <div className="storage-table-wrapper">
            <table className="storage-table"><thead><tr><th>Name</th><th>Namespace</th><th>Keys</th><th>Actions</th></tr></thead>
              <tbody>{configMaps.map(cm => (
                <tr key={`${cm.namespace}/${cm.name}`}><td className="cell-mono">{cm.name}</td><td className="cell-mono">{cm.namespace}</td>
                  <td className="cell-mono" style={{fontSize:11}}>{(cm.keys||[]).join(', ') || <span style={{color:'var(--text-tertiary)'}}>—</span>}</td>
                  <td>
                    <div style={{display:'flex',gap:4}}>
                      <button className="refresh-btn" onClick={() => openModal('configmap', cm)} style={{ padding:'4px 8px' }} title="Edit ConfigMap"><Icon name="edit" size={14} /></button>
                      <button className="refresh-btn" onClick={() => requireAuth(async () => {
                        const err = await deleteResource(`/api/config/configmaps/${cm.namespace}/${cm.name}`)
                        if (err) alert(err); else loadAll()
                      })} style={{ padding:'4px 8px',color:'var(--danger)' }} title="Delete ConfigMap"><Icon name="trash-2" size={14} /></button>
                    </div>
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
      <ConfigSection title="Secrets" icon="lock" iconColor="var(--danger)" expanded={sections.secrets} onToggle={() => toggleSection('secrets')}
        addLabel="Create" onAdd={() => requireAuth(() => openModal('secret'))}>
        {secrets.length === 0 ? (
          <EmptyState icon={<Icon name="lock" size={32} />} message="No Secrets" submessage="Click Create to add one" />
        ) : (
          <div className="storage-table-wrapper">
            <table className="storage-table"><thead><tr><th>Name</th><th>Namespace</th><th>Type</th><th>Keys</th><th>Actions</th></tr></thead>
              <tbody>{secrets.map(s => (
                <tr key={`${s.namespace}/${s.name}`}><td className="cell-mono">{s.name}</td><td className="cell-mono">{s.namespace}</td><td>{s.type}</td>
                  <td className="cell-mono" style={{fontSize:11}}>{(s.keys||[]).join(', ') || <span style={{color:'var(--text-tertiary)'}}>—</span>}</td>
                  <td>
                    <div style={{display:'flex',gap:4}}>
                      <button className="refresh-btn" onClick={() => requireAuth(() => openModal('secret', s))} style={{ padding:'4px 8px' }} title="Edit Secret (requires unlock)"><Icon name="edit" size={14} /></button>
                      <button className="refresh-btn" onClick={() => requireAuth(async () => {
                        const err = await deleteResource(`/api/config/secrets/${s.namespace}/${s.name}`)
                        if (err) alert(err); else loadAll()
                      })} style={{ padding:'4px 8px',color:'var(--danger)' }} title="Delete Secret"><Icon name="trash-2" size={14} /></button>
                    </div>
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
      <ConfigSection title="Deployments" icon="layers" iconColor="var(--warning)" expanded={sections.deployments} onToggle={() => toggleSection('deployments')}
        addLabel="Create" onAdd={() => requireAuth(() => openModal('deployment'))}>
        {deployments.length === 0 ? (
          <EmptyState icon={<Icon name="layers" size={32} />} message="No deployments" submessage="Click Create to deploy a workload" />
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
                      <button className="refresh-btn" onClick={() => openModal('deployment', d)} style={{ padding:'4px 8px' }} title="Edit image"><Icon name="edit" size={14} /></button>
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
          max-width: 560px;
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
        .config-form-label code { color: var(--primary); background: rgba(59,130,246,0.1); padding: 1px 4px; border-radius: 3px; font-size: 10px; }
        .config-form-input { width:100%; padding:9px 12px; background-color:var(--bg); border:1px solid var(--border); border-radius:var(--radius); color:var(--text); font-size:13px; font-family:inherit; transition:border-color 0.2s ease, box-shadow 0.2s ease; }
        .config-form-input:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 1px rgba(59,130,246,0.3); }
        .config-form-input:disabled { opacity: 0.55; cursor: not-allowed; }
        .config-form-textarea { resize: vertical; min-height: 90px; font-family: 'SF Mono', 'Courier New', monospace; font-size: 12px; line-height: 1.5; }
        .config-form-row { display: flex; gap: 12px; }
        .config-form-grow { flex: 1; }
        .config-form-checkbox-row { display: flex; gap: 24px; margin-bottom: 14px; }
        .config-form-checkbox { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }
        .config-form-checkbox input { accent-color: var(--primary); }
        .config-form-hint { background: rgba(59,130,246,0.06); border: 1px solid rgba(59,130,246,0.15); border-radius: var(--radius); padding: 9px 12px; font-size: 12px; color: var(--text-secondary); margin-bottom: 14px; }
        .config-form-error { background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:var(--radius); padding:10px 14px; font-size:13px; color:var(--danger); margin-bottom:12px; }
        .config-section .dashboard-compact-bar { margin-bottom:20px; }
        @media (max-width: 640px) {
          .config-form-row { flex-direction: column; gap: 0; }
        }
      `}</style>
    </div>
  )
}
