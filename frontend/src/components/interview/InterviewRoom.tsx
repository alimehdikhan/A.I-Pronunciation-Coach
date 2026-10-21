import {
  ArrowBendDownRightIcon,
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  ClosedCaptioningIcon,
  LightbulbIcon,
  MicrophoneIcon,
  PhoneDisconnectIcon,
  SpeakerHighIcon,
  SpinnerGapIcon,
  StopIcon,
} from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { LockedResults } from '@/components/auth/SignInGate'
import { Panel } from '@/components/common'
import { AnswerFeedback, viewFromResult } from '@/components/interview/AnswerFeedback'
import { AnswerTimer } from '@/components/interview/AnswerTimer'
import { CallButton, CallTimer, SpeakingBars, YouTile } from '@/components/interview/callParts'
import { LazySiriOrb } from '@/components/orb/LazySiriOrb'
import type { OrbState } from '@/components/orb/SiriOrb'
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
import { Kbd } from '@/components/ui/kbd'
import { PATIENCE_MS, useEndOfTurn } from '@/hooks/useEndOfTurn'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useRecorder, type Recording } from '@/hooks/useRecorder'
import { api } from '@/lib/api'
import { useVoiceCatalog } from '@/lib/queries'
import { createAnalyserReader, MIC_GAIN, OUTPUT_GAIN } from '@/lib/audio'
import { outputAnalyserRef, useVoiceStore } from '@/lib/audioEngine'
import { errorLine, showError } from '@/lib/errors'
import {
  afterSmallTalkLine,
  closingLine,
  cutInLine,
  firstQuestionLine,
  INTERVIEWER,
  nextQuestionLine,
  openingLine,
  resumeLine,
  RETRY_LINE,
  smallTalkLine,
} from '@/lib/interviewer'
import { useSpeaker } from '@/lib/speech'
import type { FollowUpId, InterviewAnswerResult, InterviewStart } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useInterviewPrefs } from '@/store/interview'
import { useSettings } from '@/store/settings'

type Phase = 'speaking' | 'thinking' | 'ready' | 'scoring' | 'feedback' | 'closing'
type FollowUp = { id: FollowUpId; text: string }

/** How long a follow-up answer usually runs (seconds); matches the server. */
const FOLLOW_UP_SECONDS: [number, number] = [15, 60]
const SPEAK_KEY = 'interviewer'
/** Silence this long while answering brings up phrases that buy time. */
const SILENCE_HINT_MS = 6000
/** Hands-free: how long a line may take to be ready in the natural voice before the quick voice says it instead. */
const READY_WAIT_MS = 1200
/** Small talk is a sentence or two. */
const SMALL_TALK_SECONDS: [number, number] = [2, 15]

/** When an interviewer would cut in: well past the usual length (sooner at a visa window). */
function cutInAt(kind: string, high: number, max: number): number {
  const limit = kind.startsWith('visa_') ? high * 1.6 : Math.max(high * 1.4, high + 25)
  return Math.min(limit, max - 5)
}

const KIND_LABEL: Record<string, string> = {
  intro: 'About you',
  motivation: 'Motivation',
  behavioural: 'A real example',
  role: 'Your field',
  strengths: 'Strengths',
  logistics: 'Practical details',
  tough: 'A tough question',
  closing: 'Your questions',
  uni_background: 'Your background',
  uni_why: 'Why this programme',
  uni_goals: 'Your goals',
  visa_background: 'Your background',
  visa_study: 'Your study plans',
  visa_funding: 'Funding',
  visa_plans: 'After you graduate',
}

/**
 * A mock interview, one question at a time. The interviewer speaks each question and listens;
 * in a real interview it follows up when an answer misses something and keeps feedback for the
 * end, in practice it gives feedback after every answer.
 *
 * Hands-free (the default): the microphone opens after each question and closes when the learner
 * pauses. In a real interview the next question then comes at once and the answer is scored in the
 * background, one answer after another; only the last answer is waited for, since the interviewer
 * may answer the candidate's own questions before saying goodbye. Live follow-ups are skipped there,
 * because asking one means waiting for the answer to be scored.
 */
export function InterviewRoom({
  session,
  startIndex,
  answered: initiallyAnswered,
  onFinish,
  onExit,
}: {
  session: InterviewStart
  startIndex: number
  /** Questions already answered (when an interview is resumed). */
  answered: number[]
  onFinish: () => void
  onExit: () => void
}) {
  const { mode, readAloud, fastSpeech, showText, autoRecord, thinkSeconds, handsFree, patience } = useInterviewPrefs()
  // A real interview, hands-free: answers are scored in the background while the interview moves on.
  const instant = handsFree && mode === 'interview'
  const username = useSettings((s) => s.username)
  const displayName = useSettings((s) => s.displayName)
  const signedIn = useSettings((s) => !!s.accountEmail)
  const { say, stop: stopVoice, prefetch } = useSpeaker()
  // The near-instant voice (Piper), when the server has it.
  const quickVoice = useVoiceCatalog().data?.voices.find((v) => v.speed === 'instant')?.id
  const voiceActive = useVoiceStore((s) => s.active)
  const voicePreparing = useVoiceStore((s) => s.preparing && s.speakingKey === SPEAK_KEY)

  const questions = session.questions
  const total = questions.length
  const [index, setIndex] = useState(startIndex)
  const [followUp, setFollowUp] = useState<FollowUp | null>(null)
  const [phase, setPhase] = useState<Phase>('speaking')
  const [results, setResults] = useState<Record<number, { main?: InterviewAnswerResult; followUp?: InterviewAnswerResult }>>({})
  const [answered, setAnswered] = useState(() => new Set(initiallyAnswered))
  const [thinkLeft, setThinkLeft] = useState<number | null>(null)
  const [tipsOpen, setTipsOpen] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [noSpeech, setNoSpeech] = useState(false)
  const [failed, setFailed] = useState<{ error: unknown; recording: Recording } | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  // The greeting, while the interview opens with small talk (real interview mode).
  const [smallTalk, setSmallTalk] = useState<string | null>(null)
  // Bumped whenever the interview moves on, so speech that finishes late can't move it again.
  const step = useRef(0)
  const alive = useRef(true)
  // Set when the interviewer cut a long answer short.
  const cutIn = useRef(false)
  // Hands-free: answers waiting to be scored, sent one after another (the server scores one at a time anyway).
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const [pending, setPending] = useState(0)

  const question = questions[index]
  const target = smallTalk ? SMALL_TALK_SECONDS : followUp ? FOLLOW_UP_SECONDS : question.target_seconds
  const askedText = smallTalk ?? (followUp ? followUp.text : question.text)
  const plan = { type: session.type, role: session.role, count: total, jobTitle: session.read?.job_title }
  const current = results[index]
  const latest = followUp ? current?.followUp : current?.main

  const answer = useMutation({ mutationFn: api.interviewAnswer })
  const recorder = useRecorder({
    maxSeconds: session.max_seconds,
    minSeconds: 0.5,
    // Small talk is never sent anywhere: the interview simply begins.
    onRecorded: (recording) => (smallTalk ? beginAfterSmallTalk() : submit(recording)),
    onError: (message) => {
      toast.error(message)
      setPhase('ready')
    },
  })
  const recording = recorder.state === 'recording'
  const requesting = recorder.state === 'requesting'

  /** The interviewer says `text`; then it is the learner's turn. */
  /**
   * The interviewer says `text`. Hands-free never waits on the voice: lines are rendered ahead of time,
   * and one that still isn't ready after READY_WAIT_MS is said with the quick voice instead.
   */
  async function interviewerSays(text: string): Promise<void> {
    const rate = fastSpeech ? 1.25 : 1
    let voice: string | undefined
    if (handsFree && quickVoice) {
      const ready = await Promise.race([
        prefetch(text, rate).then(() => true),
        new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), READY_WAIT_MS)),
      ])
      if (!ready) voice = quickVoice
    }
    await say(text, { key: SPEAK_KEY, rate, voice })
  }

  async function ask(text: string) {
    const mine = ++step.current
    setPhase('speaking')
    setTipsOpen(false)
    if (readAloud) {
      await interviewerSays(text)
      if (step.current !== mine || !alive.current) return
    }
    if (mode === 'practice' && thinkSeconds > 0) {
      setThinkLeft(thinkSeconds)
      setPhase('thinking')
      return
    }
    setPhase('ready')
    if (handsFree || (mode === 'interview' && autoRecord)) void recorder.start()
  }

  function startAnswer() {
    step.current++
    stopVoice()
    setThinkLeft(null)
    setFailed(null)
    setPhase('ready')
    void recorder.start()
  }

  function beginAfterSmallTalk() {
    setSmallTalk(null)
    void ask(`${afterSmallTalkLine(plan)} ${firstQuestionLine(questions[startIndex].text)}`)
  }

  /** `lead`: what the interviewer says first (a reply to the candidate's questions, or a cut-in). */
  async function finish(lead?: string | null) {
    const mine = ++step.current
    setPhase('closing')
    if (readAloud) await interviewerSays(`${lead ? `${lead} ` : ''}${closingLine(session.type)}`)
    if (step.current === mine && alive.current) onFinish()
  }

  /** `lead`: the interviewer's reaction to the last answer, said before the next question. */
  function advance(lead?: string | null) {
    const next = index + 1
    setFollowUp(null)
    setNoSpeech(false)
    setRevealed(false)
    if (next >= total) {
      void finish(lead)
      return
    }
    setIndex(next)
    void ask(nextQuestionLine(next, total, questions[next].text, lead))
  }

  function handleResult(result: InterviewAnswerResult) {
    const wasCut = cutIn.current
    cutIn.current = false
    if (result.no_speech) {
      setNoSpeech(true)
      if (mode === 'interview' && readAloud) void ask(RETRY_LINE)
      else setPhase('ready')
      return
    }
    setNoSpeech(false)
    // What the interviewer says next: a polite cut-in, an answer to the candidate's questions, or a reaction.
    const lead = wasCut ? cutInLine(session.type) : (result.reply ?? result.rubric?.reaction ?? null)
    if (followUp) {
      setResults((r) => ({ ...r, [index]: { ...r[index], followUp: result } }))
      if (mode === 'practice') setPhase('feedback')
      else advance(wasCut ? lead : null)
      return
    }
    setResults((r) => ({ ...r, [index]: { main: result } }))
    setAnswered((a) => new Set(a).add(index))
    if (mode === 'interview' && result.follow_up && !wasCut) {
      setFollowUp(result.follow_up)
      void ask(result.follow_up.text)
    } else if (mode === 'practice') {
      setPhase('feedback')
      if (result.reply && readAloud) void say(result.reply, { key: SPEAK_KEY, rate: fastSpeech ? 1.25 : 1 })
    } else advance(lead)
  }

  function answerPayload(clip: Recording, q: typeof question, follow: FollowUp | null) {
    return {
      audio: clip.blob,
      filename: clip.filename,
      questionId: q.id,
      custom: q.id.startsWith('cv-') ? { text: q.text, kind: q.kind } : undefined,
      type: session.type,
      role: session.role,
      level: session.level,
      sessionId: session.id,
      questionIndex: q.index,
      username: session.saved ? username : undefined,
      followUp: follow,
    }
  }

  /** Score an answer in the background, after any still waiting; a failed send is retried twice. */
  function scoreInBackground(clip: Recording, at: number): Promise<InterviewAnswerResult | null> {
    const q = questions[at]
    setPending((n) => n + 1)
    const run = async (): Promise<InterviewAnswerResult | null> => {
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await api.interviewAnswer(answerPayload(clip, q, null))
          if (alive.current) {
            if (result.no_speech) {
              setAnswered((a) => {
                const next = new Set(a)
                next.delete(at)
                return next
              })
            } else setResults((r) => ({ ...r, [at]: { main: result } }))
          }
          return result
        } catch (error) {
          if (attempt >= 2) {
            if (alive.current) toast.error(`Your answer to question ${at + 1} couldn’t be scored. ${errorLine(error)}`)
            return null
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1500 * (attempt + 1)))
        }
      }
    }
    const done = queue.current.then(run).finally(() => setPending((n) => n - 1))
    queue.current = done.catch(() => null)
    return done
  }

  /** Hands-free, real interview: send the answer off and carry straight on. */
  function sendAndMoveOn(clip: Recording) {
    const at = index
    const wasCut = cutIn.current
    cutIn.current = false
    setAnswered((a) => new Set(a).add(at))
    const scored = scoreInBackground(clip, at)
    if (at + 1 < total) {
      advance(wasCut ? cutInLine(session.type) : null)
      return
    }
    // The last answer: wait for it (the interviewer may answer the candidate's questions) and for any others.
    const mine = ++step.current
    setPhase('scoring')
    void scored.then(async (result) => {
      await queue.current
      if (step.current !== mine || !alive.current) return
      void finish(wasCut ? cutInLine(session.type) : (result?.reply ?? null))
    })
  }

  function submit(clip: Recording) {
    if (instant && !followUp) {
      sendAndMoveOn(clip)
      return
    }
    const mine = step.current
    setPhase('scoring')
    setFailed(null)
    answer.mutate(
      answerPayload(clip, question, followUp),
      {
        onSuccess: (result) => {
          if (step.current === mine && alive.current) handleResult(result)
        },
        onError: (error) => {
          if (step.current !== mine || !alive.current) return
          setFailed({ error, recording: clip })
          setPhase('ready')
          showError(error)
        },
      },
    )
  }

  // Opening: small talk in a real interview, then the interviewer explains what happens and asks the first question.
  useEffect(() => {
    alive.current = true
    const first = questions[startIndex]
    const name = (displayName || username).trim().split(/\s+/)[0] ?? ''
    const greeting = startIndex === 0 && mode === 'interview' && readAloud ? smallTalkLine({ name, type: session.type }) : null
    if (greeting) {
      setSmallTalk(greeting)
      void ask(greeting)
    } else {
      void ask(startIndex === 0 ? `${openingLine({ name, ...plan })} ${firstQuestionLine(first.text)}` : resumeLine(first.text))
    }
    // The voice takes seconds per sentence on a small server, so render everything the interviewer will
    // say next, one line after another, while the learner is still talking: each question then starts
    // the moment the previous answer ends.
    let cancelled = false
    if (readAloud) {
      const rate = fastSpeech ? 1.25 : 1
      const lines = [
        ...(greeting ? [`${afterSmallTalkLine(plan)} ${firstQuestionLine(first.text)}`] : []),
        ...questions.slice(startIndex + 1).map((q, k) => nextQuestionLine(startIndex + 1 + k, total, q.text)),
        closingLine(session.type),
      ]
      void (async () => {
        for (const line of lines) {
          if (cancelled) return
          await prefetch(line, rate)
        }
      })()
    }
    return () => {
      cancelled = true
      alive.current = false
      step.current++
      stopVoice()
    }
    // Runs once per interview; `ask` reads the settings fixed when it started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Thinking time (practice): counts down, then it is the learner's turn.
  useEffect(() => {
    if (thinkLeft == null) return
    if (thinkLeft <= 0) {
      setThinkLeft(null)
      setPhase('ready')
      if (handsFree) void recorder.start()
      return
    }
    const timer = window.setTimeout(() => setThinkLeft((s) => (s == null ? s : s - 1)), 1000)
    return () => window.clearTimeout(timer)
    // `recorder.start` is stable for the recorder's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thinkLeft, handsFree])

  // A real interviewer cuts in when an answer runs far past its usual length.
  useEffect(() => {
    if (!recording || mode !== 'interview' || smallTalk || cutIn.current) return
    if (recorder.elapsed > cutInAt(followUp ? 'follow_up' : question.kind, target[1], session.max_seconds)) {
      cutIn.current = true
      recorder.stop()
    }
  }, [recording, recorder, mode, smallTalk, followUp, question.kind, target, session.max_seconds])

  // An interview that isn't saved would be lost on reload.
  useEffect(() => {
    if (session.saved || answered.size === 0) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [session.saved, answered.size])

  function primary() {
    if (recording) recorder.stop()
    else if (phase === 'speaking' || phase === 'thinking' || phase === 'ready') startAnswer()
  }

  function repeat() {
    if (requesting || phase === 'scoring' || phase === 'closing') return
    if (recording) {
      // Hands-free keeps the microphone open for the whole turn: hearing the question again starts it over.
      if (!handsFree) return
      recorder.cancel()
    }
    void ask(askedText)
  }

  function endInterview() {
    setConfirmEnd(false)
    const mine = ++step.current
    stopVoice()
    recorder.cancel()
    if (answered.size === 0) {
      onExit()
      return
    }
    // Hands-free answers may still be on their way: the report should include them.
    setPhase('closing')
    void queue.current.then(() => {
      if (step.current === mine && alive.current) onFinish()
    })
  }

  useHotkeys(
    {
      ' ': primary,
      r: repeat,
      t: () => mode === 'practice' && !followUp && setTipsOpen((open) => !open),
      n: () => phase === 'feedback' && advance(),
    },
    !confirmEnd,
  )

  const readMic = useMemo(() => createAnalyserReader(recorder.analyserRef, MIC_GAIN, true), [recorder.analyserRef])
  // A plain (not adaptive) level reader for spotting silence.
  const readLevel = useMemo(() => createAnalyserReader(recorder.analyserRef, MIC_GAIN), [recorder.analyserRef])

  // Hands-free: a pause after speaking ends the answer (small talk is a sentence, so it ends sooner).
  const { finishing } = useEndOfTurn({
    active: recording && handsFree,
    readLevel,
    patienceMs: smallTalk ? PATIENCE_MS.short : PATIENCE_MS[patience],
    onEnd: () => recorder.stop(),
  })

  // While the learner answers, fetch what the interviewer says next, so it plays the moment they finish.
  useEffect(() => {
    if (!recording || !readAloud || smallTalk || followUp) return
    const next = index + 1
    void prefetch(next < total ? nextQuestionLine(next, total, questions[next].text) : closingLine(session.type), fastSpeech ? 1.25 : 1)
    // Only when an answer starts; the lines depend on nothing else that changes meanwhile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, index])

  // Going blank happens to everyone: after a long silence mid-answer, offer a way to buy time.
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    if (!recording) {
      setStuck(false)
      return
    }
    let lastVoice = performance.now()
    const timer = window.setInterval(() => {
      if ((readLevel()?.level ?? 0) > 0.1) lastVoice = performance.now()
      setStuck(performance.now() - lastVoice > SILENCE_HINT_MS)
    }, 250)
    return () => window.clearInterval(timer)
  }, [recording, readLevel])
  const readOutput = useMemo(() => createAnalyserReader(outputAnalyserRef, OUTPUT_GAIN), [])
  const orbState: OrbState = phase === 'scoring' || voicePreparing ? 'thinking' : recording ? 'listening' : voiceActive ? 'speaking' : 'idle'

  const status =
    phase === 'speaking'
      ? `${INTERVIEWER.name} is asking…`
      : phase === 'thinking'
        ? `Think about your answer · ${thinkLeft ?? 0} s`
        : phase === 'scoring'
          ? mode === 'interview'
            ? `${INTERVIEWER.name} is noting your answer${pending > 1 ? 's' : ''}…`
            : 'Listening back to your answer…'
          : phase === 'closing'
            ? 'Wrapping up…'
            : requesting
              ? 'Opening your microphone…'
              : recording
                ? handsFree
                  ? finishing > 0
                    ? 'Finishing… keep talking to continue'
                    : 'Listening. Pause when you’re done.'
                  : 'Listening. Take your time.'
                : phase === 'feedback'
                  ? 'Here’s how that went'
                  : 'Your turn'

  const showQuestion = showText || revealed || !readAloud
  const feedbackView = phase === 'feedback' && current?.main?.delivery ? viewFromResult(current.main, current.followUp) : null

  const label = smallTalk
    ? 'Before we start'
    : followUp
      ? 'Follow-up'
      : `Question ${index + 1} · ${KIND_LABEL[question.kind] ?? 'Question'}${question.about ? ` · ${question.about}` : ''}`
  const canAct = !(recording || requesting || phase === 'scoring' || phase === 'closing')

  return (
    <div className="space-y-5">
      {/* A video call: the interviewer fills the stage, you are the small window, the question is the caption. */}
      <section
        aria-label="Interview"
        className="dark overflow-hidden rounded-[28px] bg-[#0b0b0d] text-foreground shadow-[0_30px_80px_-40px_rgb(0_0_0/0.6)] ring-1 ring-white/10"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="size-2 shrink-0 rounded-full bg-[#ff453a] motion-safe:animate-pulse" aria-hidden />
            <span className="truncate font-medium text-white/90">
              {session.type_label}
              {session.role_label ? ` · ${session.role_label}` : ''}
            </span>
            <CallTimer />
          </div>
          <div className="flex items-center gap-3">
            {pending > 0 && phase !== 'scoring' && (
              <span className="flex items-center gap-1.5 text-[12px] text-white/55" title="Your answers are scored while the interview goes on">
                <SpinnerGapIcon className="motion-safe:animate-spin" /> Noting {pending} answer{pending === 1 ? '' : 's'}
              </span>
            )}
            <span className="text-[13px] font-medium text-white/70 tabular-nums">
              {index + 1} of {total}
            </span>
            <span className="hidden gap-1 sm:flex" aria-hidden>
              {questions.map((q, i) => (
                <span
                  key={q.index ?? i}
                  className={cn(
                    'h-1 w-5 rounded-full transition-colors duration-300',
                    answered.has(i) ? 'bg-primary' : i === index ? 'bg-white/45' : 'bg-white/15',
                  )}
                />
              ))}
            </span>
          </div>
        </div>

        <div className="relative mx-2 overflow-hidden rounded-[22px] bg-[radial-gradient(120%_90%_at_50%_0%,#202026_0%,#0e0e11_70%)] sm:mx-3">
          <div className="flex min-h-[440px] flex-col items-center justify-start px-4 pt-20 pb-44 sm:min-h-[480px] sm:justify-center sm:pt-16 sm:pb-44">
            <button
              type="button"
              onClick={primary}
              disabled={phase === 'scoring' || phase === 'closing' || phase === 'feedback' || requesting}
              aria-label={recording ? 'Stop answering' : 'Start answering'}
              className="rounded-full outline-none focus-visible:ring-4 focus-visible:ring-white/40 disabled:cursor-default"
            >
              <LazySiriOrb size="min(40vw, 210px)" state={orbState} theme="dark" getAudioFrame={recording ? readMic : voiceActive ? readOutput : undefined} />
            </button>
          </div>

          <div
            role="status"
            aria-live="polite"
            className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 text-[12px] font-medium text-white/90 backdrop-blur-md sm:top-4 sm:left-4"
          >
            {phase === 'scoring' && <SpinnerGapIcon className="motion-safe:animate-spin" />}
            {status}
            {recording && handsFree && finishing > 0 && (
              <span className="ml-1 h-1 w-10 overflow-hidden rounded-full bg-white/20" aria-hidden>
                <span className="block h-full rounded-full bg-white transition-[width] duration-100 ease-linear" style={{ width: `${finishing * 100}%` }} />
              </span>
            )}
          </div>

          <YouTile name={displayName || username || 'You'} live={recording} readLevel={readLevel} className="absolute top-3 right-3 sm:top-4 sm:right-4" />

          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-[13px] font-medium text-white backdrop-blur-md sm:bottom-4 sm:left-4">
            {voiceActive && <SpeakingBars />}
            {INTERVIEWER.name}
            <span className="text-white/55">Interviewer</span>
          </div>

          {/* Captions: what the interviewer is asking. */}
          <div className="absolute inset-x-3 bottom-14 flex justify-center sm:inset-x-8 sm:bottom-16">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${index}-${followUp?.id ?? 'main'}-${smallTalk ? 'hello' : 'q'}`}
                initial={{ opacity: 0, transform: 'translateY(8px)' }}
                animate={{ opacity: 1, transform: 'translateY(0px)' }}
                exit={{ opacity: 0, transform: 'translateY(-4px)' }}
                transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                className="max-w-3xl rounded-2xl bg-black/65 px-4 py-3 text-center backdrop-blur-md sm:px-6"
              >
                <div className="flex items-center justify-center gap-1.5 text-[12px] font-medium text-white/60">
                  {followUp && <ArrowBendDownRightIcon weight="bold" />}
                  {label}
                </div>
                {showQuestion ? (
                  <p className="mt-1 text-[17px] leading-snug font-semibold text-balance text-white sm:text-[22px]">{askedText}</p>
                ) : (
                  <p className="mt-1 text-[15px] text-white/75">Captions are off. Listen to {INTERVIEWER.name}.</p>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <div className="px-4 pt-5 pb-5 sm:px-8 sm:pb-6">
          {phase !== 'feedback' && phase !== 'closing' && !smallTalk && (
            <AnswerTimer elapsed={recording ? recorder.elapsed : 0} target={target} max={session.max_seconds} active={recording} />
          )}

          <div className="mt-5 flex items-start justify-center gap-2.5 sm:gap-5">
            <CallButton label="Repeat" hotkey="R" onClick={repeat} disabled={!canAct && !(handsFree && recording)}>
              <SpeakerHighIcon size={20} weight="fill" />
            </CallButton>
            <CallButton
              label="Captions"
              pressed={showQuestion}
              onClick={() => setRevealed(!showQuestion)}
              disabled={!readAloud}
            >
              <ClosedCaptioningIcon size={20} weight={showQuestion ? 'fill' : 'regular'} />
            </CallButton>
            <div className="flex flex-col items-center gap-1.5">
              <Button
                size="lg"
                onClick={primary}
                disabled={phase === 'scoring' || phase === 'closing' || phase === 'feedback' || requesting}
                className={cn('h-12 rounded-full px-5 text-[15px] sm:h-14 sm:px-7', recording && 'bg-bad hover:bg-bad/90')}
              >
                {phase === 'scoring' ? (
                  <>
                    <SpinnerGapIcon className="motion-safe:animate-spin" /> Scoring…
                  </>
                ) : recording ? (
                  <>
                    <StopIcon weight="fill" /> I’m done
                  </>
                ) : phase === 'speaking' ? (
                  <>
                    <MicrophoneIcon weight="fill" /> Answer now
                  </>
                ) : (
                  <>
                    <MicrophoneIcon weight="fill" /> {latest ? 'Answer again' : 'Answer'}
                  </>
                )}
              </Button>
              <span className="hidden text-[11px] text-white/45 sm:block">Space</span>
            </div>
            {mode === 'practice' && !followUp && !smallTalk && (
              <CallButton label="Tips" hotkey="T" pressed={tipsOpen} onClick={() => setTipsOpen((open) => !open)}>
                <LightbulbIcon size={20} weight={tipsOpen ? 'fill' : 'regular'} />
              </CallButton>
            )}
            <CallButton label="End" danger onClick={() => (answered.size > 0 ? setConfirmEnd(true) : endInterview())}>
              <PhoneDisconnectIcon size={20} weight="fill" />
            </CallButton>
          </div>

          <AnimatePresence initial={false}>
            {tipsOpen && !followUp && !smallTalk && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                className="overflow-hidden"
              >
                <div className="mx-auto mt-5 max-w-2xl rounded-2xl bg-white/[0.06] p-4">
                  <p className="text-[14px] leading-relaxed text-white/85">{question.look_for}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {question.phrases.map((phrase) => (
                      <span key={phrase} className="rounded-full bg-white/10 px-2.5 py-1 text-[13px] text-white/75">
                        {phrase}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mx-auto mt-4 max-w-2xl space-y-3 text-center">
            <AnimatePresence>
              {recording && stuck && (
                <motion.p
                  initial={{ opacity: 0, transform: 'translateY(4px)' }}
                  animate={{ opacity: 1, transform: 'translateY(0px)' }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                  className="rounded-2xl bg-white/[0.07] px-4 py-3 text-[14px] leading-relaxed text-white/85"
                >
                  Taking a moment is fine. You can say: <b className="text-white">“That’s a good question. Let me think for a second.”</b> Or
                  ask: <b className="text-white">“Could you repeat the question, please?”</b>
                </motion.p>
              )}
            </AnimatePresence>
            {failed && !recording && (
              <div className="flex flex-col items-center gap-2">
                <p className="text-[14px] text-bad">{errorLine(failed.error)}</p>
                <Button variant="secondary" size="sm" onClick={() => submit(failed.recording)}>
                  <ArrowCounterClockwiseIcon weight="bold" /> Send the same answer again
                </Button>
              </div>
            )}
            {noSpeech && !recording && phase === 'ready' && (
              <p className="text-[14px] text-warn">We didn’t hear an answer. Check your microphone, then try again.</p>
            )}
          </div>
        </div>
      </section>

      {/* Practice: feedback after every answer. */}
      {phase === 'feedback' && feedbackView && (
        <Panel className="p-5 sm:p-8">
          {current?.main?.reply && (
            <div className="mb-6 rounded-2xl bg-fill p-4">
              <div className="text-[13px] font-semibold text-muted-foreground">{INTERVIEWER.name} answered your question</div>
              <p className="mt-1 text-[15px] leading-relaxed">{current.main.reply}</p>
            </div>
          )}
          {signedIn ? <AnswerFeedback view={feedbackView} /> : <LockedResults />}
          <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-border pt-6">
            <Button size="lg" className="h-12 px-6" onClick={() => advance()}>
              {index + 1 < total ? 'Next question' : 'Finish and see your report'} <ArrowRightIcon weight="bold" />
              <Kbd className="ml-1 hidden bg-white/20 text-white sm:inline-flex">N</Kbd>
            </Button>
            <Button variant="secondary" size="lg" className="h-12" onClick={startAnswer}>
              <ArrowCounterClockwiseIcon weight="bold" /> Answer again
            </Button>
            {!followUp && current?.main?.follow_up && !current.followUp && (
              <Button
                variant="secondary"
                size="lg"
                className="h-12"
                onClick={() => {
                  setFollowUp(current.main!.follow_up)
                  void ask(current.main!.follow_up!.text)
                }}
              >
                <ArrowBendDownRightIcon weight="bold" /> Take the follow-up
              </Button>
            )}
          </div>
          {!followUp && current?.main?.follow_up && !current.followUp && (
            <p className="mt-3 text-[13px] text-muted-foreground">
              An interviewer would probably ask: “{current.main.follow_up.text}”
            </p>
          )}
        </Panel>
      )}

      <p className="text-center text-[12px] text-subtle">
        {session.saved
          ? 'Saved to your account after every answer, as text only. No audio is kept.'
          : 'This interview isn’t saved. Sign in to keep your interviews and come back to them.'}
      </p>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End the interview now?</AlertDialogTitle>
            <AlertDialogDescription>
              You’ve answered {answered.size} of {total} questions. Your report covers those answers
              {session.saved ? ', and you can come back to the rest later.' : '.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction onClick={endInterview}>End and see report</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
