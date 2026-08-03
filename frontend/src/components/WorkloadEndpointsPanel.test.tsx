import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkloadEndpointsPanel } from './WorkloadEndpointsPanel'
import { useDashboard } from '../context/DashboardContext'
import type { PolicyMatrixData } from '../types'

vi.mock('../context/DashboardContext', () => ({
  useDashboard: vi.fn(),
  useTabSubscription: vi.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asPartial = (v: any) => v as any

const SAMPLE_MATRIX: PolicyMatrixData = {
  workload_endpoints: [
    {
      namespace: 'production',
      pod_name: 'api-server-1',
      labels: { app: 'api-server' },
      node_name: 'worker-1',
      pod_ip: '10.244.1.10',
      phase: 'Running',
      interface_status: 'up',
      selecting_policies: [{ name: 'allow-api-egress', type: 'NetworkPolicy' }],
      exposed: false,
      ingress: { allow: 1, deny: 0, log: 0, pass: 0, ports: ['8080/TCP'] },
      egress: { allow: 1, deny: 0, log: 0, pass: 0, ports: ['5432/TCP'] },
    },
    {
      namespace: 'production',
      pod_name: 'unpatched-sidecar',
      labels: { app: 'legacy' },
      node_name: 'worker-1',
      pod_ip: '10.244.1.31',
      phase: 'Running',
      interface_status: 'up',
      selecting_policies: [],
      exposed: true,
      ingress: { allow: 0, deny: 0, log: 0, pass: 0, ports: [] },
      egress: { allow: 0, deny: 0, log: 0, pass: 0, ports: [] },
    },
    {
      namespace: 'default',
      pod_name: 'pending-pod',
      labels: { app: 'sandbox' },
      node_name: null,
      pod_ip: null,
      phase: 'Pending',
      interface_status: 'down',
      selecting_policies: [],
      exposed: true,
      ingress: { allow: 0, deny: 0, log: 0, pass: 0, ports: [] },
      egress: { allow: 0, deny: 0, log: 0, pass: 0, ports: [] },
    },
  ],
  policy_impacts: [],
}

describe('WorkloadEndpointsPanel', () => {
  beforeEach(() => {
    vi.mocked(useDashboard).mockReturnValue(asPartial({ policyMatrix: SAMPLE_MATRIX, policyMatrixStatus: 'mock' as const }))
  })

  it('renders total endpoint count in summary cards', () => {
    render(<WorkloadEndpointsPanel />)
    expect(screen.getByText('Total Endpoints')).toBeInTheDocument()
    const totalValues = screen.getAllByText('3').filter(el => el.closest('.coverage-summary-value'))
    expect(totalValues.length).toBeGreaterThanOrEqual(1)
  })

  it('renders covered and exposed counts', () => {
    render(<WorkloadEndpointsPanel />)
    const coveredValues = screen.getAllByText('1').filter(el => el.classList.contains('coverage-summary-value'))
    expect(coveredValues.length).toBeGreaterThanOrEqual(1)
  })

  it('renders empty state when no matrix data', () => {
    vi.mocked(useDashboard).mockReturnValue(asPartial({ policyMatrix: null, policyMatrixStatus: 'unknown' as const }))
    render(<WorkloadEndpointsPanel />)
    expect(screen.getByText('No endpoint data available')).toBeInTheDocument()
  })

  it('shows EXPOSED and COVERED badges', () => {
    render(<WorkloadEndpointsPanel />)
    expect(screen.getAllByText('EXPOSED')).toHaveLength(2)
    expect(screen.getAllByText('COVERED')).toHaveLength(1)
  })

  it('shows interface status UP and DOWN', () => {
    render(<WorkloadEndpointsPanel />)
    expect(screen.getAllByText('UP').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('DOWN')).toBeInTheDocument()
  })

  it('shows selecting policy tags for covered pods', () => {
    render(<WorkloadEndpointsPanel />)
    expect(screen.getByText('allow-api-egress')).toBeInTheDocument()
  })

  it('shows rule digest chips (allow counts)', () => {
    render(<WorkloadEndpointsPanel />)
    const allowChips = screen.getAllByText('1 allow')
    expect(allowChips).toHaveLength(2) // ingress + egress for api-server-1
  })

  it('filters to exposed pods only when chip clicked', () => {
    render(<WorkloadEndpointsPanel />)
    fireEvent.click(screen.getByText('Exposed Only'))
    expect(screen.getByText('unpatched-sidecar')).toBeInTheDocument()
    expect(screen.getByText('pending-pod')).toBeInTheDocument()
    expect(screen.queryByText('api-server-1')).not.toBeInTheDocument()
  })

  it('filters to covered pods only when chip clicked', () => {
    render(<WorkloadEndpointsPanel />)
    fireEvent.click(screen.getByText('Covered Only'))
    expect(screen.getByText('api-server-1')).toBeInTheDocument()
    expect(screen.queryByText('unpatched-sidecar')).not.toBeInTheDocument()
  })

  it('searches by pod name', () => {
    render(<WorkloadEndpointsPanel />)
    const searchInput = screen.getByPlaceholderText(/search endpoints/i)
    fireEvent.change(searchInput, { target: { value: 'api-server' } })
    expect(screen.getByText('api-server-1')).toBeInTheDocument()
    expect(screen.queryByText('unpatched-sidecar')).not.toBeInTheDocument()
  })

  it('shows no matching endpoints empty state on no results', () => {
    render(<WorkloadEndpointsPanel />)
    const searchInput = screen.getByPlaceholderText(/search endpoints/i)
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } })
    expect(screen.getByText(/no matching endpoints/i)).toBeInTheDocument()
  })

  it('shows node and IP sub-line for covered pod', () => {
    render(<WorkloadEndpointsPanel />)
    // worker-1 hosts two pods in the fixture, so it appears twice
    expect(screen.getAllByText('worker-1').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('10.244.1.10')).toBeInTheDocument()
  })
})
