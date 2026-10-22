import { HeartIcon, SparkleIcon, StarIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { CoachMood } from './Coach3D'

const SPARKS = [
  { x: -30, y: -26, colour: '#0894ff', size: 13 },
  { x: 0, y: -40, colour: '#ffcc00', size: 15 },
  { x: 30, y: -26, colour: '#ff2e54', size: 12 },
  { x: -36, y: 4, colour: '#c959dd', size: 10 },
  { x: 36, y: 4, colour: '#ff9004', size: 11 },
]

/**
 * Little extras drawn around the corner coach: z's while it sleeps, hearts when it is smitten, a burst
 * of sparkles when it cheers, and stars circling its head when it is dizzy. With reduced motion they
 * only fade in and out.
 */
export function CoachExtras({ mood }: { mood: CoachMood }) {
  const reduce = useReducedMotion()
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      <AnimatePresence>
        {mood === 'asleep' && (
          <motion.span key="z" exit={{ opacity: 0 }} className="absolute -top-1 right-0">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="absolute text-[11px] font-bold text-muted-foreground"
                style={{ fontSize: 9 + i * 2 }}
                initial={{ opacity: 0, x: 0, y: 0 }}
                animate={
                  reduce
                    ? { opacity: [0, 0.9, 0], x: i * 6, y: -i * 8 }
                    : { opacity: [0, 0.9, 0], x: [0, 6 + i * 4], y: [0, -20 - i * 6] }
                }
                transition={{ duration: 2.4, delay: i * 0.8, repeat: Infinity, ease: 'easeOut' }}
              >
                z
              </motion.span>
            ))}
          </motion.span>
        )}

        {mood === 'love' && (
          <motion.span key="love" exit={{ opacity: 0 }} className="absolute top-0 left-1/2">
            {[-14, 0, 14].map((x, i) => (
              <motion.span
                key={x}
                className="absolute text-[#ff5c8d]"
                initial={{ opacity: 0, x, y: 0, scale: 0.6 }}
                animate={
                  reduce
                    ? { opacity: [0, 1, 0], x, y: -10 }
                    : { opacity: [0, 1, 0], x: [x, x + (i - 1) * 6], y: [0, -26], scale: [0.6, 1, 0.8] }
                }
                transition={{ duration: 1.6, delay: i * 0.35, repeat: Infinity, ease: 'easeOut' }}
              >
                <HeartIcon size={11 + (i % 2) * 3} weight="fill" />
              </motion.span>
            ))}
          </motion.span>
        )}

        {mood === 'cheer' && (
          <motion.span key="cheer" exit={{ opacity: 0 }} className="absolute top-1/2 left-1/2">
            {SPARKS.map((spark, i) => (
              <motion.span
                key={i}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ color: spark.colour }}
                initial={{ opacity: 0, x: 0, y: 0, scale: 0.3, rotate: 0 }}
                animate={{
                  opacity: [0, 1, 0],
                  x: reduce ? spark.x * 0.7 : [0, spark.x],
                  y: reduce ? spark.y * 0.7 : [0, spark.y],
                  scale: [0.3, 1.1, 0.6],
                  rotate: reduce ? 0 : 90,
                }}
                transition={{ duration: 1.1, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
              >
                <SparkleIcon size={spark.size} weight="fill" />
              </motion.span>
            ))}
          </motion.span>
        )}

        {mood === 'dizzy' && (
          <motion.span
            key="dizzy"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, rotate: reduce ? 0 : 360 }}
            exit={{ opacity: 0 }}
            transition={{ opacity: { duration: 0.2 }, rotate: { duration: 1.4, repeat: Infinity, ease: 'linear' } }}
            className="absolute -top-3 left-1/2 h-4 w-12 -translate-x-1/2"
          >
            {[0, 120, 240].map((angle) => (
              <span
                key={angle}
                className="absolute top-1/2 left-1/2 text-[#ffcc00]"
                style={{ transform: `rotate(${angle}deg) translateX(18px) rotate(-${angle}deg) translate(-50%, -50%)` }}
              >
                <StarIcon size={10} weight="fill" />
              </span>
            ))}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
