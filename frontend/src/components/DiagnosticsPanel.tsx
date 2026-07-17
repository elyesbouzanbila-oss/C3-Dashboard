import { useState, useRef, useMemo, useCallback } from 'react'
import { useDashboard } from '../context/DashboardContext'
import { Icon } from './Icon'

interface LogEntry {
  id: number
  type: 'info' | 'success' | 'error' | 'command'
  message: string
  timestamp: Date
}

interface PortOption {
  value: number
  label: string
}

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export function DiagnosticsPanel() {
  const { pods, cniTopology } = useDashboard()
  const [sourceNs, setSourceNs] = useState('default')
  const [sourcePod, setSourcePod] = useState('')
  const [targetType, setTargetType] = useState<'pod' | 'service'>('pod')
  const [targetNs, setTargetNs] = useState('default')
  const [targetPod, setTargetPod] = useState('')
  const [targetService, setTargetService] = useState('')
  const [targetPort, setTargetPort] = useState(80)
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logIdRef = useRef(0)
  const logEndRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev, { id: logIdRef.current++, type, message, timestamp: new Date() }])
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [])

  const uniqueNamespaces = useMemo(() => [...new Set(pods.map(p => p.namespace))].sort(), [pods])

  const podsInSourceNs = pods.filter(p => p.namespace === sourceNs)
  const podsInTargetNs = pods.filter(p => p.namespace === targetNs)

  // ── Derive services from topology ─────────────────────────────
  const servicesInTargetNs = useMemo(() => {
    if (!cniTopology) return []
    return cniTopology.nodes
      .filter(n => n.type === 'service' && n.namespace === targetNs && !n.id.startsWith('bgp:'))
      .map(n => ({
        name: n.name,
        ports: n.ports || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [cniTopology, targetNs])

  // ── Compute port options from target pod ───────────────────────
  const targetPodPortOptions = useMemo((): PortOption[] => {
    if (targetType !== 'pod' || !targetPod) return []
    const pod = pods.find(p => p.namespace === targetNs && p.name === targetPod)
    if (!pod) return []
    const seen = new Set<number>()
    const options: PortOption[] = []
    for (const c of pod.containers || []) {
      for (const port of c.ports || []) {
        if (!seen.has(port.containerPort)) {
          seen.add(port.containerPort)
          const nameLabel = port.name ? ` (${port.name})` : ''
          const protoLabel = port.protocol ? `/${port.protocol}` : '/TCP'
          options.push({
            value: port.containerPort,
            label: `${port.containerPort}${protoLabel}${nameLabel}`,
          })
        }
      }
    }
    return options.sort((a, b) => a.value - b.value)
  }, [targetType, targetPod, targetNs, pods])

  // ── Compute port options from target service ───────────────────
  const targetServicePortOptions = useMemo((): PortOption[] => {
    if (targetType !== 'service' || !targetService) return []
    const svc = servicesInTargetNs.find(s => s.name === targetService)
    if (!svc || !svc.ports) return []
    const seen = new Set<number>()
    const options: PortOption[] = []
    // Parse port entries like "http:80/TCP" or "dns-udp:53/UDP"
    for (const entry of svc.ports.split(', ')) {
      // Try to extract port number: look for pattern like ":80/TCP" or "53/UDP"
      const match = entry.match(/(\d+)\/(\w+)/)
      if (match) {
        const portNum = parseInt(match[1], 10)
        if (!seen.has(portNum)) {
          seen.add(portNum)
          const proto = match[2]
          const nameMatch = entry.match(/^([^:]+):/)
          const nameLabel = nameMatch ? ` (${nameMatch[1]})` : ''
          options.push({
            value: portNum,
            label: `${portNum}/${proto}${nameLabel}`,
          })
        }
      }
    }
    return options.sort((a, b) => a.value - b.value)
  }, [targetType, targetService, servicesInTargetNs])

  // ── Active port options based on target type ───────────────────
  const portOptions = useMemo(() => {
    if (targetType === 'pod') {
      return targetPodPortOptions.length > 0 ? targetPodPortOptions : null
    }
    return targetServicePortOptions.length > 0 ? targetServicePortOptions : null
  }, [targetType, targetPodPortOptions, targetServicePortOptions])

  // Auto-select first port when options change and current port isn't valid
  const prevPodRef = useRef('')
  const prevSvcRef = useRef('')
  if (targetType === 'pod' && targetPod !== prevPodRef.current && targetPodPortOptions.length > 0) {
    prevPodRef.current = targetPod
    const currentValid = targetPodPortOptions.some(o => o.value === targetPort)
    if (!currentValid) {
      setTargetPort(targetPodPortOptions[0].value)
    }
  }
  if (targetType === 'service' && targetService !== prevSvcRef.current && targetServicePortOptions.length > 0) {
    prevSvcRef.current = targetService
    const currentValid = targetServicePortOptions.some(o => o.value === targetPort)
    if (!currentValid) {
      setTargetPort(targetServicePortOptions[0].value)
    }
  }

  const handleRunTest = useCallback(async () => {
    if (!sourcePod) {
      addLog('error', 'Please select a source pod.')
      return
    }
    if (targetType === 'pod' && !targetPod) {
      addLog('error', 'Please select a target pod.')
      return
    }
    if (targetType === 'service' && !targetService) {
      addLog('error', 'Please enter a target service name.')
      return
    }
    if (!targetPort || targetPort < 1 || targetPort > 65535) {
      addLog('error', 'Please enter a valid target port (1-65535).')
      return
    }

    setRunning(true)
    addLog('info', `Initiating connectivity test from ${sourceNs}/${sourcePod} to ${targetType === 'pod' ? `${targetNs}/${targetPod}:${targetPort}` : `${targetNs}/${targetService}:${targetPort}`}...`)

    try {
      const params = new URLSearchParams({
        source_pod: sourcePod,
        source_namespace: sourceNs,
        target_namespace: targetNs,
      })
      params.set('target_port', String(targetPort))
      if (targetType === 'pod') {
        params.set('target_pod', targetPod)
      } else {
        params.set('target_service', targetService)
        params.delete('target_pod')
      }

      addLog('command', `POST /api/cni/diagnostics/connectivity?${params.toString()}`)

      const response = await fetch(`${API_BASE_URL}/api/cni/diagnostics/connectivity?${params.toString()}`, {
        method: 'POST',
      })

      if (response.ok) {
        const data = await response.json()
        addLog('info', `Response status: ${data.status}`)
        const d = data.data
        if (d?.reachable === true) {
          const targetDisplay = targetType === 'pod' ? `${targetNs}/${targetPod}:${targetPort}` : `${targetNs}/${targetService}:${targetPort}`
          addLog('success', `✓ ${sourceNs}/${sourcePod} → ${targetDisplay} REACHABLE (${d.latency_ms || '?'}ms)`)
          if (d.dns_result?.trim()) {
            addLog('info', `DNS: ${d.dns_result.split('\n')[0]}`)
          }
        } else if (d?.reachable === false) {
          const targetDisplay = targetType === 'pod' ? `${targetNs}/${targetPod}:${targetPort}` : `${targetNs}/${targetService}:${targetPort}`
          addLog('error', `✗ ${sourceNs}/${sourcePod} → ${targetDisplay} NOT REACHABLE`)
        } else {
          addLog('info', `Result: ${d?.note || 'No result'}`)
        }
        // Show log preview
        if (d?.log_preview && d.log_preview !== 'No output from diagnostic pod') {
          const preview = d.log_preview.substring(0, 300)
          addLog('command', preview)
        }
      } else {
        addLog('error', `HTTP ${response.status}: ${response.statusText}`)
      }
    } catch (err) {
      addLog('error', `Network error: ${err instanceof Error ? err.message : 'Unknown'}`)
    } finally {
      setRunning(false)
      addLog('info', 'Connectivity test completed.')
    }
  }, [sourceNs, sourcePod, targetNs, targetPod, targetService, targetType, targetPort, addLog])

  const handleClearLogs = useCallback(() => {
    setLogs([])
    logIdRef.current = 0
  }, [])

  const logTimeFormatter = useCallback((d: Date) => {
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }, [])

  return (
    <div className="section diagnostics-section">
      <h2>Connectivity Diagnostics</h2>

      <div className="diagnostics-layout">
        {/* Left column: Form */}
        <div className="diagnostics-form">
          <div className="dashboard-card dashboard-card-wide" style={{ display: 'block', marginBottom: '16px' }}>
            <div className="dashboard-card-header">
              <Icon name="play" size={16} className="card-header-icon" />
              <span>Test Configuration</span>
            </div>

            {/* Source */}
            <div className="diagnostics-form-section">
              <h4 className="diagnostics-form-label">Source</h4>
              <div className="diagnostics-form-row">
                <div className="diagnostics-form-field">
                  <label className="diagnostics-field-label">Namespace</label>
                  <select
                    className="diagnostics-select"
                    value={sourceNs}
                    onChange={e => { setSourceNs(e.target.value); setSourcePod('') }}
                  >
                    {uniqueNamespaces.map(ns => (
                      <option key={ns} value={ns}>{ns}</option>
                    ))}
                  </select>
                </div>
                <div className="diagnostics-form-field">
                  <label className="diagnostics-field-label">Pod</label>
                  <select
                    className="diagnostics-select"
                    value={sourcePod}
                    onChange={e => setSourcePod(e.target.value)}
                  >
                    <option value="">— Select pod —</option>
                    {podsInSourceNs.map(p => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Target */}
            <div className="diagnostics-form-section">
              <h4 className="diagnostics-form-label">Target</h4>
              <div className="diagnostics-target-type">
                <button
                  className={`security-chip ${targetType === 'pod' ? 'active' : ''}`}
                  onClick={() => setTargetType('pod')}
                >
                  <Icon name="pod" size={14} />
                  Pod
                </button>
                <button
                  className={`security-chip ${targetType === 'service' ? 'active' : ''}`}
                  onClick={() => setTargetType('service')}
                >
                  <Icon name="network" size={14} />
                  Service
                </button>
              </div>
              <div className="diagnostics-form-row">
                <div className="diagnostics-form-field">
                  <label className="diagnostics-field-label">Namespace</label>
                  <select
                    className="diagnostics-select"
                    value={targetNs}
                    onChange={e => { setTargetNs(e.target.value); setTargetPod(''); setTargetService('') }}
                  >
                    {uniqueNamespaces.map(ns => (
                      <option key={ns} value={ns}>{ns}</option>
                    ))}
                  </select>
                </div>
                <div className="diagnostics-form-field">
                  <label className="diagnostics-field-label">Port</label>
                  {portOptions ? (
                    <select
                      className="diagnostics-select"
                      value={targetPort}
                      onChange={e => setTargetPort(parseInt(e.target.value))}
                    >
                      {portOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      className="diagnostics-input"
                      min={1}
                      max={65535}
                      value={targetPort}
                      onChange={e => setTargetPort(parseInt(e.target.value) || 80)}
                      placeholder={targetType === 'pod' ? 'Select a pod first' : 'e.g. 80'}
                    />
                  )}
                </div>
              </div>
              <div className="diagnostics-form-row">
                <div className="diagnostics-form-field">
                  {targetType === 'pod' ? (
                    <>
                      <label className="diagnostics-field-label">Pod</label>
                      <select
                        className="diagnostics-select"
                        value={targetPod}
                        onChange={e => setTargetPod(e.target.value)}
                      >
                        <option value="">— Select pod —</option>
                        {podsInTargetNs.map(p => (
                          <option key={p.name} value={p.name}>{p.name}</option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
                      <label className="diagnostics-field-label">Service Name</label>
                      {servicesInTargetNs.length > 0 ? (
                        <select
                          className="diagnostics-select"
                          value={targetService}
                          onChange={e => { setTargetService(e.target.value); setTargetPod('') }}
                        >
                          <option value="">— Select service —</option>
                          {servicesInTargetNs.map(s => (
                            <option key={s.name} value={s.name}>{s.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          className="diagnostics-input"
                          placeholder="e.g. my-service"
                          value={targetService}
                          onChange={e => setTargetService(e.target.value)}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            <button
              className="diagnostics-run-btn"
              onClick={handleRunTest}
              disabled={running}
            >
              {running ? (
                <>
                  <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
                  Running...
                </>
              ) : (
                <>
                  <Icon name="play" size={16} />
                  Run Test
                </>
              )}
            </button>
          </div>

          {pods.length === 0 && (
            <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', fontStyle: 'italic' }}>
              No pods loaded. Some features may be limited.
            </p>
          )}
        </div>

        {/* Right column: Log */}
        <div className="diagnostics-log">
          <div className="diagnostics-log-header">
            <div className="dashboard-card-header" style={{ marginBottom: 0 }}>
              <Icon name="activity" size={16} className="card-header-icon" />
              <span>Test Results</span>
            </div>
            <button className="refresh-btn" onClick={handleClearLogs} title="Clear log">
              <Icon name="trash-2" size={16} />
              <span>Clear</span>
            </button>
          </div>

          <div className="diagnostics-log-content">
            {logs.length === 0 ? (
              <div className="diagnostics-log-empty">
                <Icon name="info" size={24} />
                <span>Run a connectivity test to see results here.</span>
              </div>
            ) : (
              logs.map(entry => (
                <div key={entry.id} className={`diagnostics-log-entry diagnostics-log-${entry.type}`}>
                  <span className="diagnostics-log-time">{logTimeFormatter(entry.timestamp)}</span>
                  <span className="diagnostics-log-msg">{entry.message}</span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  )
}
