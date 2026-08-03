import { useState, useEffect, useRef } from 'react'
import { Icon } from './Icon'
import { CniHealthPanel } from './CniHealthPanel'
import { IpamPanel } from './IpamPanel'
import { CniTopologyPanel } from './CniTopologyPanel'
import { PolicyInspectorPanel } from './PolicyInspectorPanel'
import { PolicyCoveragePanel } from './PolicyCoveragePanel'
import { WorkloadEndpointsPanel, type EndpointFilter } from './WorkloadEndpointsPanel'
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
  const [initialPolicyName, setInitialPolicyName] = useState('')
  const [endpointSearch, setEndpointSearch] = useState('')
  const [endpointFilter, setEndpointFilter] = useState<EndpointFilter>('all')
  const [endpointScrollTop, setEndpointScrollTop] = useState(0)
  // Where the Impact view was opened from — drives the back-link.
  const [impactOrigin, setImpactOrigin] = useState<'endpoints' | null>(null)

  // True when a tag jump is in flight — the endpoints panel gets remounted
  // on return, so we snapshot its view state before leaving and restore it
  // after the new mount renders.
  const pendingEndpointRestore = useRef(false)

  const contentEl = (): HTMLElement | null => document.querySelector('.content')

  // Departure from the Endpoints view: remember to restore scroll on return.
  // Snapshot happens synchronously in the click handler, before the shorter
  // destination view has a chance to clamp the container's scrollTop.
  const leaveEndpoints = () => {
    pendingEndpointRestore.current = true
    const el = contentEl()
    if (el) setEndpointScrollTop(el.scrollTop)
  }

  // Cross-navigation: Endpoints -> Impact (policy tag click). Snapshots the
  // endpoints view (filter/search/scroll) so the remounted panel can resume.
  const openImpact = (policyName: string) => {
    leaveEndpoints()
    setInitialPolicyName(policyName)
    setImpactOrigin('endpoints')
    setPolicyView('impact')
    setActiveView('policies')
  }

  // Cross-navigation: Impact -> Endpoints (pod chip click or back-link).
  // A pod-chip click carries an explicit search query; a back-link does not.
  const openEndpoint = (podQuery: string) => {
    pendingEndpointRestore.current = true
    if (podQuery) {
      setEndpointSearch(podQuery)
      setEndpointFilter('all')
    }
    setActiveView('endpoints')
  }

  const backToEndpoints = () => {
    pendingEndpointRestore.current = true
    setActiveView('endpoints')
  }

  // When the endpoints panel remounts after a jump, restore its scroll
  // position once the table has rendered. The restore is an approximation:
  // if the matrix is stale and refetching on remount, the table height may
  // still be settling, so the container can clamp the restored offset.
  useEffect(() => {
    if (activeView !== 'endpoints' || !pendingEndpointRestore.current) return
    const raf = requestAnimationFrame(() => {
      const el = contentEl()
      if (el && endpointScrollTop > 0) {
        const prevBehavior = el.style.scrollBehavior
        el.style.scrollBehavior = 'auto'
        el.scrollTop = endpointScrollTop
        el.style.scrollBehavior = prevBehavior
      }
    })
    return () => {
      cancelAnimationFrame(raf)
      // Consume the flag on cleanup too, so a cancelled rAF under rapid
      // view churn doesn't restore a stale offset later.
      pendingEndpointRestore.current = false
    }
  }, [activeView, endpointScrollTop])

  return (
    <div className="section-network">
      {/* Sub-navigation */}
      <div className="network-subnav">
        {NETWORK_VIEWS.map(view => (
          <button
            key={view.id}
            className={`network-subnav-item ${activeView === view.id ? 'active' : ''}`}
            onClick={() => {
              // Manual subnav navigation consumes any cross-nav origin.
              setImpactOrigin(null)
              // Leaving the Endpoints view via subnav also preserves scroll.
              if (activeView === 'endpoints' && view.id !== 'endpoints') {
                leaveEndpoints()
              }
              setActiveView(view.id)
            }}
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
        {activeView === 'endpoints' && (
          <WorkloadEndpointsPanel
            initialSearch={endpointSearch}
            initialFilter={endpointFilter}
            onFilterChange={setEndpointFilter}
            onSearchChange={setEndpointSearch}
            onOpenImpact={openImpact}
          />
        )}
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
                onClick={() => {
                  // Manual navigation via the toggle has no jump origin.
                  setImpactOrigin(null)
                  setPolicyView('impact')
                }}
              >
                <Icon name="eye" size={14} /> Impact
              </button>
            </div>
            {policyView === 'definitions' && <PolicyInspectorPanel />}
            {policyView === 'coverage' && <PolicyCoveragePanel />}
            {policyView === 'impact' && (
              <PolicyImpactPanel
                initialPolicyName={initialPolicyName}
                onOpenEndpoint={openEndpoint}
                onBack={impactOrigin === 'endpoints' ? backToEndpoints : undefined}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
