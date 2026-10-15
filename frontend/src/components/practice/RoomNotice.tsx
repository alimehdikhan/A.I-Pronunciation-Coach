import { MicrophoneIcon } from '@phosphor-icons/react'
import type { EvaluationResult } from '@/lib/types'

/** Below this the room was loud enough to cost accuracy even after cleanup. */
const NOISY_BELOW_DB = 15

/**
 * Says so when the recording had a noisy room or another voice in it, so a lower score
 * is not a mystery and the learner knows what to change.
 */
export function RoomNotice({ cleanup }: { cleanup: EvaluationResult['audio_cleanup'] }) {
  if (!cleanup) return null
  const noisy = cleanup.snr_db !== null && cleanup.snr_db < NOISY_BELOW_DB
  const voices = cleanup.background_voices > 0
  if (!noisy && !voices) return null
  return (
    <div role="status" className="results-item flex gap-3 rounded-2xl bg-warn-soft p-4 text-[14px] leading-relaxed">
      <MicrophoneIcon size={20} weight="fill" className="mt-0.5 shrink-0 text-warn" />
      <p>
        {noisy && (
          <>
            <b>Your room was noisy.</b> I filtered out the background, but a quieter spot and a microphone closer to your
            mouth give the most accurate score.{' '}
          </>
        )}
        {voices && (
          <>
            <b>Another voice was in the background.</b> I turned it down so only yours was scored.
          </>
        )}
      </p>
    </div>
  )
}
