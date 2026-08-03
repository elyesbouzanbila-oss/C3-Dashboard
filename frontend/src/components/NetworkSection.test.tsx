import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { NetworkSection } from './NetworkSection'

// Mock child panels so the test only exercises NetworkSection's own
// navigation state — cross-nav behavior of the panels themselves is
// covered by their own test files.
vi.mock('./CniHealthPanel', () => ({
  CniHealthPanel: () => <div data-testid="view-cni-health">cni health</div>,
}))
vi.mock('./IpamPanel', () => ({
  IpamPanel: () => <div data-testid="view-ipam">ipam</div>,
}))
vi.mock('./CniTopologyPanel', () => ({
  CniTopologyPanel: () => <div data-testid="view-topology">topology</div>,
}))
vi.mock('./PolicyInspectorPanel', () => ({
  PolicyInspectorPanel: () => <div data-testid="view-definitions">definitions</div>,
}))
vi.mock('./PolicyCoveragePanel', () => ({
  PolicyCoveragePanel: () => <div data-testid="view-coverage">coverage</div>,
}))
vi.mock('./WorkloadEndpointsPanel', () => ({
  WorkloadEndpointsPanel: ({
    initialSearch,
    initialFilter,
    onFilterChange,
    onSearchChange,
    onOpenImpact,
  }: {
    initialSearch?: string
    initialFilter?: string
    onFilterChange?: (f: string) => void
    onSearchChange?: (q: string) => void
    onOpenImpact?: (name: string) => void
  }) => (
    <div data-testid="view-endpoints">
      <span data-testid="endpoint-search">{initialSearch || ''}</span>
      <span data-testid="endpoint-filter">{initialFilter || 'all'}</span>
      <button onClick={() => onFilterChange?.('exposed')}>set-filter-exposed</button>
      <button onClick={() => onSearchChange?.('api-server')}>set-search-api-server</button>
      <button onClick={() => onOpenImpact?.('allow-api-egress')}>tag:allow-api-egress</button>
    </div>
  ),
}))
vi.mock('./PolicyImpactPanel', () => ({
  PolicyImpactPanel: ({
    initialPolicyName,
    onOpenEndpoint,
    onBack,
  }: {
    initialPolicyName?: string
    onOpenEndpoint?: (query: string) => void
    onBack?: () => void
  }) => (
    <div data-testid="view-impact">
      <span data-testid="impact-policy">{initialPolicyName || ''}</span>
      {onBack && <button onClick={onBack}>back-to-endpoints</button>}
      <button onClick={() => onOpenEndpoint?.('production/api-server-1')}>chip:production/api-server-1</button>
    </div>
  ),
}))

describe('NetworkSection cross-navigation', () => {
  it('renders the default CNI Health view', () => {
    render(<NetworkSection />)
    expect(screen.getByTestId('view-cni-health')).toBeInTheDocument()
  })

  it('switches to Endpoints view via subnav', () => {
    render(<NetworkSection />)
    fireEvent.click(screen.getByText('Endpoints'))
    expect(screen.getByTestId('view-endpoints')).toBeInTheDocument()
  })

  it('clicking a policy tag jumps to the Impact view with that policy preselected', () => {
    render(<NetworkSection />)
    fireEvent.click(screen.getByText('Endpoints'))
    fireEvent.click(screen.getByText('tag:allow-api-egress'))
    expect(screen.getByTestId('view-impact')).toBeInTheDocument()
    expect(screen.getByTestId('impact-policy').textContent).toBe('allow-api-egress')
  })

  it('clicking a pod chip jumps back to Endpoints with the search pre-filled', () => {
    render(<NetworkSection />)
    // Endpoints -> Impact via policy tag
    fireEvent.click(screen.getByText('Endpoints'))
    fireEvent.click(screen.getByText('tag:allow-api-egress'))
    // Impact -> Endpoints via pod chip
    fireEvent.click(screen.getByText('chip:production/api-server-1'))
    expect(screen.getByTestId('view-endpoints')).toBeInTheDocument()
    expect(screen.getByTestId('endpoint-search').textContent).toBe('production/api-server-1')
  })

  it('Impact sub-view is reachable through the Policies toggle too', () => {
    render(<NetworkSection />)
    fireEvent.click(screen.getByText('Policies'))
    fireEvent.click(screen.getByText('Impact'))
    expect(screen.getByTestId('view-impact')).toBeInTheDocument()
  })

  it('shows the back-link after a policy-tag jump and returns to Endpoints', () => {
    render(<NetworkSection />)
    fireEvent.click(screen.getByText('Endpoints'))
    fireEvent.click(screen.getByText('tag:allow-api-egress'))
    // Back-link is present when the Impact view was opened from Endpoints
    const backBtn = screen.getByText('back-to-endpoints')
    expect(backBtn).toBeInTheDocument()
    fireEvent.click(backBtn)
    expect(screen.getByTestId('view-endpoints')).toBeInTheDocument()
  })

  it('hides the back-link when Impact is opened via the toggle', () => {
    render(<NetworkSection />)
    fireEvent.click(screen.getByText('Policies'))
    fireEvent.click(screen.getByText('Impact'))
    expect(screen.queryByText('back-to-endpoints')).not.toBeInTheDocument()
  })

  it('hides the back-link after a subnav round-trip consumes the jump origin', () => {
    render(<NetworkSection />)
    // Tag jump: Endpoints -> Impact
    fireEvent.click(screen.getByText('Endpoints'))
    fireEvent.click(screen.getByText('tag:allow-api-egress'))
    expect(screen.getByText('back-to-endpoints')).toBeInTheDocument()
    // Leave via subnav and return: the origin is consumed
    fireEvent.click(screen.getByText('Endpoints'))
    fireEvent.click(screen.getByText('Policies'))
    expect(screen.queryByText('back-to-endpoints')).not.toBeInTheDocument()
  })

  it('restores the endpoint filter and search when returning via back-link', () => {
    render(<NetworkSection />)
    // Endpoints: set a filter + search that NetworkSection should remember
    fireEvent.click(screen.getByText('Endpoints'))
    fireEvent.click(screen.getByText('set-filter-exposed'))
    fireEvent.click(screen.getByText('set-search-api-server'))
    // Jump to Impact and come back
    fireEvent.click(screen.getByText('tag:allow-api-egress'))
    fireEvent.click(screen.getByText('back-to-endpoints'))
    // The remounted panel receives the preserved state
    expect(screen.getByTestId('endpoint-filter').textContent).toBe('exposed')
    expect(screen.getByTestId('endpoint-search').textContent).toBe('api-server')
  })

  it('pod-chip jump resets the filter and applies the pod query', () => {
    render(<NetworkSection />)
    fireEvent.click(screen.getByText('Endpoints'))
    fireEvent.click(screen.getByText('set-filter-exposed'))
    fireEvent.click(screen.getByText('tag:allow-api-egress'))
    // Pod chip carries an explicit query — filter resets, search is set
    fireEvent.click(screen.getByText('chip:production/api-server-1'))
    expect(screen.getByTestId('endpoint-filter').textContent).toBe('all')
    expect(screen.getByTestId('endpoint-search').textContent).toBe('production/api-server-1')
  })

  it('restores the endpoints scroll position after a tag jump and back', () => {
    // App normally provides the .content scroll container; simulate it here.
    const { container } = render(
      <div className="content">
        <NetworkSection />
      </div>
    )
    const content = container.querySelector<HTMLElement>('.content')
    expect(content).not.toBeNull()

    // Fire rAF synchronously so the restore effect is deterministic.
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation(cb => {
        cb(0)
        return 1
      })

    try {
      fireEvent.click(screen.getByText('Endpoints'))
      // Simulate a deep scroll on the endpoints table
      content!.scrollTop = 400

      fireEvent.click(screen.getByText('tag:allow-api-egress'))
      // The destination view would clamp scrollTop; restore should put it back
      fireEvent.click(screen.getByText('back-to-endpoints'))

      expect(content!.scrollTop).toBe(400)
    } finally {
      rafSpy.mockRestore()
    }
  })
})
