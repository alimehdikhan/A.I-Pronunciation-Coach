import { ListIcon, MicrophoneIcon, PhoneDisconnectIcon, SpinnerGapIcon, StopIcon } from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CallButton, CallTimer, SpeakingBars, YouTile } from '@/components/interview/callParts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useRecorder, type Recording } from '@/hooks/useRecorder'
import { api } from '@/lib/api'
import { createAnalyserReader, MIC_GAIN } from '@/lib/audio'
import { useVoiceStore } from '@/lib/audioEngine'
import { showError } from '@/lib/errors'
import { useSpeaker } from '@/lib/speech'
import type { GdTopics, GdTurn } from '@/lib/types'
import { cn, initials } from '@/lib/utils'
import { useSettings } from '@/store/settings'

export type GdLength = 'short' | 'standard'
export const GD_LENGTHS: Record<GdLength, { turns: number; minutes: number; label: string }> = {
  short: { turns: 8, minutes: 5, label: 'Short · about 5 minutes' },
  standard: { turns: 12, minutes: 8, label: 'Standard · about 8 minutes' },
}

/** Seconds the learner has to open the discussion before someone else does. */
const OPEN_WINDOW = 6
/** A beat between speakers: room to jump in, as in a real discussion. */
const GAP_MS = 1300
const SPEAK_KEY = 'gd'

const COLOURS: Record<string, string> = {
  Priya: 'from-[#ff9f0a] to-[#ff375f]',
  Rahul: 'from-[#30d158] to-[#0a84ff]',
  Meera: 'from-[#bf5af2] to-[#5e5ce6]',
}

type Persona = GdTopics['personas'][number]

/** One participant's window in the call. */
function PersonTile({ name, speaking, holding }: { name: string; speaking: boolean; holding: boolean }) {
  return (
    <div
      className={cn(
        'relative grid aspect-[4/3] place-items-center overflow-hidden rounded-2xl bg-[#1d1d21] ring-1 transition-[box-shadow] duration-200',
        holding ? 'ring-2 ring-good' : 'ring-white/10',
      )}
    >
      <span
        className={cn(
          'grid size-14 place-items-center rounded-full bg-gradient-to-br text-[18px] font-semibold text-white transition-transform duration-300 ease-out sm:size-16',
          COLOURS[name] ?? 'from-[#636366] to-[#48484a]',
          speaking && 'scale-110',
        )}
      >
        {initials(name)}
      </span>
      <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[12px] font-medium text-white">
        {speaking && <SpeakingBars />}
        {name}
      </span>
    </div>
  )
}

/**
 * A group discussion as a video call: three participants and the learner, with Alex moderating.
 * Participants speak in turn and react to what was said; the learner can jump in at any moment,
 * even mid-sentence. At the end Alex asks the learner to summarise.
 */
export function GdRoom({
  topic,
  personas,
  length,
  onDone,
  onExit,
}: {
  topic: { id: string; title: string }
  personas: Persona[]
  length: GdLength
  onDone: (turns: GdTurn[]) => void
  onExit: () => void
}) {
  const username = useSettings((s) => s.username)
  const displayName = useSettings((s) => s.displayName)
  const userName = ((displayName || username).trim().split(/\s+/)[0] || 'You').slice(0, 40)
  const budget = GD_LENGTHS[length]
  const { say, stop: stopVoice, prefetch } = useSpeaker()
  const voiceActive = useVoiceStore((s) => s.active)

  const [turns, setTurns] = useState<GdTurn[]>([])
  const [holder, setHolder] = useState<string | null>(null)
  const [caption, setCaption] = useState<{ speaker: string; text: string } | null>(null)
  const [phase, setPhase] = useState<'intro' | 'open' | 'flow' | 'scoring' | 'summary' | 'closing'>('intro')
  const [openLeft, setOpenLeft] = useState<number | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)

  const turnsRef = useRef<GdTurn[]>([])
  const holderRef = useRef<string | null>(null)
  const step = useRef(0)
  const alive = useRef(true)
  const aiTurns = useRef(0)
  const startedAt = useRef(0)
  const lastAi = useRef<string | null>(null)
  const cutIn = useRef(false)
  const summarising = useRef(false)
  const upcoming = useRef<{ at: number; speaker: string; text: Promise<string | null> } | null>(null)

  const contribution = useMutation({ mutationFn: api.gdContribution })
  const recorder = useRecorder({
    maxSeconds: 90,
    minSeconds: 0.5,
    onRecorded: (clip) => submit(clip),
    onError: (message) => {
      toast.error(message)
      resume()
    },
  })
  const recording = recorder.state === 'recording'
  const readLevel = useMemo(() => createAnalyserReader(recorder.analyserRef, MIC_GAIN), [recorder.analyserRef])

  const voiceOf = (name: string) => personas.find((p) => p.name === name)?.voice
  const push = (turn: GdTurn) => {
    turnsRef.current = [...turnsRef.current, turn]
    setTurns(turnsRef.current)
  }
  const hold = (name: string | null) => {
    holderRef.current = name
    setHolder(name)
  }
  const wait = (ms: number, mine: number) =>
    new Promise<boolean>((resolve) => window.setTimeout(() => resolve(step.current === mine && alive.current), ms))

  /** Whoever has spoken least recently, never the same person twice in a row. */
  function pickNext(): string {
    const spoken = turnsRef.current.map((t) => t.speaker)
    return personas
      .map((p) => p.name)
      .filter((name) => name !== lastAi.current)
      .sort((a, b) => spoken.lastIndexOf(a) - spoken.lastIndexOf(b))[0]
  }

  function fetchTurn(speaker: string): Promise<string | null> {
    return api
      .gdTurn({ topic_id: topic.id, speaker, user_name: userName, turns: turnsRef.current })
      .then((reply) => {
        void prefetch(reply.text, 1, voiceOf(speaker), 'none')
        return reply.text
      })
      .catch(() => null)
  }

  /** While one participant talks, the next one gets ready, so there is no silence between turns. */
  function prepareNext() {
    const speaker = pickNext()
    upcoming.current = { at: turnsRef.current.length, speaker, text: fetchTurn(speaker) }
  }

  const timeUp = () => aiTurns.current >= budget.turns || (Date.now() - startedAt.current) / 60000 >= budget.minutes

  async function aiTurn(speaker: string, ready?: Promise<string | null>) {
    const mine = ++step.current
    setPhase('flow')
    hold(speaker)
    const text = await (ready ?? fetchTurn(speaker))
    if (step.current !== mine || !alive.current) return
    if (!text) {
      hold(null)
      toast.error('Couldn’t reach the discussion. Trying again.')
      if (await wait(2500, mine)) next()
      return
    }
    push({ speaker, text, you: false })
    lastAi.current = speaker
    aiTurns.current += 1
    setCaption({ speaker, text })
    prepareNext()
    await say(text, { key: SPEAK_KEY, voice: voiceOf(speaker), store: 'none' })
    if (step.current !== mine || !alive.current) return
    hold(null)
    if (await wait(GAP_MS, mine)) next()
  }

  function next() {
    if (timeUp()) {
      void askSummary()
      return
    }
    const ready = upcoming.current
    upcoming.current = null
    if (ready && ready.at === turnsRef.current.length) void aiTurn(ready.speaker, ready.text)
    else void aiTurn(pickNext())
  }

  /** Alex, the moderator, speaks with the coach voice. */
  async function moderator(text: string, mine: number) {
    hold('Alex')
    setCaption({ speaker: 'Alex', text })
    push({ speaker: 'Alex', text, you: false })
    await say(text, { key: SPEAK_KEY, store: 'none' })
    return step.current === mine && alive.current
  }

  async function open() {
    const mine = ++step.current
    startedAt.current = Date.now()
    const welcome = `Welcome, everyone. I'm Alex, and I'll be moderating. Today's topic is: ${topic.title}. You have about ${budget.minutes} minutes. Who would like to start?`
    const first = personas[0].name
    upcoming.current = { at: 1, speaker: first, text: fetchTurn(first) }
    if (!(await moderator(welcome, mine))) return
    hold(null)
    setPhase('open')
    setOpenLeft(OPEN_WINDOW)
  }

  async function askSummary() {
    const mine = ++step.current
    summarising.current = true
    setPhase('summary')
    if (!(await moderator(`We're almost out of time. ${userName}, would you like to summarise the discussion for us?`, mine))) return
    hold(null)
  }

  async function closing() {
    const mine = ++step.current
    setPhase('closing')
    if (!(await moderator('Thank you, everyone. That was a good discussion.', mine))) return
    onDone(turnsRef.current)
  }

  function resume() {
    if (summarising.current) void closing()
    else {
      setPhase('flow')
      next()
    }
  }

  /** The learner takes the floor, cutting in if someone is mid-sentence. */
  function jumpIn() {
    if (recording) {
      recorder.stop()
      return
    }
    if (phase === 'scoring' || phase === 'closing' || recorder.state !== 'idle') return
    cutIn.current = !!holderRef.current && holderRef.current !== 'Alex' && useVoiceStore.getState().active
    step.current++
    stopVoice()
    setOpenLeft(null)
    upcoming.current = null
    hold('You')
    void recorder.start()
  }

  function submit(clip: Recording) {
    const mine = ++step.current
    const wasCut = cutIn.current
    const isSummary = summarising.current
    cutIn.current = false
    setPhase('scoring')
    hold(null)
    contribution.mutate(
      { audio: clip.blob, filename: clip.filename },
      {
        onSuccess: (result) => {
          if (step.current !== mine || !alive.current) return
          if (result.no_speech) {
            toast('We didn’t hear that. Jump in again whenever you like.')
            resume()
            return
          }
          push({
            speaker: userName,
            text: result.text,
            you: true,
            seconds: result.delivery?.duration ?? null,
            cut_in: wasCut,
            summary: isSummary,
            delivery: result.delivery,
          })
          setCaption({ speaker: 'You', text: result.text })
          resume()
        },
        onError: (error) => {
          if (step.current !== mine || !alive.current) return
          showError(error)
          resume()
        },
      },
    )
  }

  function end() {
    setConfirmEnd(false)
    step.current++
    stopVoice()
    recorder.cancel()
    if (turnsRef.current.some((t) => t.you)) onDone(turnsRef.current)
    else onExit()
  }

  useEffect(() => {
    alive.current = true
    void open()
    return () => {
      alive.current = false
      step.current++
      stopVoice()
    }
    // Runs once per discussion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The opening window: the learner can start the discussion; otherwise the first participant does.
  useEffect(() => {
    if (openLeft == null || phase !== 'open') return
    if (openLeft <= 0) {
      setOpenLeft(null)
      next()
      return
    }
    const timer = window.setTimeout(() => setOpenLeft((s) => (s == null ? s : s - 1)), 1000)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openLeft, phase])

  useHotkeys({ ' ': jumpIn, t: () => setShowTranscript((v) => !v) }, !confirmEnd)

  const busy = phase === 'scoring' || phase === 'closing'
  const hint =
    phase === 'open' && openLeft != null
      ? `Jump in now to start the discussion · ${openLeft}`
      : phase === 'summary' && !recording && holder == null
        ? 'Summarise both sides in two or three sentences.'
        : recording
          ? 'You have the floor. Press Space when you’ve made your point.'
          : phase === 'scoring'
            ? 'Listening back…'
            : 'Jump in whenever you have something to add.'

  return (
    <div className="space-y-5">
      <section
        aria-label="Group discussion"
        className="dark overflow-hidden rounded-[28px] bg-[#0b0b0d] text-foreground shadow-[0_30px_80px_-40px_rgb(0_0_0/0.6)] ring-1 ring-white/10"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="size-2 shrink-0 rounded-full bg-[#ff453a] motion-safe:animate-pulse" aria-hidden />
            <span className="truncate font-medium text-white/90">{topic.title}</span>
            <CallTimer />
          </div>
          <span className={cn('flex items-center gap-1.5 text-[13px] font-medium', holder === 'Alex' ? 'text-white' : 'text-white/55')}>
            {holder === 'Alex' && voiceActive && <SpeakingBars />} Alex · Moderator
          </span>
        </div>

        <div className="mx-2 grid grid-cols-2 gap-2 sm:mx-3 lg:grid-cols-4">
          {personas.map((p) => (
            <PersonTile key={p.name} name={p.name} holding={holder === p.name} speaking={holder === p.name && voiceActive} />
          ))}
          <div className={cn('rounded-2xl ring-2 transition-[box-shadow] duration-200', recording ? 'ring-good' : 'ring-transparent')}>
            <YouTile name={userName} live={recording} readLevel={readLevel} className="w-full rounded-2xl sm:w-full" />
          </div>
        </div>

        <div className="px-4 pt-4 sm:px-8">
          <div className="mx-auto min-h-[84px] max-w-3xl text-center" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              {caption && (
                <motion.p
                  key={`${caption.speaker}-${turns.length}`}
                  initial={{ opacity: 0, transform: 'translateY(6px)' }}
                  animate={{ opacity: 1, transform: 'translateY(0px)' }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                  className="text-[16px] leading-relaxed text-white sm:text-[19px]"
                >
                  <span className="font-semibold text-white/60">{caption.speaker}: </span>
                  {caption.text}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="px-4 pt-3 pb-5 sm:px-8 sm:pb-6">
          <p className="text-center text-[13px] text-white/60" role="status">
            {hint}
          </p>
          <div className="mt-4 flex items-start justify-center gap-2.5 sm:gap-5">
            <CallButton label="Transcript" hotkey="T" pressed={showTranscript} onClick={() => setShowTranscript((v) => !v)}>
              <ListIcon size={20} weight="bold" />
            </CallButton>
            <div className="flex flex-col items-center gap-1.5">
              <Button
                size="lg"
                onClick={jumpIn}
                disabled={busy || recorder.state === 'requesting'}
                className={cn('h-12 rounded-full px-5 text-[15px] sm:h-14 sm:px-7', recording && 'bg-bad hover:bg-bad/90')}
              >
                {phase === 'scoring' ? (
                  <>
                    <SpinnerGapIcon className="motion-safe:animate-spin" /> Listening…
                  </>
                ) : recording ? (
                  <>
                    <StopIcon weight="fill" /> Done
                  </>
                ) : phase === 'summary' ? (
                  <>
                    <MicrophoneIcon weight="fill" /> Summarise
                  </>
                ) : (
                  <>
                    <MicrophoneIcon weight="fill" /> Jump in
                  </>
                )}
              </Button>
              <span className="hidden text-[11px] text-white/45 sm:block">Space</span>
            </div>
            {phase === 'summary' && !recording ? (
              <CallButton label="Skip" onClick={() => void closing()}>
                <span className="text-[13px] font-semibold">Skip</span>
              </CallButton>
            ) : (
              <CallButton label="End" danger onClick={() => (turnsRef.current.some((t) => t.you) ? setConfirmEnd(true) : end())}>
                <PhoneDisconnectIcon size={20} weight="fill" />
              </CallButton>
            )}
          </div>
        </div>
      </section>

      {showTranscript && (
        <section aria-label="Transcript" className="surface p-5 sm:p-7">
          <h3 className="text-[15px] font-semibold">Transcript</h3>
          <ol className="mt-3 space-y-2.5">
            {turns.map((t, i) => (
              <li key={i} className={cn('rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed', t.you ? 'bg-primary-soft' : 'bg-fill')}>
                <span className="font-semibold">{t.you ? 'You' : t.speaker}</span>
                {t.cut_in && <span className="ml-1.5 text-[12px] text-warn">cut in</span>}
                {t.summary && <span className="ml-1.5 text-[12px] text-primary">summary</span>}
                <span className="text-muted-foreground">: </span>
                {t.text}
              </li>
            ))}
          </ol>
        </section>
      )}

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End the discussion now?</AlertDialogTitle>
            <AlertDialogDescription>You’ll get your report on what you said so far.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction onClick={end}>End and see report</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
