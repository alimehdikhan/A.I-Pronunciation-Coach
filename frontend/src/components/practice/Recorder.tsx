import { QuestionIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { LazySiriOrb as SiriOrb } from '@/components/orb/LazySiriOrb'
import type { OrbState } from '@/components/orb/SiriOrb'
import { OrbGuide, OrbPulse, type OrbGuideStep } from '@/components/practice/OrbGuide'
import { Kbd } from '@/components/ui/kbd'
import { recordingSupported, type Recording, type RecorderState } from '@/hooks/useRecorder'
import { createAnalyserReader, MIC_GAIN, OUTPUT_GAIN } from '@/lib/audio'
import { outputAnalyserRef, useVoiceStore } from '@/lib/audioEngine'
import { cn, formatDuration } from '@/lib/utils'
import { useSettings } from '@/store/settings'

const ANALYSIS_STEPS = ['Uploading', 'Transcribing with Whisper', 'Aligning phonemes', 'Scoring your delivery']

function AnalyzingLabel() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setStep((s) => Math.min(s + 1, ANALYSIS_STEPS.length - 1)), 1300)
    return () => window.clearInterval(id)
  }, [])
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={step}
        className="text-ai font-semibold"
        initial={{ opacity: 0, y: 4, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: -4, filter: 'blur(4px)' }}
        transition={{ duration: 0.3 }}
      >
        {ANALYSIS_STEPS[step]}…
      </motion.span>
    </AnimatePresence>
  )
}

const ORB_SIZE = 152

export function Recorder({
  state,
  elapsed,
  maxSeconds,
  analyserRef,
  analyzing,
  disabled,
  disabledReason,
  onToggle,
  onUpload,
}: {
  state: RecorderState
  elapsed: number
  maxSeconds: number
  analyserRef: React.RefObject<AnalyserNode | null>
  analyzing: boolean
  disabled?: boolean
  disabledReason?: string
  onToggle: () => void
  onUpload?: (recording: Recording) => void
}) {
  const recording = state === 'recording'
  const fileInput = useRef<HTMLInputElement>(null)
  const busy = analyzing || state === 'requesting'
  const readMic = useMemo(() => createAnalyserReader(analyserRef, MIC_GAIN, true), [analyserRef])
  const readOutput = useMemo(() => createAnalyserReader(outputAnalyserRef, OUTPUT_GAIN), [])
  const voiceActive = useVoiceStore((s) => s.active)
  // Listening follows the microphone; speaking follows what the coach plays.
  const orbState: OrbState = analyzing ? 'thinking' : recording ? 'listening' : voiceActive ? 'speaking' : 'idle'
  const getAudioFrame = recording ? readMic : voiceActive ? readOutput : undefined
  const interactive = recording || (!disabled && !busy)

  // First-time tips that follow the learner through one real recording.
  const guideSeen = useSettings((s) => s.orbGuideSeen)
  const setGuideSeen = useSettings((s) => s.setOrbGuideSeen)
  const guideId = useId()
  const guideStep: OrbGuideStep | null =
    guideSeen || !recordingSupported
      ? null
      : analyzing
        ? 'wait'
        : recording
          ? 'speak'
          : state === 'requesting'
            ? 'allow'
            : disabled
              ? null
              : 'tap'

  const label = analyzing ? (
    <AnalyzingLabel />
  ) : recording ? (
    'Listening — tap the orb when you’re done'
  ) : state === 'requesting' ? (
    'Allow microphone access…'
  ) : disabled ? (
    disabledReason
  ) : (
    'Tap to speak'
  )

  return (
    <div className="flex flex-col items-center gap-5">
      <OrbGuide step={guideStep} id={guideId} onSkip={() => setGuideSeen(true)} />

      <motion.button
        type="button"
        onClick={interactive ? onToggle : undefined}
        disabled={!interactive}
        aria-label={recording ? 'Stop recording' : analyzing ? 'Analysing' : 'Start recording'}
        aria-describedby={guideStep ? guideId : undefined}
        className={cn(
          'relative rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring/40 focus-visible:ring-offset-4 focus-visible:ring-offset-card',
          !interactive && (analyzing ? 'cursor-progress' : 'cursor-not-allowed'),
        )}
        animate={{ opacity: disabled && !recording ? 0.5 : 1, filter: disabled && !recording ? 'saturate(0.2)' : 'saturate(1)' }}
        whileHover={interactive ? { scale: 1.03 } : undefined}
        whileTap={interactive ? { scale: 0.97 } : undefined}
        transition={{ type: 'spring', bounce: 0.3, duration: 0.5 }}
      >
        <SiriOrb size={ORB_SIZE} state={orbState} getAudioFrame={getAudioFrame} />
        {guideStep === 'tap' && <OrbPulse size={ORB_SIZE} />}
      </motion.button>

      <div className="flex min-h-11 flex-col items-center gap-1.5 text-center">
        <div className={cn('text-[15px] font-medium', recording ? 'text-foreground' : 'text-muted-foreground')}>{label}</div>
        {recording ? (
          <div className="flex items-center gap-2 font-mono text-xs text-subtle tabular-nums">
            <span className="size-1.5 animate-pulse rounded-full bg-[#ff3b30]" />
            {formatDuration(elapsed)} / {formatDuration(maxSeconds)}
          </div>
        ) : (
          !analyzing && (
            <div className="flex items-center gap-3 text-xs text-subtle">
              <span className="hidden items-center gap-1.5 sm:flex">
                or press <Kbd>Space</Kbd>
              </span>
              {onUpload && (
                <>
                  <span className="hidden size-[3px] rounded-full bg-subtle sm:block" />
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={disabled || busy}
                    className="inline-flex items-center gap-1 font-medium text-primary transition-opacity hover:opacity-80 disabled:opacity-40"
                  >
                    <UploadSimpleIcon size={13} weight="bold" /> Upload a recording
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="audio/*,.webm,.ogg,.m4a,.mp3,.wav,.flac"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) onUpload({ blob: file, filename: file.name, duration: 0 })
                    }}
                  />
                </>
              )}
              {recordingSupported && !guideStep && (
                <>
                  <span className="size-[3px] rounded-full bg-subtle" />
                  <button
                    type="button"
                    onClick={() => setGuideSeen(false)}
                    className="inline-flex items-center gap-1 font-medium text-primary transition-opacity hover:opacity-80"
                  >
                    <QuestionIcon size={13} weight="bold" /> How it works
                  </button>
                </>
              )}
            </div>
          )
        )}
        {!recordingSupported && (
          <div className="text-xs text-warn">Live recording isn’t available in this browser. Upload a recording instead.</div>
        )}
      </div>
    </div>
  )
}
