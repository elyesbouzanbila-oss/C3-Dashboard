import { useState, useEffect, useCallback, useMemo } from 'react'
import './App.css'
import { DashboardProvider, useDashboard } from './context/DashboardContext'
import { Icon } from './components/Icon'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DashboardPanel } from './components/DashboardPanel'
import { NetworkSection } from './components/NetworkSection'
import { SecuritySection } from './components/SecuritySection'
import { ToolsSection } from './components/ToolsSection'
import { ChatPanel } from './components/ChatPanel'

// ── Section definitions ───────────────────────────────────────
interface SectionDef {
  id: string
  label: string
  icon: React.ReactNode
}

const SECTIONS: SectionDef[] = [
  { id: 'overview', label: 'Overview', icon: <Icon name="layout-dashboard" /> },
  { id: 'network', label: 'Network', icon: <Icon name="network" /> },
  { id: 'security', label: 'Security', icon: <Icon name="shield" /> },
  { id: 'tools', label: 'Tools', icon: <Icon name="settings" /> },
]

function AppContent() {
  const {
    loading, error, setError,
    cniNodes, bgpPeers,
    activeTab,
    wsConnected,
    exportData, connectWebSocket, setActiveTab, silentRefresh, refreshView,
    cniNodesStatus, ipPoolsStatus, ipamStatus, policiesStatus,
    felixStatus, topologyStatus, rbacBindingsStatus, privilegedPodsStatus,
    threats,
  } = useDashboard()

  const [currentTime, setCurrentTime] = useState(new Date())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // ── Manual refresh of the current view ──
  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refreshView()
    } finally {
      setRefreshing(false)
    }
  }, [refreshView, refreshing])

  // ── DEMO DATA detection ──
  const mockSources = useMemo(() => {
    const sources: Array<[string, string]> = [
      ['CNI nodes', cniNodesStatus],
      ['IP pools', ipPoolsStatus],
      ['IPAM', ipamStatus],
      ['Policies', policiesStatus],
      ['Felix', felixStatus],
      ['Topology', topologyStatus],
      ['RBAC', rbacBindingsStatus],
      ['Privileged pods', privilegedPodsStatus],
    ]
    return sources.filter(([, status]) => status === 'mock').map(([label]) => label)
  }, [
    cniNodesStatus, ipPoolsStatus, ipamStatus, policiesStatus,
    felixStatus, topologyStatus, rbacBindingsStatus, privilegedPodsStatus,
  ])

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    silentRefresh()
    if (activeTab === 'threats') {
      connectWebSocket()
    }
  }, [activeTab])

  // Close mobile menu when section changes
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [activeTab])

  // Determine active section from active tab
  const activeSection = useMemo(() => {
    if (activeTab === 'dashboard') return 'overview'
    if (['cni-health', 'ipam', 'topology', 'policies'].includes(activeTab)) return 'network'
    if (['threats', 'security'].includes(activeTab)) return 'security'
    if (['diagnostics', 'config'].includes(activeTab)) return 'tools'
    return 'overview'
  }, [activeTab])

  const handleSectionClick = useCallback((sectionId: string) => {
    // Map section to default tab
    const defaults: Record<string, string> = {
      'overview': 'dashboard',
      'network': 'cni-health',
      'security': 'threats',
      'tools': 'diagnostics',
    }
    setActiveTab(defaults[sectionId] || 'dashboard')
  }, [setActiveTab])

  const handleSidebarKeyDown = useCallback((e: React.KeyboardEvent) => {
    const currentIdx = SECTIONS.findIndex(s => s.id === activeSection)
    let nextIdx: number | null = null

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        nextIdx = (currentIdx + 1) % SECTIONS.length
        break
      case 'ArrowUp':
        e.preventDefault()
        nextIdx = (currentIdx - 1 + SECTIONS.length) % SECTIONS.length
        break
      default:
        return
    }

    if (nextIdx !== null) {
      handleSectionClick(SECTIONS[nextIdx].id)
    }
  }, [activeSection, handleSectionClick])

  const threatCount = threats.length

  return (
    <div className="app-layout">
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="mobile-overlay"
          onClick={() => setMobileMenuOpen(false)}
          onKeyDown={e => { if (e.key === 'Escape') setMobileMenuOpen(false) }}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'mobile-open' : ''}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-header">
          <img src="/logo.png" alt="" className="sidebar-logo" aria-hidden="true" />
          {!sidebarCollapsed && (
            <div className="sidebar-brand">
              <h1>CNI Command Center</h1>
              <span className="sidebar-subtitle">Calico Diagnostics</span>
            </div>
          )}
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
          >
            <Icon name={sidebarCollapsed ? 'chevron-right' : 'chevron-down'} size={16} />
          </button>
        </div>

        <nav className="sidebar-nav" role="navigation" onKeyDown={handleSidebarKeyDown}>
          {SECTIONS.map(section => {
            const isActive = activeSection === section.id
            const hasAlert = section.id === 'security' && threatCount > 0
            return (
              <button
                key={section.id}
                className={`sidebar-item ${isActive ? 'active' : ''}`}
                onClick={() => handleSectionClick(section.id)}
                aria-current={isActive ? 'page' : undefined}
                title={sidebarCollapsed ? section.label : undefined}
              >
                <span className="sidebar-item-icon">{section.icon}</span>
                {!sidebarCollapsed && (
                  <>
                    <span className="sidebar-item-label">{section.label}</span>
                    {hasAlert && (
                      <span className="sidebar-item-badge">{threatCount}</span>
                    )}
                  </>
                )}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          {sidebarCollapsed ? (
            <button
              className="sidebar-expand-btn"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <Icon name="chevron-right" size={16} />
            </button>
          ) : (
            <>
              <div className={`sidebar-status ${wsConnected ? 'connected' : ''}`}>
                <span className="sidebar-status-dot" />
                <span>{wsConnected ? 'Live' : 'Offline'}</span>
              </div>
              <button className="sidebar-export-btn" onClick={exportData} title="Export data">
                <Icon name="download" size={14} />
                <span>Export</span>
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Main content area */}
      <div className="main-area">
        {/* Top bar */}
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
            >
              <Icon name="list" size={18} />
            </button>
            <span className="topbar-section">{SECTIONS.find(s => s.id === activeSection)?.label}</span>
          </div>
          <div className="topbar-right">
            {mockSources.length > 0 && (
              <div className="topbar-demo-badge" title={`Mock data: ${mockSources.join(', ')}`}>
                <Icon name="alert-triangle" size={12} />
                <span>DEMO</span>
              </div>
            )}
            <button
              className={`topbar-refresh-btn ${refreshing ? 'refreshing' : ''}`}
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refresh current view"
              title="Refresh current view"
            >
              <Icon name="refresh-cw" size={14} />
            </button>
            <span className="topbar-clock">{currentTime.toLocaleTimeString()}</span>
          </div>
        </header>

        {/* Error banner */}
        {error && (
          <div className="error-banner" role="alert">
            <div className="error-banner-content">
              <Icon name="x" size={16} className="error-icon" />
              <strong>Error:</strong> {error}
            </div>
            <button className="error-dismiss" onClick={() => setError(null)} aria-label="Dismiss error">
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        {/* Content */}
        <main className="content">
          {loading && (
            <div className="loading-overlay">
              <div className="spinner" />
              <span>Loading data...</span>
            </div>
          )}

          <ErrorBoundary>
            {activeSection === 'overview' && <DashboardPanel onNavigate={setActiveTab} />}
            {activeSection === 'network' && <NetworkSection />}
            {activeSection === 'security' && <SecuritySection />}
            {activeSection === 'tools' && <ToolsSection />}
          </ErrorBoundary>
        </main>
      </div>

      {/* Chat Panel */}
      <ChatPanel />
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
