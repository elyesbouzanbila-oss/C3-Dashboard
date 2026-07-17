import { useDashboard, useTabSubscription } from '../context/DashboardContext'
import type { CalicoNodeStatus } from '../types'
import { DataSourceBadge } from './DataSourceBadge'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'

function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return '-'
  if (seconds === 0) return '0m'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 60)}m`
}

function getHealthColor(ready: boolean): string {
  return ready ? 'var(--success)' : 'var(--danger)'
}

function getHealthLabel(ready: boolean): string {
  return ready ? 'Healthy' : 'Down'
}

/** Simple donut chart SVG. */
function DonutChart({
  pct,
  size = 48,
  strokeWidth = 4,
  color,
  bgColor = 'rgba(255,255,255,0.06)',
}: {
  pct: number
  size?: number
  strokeWidth?: number
  color: string
  bgColor?: string
}) {
  const r = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut-chart" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={bgColor} strokeWidth={strokeWidth} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ - dash}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 1s ease, stroke 0.4s ease' }}
      />
    </svg>
  )
}

export function CniHealthPanel() {
  useTabSubscription('cni-health')

  const { cniNodes: nodes, cniNodesStatus: status } = useDashboard()
  const isReady = (n: CalicoNodeStatus) => n.calico_ready ?? n.felix_ready ?? false
  const healthy = nodes.filter(isReady)
  const down = nodes.filter(n => !isReady(n))

  const totalPct = nodes.length > 0 ? (healthy.length / nodes.length) * 100 : 0

  return (
    <div className="cni-health-section">
      <div className="subsection">
        <div className="subsection-header">
          <h3>Calico Node Agents</h3>
          <DataSourceBadge status={status} label="CNI nodes" />
        </div>

        {/* ── Compact stats bar ── */}
        <div className="dashboard-compact-bar" style={{ marginBottom: 20 }}>
          <div className="dashboard-mini-stat">
            <span className="dashboard-mini-stat-icon" style={{ color: 'var(--success)' }}>
              <Icon name="check" size={16} />
            </span>
            <div className="dashboard-mini-stat-content">
              <span className="dashboard-mini-stat-value" style={{ color: 'var(--success)' }}>{healthy.length}/{nodes.length}</span>
              <span className="dashboard-mini-stat-label">Healthy</span>
            </div>
          </div>
          <div className="dashboard-mini-stat">
            <span className="dashboard-mini-stat-icon" style={{ color: down.length > 0 ? 'var(--danger)' : 'var(--text-tertiary)' }}>
              <Icon name="x" size={16} />
            </span>
            <div className="dashboard-mini-stat-content">
              <span className="dashboard-mini-stat-value" style={{ color: down.length > 0 ? 'var(--danger)' : 'var(--text-tertiary)' }}>{down.length}</span>
              <span className="dashboard-mini-stat-label">Down</span>
            </div>
          </div>
          <div className="dashboard-mini-stat">
            <span className="dashboard-mini-stat-icon" style={{ color: 'var(--info)' }}>
              <Icon name="activity" size={16} />
            </span>
            <div className="dashboard-mini-stat-content">
              <span className="dashboard-mini-stat-value" style={{ color: 'var(--info)' }}>{nodes.length}</span>
              <span className="dashboard-mini-stat-label">Total Nodes</span>
            </div>
          </div>
          <div className="dashboard-compbar-actions">
            {nodes.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <DonutChart pct={totalPct} size={28} strokeWidth={3} color="var(--success)" />
                <span className="dashboard-last-updated" style={{ fontSize: 11 }}>
                  {totalPct.toFixed(0)}% healthy
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Node cards ── */}
        {nodes.length === 0 ? (
          <EmptyState
            icon={<Icon name="activity" size={48} />}
            message="No Calico node data"
            submessage="Ensure calico-node pods are running in kube-system."
          />
        ) : (
          <div className="cni-health-grid stagger-container" style={{ display: 'grid' }}>
            {nodes.map((n, idx) => {
              const nodeReady = isReady(n)
              const healthColor = getHealthColor(nodeReady)
              const healthLabel = getHealthLabel(nodeReady)

              // Readiness breakdown
              const felixOk = n.felix_ready ?? false
              const birdOk = n.bird_ready ?? false
              const componentsReady = [felixOk, birdOk].filter(Boolean).length
              const componentsTotal = 2

              // Color for Felix vs Bird
              const felixColor = felixOk ? 'var(--success)' : 'var(--danger)'
              const birdColor = birdOk ? 'var(--success)' : 'var(--danger)'

              return (
                <div
                  key={n.node}
                  className="cni-health-card gradient-border-card stagger-item"
                  style={{
                    '--health-color': healthColor,
                    animationDelay: `${0.04 + idx * 0.08}s`,
                  } as React.CSSProperties}
                >
                  {/* Card header */}
                  <div className="cni-health-card-header">
                    <div className="cni-health-card-name">
                      <span className="cni-health-indicator" style={{ backgroundColor: healthColor }} />
                      <span>{n.node}</span>
                    </div>
                    <span className="cni-health-badge" style={{ backgroundColor: healthColor, color: '#fff' }}>
                      {healthLabel}
                    </span>
                  </div>

                  {/* Card body */}
                  <div className="cni-health-card-body">
                    <div className="cni-health-detail">
                      <span className="cni-health-detail-label">IP</span>
                      <span className="cni-health-detail-value">{n.ip || '-'}</span>
                    </div>

                    {/* Readiness breakdown */}
                    <div className="cni-health-detail">
                      <span className="cni-health-detail-label">Felix</span>
                      <span className="cni-health-detail-value" style={{ color: felixColor }}>
                        <span style={{
                          width: 7, height: 7, borderRadius: '50%',
                          backgroundColor: felixColor, display: 'inline-block',
                          boxShadow: felixOk ? `0 0 6px ${felixColor}` : 'none',
                        }} />
                        {felixOk ? 'Ready' : 'Down'}
                      </span>
                    </div>
                    <div className="cni-health-detail">
                      <span className="cni-health-detail-label">BIRD</span>
                      <span className="cni-health-detail-value" style={{ color: birdColor }}>
                        <span style={{
                          width: 7, height: 7, borderRadius: '50%',
                          backgroundColor: birdColor, display: 'inline-block',
                          boxShadow: birdOk ? `0 0 6px ${birdColor}` : 'none',
                        }} />
                        {birdOk ? 'Ready' : 'Down'}
                      </span>
                    </div>

                    {/* Readiness bar */}
                    <div style={{ marginTop: 10 }}>
                      <div className="cni-health-detail" style={{ marginBottom: 4 }}>
                        <span className="cni-health-detail-label">Readiness</span>
                        <span className="cni-health-detail-value" style={{ color: healthColor }}>
                          {componentsReady}/{componentsTotal}
                        </span>
                      </div>
                      <div style={{
                        width: '100%', height: 6,
                        backgroundColor: 'rgba(255,255,255,0.06)',
                        borderRadius: 3, overflow: 'hidden',
                        display: 'flex', gap: 3,
                      }}>
                        <div style={{
                          flex: 1, height: '100%', borderRadius: 3,
                          backgroundColor: felixColor,
                          opacity: felixOk ? 1 : 0.3,
                          transition: 'all 0.5s ease',
                        }} title={`Felix: ${felixOk ? 'Ready' : 'Down'}`} />
                        <div style={{
                          flex: 1, height: '100%', borderRadius: 3,
                          backgroundColor: birdColor,
                          opacity: birdOk ? 1 : 0.3,
                          transition: 'all 0.5s ease',
                        }} title={`BIRD: ${birdOk ? 'Ready' : 'Down'}`} />
                      </div>
                    </div>

                    {/* Uptime */}
                    <div className="cni-health-detail" style={{ marginTop: 8 }}>
                      <span className="cni-health-detail-label">Uptime</span>
                      <span className="cni-health-detail-value" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatUptime(n.uptime_seconds)}
                      </span>
                    </div>

                    {/* Last reported */}
                    {n.last_reported && (
                      <div className="cni-health-detail" style={{ marginTop: 4 }}>
                        <span className="cni-health-detail-label">Reported</span>
                        <span className="cni-health-detail-value" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                          {n.last_reported}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Scoped CSS ── */}
      <style>{`
        .cni-health-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
          gap: 16px;
        }
        .cni-health-card {
          background-color: var(--surface);
          border: 1px solid var(--border);
          border-top: 3px solid var(--health-color, var(--success));
          border-radius: var(--radius-lg);
          padding: 18px;
          transition: all 0.25s ease;
          position: relative;
          overflow: hidden;
        }
        .cni-health-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, var(--health-color, var(--success)), transparent);
          opacity: 0.6;
        }
        .cni-health-card:hover {
          border-color: var(--border-hover);
          box-shadow: var(--shadow-hover);
          transform: translateY(-2px);
        }
        .cni-health-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 14px;
        }
        .cni-health-card-name {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 15px;
          font-weight: 600;
          color: var(--text);
          min-width: 0;
          word-break: break-word;
        }
        .cni-health-indicator {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
          box-shadow: 0 0 8px var(--health-color, var(--success));
        }
        .cni-health-badge {
          padding: 3px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.3px;
          flex-shrink: 0;
        }
        .cni-health-card-body {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .cni-health-detail {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
        }
        .cni-health-detail-label {
          color: var(--text-tertiary);
          font-size: 11px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          min-width: 52px;
          flex-shrink: 0;
        }
        .cni-health-detail-value {
          display: flex;
          align-items: center;
          gap: 5px;
          color: var(--text-secondary);
          font-family: 'SF Mono', 'Courier New', monospace;
          font-size: 12px;
        }
        @media (max-width: 768px) {
          .cni-health-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  )
}
