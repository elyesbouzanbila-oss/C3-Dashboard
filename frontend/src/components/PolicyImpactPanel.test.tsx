import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PolicyImpactPanel } from './PolicyImpactPanel'
import { useDashboard } from '../context/DashboardContext'
import type { PolicyMatrixData } from '../types'

vi.mock('../context/DashboardContext', () => ({
  useDashboard: vi.fn(),
  useTabSubscription: vi.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asPartial = (v: any) => v as any

const SAMPLE_MATRIX: PolicyMatrixData = {
  workload_endpoints: [],
  policy_impacts: [
    {
      name: 'allow-api-egress',
      namespace: 'production',
      type: 'NetworkPolicy',
      selector: "app == 'api-server'",
      selected_pods: [{ namespace: 'production', pod_name: 'api-server-1' }],
      selected_count: 1,
      actions: ['Allow'],
      rules: [
        {
          index: 0,
          direction: 'Ingress',
          action: 'Allow',
          protocol: 'TCP',
          ports: ['8080/TCP'],
          source_selector: "app == 'frontend'",
          destination_selector: null,
          matched_pods: [{ namespace: 'production', pod_name: 'frontend-1' }],
          matched_count: 1,
        },
        {
          index: 0,
          direction: 'Egress',
          action: 'Allow',
          protocol: 'TCP',
          ports: ['5432/TCP'],
          source_selector: null,
          destination_selector: "app == 'database'",
          matched_pods: [{ namespace: 'production', pod_name: 'db-1' }],
          matched_count: 1,
        },
      ],
    },
    {
      name: 'default-deny',
      namespace: null,
      type: 'GlobalNetworkPolicy',
      selector: 'all()',
      selected_pods: [
        { namespace: 'production', pod_name: 'api-server-1' },
        { namespace: 'production', pod_name: 'db-1' },
      ],
      selected_count: 2,
      actions: ['Deny'],
      rules: [
        {
          index: 0,
          direction: 'Ingress',
          action: 'Deny',
          protocol: null,
          ports: [],
          source_selector: null,
          destination_selector: null,
          matched_pods: [],
          matched_count: 0,
        },
      ],
    },
  ],
}

describe('PolicyImpactPanel', () => {
  beforeEach(() => {
    vi.mocked(useDashboard).mockReturnValue(asPartial({ policyMatrix: SAMPLE_MATRIX, policyMatrixStatus: 'mock' as const }))
  })

  it('renders summary cards with policy count', () => {
    render(<PolicyImpactPanel />)
    expect(screen.getByText('Policies')).toBeInTheDocument()
    const policyValues = screen.getAllByText('2').filter(el => el.closest('.coverage-summary-value'))
    expect(policyValues.length).toBeGreaterThanOrEqual(1)
  })

  it('auto-selects the first policy and shows its details', () => {
    render(<PolicyImpactPanel />)
    expect(screen.getByText('allow-api-egress')).toBeInTheDocument()
    expect(screen.getByText(/1 pod selected/i)).toBeInTheDocument()
    // Pod chips render as namespace/pod_name
    expect(screen.getByText('production/api-server-1')).toBeInTheDocument()
  })

  it('renders empty state when no impact data', () => {
    vi.mocked(useDashboard).mockReturnValue(asPartial({ policyMatrix: null, policyMatrixStatus: 'unknown' as const }))
    render(<PolicyImpactPanel />)
    expect(screen.getByText('No policy impact data available')).toBeInTheDocument()
  })

  it('allows switching policies via the select', () => {
    render(<PolicyImpactPanel />)
    const select = screen.getByRole('combobox', { name: /select policy/i })
    fireEvent.change(select, { target: { value: 'default-deny' } })
    // The policy name appears in both the select option and the header
    expect(screen.getAllByText('default-deny').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/2 pods selected/i)).toBeInTheDocument()
  })

  it('shows rule table with direction, action, ports and matched pods', () => {
    render(<PolicyImpactPanel />)
    expect(screen.getByText('8080/TCP')).toBeInTheDocument()
    expect(screen.getByText('5432/TCP')).toBeInTheDocument()
    // Matched peer pods are shown as chips
    expect(screen.getByText('frontend-1')).toBeInTheDocument()
    expect(screen.getByText('db-1')).toBeInTheDocument()
  })

  it('shows Deny action badge for deny rules', () => {
    render(<PolicyImpactPanel />)
    const select = screen.getByRole('combobox', { name: /select policy/i })
    fireEvent.change(select, { target: { value: 'default-deny' } })
    const denyBadges = screen.getAllByText('Deny')
    expect(denyBadges.length).toBeGreaterThanOrEqual(1)
  })

  it('searches policies by name', () => {
    render(<PolicyImpactPanel />)
    const searchInput = screen.getByPlaceholderText(/search policies/i)
    fireEvent.change(searchInput, { target: { value: 'default-deny' } })
    // The selected policy becomes default-deny (only match)
    expect(screen.getByText(/2 pods selected/i)).toBeInTheDocument()
  })

  it('shows no matching policies empty state when search misses', () => {
    render(<PolicyImpactPanel />)
    const searchInput = screen.getByPlaceholderText(/search policies/i)
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } })
    expect(screen.getByText(/no matching policies/i)).toBeInTheDocument()
  })

  it('shows selector code for the selected policy', () => {
    render(<PolicyImpactPanel />)
    expect(screen.getByText("app == 'api-server'")).toBeInTheDocument()
  })
})
