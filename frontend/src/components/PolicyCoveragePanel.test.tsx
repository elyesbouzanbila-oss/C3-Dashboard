import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PolicyCoveragePanel } from './PolicyCoveragePanel'
import { useDashboard } from '../context/DashboardContext'
import type { PodCoverageItem } from '../types'

vi.mock('../context/DashboardContext', () => ({
  useDashboard: vi.fn(),
  useTabSubscription: vi.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asPartial = (v: any) => v as any

const COVERED_POD: PodCoverageItem = {
  pod_name: 'nginx-1',
  namespace: 'default',
  labels: { app: 'nginx' },
  selecting_policies: ['allow-nginx', 'default-deny'],
  exposed: false,
}

const EXPOSED_POD: PodCoverageItem = {
  pod_name: 'redis-1',
  namespace: 'default',
  labels: { app: 'redis' },
  selecting_policies: [],
  exposed: true,
}

const SAMPLE_COVERAGE: PodCoverageItem[] = [
  COVERED_POD,
  EXPOSED_POD,
  {
    pod_name: 'prometheus-0',
    namespace: 'monitoring',
    labels: { app: 'prometheus' },
    selecting_policies: ['allow-monitoring-scrape'],
    exposed: false,
  },
]

describe('PolicyCoveragePanel', () => {
  beforeEach(() => {
    vi.mocked(useDashboard).mockReturnValue(asPartial({ policyCoverage: SAMPLE_COVERAGE, policiesStatus: 'mock' as const }))
  })

  it('renders total pod count in summary cards', () => {
    render(<PolicyCoveragePanel />)
    expect(screen.getByText('Total Pods')).toBeInTheDocument()
    // Total should be 3 (use getAllByText since the number may appear elsewhere)
    const totalValues = screen.getAllByText('3').filter(
      el => el.closest('.coverage-summary-value')
    )
    expect(totalValues.length).toBeGreaterThanOrEqual(1)
  })

  it('renders covered and exposed counts', () => {
    render(<PolicyCoveragePanel />)
    // Use getAllByText and filter to summary-value elements
    const coveredValues = screen.getAllByText('2').filter(
      el => el.classList.contains('coverage-summary-value')
    )
    expect(coveredValues.length).toBeGreaterThanOrEqual(1)
    const exposedValues = screen.getAllByText('1').filter(
      el => el.classList.contains('coverage-summary-value')
    )
    expect(exposedValues.length).toBeGreaterThanOrEqual(1)
  })

  it('renders empty state when no coverage data', () => {
    vi.mocked(useDashboard).mockReturnValue(asPartial({ policyCoverage: [], policiesStatus: 'mock' as const }))
    render(<PolicyCoveragePanel />)
    expect(screen.getByText('No pod data available')).toBeInTheDocument()
  })

  it('shows EXPOSED badge for exposed pods', () => {
    render(<PolicyCoveragePanel />)
    const exposedBadges = screen.getAllByText('EXPOSED')
    expect(exposedBadges).toHaveLength(1)
  })

  it('shows COVERED badge for covered pods', () => {
    render(<PolicyCoveragePanel />)
    const coveredBadges = screen.getAllByText('COVERED')
    expect(coveredBadges).toHaveLength(2)
  })

  it('renders namespace summary cards', () => {
    render(<PolicyCoveragePanel />)
    // Namespace names appear in the coverage-ns-name elements (uppercase via CSS text-transform)
    // Use getAllByText to confirm at least one match for 'default' and 'monitoring'
    expect(screen.getAllByText('default').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('monitoring').length).toBeGreaterThanOrEqual(1)
  })

  it('filters to show exposed pods only when chip clicked', () => {
    render(<PolicyCoveragePanel />)
    fireEvent.click(screen.getByText('Exposed Only'))
    // Should only show the exposed pod (redis-1)
    expect(screen.getByText('redis-1')).toBeInTheDocument()
    expect(screen.queryByText('nginx-1')).not.toBeInTheDocument()
    expect(screen.queryByText('prometheus-0')).not.toBeInTheDocument()
  })

  it('filters to show covered pods only when chip clicked', () => {
    render(<PolicyCoveragePanel />)
    fireEvent.click(screen.getByText('Covered Only'))
    expect(screen.queryByText('redis-1')).not.toBeInTheDocument()
  })

  it('searches by pod name', () => {
    render(<PolicyCoveragePanel />)
    const searchInput = screen.getByPlaceholderText(/search pods/i)
    fireEvent.change(searchInput, { target: { value: 'nginx' } })
    expect(screen.getByText('nginx-1')).toBeInTheDocument()
    expect(screen.queryByText('redis-1')).not.toBeInTheDocument()
  })

  it('searches by namespace', () => {
    render(<PolicyCoveragePanel />)
    const searchInput = screen.getByPlaceholderText(/search pods/i)
    fireEvent.change(searchInput, { target: { value: 'monitoring' } })
    expect(screen.getByText('prometheus-0')).toBeInTheDocument()
    expect(screen.queryByText('nginx-1')).not.toBeInTheDocument()
  })

  it('shows no matching pods empty state when search returns no results', () => {
    render(<PolicyCoveragePanel />)
    const searchInput = screen.getByPlaceholderText(/search pods/i)
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } })
    expect(screen.getByText(/no matching pods/i)).toBeInTheDocument()
  })

  it('shows filter results meta when filter is active', () => {
    render(<PolicyCoveragePanel />)
    fireEvent.click(screen.getByText('Exposed Only'))
    expect(screen.getByText(/Found 1 pod/i)).toBeInTheDocument()
  })

  it('resets to all pods when clicking "All" after filtering', () => {
    render(<PolicyCoveragePanel />)
    fireEvent.click(screen.getByText('Exposed Only'))
    fireEvent.click(screen.getByText('All'))
    // All three pods should be visible again
    expect(screen.getByText('nginx-1')).toBeInTheDocument()
    expect(screen.getByText('redis-1')).toBeInTheDocument()
    expect(screen.getByText('prometheus-0')).toBeInTheDocument()
  })

  it('shows selecting_policies tag for covered pods', () => {
    render(<PolicyCoveragePanel />)
    expect(screen.getByText('allow-nginx')).toBeInTheDocument()
    expect(screen.getByText('allow-monitoring-scrape')).toBeInTheDocument()
  })

  it('shows labels in the table', () => {
    render(<PolicyCoveragePanel />)
    expect(screen.getByText('app=nginx')).toBeInTheDocument()
    expect(screen.getByText('app=redis')).toBeInTheDocument()
  })

  it('shows coverage percentage in namespace cards', () => {
    render(<PolicyCoveragePanel />)
    // default: 2 pods, 1 exposed → 50% covered
    // monitoring: 1 pod, 0 exposed → 100% covered
    expect(screen.getByText('50% covered')).toBeInTheDocument()
    expect(screen.getByText('100% covered')).toBeInTheDocument()
  })
})
