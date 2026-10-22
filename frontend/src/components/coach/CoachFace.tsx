import { motion } from 'motion/react'
import { useId } from 'react'

const INK = '#1d1238'

/**
 * The coach's face drawn flat: the same glossy head, glassy eyes, rosy cheeks and smile as the 3D
 * coach. Used where a 3D canvas would be too much (the chat header) and while the 3D coach loads.
 * `happy` turns the eyes into smiling arcs.
 */
export function CoachFace({ size = 56, happy = false, className }: { size?: number; happy?: boolean; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const skin = `coach-skin-${id}`
  const shade = `coach-shade-${id}`
  const shine = `coach-shine-${id}`
  const cheek = `coach-cheek-${id}`
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden className={className}>
      <defs>
        <linearGradient id={skin} x1="0.08" y1="0.02" x2="0.92" y2="0.98">
          <stop offset="0" stopColor="#0894ff" />
          <stop offset="0.38" stopColor="#c959dd" />
          <stop offset="0.7" stopColor="#ff2e54" />
          <stop offset="1" stopColor="#ff9004" />
        </linearGradient>
        <radialGradient id={shade} cx="0.38" cy="0.32" r="0.72">
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#1d0b30" stopOpacity="0.3" />
        </radialGradient>
        <radialGradient id={shine} cx="0.33" cy="0.2" r="0.3">
          <stop offset="0" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={cheek}>
          <stop offset="0" stopColor="#ff8fc4" stopOpacity="0.7" />
          <stop offset="1" stopColor="#ff8fc4" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="28" cy="28" r="28" fill={`url(#${skin})`} />
      <circle cx="28" cy="28" r="28" fill={`url(#${shade})`} />
      <ellipse cx="19" cy="12" rx="13" ry="9" fill={`url(#${shine})`} />

      <ellipse cx="13.5" cy="33" rx="5.5" ry="4" fill={`url(#${cheek})`} />
      <ellipse cx="42.5" cy="33" rx="5.5" ry="4" fill={`url(#${cheek})`} />

      {happy ? (
        <g stroke={INK} strokeWidth="2.8" strokeLinecap="round" fill="none">
          <path d="M16.5 26.5 q3.8 -5 7.6 0" />
          <path d="M31.9 26.5 q3.8 -5 7.6 0" />
        </g>
      ) : (
        <motion.g
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          animate={{ scaleY: [1, 1, 0.1, 1] }}
          transition={{ duration: 4.6, times: [0, 0.93, 0.965, 1], repeat: Infinity, ease: 'easeInOut' }}
        >
          <rect x="17.3" y="19" width="6.4" height="10.5" rx="3.2" fill={INK} />
          <rect x="32.3" y="19" width="6.4" height="10.5" rx="3.2" fill={INK} />
          <circle cx="19.4" cy="21.6" r="1.5" fill="#fff" />
          <circle cx="34.4" cy="21.6" r="1.5" fill="#fff" />
          <circle cx="21.9" cy="26.6" r="0.75" fill="#fff" />
          <circle cx="36.9" cy="26.6" r="0.75" fill="#fff" />
        </motion.g>
      )}

      <path
        d={happy ? 'M22.2 34.2 q5.8 5.8 11.6 0' : 'M23.2 34.6 q4.8 4.4 9.6 0'}
        stroke={INK}
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
