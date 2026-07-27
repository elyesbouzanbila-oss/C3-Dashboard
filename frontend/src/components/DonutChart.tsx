import { useState, useEffect } from 'react'

interface DonutChartProps {
  percentage: number
  size?: number
  strokeWidth?: number
  color?: string
  bgColor?: string
  gradient?: boolean
  animated?: boolean
  glow?: boolean
  showLabel?: boolean
}

export function DonutChart({
  percentage,
  size = 80,
  strokeWidth = 8,
  color = 'var(--info)',
  bgColor = 'rgba(255, 255, 255, 0.06)',
  gradient = false,
  animated = true,
  glow = false,
  showLabel = true,
}: DonutChartProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const [offset, setOffset] = useState(animated ? circumference : circumference * (1 - percentage / 100))
  const gradientId = `donut-grad-${Math.random().toString(36).slice(2, 8)}`

  useEffect(() => {
    if (!animated) {
      setOffset(circumference * (1 - percentage / 100))
      return
    }
    const timer = setTimeout(() => {
      setOffset(circumference * (1 - percentage / 100))
    }, 100)
    return () => clearTimeout(timer)
  }, [percentage, circumference, animated])

  const pctColor =
    percentage >= 90 ? 'var(--danger)' :
    percentage >= 70 ? 'var(--warning)' :
    percentage >= 40 ? 'var(--primary)' :
    color

  const strokeColor = gradient ? `url(#${gradientId})` : pctColor

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="donut-chart"
      aria-hidden="true"
      style={glow ? { filter: `drop-shadow(0 0 6px ${pctColor})` } : undefined}
    >
      <defs>
        {gradient && (
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={pctColor} />
            <stop offset="50%" stopColor={pctColor} stopOpacity={0.8} />
            <stop offset="100%" stopColor={pctColor} stopOpacity={0.5} />
          </linearGradient>
        )}
      </defs>

      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={bgColor}
        strokeWidth={strokeWidth}
      />

      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{
          transition: animated ? 'stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.4s ease' : 'none',
        }}
      />

      {/* Percentage label */}
      {showLabel && (
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          fontSize={size * 0.22}
          fontWeight={700}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {Math.round(percentage)}%
        </text>
      )}
    </svg>
  )
}
