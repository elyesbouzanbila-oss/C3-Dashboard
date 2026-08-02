import { useState } from 'react'
import { Icon } from './Icon'
import { DiagnosticsPanel } from './DiagnosticsPanel'
import { ClusterConfigPanel } from './ClusterConfigPanel'

type ToolsSubview = 'diagnostics' | 'configure'

const TOOLS_VIEWS: { id: ToolsSubview; label: string; icon: React.ReactNode }[] = [
  { id: 'diagnostics', label: 'Diagnostics', icon: <Icon name="play" size={14} /> },
  { id: 'configure', label: 'Configure', icon: <Icon name="settings" size={14} /> },
]

export function ToolsSection() {
  const [activeView, setActiveView] = useState<ToolsSubview>('diagnostics')

  return (
    <div className="section-tools">
      {/* Sub-navigation */}
      <div className="network-subnav">
        {TOOLS_VIEWS.map(view => (
          <button
            key={view.id}
            className={`network-subnav-item ${activeView === view.id ? 'active' : ''}`}
            onClick={() => setActiveView(view.id)}
          >
            <span className="network-subnav-icon">{view.icon}</span>
            <span className="network-subnav-label">{view.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="network-content">
        {activeView === 'diagnostics' && <DiagnosticsPanel />}
        {activeView === 'configure' && <ClusterConfigPanel />}
      </div>
    </div>
  )
}
