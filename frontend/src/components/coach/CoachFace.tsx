import { motion } from 'motion/react'
import { useId } from 'react'

/**
 * The coach's face drawn flat: the same pearl-white head, black glass screen and glowing eyes as the
 * 3D coach. Used where a 3D canvas would be too much (the chat header) and while the 3D coach loads.
 * `happy` turns the eyes into smiling arcs.
 */
export function CoachFace({ size = 56, happy = false, className }: { size?: number; happy?: boolean; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const shell = `coach-shell-${id}`
  const glass = `coach-glass-${id}`
  const sheen = `coach-sheen-${id}`
  const light = `coach-light-${id}`
  const glow = `coach-glow-${id}`
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden className={className}>
      <defs>
        <radialGradient id={shell} cx="0.36" cy="0.28" r="0.78">
          <stop offset="0" stopColor="#fbfbfd" />
          <stop offset="0.65" stopColor="#eceef3" />
          <stop offset="1" stopColor="#cfd3dc" />
        </radialGradient>
        <radialGradient id={glass} cx="0.4" cy="0.25" r="0.85">
          <stop offset="0" stopColor="#262a36" />
          <stop offset="0.55" stopColor="#0b0c12" />
          <stop offset="1" stopColor="#030306" />
        </radialGradient>
        <linearGradient id={sheen} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={light} x1="0.25" y1="0" x2="0.75" y2="0">
          <stop offset="0" stopColor="#7fe3ff" />
          <stop offset="1" stopColor="#b3a4ff" />
        </linearGradient>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx="28" cy="28" r="28" fill={`url(#${shell})`} />
      <ellipse cx="28" cy="28.5" rx="22.4" ry="16.8" fill={`url(#${glass})`} />
      <ellipse cx="25" cy="17.5" rx="13" ry="4.2" fill={`url(#${sheen})`} />

      <g filter={`url(#${glow})`}>
        {happy ? (
          <g stroke={`url(#${light})`} strokeWidth="3.4" strokeLinecap="round" fill="none">
            <path d="M16.6 30 a5.6 5.6 0 0 1 9.6 0" />
            <path d="M29.8 30 a5.6 5.6 0 0 1 9.6 0" />
          </g>
        ) : (
          <motion.g
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            animate={{ scaleY: [1, 1, 0.12, 1] }}
            transition={{ duration: 4.6, times: [0, 0.93, 0.965, 1], repeat: Infinity, ease: 'easeInOut' }}
          >
            <rect x="18.6" y="22.2" width="6.2" height="10.2" rx="3.1" fill={`url(#${light})`} />
            <rect x="31.2" y="22.2" width="6.2" height="10.2" rx="3.1" fill={`url(#${light})`} />
          </motion.g>
        )}
      </g>
    </svg>
  )
}
