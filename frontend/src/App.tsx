import { useState, useEffect, useCallback, useMemo } from 'react'
import './App.css'
import { DashboardProvider, useDashboard } from './context/DashboardContext'
import { Icon } from './components/Icon'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DashboardPanel } from './components/DashboardPanel'
import { CniHealthPanel } from './components/CniHealthPanel'
import { IpamPanel } from './components/IpamPanel'
import { PolicyInspectorPanel } from './components/PolicyInspectorPanel'
import { PolicyCoveragePanel } from './components/PolicyCoveragePanel'
import { CniTopologyPanel } from './components/CniTopologyPanel'
import { DiagnosticsPanel } from './components/DiagnosticsPanel'
import { ThreatPanel } from './components/ThreatPanel'
import { SecurityPanel } from './components/SecurityPanel'

interface TabDef {
  id: string
  label: string
  icon: React.ReactNode
}

const TABS: TabDef[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <Icon name="layout-dashboard" /> },
  { id: 'cni-health', label: 'CNI Health', icon: <Icon name="activity" /> },
  { id: 'ipam', label: 'IPAM', icon: <Icon name="bar-chart" /> },
  { id: 'policies', label: 'Policies', icon: <Icon name="shield" /> },
  { id: 'topology', label: 'Topology', icon: <Icon name="network" /> },
  { id: 'diagnostics', label: 'Diagnostics', icon: <Icon name="play" /> },
  { id: 'threats', label: 'Threats', icon: <Icon name="alert-triangle" /> },
  { id: 'security', label: 'Security', icon: <Icon name="shield" /> },
]

function AppContent() {
  const {
    loading, error, setError,
    cniNodes, bgpPeers,
    activeTab,
    wsConnected,
    exportData, connectWebSocket, setActiveTab, silentRefresh,
  } = useDashboard()

  const [currentTime, setCurrentTime] = useState(new Date())
  const [policyCoverageView, setPolicyCoverageView] = useState<'definitions' | 'coverage'>('definitions')

  // Live footer clock
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  // ── Silent refresh + WebSocket on tab switch ──
  useEffect(() => {
    silentRefresh()

    if (activeTab === 'threats') {
      connectWebSocket()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  // ── Keyboard navigation for tabs ──
  const tabIndexMap = useMemo(() => Object.fromEntries(TABS.map((t, i) => [t.id, i])), [])

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent) => {
    const currentIdx = tabIndexMap[activeTab]
    let nextIdx: number | null = null

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        nextIdx = (currentIdx + 1) % TABS.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        nextIdx = (currentIdx - 1 + TABS.length) % TABS.length
        break
      case 'Home':
        e.preventDefault()
        nextIdx = 0
        break
      case 'End':
        e.preventDefault()
        nextIdx = TABS.length - 1
        break
      default:
        return
    }

    if (nextIdx !== null) {
      const nextTab = TABS[nextIdx]
      setActiveTab(nextTab.id)
      setTimeout(() => {
        document.getElementById(`tab-${nextTab.id}`)?.focus()
      }, 0)
    }
  }, [activeTab, tabIndexMap, setActiveTab])

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>CNI Command Center</h1>
          <span className="header-subtitle">Calico Network Diagnostics</span>
        </div>
        <div className="header-right">
          <div className={`status ${wsConnected ? 'status-ok' : 'status-warn'}`}>
            <span className={`indicator ${wsConnected ? 'connected' : 'disconnected'}`} role="img" aria-label={wsConnected ? 'Connected' : 'Disconnected'} />
            <span>{wsConnected ? 'Threats Live' : 'Disconnected'}</span>
          </div>
          <button className="refresh-btn" onClick={exportData} title="Export all data as JSON" aria-label="Export data">
            <Icon name="download" size={16} />
            <span>Export</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <div className="error-banner-content">
            <Icon name="x" size={20} className="error-icon" aria-hidden="true" style={{ strokeWidth: 2 }} />
            <strong>Error:</strong> {error}
          </div>
          <button className="error-dismiss" onClick={() => setError(null)} aria-label="Dismiss error">
            <Icon name="x" size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <nav className="tabs" role="tablist" aria-label="CNI Command Center tabs" onKeyDown={handleTabKeyDown}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
          >
            <span className="tab-icon" aria-hidden="true">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </nav>

      <main className="content">
        {loading && (
          <div className="loading-overlay">
            <div className="spinner" />
            <span>Loading data...</span>
          </div>
        )}

        <ErrorBoundary>
          {TABS.map(tab => (
            <div
              key={tab.id}
              id={`tabpanel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`tab-${tab.id}`}
              className="tab-content"
              hidden={activeTab !== tab.id}
            >
              {tab.id === 'dashboard' && (
                <DashboardPanel onNavigate={setActiveTab} />
              )}
              {tab.id === 'cni-health' && <CniHealthPanel />}
              {tab.id === 'ipam' && <IpamPanel />}
              {tab.id === 'policies' && (
                <>
                  <div className="coverage-view-toggle" style={{ marginBottom: '20px' }}>
                    <button
                      className={`coverage-view-btn ${policyCoverageView === 'definitions' ? 'active' : ''}`}
                      onClick={() => setPolicyCoverageView('definitions')}
                    >
                      <Icon name="list" size={16} /> Definitions
                    </button>
                    <button
                      className={`coverage-view-btn ${policyCoverageView === 'coverage' ? 'active' : ''}`}
                      onClick={() => setPolicyCoverageView('coverage')}
                    >
                      <Icon name="shield" size={16} /> Coverage
                    </button>
                  </div>
                  {policyCoverageView === 'definitions' ? <PolicyInspectorPanel /> : <PolicyCoveragePanel />}
                </>
              )}
              {tab.id === 'topology' && <CniTopologyPanel />}
              {tab.id === 'diagnostics' && <DiagnosticsPanel />}
              {tab.id === 'threats' && <ThreatPanel />}
              {tab.id === 'security' && <SecurityPanel />}
            </div>
          ))}
        </ErrorBoundary>
      </main>

      <footer className="footer">
        <span>CNI Command Center</span>
        <span className="footer-sep">·</span>
        <span>{cniNodes.length} agents · {bgpPeers.length} BGP peers</span>
        <span className="footer-sep">·</span>
        <span>{currentTime.toLocaleTimeString()}</span>
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <DashboardProvider>
      <AppContent />
    </DashboardProvider>
  )
}
