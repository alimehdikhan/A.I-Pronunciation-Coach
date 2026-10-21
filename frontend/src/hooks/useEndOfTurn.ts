import { useEffect, useRef, useState } from 'react'
import type { AudioFrame } from '@/components/orb/SiriOrb'

/** How long a pause means "I'm done", in milliseconds. */
export const PATIENCE_MS = { short: 1800, normal: 2800, long: 4500 } as const
export type Patience = keyof typeof PATIENCE_MS

const TICK_MS = 100
/** Below this level nothing counts as speech, however quiet the room. */
const MIN_VOICE_LEVEL = 0.06

/**
 * Notices when someone has finished speaking: they spoke for at least `minSpeechMs`, then stayed
 * quiet for `patienceMs`. Silence before the first words never ends the turn. The speech threshold
 * follows the room: it sits well above the quietest recent level, so steady background noise
 * isn't taken for talking.
 *
 * `finishing` runs from 0 to 1 during the closing pause, for a "keep talking to continue" cue.
 */
export function useEndOfTurn({
  active,
  readLevel,
  patienceMs,
  minSpeechMs = 1200,
  onEnd,
}: {
  active: boolean
  readLevel: () => AudioFrame | null
  patienceMs: number
  minSpeechMs?: number
  onEnd: () => void
}): { finishing: number; heardSpeech: boolean } {
  const [finishing, setFinishing] = useState(0)
  const [heardSpeech, setHeardSpeech] = useState(false)
  const end = useRef(onEnd)
  end.current = onEnd

  useEffect(() => {
    setFinishing(0)
    setHeardSpeech(false)
    if (!active) return
    let floor = 0.02
    let spokenMs = 0
    let quietMs = 0
    let shown = 0
    let done = false
    const timer = window.setInterval(() => {
      if (done) return
      const level = readLevel()?.level ?? 0
      // The quiet level of the room: falls at once, rises slowly.
      floor = level < floor ? level : floor + (level - floor) * 0.01
      const voiced = level > Math.max(MIN_VOICE_LEVEL, floor * 3 + 0.03)
      if (voiced) {
        spokenMs += TICK_MS
        quietMs = 0
        if (spokenMs === TICK_MS) setHeardSpeech(true)
      } else if (spokenMs >= minSpeechMs) {
        quietMs += TICK_MS
      }
      const progress = spokenMs >= minSpeechMs ? Math.min(1, quietMs / patienceMs) : 0
      // Re-render only when the cue visibly changes.
      const step = Math.round(progress * 10) / 10
      if (step !== shown) {
        shown = step
        setFinishing(step)
      }
      if (progress >= 1) {
        done = true
        end.current()
      }
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [active, readLevel, patienceMs, minSpeechMs])

  return { finishing, heardSpeech }
}
