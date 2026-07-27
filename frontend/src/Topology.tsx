import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import cytoscape from 'cytoscape'
import './Topology.css'
import { getNsColor } from './utils'
import { DonutChart } from './components/DonutChart'

interface TopologyNode {
  id: string
  type: 'pod' | 'service' | 'node'
  namespace?: string
  name: string
  ip?: string
  labels?: Record<string, string>
  node_name?: string
  role?: 'master' | 'worker'
  node_ip?: string
  capacity?: Record<string, string>
  ready?: boolean
  ports?: string | null
}

interface TopologyEdge {
  id: string
  source: string
  target: string
  label?: string
}

interface TopologyProps {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}

// ─── Color palette ──────────────────────────────────────────────
const COLORS = {
  master: '#EC4899',
  masterBg: 'rgba(236, 72, 153, 0.08)',
  masterBorder: 'rgba(236, 72, 153, 0.4)',
  worker: '#3B82F6',
  workerBg: 'rgba(59, 130, 246, 0.06)',
  workerBorder: 'rgba(59, 130, 246, 0.3)',
  service: '#8B5CF6',
  serviceBg: 'rgba(139, 92, 246, 0.12)',
  selection: '#FCD34D',
  edgeDefault: 'rgba(148, 163, 184, 0.35)',
}

// ─── Style helper types ──────────────────────────────────────────
type EleStyle = Record<string, string | number | boolean | ((ele: cytoscape.NodeSingular) => string | number)>

const getNamespaceColor = (ns?: string): string =>
  getNsColor(ns || '')

/** Inline SVG icon components to avoid extra dependencies */
const ZoomInIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
)

const ZoomOutIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
)

const FitIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
)

export function Topology({ nodes, edges }: TopologyProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const toastRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [focusedNodeIdx, setFocusedNodeIdx] = useState(-1)

  const clusterNodes = nodes.filter(n => n.type === 'node')
  const masterNodes = clusterNodes.filter(n => n.role === 'master')
  const workerNodes = clusterNodes.filter(n => n.role === 'worker')
  const podNodes = nodes.filter(n => n.type === 'pod')
  const serviceNodes = nodes.filter(n => n.type === 'service')
  const offlineNodes = clusterNodes.filter(n => n.ready === false)

  // ── Zoom helpers ──────────────────────────────────────────────
  const handleZoomIn = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.zoom(cy.zoom() * 1.3)
    cy.center()
  }, [])

  const handleZoomOut = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.zoom(cy.zoom() * 0.75)
    cy.center()
  }, [])

  const handleFit = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.fit(undefined, 30)
  }, [])

  useEffect(() => {
    if (!containerRef.current || nodes.length === 0) return

    const clusterNodeEntries = nodes.filter(n => n.type === 'node')
    const podEntries = nodes.filter(n => n.type === 'pod')
    const serviceEntries = nodes.filter(n => n.type === 'service')

    // ─── Pre-compute ALL positions BEFORE creating cytoscape ─────
    type LayoutNode = TopologyNode & {
      width: number
      height: number
      x: number
      y: number
    }

    type AnchorNode = {
      id: string
      parent: string
      x: number
      y: number
    }

    const computePositions = (containerWidth: number) => {
      const clusterW = 520
      const clusterMinH = 320
      const clusterGapX = 56
      const rowGapY = 72
      const outerPad = 48
      const podW = 72
      const podH = 50
      const podGapX = 16
      const podGapY = 16
      const clusterHeaderH = 72
      const serviceW = 118
      const serviceH = 66
      const serviceGapX = 22
      const serviceGapY = 24
      const serviceAreaGap = serviceEntries.length > 0 ? 120 : 0
      const compoundPadding = 20

      const masters = clusterNodeEntries.filter(n => n.role === 'master')
      const workers = clusterNodeEntries.filter(n => n.role === 'worker')
      const services = serviceEntries

      const podCounts = clusterNodeEntries.reduce((acc, node) => {
        acc[node.id] = podEntries.filter(p => p.node_name === node.name).length
        return acc
      }, {} as Record<string, number>)

      const clusterHeight = (node: TopologyNode) => {
        const count = podCounts[node.id] || 0
        const cols = Math.max(1, Math.floor((clusterW - 64 + podGapX) / (podW + podGapX)))
        const rows = Math.ceil(count / cols)
        const podAreaH = rows > 0 ? rows * podH + Math.max(0, rows - 1) * podGapY : 0
        return Math.max(clusterMinH, clusterHeaderH + podAreaH + 40)
      }

      const rowWidth = (count: number) => Math.max(0, count * (clusterW + clusterGapX) - clusterGapX)
      const masterRowW = rowWidth(masters.length)
      const workerRowW = rowWidth(workers.length)
      const clusterAreaW = Math.max(masterRowW, workerRowW, clusterW)
      const serviceCols = services.length > 0
        ? Math.max(1, Math.min(2, Math.floor((containerWidth * 0.28) / (serviceW + serviceGapX))))
        : 0
      const serviceAreaW = serviceCols > 0 ? serviceCols * serviceW + Math.max(0, serviceCols - 1) * serviceGapX : 0
      const contentW = clusterAreaW + serviceAreaGap + serviceAreaW
      const startX = Math.max(outerPad, (containerWidth - contentW) / 2)

      const positions: Record<string, { x: number; y: number }> = {}
      const layoutNodes: Record<string, LayoutNode> = {}
      const anchorPositions: AnchorNode[] = []

      const placeClusterRow = (row: TopologyNode[], topY: number, rowAreaW: number) => {
        const rowStartX = startX + (clusterAreaW - rowAreaW) / 2
        row.forEach((node, i) => {
          const width = clusterW
          const height = clusterHeight(node)
          const x = rowStartX + i * (clusterW + clusterGapX) + width / 2
          const y = topY + height / 2
          positions[node.id] = { x, y }
          layoutNodes[node.id] = { ...node, width, height, x, y }

          const anchorX = width / 2 - compoundPadding
          const anchorY = height / 2 - compoundPadding
          anchorPositions.push(
            { id: `${node.id}:anchor:tl`, parent: node.id, x: x - anchorX, y: y - anchorY },
            { id: `${node.id}:anchor:tr`, parent: node.id, x: x + anchorX, y: y - anchorY },
            { id: `${node.id}:anchor:br`, parent: node.id, x: x + anchorX, y: y + anchorY },
            { id: `${node.id}:anchor:bl`, parent: node.id, x: x - anchorX, y: y + anchorY },
          )
        })
      }

      const masterTopY = outerPad
      placeClusterRow(masters, masterTopY, masterRowW)

      const masterRowH = masters.length > 0 ? Math.max(...masters.map(clusterHeight)) : 0
      const workerTopY = masterTopY + masterRowH + (workers.length > 0 ? rowGapY : 0)
      placeClusterRow(workers, workerTopY, workerRowW)

      const serviceStartX = startX + clusterAreaW + serviceAreaGap
      services.forEach((node, i) => {
        const col = serviceCols > 0 ? i % serviceCols : 0
        const row = serviceCols > 0 ? Math.floor(i / serviceCols) : i
        positions[node.id] = {
          x: serviceStartX + col * (serviceW + serviceGapX) + serviceW / 2,
          y: outerPad + row * (serviceH + serviceGapY) + serviceH / 2,
        }
      })

      const childPositions: Record<string, { x: number; y: number }> = {}
      masters.concat(workers).forEach(parent => {
        const parentLayout = layoutNodes[parent.id]
        if (!parentLayout) return

        const children = podEntries.filter(p => p.node_name === parent.name)
        if (children.length === 0) return

        const innerW = parentLayout.width - 64
        const cols = Math.max(1, Math.floor((innerW + podGapX) / (podW + podGapX)))
        const rows = Math.ceil(children.length / cols)
        const gridW = cols * podW + Math.max(0, cols - 1) * podGapX
        const gridH = rows * podH + Math.max(0, rows - 1) * podGapY
        const podStartX = parentLayout.x - gridW / 2 + podW / 2
        const podStartY = parentLayout.y - parentLayout.height / 2 + clusterHeaderH + Math.max(24, (parentLayout.height - clusterHeaderH - gridH) / 2) + podH / 2

        children.forEach((child, idx) => {
          const col = idx % cols
          const row = Math.floor(idx / cols)
          childPositions[child.id] = {
            x: podStartX + col * (podW + podGapX),
            y: podStartY + row * (podH + podGapY),
          }
        })
      })

      const orphanPods = podEntries.filter(p => !childPositions[p.id])
      const workerRowH = workers.length > 0 ? Math.max(...workers.map(clusterHeight)) : 0
      const orphanTopY = workerTopY + workerRowH + (orphanPods.length > 0 ? rowGapY : 0)
      const orphanCols = Math.max(1, Math.floor(clusterAreaW / (podW + podGapX)))
      orphanPods.forEach((pod, i) => {
        const col = i % orphanCols
        const row = Math.floor(i / orphanCols)
        childPositions[pod.id] = {
          x: startX + col * (podW + podGapX) + podW / 2,
          y: orphanTopY + row * (podH + podGapY) + podH / 2,
        }
      })

      return { positions, childPositions, layoutNodes, anchorPositions }
    }

    const containerWidth = containerRef.current.clientWidth || 1000
    const { positions, childPositions, layoutNodes, anchorPositions } = computePositions(containerWidth)

    // ─── Build elements with CORRECT positions from the start ────
    const elements: cytoscape.ElementDefinition[] = [
      ...clusterNodeEntries.map(node => ({
        data: {
          id: node.id,
          label: node.name,
          type: 'clusternode',
          role: node.role,
          ip: node.ip,
          capacity: node.capacity,
          ready: node.ready !== false ? 'true' : 'false',
          width: layoutNodes[node.id]?.width || 520,
          height: layoutNodes[node.id]?.height || 320,
        },
        position: positions[node.id] || { x: 0, y: 0 },
      })),
      ...anchorPositions.map(anchor => ({
        data: {
          id: anchor.id,
          type: 'cluster-anchor',
          parent: anchor.parent,
        },
        position: { x: anchor.x, y: anchor.y },
      })),
      ...podEntries.map(pod => ({          data: {
              id: pod.id,
              label: pod.name,
              type: 'pod',
              namespace: pod.namespace,
              ip: pod.ip,
              node_name: pod.node_name,
              labels: pod.labels,
              ports: pod.ports,
              parent: pod.node_name ? `node:${pod.node_name}` : undefined,
            },
            position: childPositions[pod.id],
      })),
      ...serviceEntries.map(svc => ({            data: {
              id: svc.id,
              label: svc.name,
              type: 'service',
              namespace: svc.namespace,
              ip: svc.ip,
              ports: svc.ports,
            },
            position: positions[svc.id] || { x: 0, y: 0 },
      })),
      ...edges.map(edge => ({
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          ...(edge.label ? { label: edge.label } : {}),
        },
      })),
    ]

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node[type="clusternode"][role="master"][ready="true"]',
          style: {
            'background-color': COLORS.masterBg,
            'background-blacken': -0.15,
            'border-opacity': 0.7,
            'label': (ele: cytoscape.NodeSingular) => {
              const name = ele.data('label') || ''
              const ip = ele.data('ip') || ''
              return ip ? `${name}\n${ip}` : name
            },
            'color': COLORS.master,
            'font-size': '13px',
            'font-weight': '700',
            'text-valign': 'top',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'padding': '20px',
            'shape': 'round-rectangle',
            'text-margin-y': 4,
            'width': 'data(width)',
            'height': 'data(height)',
            'z-index': 1,
            'z-compound-depth': 'bottom',
            'shadow-blur': 20,
            'shadow-color': 'rgba(236, 72, 153, 0.2)',
            'shadow-offset-x': 0,
            'shadow-offset-y': 4,
            'shadow-opacity': 0.6,
          } as EleStyle,
        },
        {
          selector: 'node[type="clusternode"][role="master"][ready="false"]',
          style: {
            'background-color': 'rgba(100, 100, 100, 0.06)',
            'border-color': 'rgba(239, 68, 68, 0.4)',
            'border-width': 2,
            'border-style': 'solid',
            'border-opacity': 0.5,
            'label': (ele: cytoscape.NodeSingular) => {
              const name = ele.data('label') || ''
              return `${name}\n(OFFLINE)`
            },
            'color': 'rgba(239, 68, 68, 0.6)',
            'font-size': '13px',
            'font-weight': '700',
            'text-valign': 'top',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'padding': '20px',
            'shape': 'round-rectangle',
            'text-margin-y': 4,
            'width': 'data(width)',
            'height': 'data(height)',
            'z-index': 1,
            'z-compound-depth': 'bottom',
            'opacity': 0.4,
            'shadow-blur': 0,
          } as EleStyle,
        },
        {
          selector: 'node[type="clusternode"][role="worker"][ready="true"]',
          style: {
            'background-color': COLORS.workerBg,
            'background-blacken': -0.1,
            'border-color': COLORS.worker,
            'border-width': 2.5,
            'border-style': 'solid',
            'border-opacity': 0.6,
            'label': (ele: cytoscape.NodeSingular) => {
              const name = ele.data('label') || ''
              const ip = ele.data('ip') || ''
              return ip ? `${name}\n${ip}` : name
            },
            'color': COLORS.worker,
            'font-size': '13px',
            'font-weight': '700',
            'text-valign': 'top',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'padding': '20px',
            'shape': 'round-rectangle',
            'text-margin-y': 4,
            'width': 'data(width)',
            'height': 'data(height)',
            'z-index': 1,
            'z-compound-depth': 'bottom',
            'shadow-blur': 20,
            'shadow-color': 'rgba(59, 130, 246, 0.18)',
            'shadow-offset-x': 0,
            'shadow-offset-y': 4,
            'shadow-opacity': 0.6,
          } as EleStyle,
        },
        {
          selector: 'node[type="clusternode"][role="worker"][ready="false"]',
          style: {
            'background-color': 'rgba(100, 100, 100, 0.06)',
            'border-color': 'rgba(239, 68, 68, 0.4)',
            'border-width': 2,
            'border-style': 'solid',
            'border-opacity': 0.5,
            'label': (ele: cytoscape.NodeSingular) => {
              const name = ele.data('label') || ''
              return `${name}\n(OFFLINE)`
            },
            'color': 'rgba(239, 68, 68, 0.6)',
            'font-size': '13px',
            'font-weight': '700',
            'text-valign': 'top',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'padding': '20px',
            'shape': 'round-rectangle',
            'text-margin-y': 4,
            'width': 'data(width)',
            'height': 'data(height)',
            'z-index': 1,
            'z-compound-depth': 'bottom',
            'opacity': 0.4,
            'shadow-blur': 0,
          } as EleStyle,
        },
        {
          selector: 'node[type="cluster-anchor"]',
          style: {
            'width': 1,
            'height': 1,
            'opacity': 0,
            'events': 'no',
            'label': '',
            'z-index': 0,
          } as EleStyle,
        },
        {
          selector: 'node[type="pod"]',
          style: {
            'content': (ele: cytoscape.NodeSingular) => {
              const label = ele.data('label') || ''
              const ip = ele.data('ip') || ''
              const shortName = label.length > 18 ? label.slice(0, 16) + '…' : label
              return ip ? `${shortName}\n${ip}` : shortName
            },
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '8px',
            'font-weight': '600',
            'color': '#ffffff',
            'text-wrap': 'wrap',
            'text-max-width': '80px',
            'background-color': (ele: cytoscape.NodeSingular) => getNamespaceColor(ele.data('namespace')),
            'background-blacken': -0.2,
            'border-width': 2,
            'border-color': 'rgba(255, 255, 255, 0.5)',
            'border-opacity': 0.7,
            'shape': 'ellipse',
            'width': '72px',
            'height': '50px',
            'min-zoomed-font-size': 6,
            'z-index': 20,
            'shadow-blur': 12,
            'shadow-color': (ele: cytoscape.NodeSingular) => getNamespaceColor(ele.data('namespace')),
            'shadow-offset-x': 0,
            'shadow-offset-y': 2,
            'shadow-opacity': 0.5,
            'transition-property': 'background-color, border-color, border-width, shadow-blur, shadow-opacity, width, height',
            'transition-duration': '0.25s',
          } as EleStyle,
        },
        {
          selector: 'node[type="service"]',
          style: {
            'content': (ele: cytoscape.NodeSingular) => {
              const label = ele.data('label') || ''
              const ip = ele.data('ip') || ''
              const shortName = label.length > 14 ? label.slice(0, 12) + '…' : label
              return ip ? `${shortName}\n${ip}` : shortName
            },
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '9px',
            'font-weight': '600',
            'color': '#ffffff',
            'text-wrap': 'wrap',
            'text-max-width': '90px',
            'background-color': COLORS.service,
            'background-blacken': -0.15,
            'border-width': 2,
            'border-color': 'rgba(255, 255, 255, 0.4)',
            'border-opacity': 0.6,
            'shape': 'round-rectangle',
            'width': '118px',
            'height': '66px',
            'min-zoomed-font-size': 7,
            'z-index': 15,
            'shadow-blur': 12,
            'shadow-color': 'rgba(139, 92, 246, 0.3)',
            'shadow-offset-x': 0,
            'shadow-offset-y': 2,
            'shadow-opacity': 0.5,
            'transition-property': 'background-color, border-color, border-width, shadow-blur, shadow-opacity',
            'transition-duration': '0.25s',
          } as EleStyle,
        },
        {
          selector: 'node[type="pod"]:selected, node[type="pod"]:active, node[type="pod"]:hover',
          style: {
            'border-color': COLORS.selection,
            'border-width': 3,
            'border-opacity': 1,
            'outline-width': 6,
            'outline-color': COLORS.selection,
            'outline-opacity': 0.4,
            'shadow-blur': 20,
            'shadow-color': COLORS.selection,
            'shadow-opacity': 0.5,
            'transition-property': 'border-color, border-width, shadow-blur, shadow-opacity, outline-width, outline-opacity',
            'transition-duration': '0.2s',
            'width': '78px',
            'height': '56px',
          },
        },
        {
          selector: 'node[type="service"]:selected, node[type="service"]:active, node[type="service"]:hover',
          style: {
            'border-color': COLORS.selection,
            'border-width': 3,
            'border-opacity': 1,
            'outline-width': 6,
            'outline-color': COLORS.selection,
            'outline-opacity': 0.4,
            'shadow-blur': 20,
            'shadow-color': COLORS.selection,
            'shadow-opacity': 0.5,
            'transition-property': 'border-color, border-width, shadow-blur, shadow-opacity, outline-width, outline-opacity',
            'transition-duration': '0.2s',
          },
        },
        {
          selector: 'node[type="clusternode"]:selected',
          style: {
            'border-color': COLORS.selection,
            'border-width': 3,
            'outline-width': 6,
            'outline-color': COLORS.selection,
            'outline-opacity': 0.25,
            'shadow-blur': 30,
            'shadow-color': COLORS.selection,
            'shadow-opacity': 0.4,
            'transition-property': 'border-color, border-width, shadow-blur, shadow-opacity, outline-width, outline-opacity',
            'transition-duration': '0.2s',
          },
        },
        // ── Base edge style ──
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': COLORS.edgeDefault,
            'target-arrow-color': COLORS.edgeDefault,
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.8,
            'curve-style': 'bezier',
            'opacity': 0.5,
            'transition-property': 'opacity, width, line-color',
            'transition-duration': '0.3s',
          },
        },
        // ── BGP edges — dashed pink ──
        {
          selector: 'edge[label="BGP"]',
          style: {
            'width': 2.5,
            'line-color': 'rgba(236, 72, 153, 0.55)',
            'line-style': 'dashed',
            'line-cap': 'round',
            'target-arrow-shape': 'none',
            'source-arrow-shape': 'none',
            'opacity': 0.65,
            'curve-style': 'bezier',
            'transition-property': 'opacity, width, line-color, line-style',
            'transition-duration': '0.3s',
          },
        },
        // ── Overlay edges — teal dotted ──
        {
          selector: 'edge[label="Overlay"]',
          style: {
            'width': 2.5,
            'line-color': 'rgba(6, 182, 212, 0.55)',
            'line-style': 'dotted',
            'line-cap': 'round',
            'target-arrow-shape': 'none',
            'source-arrow-shape': 'none',
            'opacity': 0.65,
            'curve-style': 'bezier',
            'transition-property': 'opacity, width, line-color, line-style',
            'transition-duration': '0.3s',
          },
        },
        // ── Pod-to-service edges — amber ──
        {
          selector: 'edge:not([label])',
          style: {
            'line-color': 'rgba(251, 191, 36, 0.35)',
            'target-arrow-color': 'rgba(251, 191, 36, 0.35)',
            'width': 1.8,
            'opacity': 0.5,
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.7,
            'transition-property': 'opacity, width, line-color, line-style',
            'transition-duration': '0.3s',
          },
        },
        // ── Selected/active edges (base) ──
        {
          selector: 'edge:selected, edge:active',
          style: {
            'width': 3.5,
            'opacity': 1,
            'line-style': 'solid',
            'line-color': '#3B82F6',
            'target-arrow-color': '#3B82F6',
          },
        },
        // ── Per-type selected override colors ──
        {
          selector: 'edge:not([label]):selected, edge:not([label]):active',
          style: {
            'line-color': COLORS.selection,
            'target-arrow-color': COLORS.selection,
          },
        },
        {
          selector: 'edge[label="BGP"]:selected, edge[label="BGP"]:active',
          style: {
            'line-color': '#EC4899',
            'target-arrow-shape': 'none',
            'source-arrow-shape': 'none',
          },
        },
        {
          selector: 'edge[label="Overlay"]:selected, edge[label="Overlay"]:active',
          style: {
            'line-color': '#06B6D4',
            'target-arrow-shape': 'none',
            'source-arrow-shape': 'none',
          },
        },
        // ── Edge hover (applied when no selection) ──
        {
          selector: 'edge:hover',
          style: {
            'width': 3,
            'opacity': 1,
            'line-color': '#60A5FA',
            'target-arrow-color': '#60A5FA',
            'line-style': 'solid',
          },
        },
        {
          selector: 'edge:not([label]):hover',
          style: {
            'line-color': COLORS.selection,
            'target-arrow-color': COLORS.selection,
          },
        },
        {
          selector: 'edge[label="BGP"]:hover',
          style: {
            'line-color': '#F472B6',
            'line-style': 'solid',
            'target-arrow-shape': 'none',
            'source-arrow-shape': 'none',
          },
        },
        {
          selector: 'edge[label="Overlay"]:hover',
          style: {
            'line-color': '#22D3EE',
            'line-style': 'solid',
            'target-arrow-shape': 'none',
            'source-arrow-shape': 'none',
          },
        },
      ],
      layout: {
        name: 'preset',
        fit: false,
      } as cytoscape.PresetLayoutOptions,
    })

    cyRef.current = cy

    // Fit viewport to show all nodes at correct positions
    cy.fit(undefined, 30)

    // ── ResizeObserver: re-layout on container size change ───────
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const onContainerResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (!cyRef.current || !containerRef.current) return
        const cyi = cyRef.current
        const w = containerRef.current.clientWidth || 1000
        const {
          positions: newPos,
          childPositions: newChildPos,
          anchorPositions: newAnchorPositions,
        } = computePositions(w)
        const newAnchorPos = newAnchorPositions.reduce((acc, anchor) => {
          acc[anchor.id] = { x: anchor.x, y: anchor.y }
          return acc
        }, {} as Record<string, { x: number; y: number }>)

        // Apply new positions to all nodes
        cyi.nodes().forEach((n: cytoscape.NodeSingular) => {
          const id = n.id()
          if (newPos[id]) n.position(newPos[id])
          if (newChildPos[id]) n.position(newChildPos[id])
          if (newAnchorPos[id]) n.position(newAnchorPos[id])
        })
        cyi.fit(undefined, 30)
      }, 200)
    }
    const observer = new ResizeObserver(onContainerResize)
    observer.observe(containerRef.current)

    // ── Interactivity ──
    cy.on('mouseover', 'node[type="pod"], node[type="service"]', (event: cytoscape.EventObject) => {
      event.target.addClass('selected')
    })
    cy.on('mouseout', 'node[type="pod"], node[type="service"]', (event: cytoscape.EventObject) => {
      event.target.removeClass('selected')
    })
    cy.on('mouseover', 'node[type="clusternode"]', (event: cytoscape.EventObject) => {
      event.target.addClass('selected')
    })
    cy.on('mouseout', 'node[type="clusternode"]', (event: cytoscape.EventObject) => {
      event.target.removeClass('selected')
    })
    cy.on('mouseover', 'edge', (event: cytoscape.EventObject) => {
      event.target.addClass('selected')
    })
    cy.on('mouseout', 'edge', (event: cytoscape.EventObject) => {
      event.target.removeClass('selected')
    })

    cy.on('tap', 'node', (event: cytoscape.EventObject) => {
      const node = event.target
      const d = node.data()
      const info: string[] = []

      if (d.type === 'clusternode') {
        const isOnline = d.ready !== 'false'
        info.push(`${isOnline ? '🟢' : '🔴'}  Node: ${d.label}`)
        if (!isOnline) info.push(`⚠️  Status: Offline`)
        info.push(`🎯 Role: ${d.role === 'master' ? 'Control Plane (Master)' : 'Worker'}`)
        if (d.ip) info.push(`🌐 IP: ${d.ip}`)
        if (d.capacity) {
          info.push(`💻 CPU: ${d.capacity.cpu || '?'}  |  RAM: ${d.capacity.memory || '?'}`)
        }
        const childCount = podEntries.filter(p => p.node_name === d.label).length
        info.push(`📦 Pods: ${childCount}`)
      } else if (d.type === 'pod') {
        info.push(`📦 Pod: ${d.label}`)
        if (d.namespace) info.push(`📁 Namespace: ${d.namespace}`)
        if (d.ip) info.push(`🌐 IP: ${d.ip}`)
        if (d.ports) info.push(`🔌 Ports: ${d.ports}`)
        if (d.node_name) info.push(`🖥️  Node: ${d.node_name}`)
      } else if (d.type === 'service') {
        info.push(`🔗 Service: ${d.label}`)
        if (d.namespace) info.push(`📁 Namespace: ${d.namespace}`)
        if (d.ip) info.push(`🌐 Cluster IP: ${d.ip}`)
        if (d.ports) info.push(`🔌 Ports: ${d.ports}`)
        const connectedPods = cy.edges(`[source = "${d.id}"], [target = "${d.id}"]`).connectedNodes()
        const podCount = connectedPods.filter((n: cytoscape.NodeSingular) => n.data('type') === 'pod').length
        info.push(`🔌 Connected Pods: ${podCount}`)
      }

      const infoBar = toastRef.current
      if (infoBar) {
        infoBar.textContent = info.join('  •  ')
        infoBar.classList.add('visible')
        // Store timer on element via data-attr to avoid `as any` cast
        const timerId = infoBar.getAttribute('data-hide-timer')
        if (timerId) clearTimeout(Number(timerId))
        const newTimerId = window.setTimeout(() => {
          infoBar.classList.remove('visible')
        }, 6000)
        infoBar.setAttribute('data-hide-timer', String(newTimerId))
      }
    })

    cy.on('dbltap', () => {
      cy.fit(undefined, 30)
    })

    return () => {
      observer.disconnect()
      if (resizeTimer) clearTimeout(resizeTimer)
      if (cyRef.current) {
        cyRef.current.destroy()
      }
    }
  }, [nodes, edges])

  const namespaceCounts = podNodes.reduce((acc, node) => {
    const ns = node.namespace || 'unknown'
    acc[ns] = (acc[ns] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const podCountByNode = podNodes.reduce((acc, pod) => {
    const n = pod.node_name || 'unknown'
    acc[n] = (acc[n] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Compute health percentage for donut chart
  const totalNodeCount = clusterNodes.length
  const healthyNodeCount = clusterNodes.filter(n => n.ready !== false).length
  const healthPct = totalNodeCount > 0 ? (healthyNodeCount / totalNodeCount) * 100 : 0

  const healthColor =
    healthPct >= 90 ? 'var(--success)' :
    healthPct >= 70 ? 'var(--warning)' :
    'var(--danger)'

  // ── Keyboard navigation ──
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- array deps change each render
  const nodeList = useMemo(() => [...podNodes, ...serviceNodes], [podNodes, serviceNodes])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!cyRef.current || nodeList.length === 0) return
    const cy = cyRef.current

    switch (e.key) {
      case 'Tab': {
        e.preventDefault()
        const direction = e.shiftKey ? -1 : 1
        setFocusedNodeIdx(prev => {
          const next = (prev + direction + nodeList.length) % nodeList.length
          // Clear all previous selections
          cy.nodes().unselect()
          // Select the new node
          const targetId = nodeList[next].id
          const node = cy.getElementById(targetId)
          if (node.length) {
            node.select()
            cy.zoom(cy.zoom())
            cy.center(node)
            // Trigger the info toast via tap event
            cy.emit('tap', { target: node } as never)
          }
          return next
        })
        break
      }
      case 'ArrowRight':
      case 'ArrowDown': {
        e.preventDefault()
        setFocusedNodeIdx(prev => {
          const next = (prev + 1) % nodeList.length
          cy.nodes().unselect()
          const targetId = nodeList[next].id
          const node = cy.getElementById(targetId)
          if (node.length) {
            node.select()
            cy.center(node)
            cy.emit('tap', { target: node } as never)
          }
          return next
        })
        break
      }
      case 'ArrowLeft':
      case 'ArrowUp': {
        e.preventDefault()
        setFocusedNodeIdx(prev => {
          const next = (prev - 1 + nodeList.length) % nodeList.length
          cy.nodes().unselect()
          const targetId = nodeList[next].id
          const node = cy.getElementById(targetId)
          if (node.length) {
            node.select()
            cy.center(node)
            cy.emit('tap', { target: node } as never)
          }
          return next
        })
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        if (focusedNodeIdx >= 0 && focusedNodeIdx < nodeList.length) {
          cy.nodes().unselect()
          const targetId = nodeList[focusedNodeIdx].id
          const node = cy.getElementById(targetId)
          if (node.length) {
            node.select()
            cy.emit('tap', { target: node } as never)
          }
        }
        break
      }
      case 'Escape': {
        cy.nodes().unselect()
        setFocusedNodeIdx(-1)
        break
      }
    }
  }, [nodeList, focusedNodeIdx])

  return (
    <div className="topology-container" role="region" aria-label="Cluster topology diagram showing nodes, pods, and services with their connections. Use Tab/Arrow keys to navigate elements."
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* ── Polished Stats Bar (compact-bar pattern) ── */}
      <div className="topology-stats-bar">
        <div className="stat">
          <span className="stat-dot master-dot" />
          <div className="stat-content">
            <span className="stat-value" style={{ color: '#EC4899' }}>{masterNodes.length}</span>
            <span className="stat-label">Master{masterNodes.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="stat">
          <span className="stat-dot worker-dot" />
          <div className="stat-content">
            <span className="stat-value" style={{ color: '#3B82F6' }}>{workerNodes.length}</span>
            <span className="stat-label">Worker{workerNodes.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="stat">
          <span className="stat-dot pod-dot" />
          <div className="stat-content">
            <span className="stat-value" style={{ color: '#10B981' }}>{podNodes.length}</span>
            <span className="stat-label">Pod{podNodes.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="stat">
          <span className="stat-dot service-dot" />
          <div className="stat-content">
            <span className="stat-value" style={{ color: '#8B5CF6' }}>{serviceNodes.length}</span>
            <span className="stat-label">Service{serviceNodes.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="stat">
          <span className="stat-dot edge-dot" />
          <div className="stat-content">
            <span className="stat-value" style={{ color: 'var(--text-secondary)' }}>{edges.length}</span>
            <span className="stat-label">Connection{edges.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Right side: health donut + offline badge */}
        <div className="stats-actions">
          {totalNodeCount > 0 && (
            <div className="stats-health-badge" title={`${healthyNodeCount}/${totalNodeCount} nodes healthy`}>
              <DonutChart
                percentage={healthPct}
                size={22}
                strokeWidth={3}
                color={healthColor}
                showLabel={false}
                glow
              />
              <span style={{ color: healthColor, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {healthPct.toFixed(0)}%
              </span>
              <span style={{ color: 'var(--text-tertiary)' }}>healthy</span>
            </div>
          )}
          {offlineNodes.length > 0 && (
            <span className="stats-health-badge" style={{ borderColor: 'rgba(239, 68, 68, 0.3)', color: 'var(--danger)' }}>
              ⚠ {offlineNodes.length} offline
            </span>
          )}
        </div>
      </div>

      <div className="topology-graph-wrapper">
        <div ref={containerRef} className="topology-graph" />
        <div ref={toastRef} className="topology-toast" role="status" aria-live="polite" />

        {/* ── Zoom Controls Overlay ── */}
        <div className="topology-zoom-controls">
          <button
            className="topology-zoom-btn"
            onClick={handleZoomIn}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomInIcon />
          </button>
          <button
            className="topology-zoom-btn"
            onClick={handleZoomOut}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOutIcon />
          </button>
          <button
            className="topology-zoom-btn"
            onClick={handleFit}
            title="Fit all elements"
            aria-label="Fit all elements"
          >
            <FitIcon />
          </button>
        </div>
      </div>

      <div className="topology-legend">
        <div className="legend-section">
          <div className="legend-title">Namespaces</div>
          {Object.entries(namespaceCounts).map(([ns, count]) => (
            <div key={ns} className="legend-item">
              <div
                className="legend-color"
                style={{ backgroundColor: getNamespaceColor(ns) }}
              />
              <span>{ns} ({count})</span>
            </div>
          ))}
        </div>

        <div className="legend-section">
          <div className="legend-title">Cluster Nodes</div>
          {clusterNodes.map(n => (
            <div key={n.id} className="legend-item">
              <div
                className={`legend-color ${n.role === 'master' ? 'master-bg' : 'worker-bg'}`}
                style={{
                  backgroundColor: n.role === 'master' ? COLORS.master : COLORS.worker,
                }}
              />
              <span>
                {n.name}
                <span className="legend-ip"> {n.ip || ''}</span>
                <span className="legend-pod-count">
                  {' '}({podCountByNode[n.name] || 0} pods)
                </span>
              </span>
            </div>
          ))}
        </div>

        <div className="legend-section">
          <div className="legend-title">Services</div>
          {serviceNodes.map(svc => (
            <div key={svc.id} className="legend-item">
              <div className="legend-color service-color" />
              <span>
                {svc.name}
                {svc.ip && <span className="legend-ip"> {svc.ip}</span>}
              </span>
            </div>
          ))}
        </div>

        <div className="legend-section">
          <div className="legend-title">Legend</div>
          <div className="legend-item">
            <div className="legend-shape cluster-master" />
            <span>Master Node</span>
          </div>
          <div className="legend-item">
            <div className="legend-shape cluster-worker" />
            <span>Worker Node</span>
          </div>
          <div className="legend-item">
            <div className="legend-shape pod-legend" />
            <span>Pod (with IP)</span>
          </div>
          <div className="legend-item">
            <div className="legend-shape service-legend" />
            <span>Service</span>
          </div>
        </div>
      </div>

      <div className="topology-hint">
        💡 Click any element for details • Hover to highlight • Double-click or use
        <button
          onClick={handleFit}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--primary)',
            cursor: 'pointer',
            fontSize: 'inherit',
            fontStyle: 'italic',
            fontFamily: 'inherit',
            padding: '0 2px',
            textDecoration: 'underline',
            textDecorationStyle: 'dotted',
          }}
          aria-label="Fit all elements"
        >
          Fit All
        </button>
        {' '}to reset view • Zoom with scroll/buttons
      </div>
    </div>
  )
}
