import { useState } from 'react'
import { Icon } from './Icon'
import { ThreatPanel } from './ThreatPanel'
import { SecurityPanel } from './SecurityPanel'

type SecuritySubview = 'threats' | 'audit'

const SECURITY_VIEWS: { id: SecuritySubview; label: string; icon: React.ReactNode }[] = [
  { id: 'threats', label: 'Threats', icon: <Icon name="alert-triangle" size={14} /> },
  { id: 'audit', label: 'Audit', icon: <Icon name="shield" size={14} /> },
]

export function SecuritySection() {
  const [activeView, setActiveView] = useState<SecuritySubview>('threats')

  return (
    <div className="section-security">
      {/* Sub-navigation */}
      <div className="network-subnav">
        {SECURITY_VIEWS.map(view => (
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
        {activeView === 'threats' && <ThreatPanel />}
        {activeView === 'audit' && <SecurityPanel />}
      </div>
    </div>
  )
}
