import { motion, useReducedMotion } from 'motion/react'
import { useMemo, useState } from 'react'

interface Point {
  label: string
  value: number | null
}

const WIDTH = 640
const HEIGHT = 240
const PAD = { left: 30, right: 10, top: 12, bottom: 26 }

/**
 * A small area chart drawn as plain SVG. It replaces a general charting library that was most of
 * the Progress page's download size for what is one line and a gradient.
 */
export function TrendChart({ points, color }: { points: Point[]; color: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const reduce = useReducedMotion()

  const geometry = useMemo(() => {
    const innerW = WIDTH - PAD.left - PAD.right
    const innerH = HEIGHT - PAD.top - PAD.bottom
    const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
    const y = (v: number) => PAD.top + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH
    const known = points.map((p, i) => (p.value === null ? null : { i, px: x(i), py: y(p.value) })).filter((p) => p !== null)
    const line = known.map((p, n) => `${n === 0 ? 'M' : 'L'}${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ')
    const base = PAD.top + innerH
    const area = known.length
      ? `${line} L${known[known.length - 1].px.toFixed(1)},${base} L${known[0].px.toFixed(1)},${base} Z`
      : ''
    return { x, y, known, line, area, base, innerW }
  }, [points])

  const ticks = [0, 25, 50, 75, 100]
  const labelEvery = Math.max(1, Math.ceil(points.length / 6))
  const active = hover !== null ? points[hover] : null
  const gradient = `trend-${color.replace(/[^a-z0-9]/gi, '')}`

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const px = ((event.clientX - box.left) / box.width) * WIDTH
    const index = Math.round(((px - PAD.left) / geometry.innerW) * (points.length - 1))
    setHover(Math.max(0, Math.min(points.length - 1, index)))
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-[240px] w-full touch-pan-y select-none"
        role="img"
        aria-label="Score trend over your recent sessions"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={geometry.y(t)} y2={geometry.y(t)} stroke="currentColor" strokeOpacity={0.1} strokeDasharray="3 4" />
            <text x={PAD.left - 8} y={geometry.y(t) + 4} textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.5}>
              {t}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={geometry.x(i)} y={HEIGHT - 6} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.5}>
              {p.label}
            </text>
          ) : null,
        )}
        {geometry.area && (
          <motion.path
            key={`area-${geometry.area}`}
            d={geometry.area}
            fill={`url(#${gradient})`}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.25 }}
          />
        )}
        {geometry.line && (
          <motion.path
            key={`line-${geometry.line}`}
            d={geometry.line}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
        {hover !== null && active?.value != null && (
          <g>
            <line x1={geometry.x(hover)} x2={geometry.x(hover)} y1={PAD.top} y2={geometry.base} stroke={color} strokeOpacity={0.35} />
            <circle cx={geometry.x(hover)} cy={geometry.y(active.value)} r={5} fill={color} stroke="var(--card)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover !== null && active?.value != null && (
        <div
          className="pointer-events-none absolute top-1 -translate-x-1/2 rounded-xl bg-popover px-2.5 py-1.5 text-[12px] shadow-lg ring-1 ring-border"
          style={{ left: `${(geometry.x(hover) / WIDTH) * 100}%` }}
        >
          <div className="text-subtle">{active.label}</div>
          <div className="font-semibold tabular-nums">{Math.round(active.value)}</div>
        </div>
      )}
    </div>
  )
}
