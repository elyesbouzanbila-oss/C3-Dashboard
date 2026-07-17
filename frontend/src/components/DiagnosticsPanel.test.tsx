import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DiagnosticsPanel } from './DiagnosticsPanel'
import type { Pod } from '../types'

vi.mock('../context/DashboardContext', () => ({
  useDashboard: () => ({
    pods: MOCK_PODS,
    cniTopology: { nodes: [], edges: [] },
  }),
  useTabSubscription: vi.fn(),
}))

const MOCK_PODS: Pod[] = [
  { name: 'web-1', namespace: 'default', pod_ip: '10.0.0.1', node_name: 'n1', phase: 'Running', labels: {}, containers: [] },
  { name: 'api-1', namespace: 'production', pod_ip: '10.0.0.2', node_name: 'n2', phase: 'Running', labels: {}, containers: [] },
  { name: 'cache-1', namespace: 'production', pod_ip: '10.0.0.3', node_name: 'n2', phase: 'Running', labels: {}, containers: [] },
]

describe('DiagnosticsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('renders the form with source/target sections', () => {
    render(<DiagnosticsPanel />)
    expect(screen.getByText('Connectivity Diagnostics')).toBeInTheDocument()
    expect(screen.getByText('Source')).toBeInTheDocument()
    expect(screen.getByText('Target')).toBeInTheDocument()
  })

  it('shows validation error when source pod is not selected', async () => {
    const user = userEvent.setup()
    render(<DiagnosticsPanel />)
    await user.click(screen.getByText('Run Test'))
    expect(screen.getByText(/Please select a source pod/i)).toBeInTheDocument()
  })

  it('shows validation error when target pod is not selected', async () => {
    const user = userEvent.setup()
    render(<DiagnosticsPanel />)
    // Select source namespace & pod
    const nsSelect = screen.getAllByRole('combobox')[0] // source namespace
    await user.selectOptions(nsSelect, 'production')
    const podSelect = screen.getAllByRole('combobox')[1] // source pod
    await user.selectOptions(podSelect, 'api-1')
    // Keep target type as "pod" (default), don't select target pod
    await user.click(screen.getByText('Run Test'))
    expect(screen.getByText(/Please select a target pod/i)).toBeInTheDocument()
  })

  it('shows validation error when target service name is empty', async () => {
    const user = userEvent.setup()
    render(<DiagnosticsPanel />)
    // Select source
    const nsSelect = screen.getAllByRole('combobox')[0]
    await user.selectOptions(nsSelect, 'production')
    const podSelect = screen.getAllByRole('combobox')[1]
    await user.selectOptions(podSelect, 'api-1')
    // Switch target type to service
    await user.click(screen.getByText('Service'))
    await user.click(screen.getByText('Run Test'))
    expect(screen.getByText(/Please enter a target service name/i)).toBeInTheDocument()
  })

  it('shows validation error for invalid port', async () => {
    const user = userEvent.setup()
    render(<DiagnosticsPanel />)
    // Select source
    const nsSelect = screen.getAllByRole('combobox')[0]
    await user.selectOptions(nsSelect, 'production')
    const podSelect = screen.getAllByRole('combobox')[1]
    await user.selectOptions(podSelect, 'api-1')
    // Select target pod (needed so port validation is reached)
    const targetNsSelect = screen.getAllByRole('combobox')[2]
    await user.selectOptions(targetNsSelect, 'default')
    const targetPodSelect = screen.getAllByRole('combobox')[3]
    await user.selectOptions(targetPodSelect, 'web-1')
    // Set invalid port via fireEvent.change (userEvent.type is unreliable on number inputs in jsdom)
    const portInput = screen.getByDisplayValue('80')
    fireEvent.change(portInput, { target: { value: '99999' } })
    await user.click(screen.getByText('Run Test'))
    expect(screen.getByText(/Please enter a valid target port/i)).toBeInTheDocument()
  })

  it('clears logs when Clear button is clicked', async () => {
    const user = userEvent.setup()
    render(<DiagnosticsPanel />)
    // First show an error log
    await user.click(screen.getByText('Run Test'))
    expect(screen.getByText(/Please select a source pod/i)).toBeInTheDocument()
    // Clear
    await user.click(screen.getByText('Clear'))
    expect(screen.queryByText(/Please select a source pod/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Run a connectivity test to see results/i)).toBeInTheDocument()
  })

  it('shows empty log state initially', () => {
    render(<DiagnosticsPanel />)
    expect(screen.getByText(/Run a connectivity test to see results/i)).toBeInTheDocument()
  })
})
