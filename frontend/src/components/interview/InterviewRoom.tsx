import {
  ArrowBendDownRightIcon,
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  ClosedCaptioningIcon,
  LightbulbIcon,
  MicrophoneIcon,
  PhoneDisconnectIcon,
  PlayIcon,
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
import { MINUTES } from '@/components/interview/setupParts'
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
import { audioEngine, outputAnalyserRef, useVoiceStore } from '@/lib/audioEngine'
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
import { useUI } from '@/store/ui'

type Phase = 'speaking' | 'thinking' | 'ready' | 'turn' | 'scoring' | 'feedback' | 'closing'
type FollowUp = { id: FollowUpId; text: string }
type Line = { speaker: 'interviewer' | 'candidate'; text: string }
type LogEntry = { who: 'interviewer' | 'you'; text: string; followUp?: boolean }

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
 * A mock interview, one question at a time. The interviewer speaks each question and listens.
 *
 * In a real interview the interviewer hears every answer and replies the way a real one does
 * (`/api/interview/turn`, a second or two): a follow-up about something the candidate said, a simpler
 * way of asking, a nudge back to the question, or a short reaction and the next question. Each answer
 * is scored in the background meanwhile, one after another, and the report waits for the last one.
 * Feedback is kept for the end. In practice it comes after every answer, with any follow-up on request.
 *
 * Hands-free (the default): the microphone opens after each question and closes when the learner pauses.
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
  // Follow-ups asked on the current question.
  const [probes, setProbes] = useState(0)
  const [phase, setPhase] = useState<Phase>('speaking')
  const [results, setResults] = useState<Record<number, { main?: InterviewAnswerResult; followUps?: InterviewAnswerResult[] }>>({})
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
  // Answers waiting to be scored, sent one after another (the server scores one at a time anyway).
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const [pending, setPending] = useState(0)
  // What was said on the current question, and notes of earlier answers: the interviewer's memory.
  const conversation = useRef<Line[]>([])
  const earlier = useRef<{ question: string; answer: string }[]>([])
  // The whole conversation, shown under the call.
  const [log, setLog] = useState<LogEntry[]>([])
  // Nothing is said until the learner presses Start: sound can only be switched on inside a tap.
  const [begun, setBegun] = useState(false)
  const setMicCheckOpen = useUI((s) => s.setMicCheckOpen)

  const question = questions[index]
  const target = smallTalk ? SMALL_TALK_SECONDS : followUp ? FOLLOW_UP_SECONDS : question.target_seconds
  const askedText = smallTalk ?? (followUp ? followUp.text : question.text)
  const plan = { type: session.type, role: session.role, count: total, jobTitle: session.read?.job_title }
  const current = results[index]
  const latest = followUp ? current?.followUps?.at(-1) : current?.main

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

  /** The interviewer says `text` (one line, or several in turn), then it is the learner's turn. */
  async function ask(text: string | (string | null | undefined)[], { remember = true, followUp: probing = false } = {}) {
    const lines = (Array.isArray(text) ? text : [text]).filter((line): line is string => !!line)
    const mine = ++step.current
    setPhase('speaking')
    setTipsOpen(false)
    if (remember) setLog((l) => [...l, { who: 'interviewer', text: lines.join(' '), followUp: probing }])
    if (readAloud) {
      const rate = fastSpeech ? 1.25 : 1
      // A later line renders while the first one plays.
      for (const line of lines.slice(1)) void prefetch(line, rate)
      for (const line of lines) {
        await interviewerSays(line)
        if (step.current !== mine || !alive.current) return
      }
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
    conversation.current = [{ speaker: 'interviewer', text: questions[startIndex].text }]
    void ask(`${afterSmallTalkLine(plan)} ${firstQuestionLine(questions[startIndex].text)}`)
  }

  /** `lead`: what the interviewer says first (a reply to the candidate's questions, or a cut-in). */
  async function finish(lead?: string | null) {
    const mine = ++step.current
    setPhase('closing')
    const goodbye = closingLine(session.type)
    setLog((l) => [...l, { who: 'interviewer', text: [lead, goodbye].filter(Boolean).join(' ') }])
    if (readAloud) {
      if (lead) await interviewerSays(lead)
      if (step.current === mine && alive.current) await interviewerSays(goodbye)
    }
    // The report covers every answer, so it waits for any still being scored.
    await queue.current
    if (step.current === mine && alive.current) onFinish()
  }

  /** `lead`: the interviewer's reaction to the last answer, said before the next question. */
  function advance(lead?: string | null) {
    const next = index + 1
    setFollowUp(null)
    setProbes(0)
    setNoSpeech(false)
    setRevealed(false)
    if (next >= total) {
      void finish(lead)
      return
    }
    setIndex(next)
    conversation.current = [{ speaker: 'interviewer', text: questions[next].text }]
    // The question was rendered while the learner answered; the reaction plays first.
    void ask([lead, nextQuestionLine(next, total, questions[next].text)])
  }

  /** Keep a note of an answer, so a later follow-up can pick up on it (or on a clash with it). */
  function noteAnswer(at: number, text: string) {
    const asked = questions[at].text
    const notes = earlier.current
    const last = notes[notes.length - 1]
    earlier.current =
      last && last.question === asked
        ? [...notes.slice(0, -1), { question: asked, answer: `${last.answer} ${text}`.slice(0, 600) }]
        : [...notes, { question: asked, answer: text.slice(0, 600) }]
  }

  /** Practice: the scored answer, with its feedback. */
  function handleResult(result: InterviewAnswerResult) {
    if (result.no_speech) {
      setNoSpeech(true)
      setPhase('ready')
      return
    }
    setNoSpeech(false)
    setLog((l) => [...l, { who: 'you', text: result.transcription }])
    if (followUp) {
      setResults((r) => ({ ...r, [index]: { ...r[index], followUps: [...(r[index]?.followUps ?? []), result] } }))
      setPhase('feedback')
      return
    }
    setResults((r) => ({ ...r, [index]: { main: result } }))
    setAnswered((a) => new Set(a).add(index))
    setPhase('feedback')
    if (result.reply && readAloud) void say(result.reply, { key: SPEAK_KEY, rate: fastSpeech ? 1.25 : 1 })
  }

  /**
   * A real interview: the interviewer hears the answer and replies like a real one, within a second or
   * two, while the same answer is scored in the background for the report.
   */
  function takeTurn(clip: Recording) {
    const at = index
    const probe = followUp
    const asked = probes
    const wasCut = cutIn.current
    cutIn.current = false
    const mine = ++step.current
    setPhase('turn')
    setFailed(null)
    const q = questions[at]
    api
      .interviewTurn({
        audio: clip.blob,
        filename: clip.filename,
        questionId: q.id,
        custom: q.id.startsWith('cv-') ? { text: q.text, kind: q.kind } : undefined,
        type: session.type,
        role: session.role,
        level: session.level,
        conversation: conversation.current,
        earlier: earlier.current.filter((note) => note.question !== q.text),
        followUpsAsked: asked,
      })
      .then((turn) => {
        if (step.current !== mine || !alive.current) return
        if (turn.no_speech) {
          setNoSpeech(true)
          if (readAloud) void ask(RETRY_LINE, { remember: false })
          else setPhase('ready')
          return
        }
        setNoSpeech(false)
        void scoreInBackground(clip, at, probe)
        setAnswered((a) => new Set(a).add(at))
        conversation.current = [...conversation.current, { speaker: 'candidate', text: turn.transcript }]
        setLog((l) => [...l, { who: 'you', text: turn.transcript }])
        noteAnswer(at, turn.transcript)
        if (!wasCut && turn.question && ['follow_up', 'clarify', 'redirect'].includes(turn.action)) {
          const next: FollowUp = { id: turn.probe ?? 'more', text: turn.question }
          conversation.current = [...conversation.current, { speaker: 'interviewer', text: next.text }]
          setFollowUp(next)
          setProbes(asked + 1)
          setRevealed(false)
          void ask([turn.reaction, next.text], { followUp: true })
          return
        }
        advance(wasCut ? cutInLine(session.type) : (turn.reply ?? turn.reaction))
      })
      .catch((error) => {
        if (step.current !== mine || !alive.current) return
        setFailed({ error, recording: clip })
        setPhase('ready')
        showError(error)
      })
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
  function scoreInBackground(clip: Recording, at: number, follow: FollowUp | null): Promise<InterviewAnswerResult | null> {
    const q = questions[at]
    setPending((n) => n + 1)
    const run = async (): Promise<InterviewAnswerResult | null> => {
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await api.interviewAnswer(answerPayload(clip, q, follow))
          if (alive.current && !result.no_speech) {
            setResults((r) =>
              follow
                ? { ...r, [at]: { ...r[at], followUps: [...(r[at]?.followUps ?? []), result] } }
                : { ...r, [at]: { ...r[at], main: result } },
            )
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

  function submit(clip: Recording) {
    if (mode === 'interview') {
      takeTurn(clip)
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

  // How the interviewer opens: small talk in a real interview, or a welcome and the first question.
  // Fixed when the interview starts.
  const opening = useMemo(() => {
    const first = questions[startIndex]
    const name = (displayName || username).trim().split(/\s+/)[0] ?? ''
    const greeting = startIndex === 0 && mode === 'interview' && readAloud ? smallTalkLine({ name, type: session.type }) : null
    const line = greeting ?? (startIndex === 0 ? `${openingLine({ name, ...plan })} ${firstQuestionLine(first.text)}` : resumeLine(first.text))
    const soundCheck = `Hi${name ? ` ${name}` : ''}, I'm ${INTERVIEWER.name}. If you can hear me clearly, you're all set.`
    return { first, greeting, line, soundCheck }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** The learner presses Start: sound is switched on inside the tap, then the interviewer begins. */
  function begin() {
    audioEngine.ensure()
    setBegun(true)
    if (opening.greeting) {
      setSmallTalk(opening.greeting)
      void ask(opening.greeting)
    } else {
      conversation.current = [{ speaker: 'interviewer', text: opening.first.text }]
      void ask(opening.line)
    }
  }

  function testSound() {
    void say(opening.soundCheck, { key: SPEAK_KEY, rate: fastSpeech ? 1.25 : 1 })
  }

  // While the learner reads the start screen, render what the interviewer says first and then everything
  // after it, one line after another: each line then plays the moment it is needed.
  useEffect(() => {
    alive.current = true
    const { first, greeting } = opening
    let cancelled = false
    if (readAloud) {
      const rate = fastSpeech ? 1.25 : 1
      const lines = [
        opening.line,
        opening.soundCheck,
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
    // Runs once per interview; the lines are fixed when it starts.
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
    if (!begun) {
      begin()
      return
    }
    if (recording) recorder.stop()
    else if (phase === 'speaking' || phase === 'thinking' || phase === 'ready') startAnswer()
  }

  function repeat() {
    if (requesting || phase === 'turn' || phase === 'scoring' || phase === 'closing') return
    if (recording) {
      // Hands-free keeps the microphone open for the whole turn: hearing the question again starts it over.
      if (!handsFree) return
      recorder.cancel()
    }
    void ask(askedText, { remember: false })
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
  const orbState: OrbState =
    phase === 'scoring' || phase === 'turn' || voicePreparing ? 'thinking' : recording ? 'listening' : voiceActive ? 'speaking' : 'idle'

  const status = !begun
    ? 'Waiting to start'
    : phase === 'speaking'
      ? `${INTERVIEWER.name} is asking…`
      : phase === 'thinking'
        ? `Think about your answer · ${thinkLeft ?? 0} s`
        : phase === 'turn'
          ? `${INTERVIEWER.name} is thinking…`
          : phase === 'scoring'
            ? 'Listening back to your answer…'
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
  const feedbackView = phase === 'feedback' && current?.main?.delivery ? viewFromResult(current.main, current.followUps) : null

  const label = smallTalk
    ? 'Before we start'
    : followUp
      ? 'Follow-up'
      : `Question ${index + 1} · ${KIND_LABEL[question.kind] ?? 'Question'}${question.about ? ` · ${question.about}` : ''}`
  const busy = phase === 'turn' || phase === 'scoring' || phase === 'closing'
  const canAct = !(recording || requesting || busy)

  return (
    <div className="space-y-5">
      {/* A video call: the interviewer fills the stage, you are the small window, the question is the caption. */}
      <section
        aria-label="Interview"
        className="dark overflow-hidden rounded-[28px] bg-[#0b0b0d] text-foreground shadow-[0_30px_80px_-40px_rgb(0_0_0/0.6)] ring-1 ring-white/10"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            {begun && <span className="size-2 shrink-0 rounded-full bg-[#ff453a] motion-safe:animate-pulse" aria-hidden />}
            <span className="truncate font-medium text-white/90">
              {session.type_label}
              {session.role_label ? ` · ${session.role_label}` : ''}
            </span>
            {/* Counts from the moment the interview starts. */}
            {begun && <CallTimer />}
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
              disabled={busy || phase === 'feedback' || requesting}
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
            {(phase === 'scoring' || phase === 'turn') && <SpinnerGapIcon className="motion-safe:animate-spin" />}
            {status}
            {recording && handsFree && finishing > 0 && (
              <span className="ml-1 h-1 w-10 overflow-hidden rounded-full bg-white/20" aria-hidden>
                <span className="block h-full rounded-full bg-white transition-[width] duration-100 ease-linear" style={{ width: `${finishing * 100}%` }} />
              </span>
            )}
          </div>

          <YouTile name={displayName || username || 'You'} live={recording} readLevel={readLevel} className="absolute top-3 right-3 sm:top-4 sm:right-4" />

          {!begun && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0e0e11]/80 px-6 text-center backdrop-blur-md">
              <h3 className="text-[22px] font-semibold tracking-[-0.01em] text-balance text-white sm:text-[26px]">
                {startIndex > 0 ? 'Ready to carry on?' : `${INTERVIEWER.name} is ready when you are`}
              </h3>
              <p className="mt-2 max-w-md text-[15px] leading-relaxed text-white/70">
                {session.type_label} · {total} questions{MINUTES[total] ? ` · ${MINUTES[total].toLowerCase()}` : ''}. Find a quiet spot
                and turn your volume up.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button variant="secondary" onClick={testSound} disabled={voiceActive || voicePreparing}>
                  {voicePreparing ? <SpinnerGapIcon className="motion-safe:animate-spin" /> : <SpeakerHighIcon weight="fill" />}
                  {voiceActive ? 'Playing…' : 'Test sound'}
                </Button>
                <Button variant="secondary" onClick={() => setMicCheckOpen(true)}>
                  <MicrophoneIcon weight="fill" /> Check microphone
                </Button>
              </div>
              <Button size="lg" className="mt-6 h-14 rounded-full px-8 text-[16px]" onClick={begin}>
                <PlayIcon weight="fill" /> {startIndex > 0 ? 'Carry on' : 'Start interview'}
              </Button>
              <p className="mt-3 text-[12px] text-white/45">Headphones give the clearest sound.</p>
            </div>
          )}

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

        <div className={cn('px-4 pt-5 pb-5 sm:px-8 sm:pb-6', !begun && 'hidden')}>
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
                disabled={busy || phase === 'feedback' || requesting}
                className={cn('h-12 rounded-full px-5 text-[15px] sm:h-14 sm:px-7', recording && 'bg-bad hover:bg-bad/90')}
              >
                {phase === 'scoring' || phase === 'turn' ? (
                  <>
                    <SpinnerGapIcon className="motion-safe:animate-spin" /> {phase === 'turn' ? 'One moment…' : 'Scoring…'}
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

      {log.length > 0 && <Conversation log={log} you={displayName || username || 'You'} />}

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
            {!followUp && current?.main?.follow_up && !current.followUps?.length && (
              <Button
                variant="secondary"
                size="lg"
                className="h-12"
                onClick={() => {
                  setFollowUp(current.main!.follow_up)
                  void ask(current.main!.follow_up!.text, { followUp: true })
                }}
              >
                <ArrowBendDownRightIcon weight="bold" /> Take the follow-up
              </Button>
            )}
          </div>
          {!followUp && current?.main?.follow_up && !current.followUps?.length && (
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

/** Everything said so far, newest at the bottom: what the interviewer asked and what it heard you say. */
function Conversation({ log, you }: { log: LogEntry[]; you: string }) {
  const end = useRef<HTMLLIElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [log.length])
  return (
    <Panel className="p-4 sm:p-6">
      <div className="text-[13px] font-semibold text-muted-foreground">The conversation</div>
      <ol className="mt-3 max-h-80 space-y-2.5 overflow-y-auto pr-1" aria-live="polite">
        {log.map((entry, i) => (
          <li key={i} ref={i === log.length - 1 ? end : undefined} className={cn('flex', entry.who === 'you' && 'justify-end')}>
            <div
              className={cn(
                'max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed',
                entry.who === 'you' ? 'bg-primary-soft' : 'bg-fill',
              )}
            >
              <span className="mb-0.5 block text-[11px] font-semibold text-muted-foreground">
                {entry.who === 'you' ? you : INTERVIEWER.name}
                {entry.followUp ? ' · follow-up' : ''}
              </span>
              {entry.text}
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
