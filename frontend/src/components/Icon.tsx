import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

export type IconName =
  | 'chevron-right'
  | 'search'
  | 'x'
  | 'refresh-cw'
  | 'pod'
  | 'shield'
  | 'alert-triangle'
  | 'cpu'
  | 'hard-drive'
  | 'activity'
  | 'pause'
  | 'play'
  | 'trash-2'
  | 'copy'
  | 'info'
  | 'clock'
  | 'chevron-down'
  | 'users'
  | 'lock'
  | 'unlock'
  | 'server'
  | 'box'
  | 'layout-dashboard'
  | 'bar-chart'
  | 'eye'
  | 'eye-off'
  | 'arrow-left'
  | 'check'
  | 'network'
  | 'square'
  | 'circle'
  | 'list'
  | 'layers'
  | 'globe'
  | 'grid'
  | 'download'

const ICON_PATHS: Record<IconName, { viewBox: string; paths: React.ReactNode }> = {
  'chevron-right': {
    viewBox: '0 0 24 24',
    paths: <polyline points="9 18 15 12 9 6" strokeWidth="2" />,
  },
  'chevron-down': {
    viewBox: '0 0 24 24',
    paths: <polyline points="6 9 12 15 18 9" strokeWidth="2" />,
  },
  search: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <circle cx="11" cy="11" r="8" strokeWidth="2" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" strokeWidth="2" />
      </>
    ),
  },
  x: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <line x1="18" y1="6" x2="6" y2="18" strokeWidth="2" />
        <line x1="6" y1="6" x2="18" y2="18" strokeWidth="2" />
      </>
    ),
  },
  'refresh-cw': {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <polyline points="23 4 23 10 17 10" strokeWidth="2" />
        <polyline points="1 20 1 14 7 14" strokeWidth="2" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" strokeWidth="2" />
      </>
    ),
  },
  pod: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" strokeWidth="2" />
        <line x1="8" y1="21" x2="16" y2="21" strokeWidth="2" />
        <line x1="12" y1="17" x2="12" y2="21" strokeWidth="2" />
      </>
    ),
  },
  shield: {
    viewBox: '0 0 24 24',
    paths: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeWidth="2" />,
  },
  'alert-triangle': {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeWidth="2" />
        <line x1="12" y1="9" x2="12" y2="13" strokeWidth="2" />
        <line x1="12" y1="17" x2="12.01" y2="17" strokeWidth="2" />
      </>
    ),
  },
  cpu: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <line x1="18" y1="20" x2="18" y2="10" strokeWidth="2" />
        <line x1="12" y1="20" x2="12" y2="4" strokeWidth="2" />
        <line x1="6" y1="20" x2="6" y2="14" strokeWidth="2" />
      </>
    ),
  },
  'hard-drive': {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <ellipse cx="12" cy="5" rx="9" ry="3" strokeWidth="2" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" strokeWidth="2" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" strokeWidth="2" />
      </>
    ),
  },
  activity: {
    viewBox: '0 0 24 24',
    paths: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" strokeWidth="2" />,
  },
  pause: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <rect x="6" y="4" width="4" height="16" strokeWidth="2" />
        <rect x="14" y="4" width="4" height="16" strokeWidth="2" />
      </>
    ),
  },
  play: {
    viewBox: '0 0 24 24',
    paths: <polygon points="5 3 19 12 5 21 5 3" strokeWidth="2" />,
  },
  'trash-2': {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <polyline points="3 6 5 6 21 6" strokeWidth="2" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" strokeWidth="2" />
      </>
    ),
  },
  copy: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeWidth="2" />
      </>
    ),
  },
  info: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <circle cx="12" cy="12" r="10" strokeWidth="2" />
        <line x1="12" y1="16" x2="12" y2="12" strokeWidth="2" />
        <line x1="12" y1="8" x2="12.01" y2="8" strokeWidth="2" />
      </>
    ),
  },
  clock: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <circle cx="12" cy="12" r="10" strokeWidth="2" />
        <polyline points="12 6 12 12 16 14" strokeWidth="2" />
      </>
    ),
  },
  users: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" strokeWidth="2" />
        <circle cx="9" cy="7" r="4" strokeWidth="2" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" strokeWidth="2" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" strokeWidth="2" />
      </>
    ),
  },
  lock: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" strokeWidth="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" strokeWidth="2" />
      </>
    ),
  },
  unlock: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" strokeWidth="2" />
        <path d="M7 11V7a5 5 0 0 1 9.9-3" strokeWidth="2" />
      </>
    ),
  },
  server: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" strokeWidth="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2" strokeWidth="2" />
        <line x1="6" y1="6" x2="6.01" y2="6" strokeWidth="2" />
        <line x1="6" y1="18" x2="6.01" y2="18" strokeWidth="2" />
      </>
    ),
  },
  box: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" strokeWidth="2" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" strokeWidth="2" />
        <line x1="12" y1="22.08" x2="12" y2="12" strokeWidth="2" />
      </>
    ),
  },
  'layout-dashboard': {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <rect x="3" y="3" width="7" height="7" strokeWidth="2" />
        <rect x="14" y="3" width="7" height="7" strokeWidth="2" />
        <rect x="3" y="14" width="7" height="7" strokeWidth="2" />
        <rect x="14" y="14" width="7" height="7" strokeWidth="2" />
      </>
    ),
  },
  'bar-chart': {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <line x1="12" y1="20" x2="12" y2="10" strokeWidth="2" />
        <line x1="18" y1="20" x2="18" y2="4" strokeWidth="2" />
        <line x1="6" y1="20" x2="6" y2="16" strokeWidth="2" />
      </>
    ),
  },
  eye: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeWidth="2" />
        <circle cx="12" cy="12" r="3" strokeWidth="2" />
      </>
    ),
  },
  'eye-off': {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" strokeWidth="2" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" strokeWidth="2" />
        <line x1="1" y1="1" x2="23" y2="23" strokeWidth="2" />
      </>
    ),
  },
  'arrow-left': {
    viewBox: '0 0 24 24',
    paths: <polyline points="15 18 9 12 15 6" strokeWidth="2" />,
  },
  check: {
    viewBox: '0 0 24 24',
    paths: <polyline points="20 6 9 17 4 12" strokeWidth="2" />,
  },
  network: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <circle cx="12" cy="12" r="3" strokeWidth="2" />
        <circle cx="19" cy="5" r="2" strokeWidth="2" />
        <circle cx="5" cy="5" r="2" strokeWidth="2" />
        <circle cx="19" cy="19" r="2" strokeWidth="2" />
        <circle cx="5" cy="19" r="2" strokeWidth="2" />
        <line x1="12" y1="9" x2="17" y2="6" strokeWidth="2" />
        <line x1="12" y1="9" x2="7" y2="6" strokeWidth="2" />
        <line x1="12" y1="15" x2="17" y2="18" strokeWidth="2" />
        <line x1="12" y1="15" x2="7" y2="18" strokeWidth="2" />
      </>
    ),
  },
  square: {
    viewBox: '0 0 24 24',
    paths: <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth="2" />,
  },
  circle: {
    viewBox: '0 0 24 24',
    paths: <circle cx="12" cy="12" r="10" strokeWidth="2" />,
  },
  list: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <line x1="8" y1="6" x2="21" y2="6" strokeWidth="2" />
        <line x1="8" y1="12" x2="21" y2="12" strokeWidth="2" />
        <line x1="8" y1="18" x2="21" y2="18" strokeWidth="2" />
        <line x1="3" y1="6" x2="3.01" y2="6" strokeWidth="2" />
        <line x1="3" y1="12" x2="3.01" y2="12" strokeWidth="2" />
        <line x1="3" y1="18" x2="3.01" y2="18" strokeWidth="2" />
      </>
    ),
  },
  layers: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <polygon points="12 2 2 7 12 12 22 7 12 2" strokeWidth="2" />
        <polyline points="2 17 12 22 22 17" strokeWidth="2" />
        <polyline points="2 12 12 17 22 12" strokeWidth="2" />
      </>
    ),
  },
  globe: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <circle cx="12" cy="12" r="10" strokeWidth="2" />
        <line x1="2" y1="12" x2="22" y2="12" strokeWidth="2" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" strokeWidth="2" />
      </>
    ),
  },
  download: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeWidth="2" />
        <polyline points="7 10 12 15 17 10" strokeWidth="2" />
        <line x1="12" y1="15" x2="12" y2="3" strokeWidth="2" />
      </>
    ),
  },
  grid: {
    viewBox: '0 0 24 24',
    paths: (
      <>
        <rect x="3" y="3" width="7" height="7" strokeWidth="2" />
        <rect x="14" y="3" width="7" height="7" strokeWidth="2" />
        <rect x="3" y="14" width="7" height="7" strokeWidth="2" />
        <rect x="14" y="14" width="7" height="7" strokeWidth="2" />
      </>
    ),
  },
}

export function Icon({ name, size = 16, ...props }: IconProps) {
  const icon = ICON_PATHS[name]
  if (!icon) return null

  return (
    <svg
      viewBox={icon.viewBox}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      aria-hidden="true"
      {...props}
    >
      {icon.paths}
    </svg>
  )
}
