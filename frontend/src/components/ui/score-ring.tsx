import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useEffect, useId, type ReactNode } from 'react'
import { cn, scoreTone, toneColor } from '@/lib/utils'

/** Animated number that counts up from 0. */
export function CountUp({ value, decimals = 0, duration = 1.2 }: { value: number; decimals?: number; duration?: number }) {
  const mv = useMotionValue(0)
  const text = useTransform(mv, (v) => v.toFixed(decimals))
  useEffect(() => {
    const controls = animate(mv, value, { duration, ease: [0.16, 1, 0.3, 1] })
    return () => controls.stop()
  }, [mv, value, duration])
  return <motion.span>{text}</motion.span>
}

/** Single progress ring coloured by score. */
export function ScoreRing({
  value,
  size = 120,
  stroke = 10,
  children,
  className,
  delay = 0,
}: {
  value: number | null
  size?: number
  stroke?: number
  children?: ReactNode
  className?: string
  delay?: number
}) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value)) / 100
  const color = toneColor[scoreTone(value)]

  return (
    <div className={cn('relative grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--fill-strong)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - pct) }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  )
}

export interface RingSpec {
  value: number | null
  from: string
  to: string
}

/** Concentric Apple Fitness-style activity rings. */
export function ActivityRings({ rings, size = 200, stroke = 22, gap = 4 }: { rings: RingSpec[]; size?: number; stroke?: number; gap?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
      <defs>
        {rings.map((ring, i) => (
          <linearGradient key={i} id={`${id}-g${i}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={ring.from} />
            <stop offset="100%" stopColor={ring.to} />
          </linearGradient>
        ))}
      </defs>
      {rings.map((ring, i) => {
        const radius = size / 2 - stroke / 2 - i * (stroke + gap)
        const circumference = 2 * Math.PI * radius
        const pct = ring.value == null ? 0 : Math.max(0, Math.min(100, ring.value)) / 100
        return (
          <g key={i}>
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={ring.from} strokeOpacity={0.18} strokeWidth={stroke} />
            {ring.value != null && (
              <motion.circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={`url(#${id}-g${i})`}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset: circumference * (1 - pct) }}
                transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1], delay: 0.15 + i * 0.15 }}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}
