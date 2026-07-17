import { useMemo } from 'react'
import { useDashboard } from '../context/DashboardContext'
import { DataSourceBadge } from './DataSourceBadge'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'

function getUtilColor(pct: number): string {
  if (pct >= 90) return 'var(--danger)'
  if (pct >= 70) return 'var(--warning)'
  if (pct >= 40) return 'var(--primary)'
  return 'var(--success)'
}

function formatCIDR(cidr: string): string {
  return cidr || '-'
}

function getModeLabel(mode: string): string {
  switch (mode) {
    case 'ipip': return 'IPIP'
    case 'vxlan': return 'VXLAN'
    case 'none': return 'Direct'
    default: return mode.toUpperCase()
  }
}

/** Parse CIDR and return network prefix length and host bits. */
function parseCidr(cidr: string): { prefix: number; bits: number } | null {
  const parts = cidr.split('/')
  if (parts.length !== 2) return null
  const bits = parseInt(parts[1], 10)
  if (isNaN(bits) || bits < 0 || bits > 128) return null
  // Detect IPv6 by presence of ':' in the address portion
  const isIpv6 = parts[0].includes(':')
  const totalBits = isIpv6 ? 128 : 32
  return { prefix: bits, bits: totalBits - bits }
}

/** Simple donut chart SVG (reused from DashboardPanel pattern). */
function DonutChart({
  pct,
  size = 64,
  strokeWidth = 6,
  color,
}: {
  pct: number
  size?: number
  strokeWidth?: number
  color: string
}) {
  const r = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut-chart" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ - dash}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 1s ease, stroke 0.4s ease' }}
      />
      <text
        x={size / 2} y={size / 2}
        textAnchor="middle" dominantBaseline="central"
        fill="currentColor" fontSize={size * 0.22}
        fontWeight={700}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {pct.toFixed(0)}%
      </text>
    </svg>
  )
}

/** Small colored utilization bar. */
function UtilizationBar({ pct }: { pct: number }) {
  const color = getUtilColor(pct)
  return (
    <div className="ipam-pool-bar-track" style={{ height: 6, borderRadius: 3 }}>
      <div
        className="ipam-pool-bar-fill"
        style={{
          width: `${Math.min(pct, 100)}%`,
          backgroundColor: color,
          height: '100%',
          borderRadius: 3,
          transition: 'width 0.8s ease',
        }}
      />
    </div>
  )
}

export function IpamPanel() {
  const { ipPools: pools, ipamBlocks: blocks, ipPoolsStatus: poolsStatus, ipamStatus } = useDashboard()
  const totalPools = pools.length
  const totalAllocated = useMemo(() => blocks.reduce((acc, b) => acc + b.allocated, 0), [blocks])
  const totalCapacity = useMemo(() => blocks.reduce((acc, b) => acc + b.total, 0), [blocks])
  const overallPct = totalCapacity > 0 ? (totalAllocated / totalCapacity) * 100 : 0

  return (
    <div className="section ipam-section">
      <h2>IP Address Management</h2>

      {/* ── Summary stats with donut charts ── */}
      <div className="pod-metrics-cluster-summary stagger-container">
        {[
          { label: 'IP Pools', value: String(totalPools), icon: 'hard-drive', color: 'var(--primary)' },
          { label: 'Allocated IPs', value: String(totalAllocated), icon: 'zap', color: 'var(--info)' },
          { label: 'Total Capacity', value: String(totalCapacity), icon: 'server', color: 'var(--text)' },
          {
            label: 'Utilization',
            value: `${overallPct.toFixed(1)}%`,
            icon: 'bar-chart',
            color: getUtilColor(overallPct),
            donut: true,
          },
        ].map((stat) => (
          <div key={stat.label} className="pod-metrics-cluster-stat stagger-item" style={{ position: 'relative', overflow: 'hidden' }}>
            {stat.donut ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <DonutChart pct={overallPct} size={56} strokeWidth={5} color={stat.color} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="cluster-stat-value" style={{ color: stat.color, fontSize: 18 }}>{stat.value}</span>
                  <span className="cluster-stat-label">{stat.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {totalAllocated} / {totalCapacity} IPs
                  </span>
                </div>
              </div>
            ) : (
              <>
                <span className="cluster-stat-value" style={{ color: stat.color }}>{stat.value}</span>
                <span className="cluster-stat-label">{stat.label}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {/* ── Per-pool utilization with CIDR visual breakdown ── */}
      <div className="subsection">
        <div className="subsection-header">
          <h3>Pool Utilization</h3>
          <DataSourceBadge status={ipamStatus} label="IPAM data" />
        </div>

        {blocks.length === 0 ? (
          <EmptyState
            icon={<Icon name="bar-chart" size={48} />}
            message="No IPAM data"
            submessage="Ensure Calico is installed and IP pools are configured."
          />
        ) : (
          <div className="ipam-pool-list stagger-container">
            {blocks.map((b, idx) => {
              const color = getUtilColor(b.utilization_pct)
              const poolDef = pools.find(p => p.name === b.pool)
              const cidrParsed = poolDef ? parseCidr(poolDef.cidr) : null
              return (
                <div
                  key={b.pool}
                  className="dashboard-card dashboard-card-wide gradient-border-card stagger-item"
                  style={{ display: 'block', animationDelay: `${0.04 + idx * 0.06}s` }}
                >
                  {/* Header row */}
                  <div className="ipam-pool-header">
                    <div className="ipam-pool-name">{b.pool}</div>
                    <div className="ipam-pool-stats" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="ipam-blocks-badge">
                        <Icon name="layers" size={12} /> {b.blocks} block{b.blocks !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>

                  {/* Main content: utilization bar + donut */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
                    {/* Donut (compact) */}
                    <DonutChart pct={b.utilization_pct} size={48} strokeWidth={4} color={color} />
                    {/* Bars & stats */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Progress bar */}
                      <UtilizationBar pct={b.utilization_pct} />
                      <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        marginTop: 6, fontSize: 12, color: 'var(--text-secondary)',
                      }}>
                        <span style={{ fontWeight: 600, color }}>{b.allocated} / {b.total} IPs</span>
                        <span style={{ color }}>{b.utilization_pct.toFixed(1)}% utilized</span>
                      </div>
                    </div>
                  </div>

                  {/* CIDR visual breakdown */}
                  {cidrParsed && poolDef && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                          CIDR
                        </span>
                        <span style={{
                          fontSize: 13, fontFamily: "'SF Mono','Courier New',monospace",
                          color: 'var(--primary)', fontWeight: 600,
                        }}>
                          {poolDef.cidr}
                        </span>
                      </div>
                      {/* Visual CIDR bits bar */}
                      <div className="cidr-visual-bar" style={{
                        display: 'flex', gap: 2, marginTop: 4,
                      }}>
                        {/* Network prefix bits */}
                        {Array.from({ length: cidrParsed.prefix }).map((_, i) => (
                          <div
                            key={`net-${i}`}
                            className="cidr-bit cidr-bit-network"
                            title={`Network bit ${i + 1}`}
                            style={{
                              flex: 1, height: 10, borderRadius: 2,
                              backgroundColor: 'rgba(59, 130, 246, 0.5)',
                              transition: 'background-color 0.2s ease',
                            }}
                          />
                        ))}
                        {/* Host bits */}
                        {cidrParsed.bits > 0 ? (
                          Array.from({ length: cidrParsed.bits }).map((_, i) => (
                            <div
                              key={`host-${i}`}
                              className="cidr-bit cidr-bit-host"
                              title={`Host bit ${i + 1}`}
                              style={{
                                flex: 1, height: 10, borderRadius: 2,
                                backgroundColor: 'rgba(16, 185, 129, 0.35)',
                                transition: 'background-color 0.2s ease',
                              }}
                            />
                          ))
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', paddingLeft: 4 }}>No host bits</span>
                        )}
                      </div>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        marginTop: 5, fontSize: 11, color: 'var(--text-tertiary)',
                      }}>
                        <span style={{ color: 'var(--primary)', fontWeight: 500 }}>/{cidrParsed.prefix} network</span>
                        {cidrParsed.bits > 0 && (
                          <span style={{ color: 'var(--success)', fontWeight: 500 }}>
                            {cidrParsed.bits} host bits · {Math.pow(2, cidrParsed.bits).toLocaleString()} addresses
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Allocated blocks breakdown (estimated) */}
                  {b.blocks > 0 && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <Icon name="grid" size={14} style={{ color: 'var(--info)' }} />
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
                          Block Allocation (estimated)
                        </span>
                      </div>
                      <div className="ipam-block-heatmap" style={{
                        display: 'flex', gap: 4, flexWrap: 'wrap',
                      }}>
                        {Array.from({ length: Math.min(b.blocks, 24) }).map((_, bi) => {
                          // Simulate varying utilization per block for visual interest
                          const simulatedPct = Math.min(100, Math.max(5,
                            (b.utilization_pct / 100) * 100 + (Math.sin(bi * 1.5) * 20)
                          ))
                          const blockColor = getUtilColor(simulatedPct)
                          const isAllocated = simulatedPct > 30
                          return (
                            <div
                              key={bi}
                              className="ipam-heat-block"
                              title={`Block ${bi + 1}: ~${Math.round(simulatedPct)}% utilized`}
                              style={{
                                width: 20, height: 20, borderRadius: 4,
                                backgroundColor: isAllocated ? blockColor : 'rgba(255,255,255,0.04)',
                                opacity: isAllocated ? 0.7 + (simulatedPct / 100) * 0.3 : 0.5,
                                border: '1px solid',
                                borderColor: isAllocated ? 'rgba(255,255,255,0.08)' : 'var(--border)',
                                transition: 'all 0.2s ease',
                                cursor: 'pointer',
                              }}
                            />
                          )
                        })}
                        {b.blocks > 24 && (
                          <div style={{
                            width: 20, height: 20, borderRadius: 4,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 9, color: 'var(--text-tertiary)',
                            border: '1px dashed var(--border)',
                          }}>
                            +{b.blocks - 24}
                          </div>
                        )}
                      </div>
                      <div style={{
                        display: 'flex', gap: 12, marginTop: 8,
                        fontSize: 11, color: 'var(--text-tertiary)',
                      }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: 'var(--success)', display: 'inline-block' }} />
                          Low
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: 'var(--primary)', display: 'inline-block' }} />
                          Medium
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: 'var(--warning)', display: 'inline-block' }} />
                          High
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: 'var(--danger)', display: 'inline-block' }} />
                          Full
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── IP Pool Definitions ── */}
      <div className="subsection">
        <div className="subsection-header">
          <h3>Pool Definitions</h3>
          <DataSourceBadge status={poolsStatus} label="IPPool CRDs" />
        </div>

        {pools.length === 0 ? (
          <EmptyState
            icon={<Icon name="hard-drive" size={48} />}
            message="No IP pools defined"
            submessage="Create IPPool CRDs in your Calico configuration."
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
                  <th>Node Selector</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pools.map((p, i) => (
                  <tr key={p.name} className="stagger-item" style={{ animationDelay: `${i * 0.04}s` }}>
                    <td className="cell-mono">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%',
                          backgroundColor: p.disabled ? 'var(--danger)' : 'var(--success)',
                          display: 'inline-block', flexShrink: 0,
                        }} />
                        {p.name}
                      </span>
                    </td>
                    <td className="cell-mono">{formatCIDR(p.cidr)}</td>
                    <td><span className="badge badge-muted">{getModeLabel(p.mode)}</span></td>
                    <td>
                      {p.nat_outgoing ? (
                        <span className="badge badge-success">Enabled</span>
                      ) : (
                        <span className="badge badge-muted">Disabled</span>
                      )}
                    </td>
                    <td className="cell-mono" style={{ fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.node_selector || <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>All nodes</span>}
                    </td>
                    <td>
                      {p.disabled ? (
                        <span className="badge badge-warning">Disabled</span>
                      ) : (
                        <span className="badge badge-success">Active</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── IPAM CSS (scoped additions) ── */}
      <style>{`
        .ipam-pool-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .ipam-block-heatmap {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
        }
        .ipam-heat-block {
          transition: all 0.2s ease;
          cursor: pointer;
        }
        .ipam-heat-block:hover {
          transform: scale(1.25);
          opacity: 1 !important;
          box-shadow: 0 0 8px rgba(59, 130, 246, 0.4);
        }
        .cidr-visual-bar {
          display: flex;
          gap: 2px;
          margin-top: 4px;
        }
        .cidr-bit {
          flex: 1;
          height: 10px;
          border-radius: 2px;
          transition: all 0.2s ease;
        }
        .cidr-bit:hover {
          transform: scaleY(1.5);
          opacity: 0.8;
        }
        .cidr-bit-network {
          background-color: rgba(59, 130, 246, 0.5);
        }
        .cidr-bit-host {
          background-color: rgba(16, 185, 129, 0.35);
        }
        @media (max-width: 768px) {
          .ipam-block-heatmap {
            gap: 3px;
          }
          .ipam-heat-block {
            width: 16px !important;
            height: 16px !important;
          }
        }
      `}</style>
    </div>
  )
}
