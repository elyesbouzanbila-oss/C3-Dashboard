import { useState } from 'react'
import { Icon } from './Icon'
import { CniHealthPanel } from './CniHealthPanel'
import { IpamPanel } from './IpamPanel'
import { CniTopologyPanel } from './CniTopologyPanel'
import { PolicyInspectorPanel } from './PolicyInspectorPanel'
import { PolicyCoveragePanel } from './PolicyCoveragePanel'
import { WorkloadEndpointsPanel } from './WorkloadEndpointsPanel'
import { PolicyImpactPanel } from './PolicyImpactPanel'

type NetworkSubview = 'cni-health' | 'ipam' | 'topology' | 'policies' | 'endpoints'

const NETWORK_VIEWS: { id: NetworkSubview; label: string; icon: React.ReactNode }[] = [
  { id: 'cni-health', label: 'CNI Health', icon: <Icon name="activity" size={14} /> },
  { id: 'ipam', label: 'IPAM', icon: <Icon name="hard-drive" size={14} /> },
  { id: 'topology', label: 'Topology', icon: <Icon name="network" size={14} /> },
  { id: 'endpoints', label: 'Endpoints', icon: <Icon name="pod" size={14} /> },
  { id: 'policies', label: 'Policies', icon: <Icon name="shield" size={14} /> },
]

export function NetworkSection() {
  const [activeView, setActiveView] = useState<NetworkSubview>('cni-health')
  const [policyView, setPolicyView] = useState<'definitions' | 'coverage' | 'impact'>('definitions')

  return (
    <div className="section-network">
      {/* Sub-navigation */}
      <div className="network-subnav">
        {NETWORK_VIEWS.map(view => (
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
        {activeView === 'cni-health' && <CniHealthPanel />}
        {activeView === 'ipam' && <IpamPanel />}
        {activeView === 'topology' && <CniTopologyPanel />}
        {activeView === 'endpoints' && <WorkloadEndpointsPanel />}
        {activeView === 'policies' && (
          <>
            <div className="coverage-view-toggle">
              <button
                className={`coverage-view-btn ${policyView === 'definitions' ? 'active' : ''}`}
                onClick={() => setPolicyView('definitions')}
              >
                <Icon name="list" size={14} /> Definitions
              </button>
              <button
                className={`coverage-view-btn ${policyView === 'coverage' ? 'active' : ''}`}
                onClick={() => setPolicyView('coverage')}
              >
                <Icon name="shield" size={14} /> Coverage
              </button>
              <button
                className={`coverage-view-btn ${policyView === 'impact' ? 'active' : ''}`}
                onClick={() => setPolicyView('impact')}
              >
                <Icon name="eye" size={14} /> Impact
              </button>
            </div>
            {policyView === 'definitions' && <PolicyInspectorPanel />}
            {policyView === 'coverage' && <PolicyCoveragePanel />}
            {policyView === 'impact' && <PolicyImpactPanel />}
          </>
        )}
      </div>
    </div>
  )
}
