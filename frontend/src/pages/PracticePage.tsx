import { useMutation, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useCallback, useEffect } from 'react'
import { useLocation } from 'react-router'
import { toast } from 'sonner'
import { Segmented } from '@/components/common'
import { LockedResults } from '@/components/auth/SignInGate'
import { PageHeader } from '@/components/layout/AppShell'
import { GoalChip } from '@/components/journey/GoalChip'
import { TalkButton } from '@/components/voice/TalkButton'
import { PhraseStage } from '@/components/practice/PhraseStage'
import { Recorder } from '@/components/practice/Recorder'
import { Results } from '@/components/practice/Results'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useRecorder, type Recording } from '@/hooks/useRecorder'
import { api } from '@/lib/api'
import { audioEngine } from '@/lib/audioEngine'
import { keys, useHealth } from '@/lib/queries'
import { LEVELS, PHRASES, phrasesFor } from '@/lib/sentences'
import { usesNeuralVoice, useSpeaker } from '@/lib/speech'
import type { Level } from '@/lib/types'
import { usePractice } from '@/store/practice'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'

const PhraseLibrary = lazy(() => import('@/components/practice/PhraseLibrary').then((m) => ({ default: m.PhraseLibrary })))

export default function PracticePage() {
  const level = useSettings((s) => s.level)
  const setLevel = useSettings((s) => s.setLevel)
  const username = useSettings((s) => s.username)
  const signedIn = useSettings((s) => !!s.accountEmail)
  const { target, setTarget, attempt, setAttempt, clearAttempt, scoreHistory } = usePractice()
  const setLibraryOpen = useUI((s) => s.setLibraryOpen)
  const { data: health, isError: offline } = useHealth()
  const { speak } = useSpeaker()
  const queryClient = useQueryClient()

  const phrases = phrasesFor(level)
  const phraseIndex = phrases.findIndex((p) => p.text === target.text)
  const phrase = PHRASES.find((p) => p.text === target.text)

  const evaluate = useMutation({
    mutationFn: api.evaluateRecording,
    onSuccess: ({ result, audio }) => {
      setAttempt({ result, audioBlob: audio, audioUrl: URL.createObjectURL(audio), createdAt: Date.now() })
      if (!result.transcription) toast.warning('We couldn’t hear any speech. Check your microphone and try again.')
      else if (result.save_error === 'profile_locked')
        toast.warning('This name is in use on another device, so this attempt wasn’t saved. Choose a different name in Settings.')
      if (username) {
        void queryClient.invalidateQueries({ queryKey: keys.analytics(username) })
        void queryClient.invalidateQueries({ queryKey: keys.history(username) })
        void queryClient.invalidateQueries({ queryKey: keys.practice(username) })
        void queryClient.invalidateQueries({ queryKey: keys.journey(username) })
      }
    },
  })

  // A new sentence aimed at the learner's own weakest sound, written by the coach and checked
  // against the dictionary. Falls back to the sound library when the model is unavailable.
  const nativeLanguage = useSettings((s) => s.nativeLanguage)
  const suggest = useMutation({
    mutationFn: () => api.coachSentences({ username, level, count: 1, native_language: nativeLanguage }),
    meta: { silent: true },
    onSuccess: (data) => {
      const sentence = data.sentences[0]
      if (!sentence) return toast.info('No new sentence this time. Try again in a moment.')
      clearAttempt()
      setTarget({ text: sentence.text, source: 'custom' })
      toast.success(`A sentence for ${data.label || `/${data.phoneme}/`}`)
    },
    onError: () => toast.error('Could not write a sentence just now.'),
  })

  const onRecorded = useCallback(
    ({ blob, filename }: Recording) =>
      evaluate.mutate({ audio: blob, filename, text: target.text, difficulty: level, username: username || undefined }),
    [evaluate, level, target.text, username],
  )
  const onError = useCallback((message: string) => toast.error(message), [])
  const recorder = useRecorder({ maxSeconds: 30, onRecorded, onError })
  const { pathname } = useLocation()
  const cancelRecording = recorder.cancel

  // Leaving the page must never submit a half-finished recording, even while
  // the page is still mounted for its exit transition.
  useEffect(() => {
    if (pathname !== '/') cancelRecording()
  }, [pathname, cancelRecording])

  const ready = !!health?.models_loaded
  const busy = evaluate.isPending
  const voiceURI = useSettings((s) => s.voiceURI)
  const speechRate = useSettings((s) => s.rate)
  const coachVoice = useSettings((s) => s.coachVoice) ?? ''

  // Warm the coach's voice for this phrase so "Listen" starts instantly.
  useEffect(() => {
    if (health?.tts_ready && usesNeuralVoice(voiceURI)) {
      audioEngine.prefetch(target.text, Math.min(1.6, Math.max(0.5, speechRate)), coachVoice)
    }
  }, [health?.tts_ready, target.text, voiceURI, speechRate, coachVoice])

  // Never let the coach's voice bleed into the microphone.
  const toggleRecording = useCallback(() => {
    if (recorder.state === 'idle') audioEngine.stop()
    recorder.toggle()
  }, [recorder])

  const go = (direction: 1 | -1) => {
    const base = phraseIndex === -1 ? (direction === 1 ? -1 : 0) : phraseIndex
    const next = phrases[(base + direction + phrases.length) % phrases.length]
    setTarget({ text: next.text, source: 'library', phraseId: next.id })
  }

  const changeLevel = (next: Level) => {
    setLevel(next)
    if (target.source === 'library') {
      const first = phrasesFor(next)[0]
      setTarget({ text: first.text, source: 'library', phraseId: first.id })
    }
  }

  const retry = () => {
    clearAttempt()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  useHotkeys({
    ' ': () => ready && !busy && toggleRecording(),
    r: () => attempt && retry(),
    n: () => go(1),
    arrowright: () => go(1),
    arrowleft: () => go(-1),
    l: () => speak(target.text, { key: 'stage-normal' }),
  })

  return (
    <>
      <PageHeader
        eyebrow="Practice"
        title="Say it. See every sound."
        description="Pick a phrase, tap the mic, and get feedback on each word and sound you say."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <TalkButton />
            <GoalChip />
            <Segmented<Level>
              layoutId="level"
              value={level}
              onChange={changeLevel}
              options={LEVELS.map((l) => ({ value: l.id, label: l.label }))}
            />
          </div>
        }
      />

      <PhraseStage
        target={target}
        phrase={phrase}
        position={phraseIndex >= 0 ? { index: phraseIndex, total: phrases.length } : undefined}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
        onBrowse={() => setLibraryOpen(true)}
        onSuggest={() => suggest.mutate()}
        suggesting={suggest.isPending}
      >
        <Recorder
          state={recorder.state}
          elapsed={recorder.elapsed}
          maxSeconds={recorder.maxSeconds}
          analyserRef={recorder.analyserRef}
          analyzing={busy}
          disabled={!ready}
          disabledReason={offline ? 'Can’t reach the server' : 'Warming up the speech model…'}
          onToggle={toggleRecording}
          onUpload={onRecorded}
        />
      </PhraseStage>

      {attempt && (
        <div className="mt-5">
          {signedIn ? (
            <Results
              attempt={attempt}
              previousScore={(scoreHistory[target.text] ?? []).slice(-2, -1)[0]}
              onRetry={retry}
              onNext={() => go(1)}
            />
          ) : (
            <LockedResults />
          )}
        </div>
      )}

      <Suspense fallback={null}>
        <PhraseLibrary />
      </Suspense>
    </>
  )
}
