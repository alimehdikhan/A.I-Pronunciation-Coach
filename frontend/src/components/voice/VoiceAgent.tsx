import {
  LightbulbIcon,
  MicrophoneIcon,
  MicrophoneSlashIcon,
  PhoneDisconnectIcon,
  ShieldCheckIcon,
  WaveformIcon,
  XIcon,
} from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LazySiriOrb } from '@/components/orb/LazySiriOrb'
import { Button } from '@/components/ui/button'
import { audioEngine } from '@/lib/audioEngine'
import { VoiceClient, type VoiceHint, type VoiceState } from '@/lib/voiceAgent'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'
import { useVoiceUI } from '@/store/voice'

const STATE_TEXT: Record<VoiceState, string> = {
  connecting: 'Connecting to your coach…',
  listening: 'Listening. Just talk.',
  thinking: 'One moment…',
  speaking: 'Your coach is speaking',
  ended: 'Conversation ended',
  error: 'Something went wrong',
}

const ORB_STATE = { connecting: 'thinking', listening: 'listening', thinking: 'thinking', speaking: 'speaking', ended: 'idle', error: 'idle' } as const

/** A spoken conversation with the coach: tap, talk, and it talks back. */
export function VoiceAgent() {
  const open = useVoiceUI((s) => s.open)
  const setOpen = useVoiceUI((s) => s.setOpen)
  const username = useSettings((s) => s.username)
  const profileKey = useSettings((s) => s.profileKey)
  const level = useSettings((s) => s.level)
  const nativeLanguage = useSettings((s) => s.nativeLanguage)
  const reduce = useReducedMotion()

  const [started, setStarted] = useState(false)
  const [state, setState] = useState<VoiceState>('connecting')
  const [coachLine, setCoachLine] = useState('')
  const [learnerLine, setLearnerLine] = useState('')
  const [hint, setHint] = useState<VoiceHint | null>(null)
  const [guard, setGuard] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const client = useRef<VoiceClient | null>(null)
  const stateRef = useRef<VoiceState>('connecting')

  const end = useCallback(() => {
    client.current?.stop()
    client.current = null
    setStarted(false)
    setOpen(false)
  }, [setOpen])

  // Leaving the screen always ends the call and releases the microphone.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && end()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      client.current?.stop()
      client.current = null
    }
  }, [open, end])

  const begin = async () => {
    audioEngine.stop() // the coach's practice voice must not talk over the conversation
    setError(null)
    setCoachLine('')
    setLearnerLine('')
    setHint(null)
    setGuard(false)
    setMuted(false)
    setStarted(true)
    const voice = new VoiceClient(
      { username, profileKey, level, nativeLanguage, voice: 'Kore' },
      {
        onState: (next) => {
          stateRef.current = next
          setState(next)
        },
        onTranscript: (role, text) => (role === 'coach' ? setCoachLine(text) : setLearnerLine(text)),
        onHint: setHint,
        onGuard: () => setGuard(true),
        onError: (message) => setError(message),
      },
    )
    client.current = voice
    await voice.start()
  }

  const getAudioFrame = useCallback(() => ({ level: client.current?.audioLevel(stateRef.current === 'speaking') ?? 0 }), [])

  if (!open) return null

  const live = started && state !== 'ended' && state !== 'error'

  return (
    <AnimatePresence>
      <motion.div
        key="voice"
        role="dialog"
        aria-modal="true"
        aria-label="Talk to your coach"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] flex flex-col items-center bg-background/95 px-5 pt-5 pb-8 backdrop-blur-xl"
      >
        <div className="flex w-full max-w-xl items-center justify-between">
          <span className="inline-flex items-center gap-2 text-[14px] font-semibold text-muted-foreground">
            <WaveformIcon size={18} weight="fill" /> Talk to your coach
          </span>
          <button
            type="button"
            onClick={end}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-full bg-fill text-muted-foreground transition-colors hover:bg-fill-strong"
          >
            <XIcon size={18} weight="bold" />
          </button>
        </div>

        <div className="flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6">
          <LazySiriOrb size="min(62vw, 280px)" state={started ? ORB_STATE[state] : 'idle'} getAudioFrame={getAudioFrame} label="Your coach" />

          {!started ? (
            <div className="text-center">
              <h2 className="headline text-[26px]">Have a conversation</h2>
              <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
                Talk about anything, like your day. Your coach answers out loud and gently helps with your pronunciation as you go.
                Headphones work best.
              </p>
              <p className="mx-auto mt-4 flex max-w-sm items-start gap-2 text-left text-xs text-subtle">
                <ShieldCheckIcon size={16} className="mt-0.5 shrink-0" weight="fill" />
                <span>
                  Your voice is sent to Google&rsquo;s Gemini service for the length of the conversation, so the coach can hear and
                  answer you. It is not saved by this app.
                </span>
              </p>
              <Button size="lg" className="mt-6" onClick={() => void begin()}>
                <MicrophoneIcon weight="fill" /> Start talking
              </Button>
            </div>
          ) : (
            <div className="w-full text-center" aria-live="polite">
              <div className="text-[13px] font-semibold text-muted-foreground">{error ?? STATE_TEXT[state]}</div>
              <p className="mt-3 min-h-[3.5rem] text-[19px] leading-snug font-medium">{coachLine}</p>
              <p className="mt-2 min-h-[1.5rem] text-[15px] text-muted-foreground">{learnerLine && `You: ${learnerLine}`}</p>
            </div>
          )}

          {hint && live && (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex w-full max-w-sm items-start gap-3 rounded-2xl bg-warn-soft p-4 text-left"
            >
              <LightbulbIcon size={20} weight="fill" className="mt-0.5 shrink-0 text-[#ff9500]" />
              <p className="text-[14px] leading-relaxed">
                <b>{hint.word}</b>
                {hint.heard ? ` sounded like “${hint.heard}”.` : ' was not very clear.'} Say it slowly once more.
              </p>
            </motion.div>
          )}
          {guard && live && <p className="text-[13px] text-muted-foreground">Let&rsquo;s keep it friendly. What would you like to practise?</p>}
        </div>

        {started && (
          <div className="flex items-center gap-4">
            <button
              type="button"
              disabled={!live}
              onClick={() => {
                const next = !muted
                setMuted(next)
                client.current?.setMuted(next)
              }}
              aria-pressed={muted}
              aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
              className={cn(
                'grid size-14 place-items-center rounded-full transition-colors disabled:opacity-50',
                muted ? 'bg-warn-soft text-warn' : 'bg-fill text-foreground hover:bg-fill-strong',
              )}
            >
              {muted ? <MicrophoneSlashIcon size={24} weight="fill" /> : <MicrophoneIcon size={24} weight="fill" />}
            </button>
            {live ? (
              <button
                type="button"
                onClick={end}
                aria-label="End the conversation"
                className="grid size-16 place-items-center rounded-full bg-[#ff3b30] text-white shadow-lg transition-transform active:scale-95"
              >
                <PhoneDisconnectIcon size={28} weight="fill" />
              </button>
            ) : (
              <Button size="lg" onClick={() => void begin()}>
                Talk again
              </Button>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
