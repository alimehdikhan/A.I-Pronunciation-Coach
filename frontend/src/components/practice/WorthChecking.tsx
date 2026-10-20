import { CheckCircleIcon, MicrophoneIcon, QuestionIcon, SpinnerGapIcon, StopIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useRecorder, type Recording } from '@/hooks/useRecorder'
import { api } from '@/lib/api'
import { keys } from '@/lib/queries'
import type { WordResult } from '@/lib/types'
import { TIER_META, cn, wordTier } from '@/lib/utils'
import { usePractice } from '@/store/practice'
import { useSettings } from '@/store/settings'

/** The borderline sounds in a word: the ones saying it alone will settle. */
function uncertainSounds(word: WordResult): string[] {
  const fromAudio = (word.phonemes ?? []).filter((p) => p.tier === 'check').map((p) => p.phoneme)
  const sounds = fromAudio.length ? fromAudio : word.alignment.filter((op) => op.tier === 'check').map((op) => op.expected)
  return [...new Set(sounds.filter(Boolean))]
}

/**
 * "Not sure? Say just this word": records the word on its own and scores it. Inside a sentence the
 * sound model often hears the sound it expects; alone it separates sounds well, so its verdict
 * replaces the uncertain one, in this result and (for a saved attempt) in the learner's history.
 */
export function SayItAlone({
  word,
  recordId,
  compact,
  hotkey,
  onDone,
}: {
  word: WordResult
  recordId?: number | null
  /** A short label, for lists. */
  compact?: boolean
  /** `C` starts and stops the recording. */
  hotkey?: boolean
  onDone?: () => void
}) {
  const username = useSettings((s) => s.username)
  const updateWord = usePractice((s) => s.updateWord)
  const queryClient = useQueryClient()
  const target = word.reference ?? word.display

  const check = useMutation({
    mutationFn: (recording: Recording) =>
      api.confirmWord({
        audio: recording.blob,
        filename: recording.filename,
        word: target,
        phonemes: uncertainSounds(word),
        recordId,
        username: username || undefined,
      }),
    onSuccess: (result) => {
      if (result.verdict === 'unheard') {
        toast.warning(`We couldn’t hear “${word.display}” clearly. Try once more, a little closer to the microphone.`)
        return
      }
      if (result.verdict === 'unavailable') {
        toast.info('Checking a single word needs the sound model, which isn’t running on this server.')
        return
      }
      if (result.updated > 0 && username) {
        for (const key of [keys.analytics(username), keys.history(username), keys.journey(username), ['coach-plan', username]]) {
          void queryClient.invalidateQueries({ queryKey: key })
        }
      }
      onDone?.()
      updateWord(word.index, { confirmed: result.verdict, confirmedSaved: result.updated > 0 })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not check the word. Try again.'),
  })

  const recorder = useRecorder({
    maxSeconds: 4,
    minSeconds: 0.3,
    onRecorded: (recording) => check.mutate(recording),
    onError: (message) => toast.error(message),
  })
  const recording = recorder.state === 'recording'
  const busy = check.isPending || recorder.state === 'requesting'
  useHotkeys({ c: () => !busy && recorder.toggle() }, !!hotkey)

  return (
    <Button
      variant={recording ? 'default' : 'secondary'}
      size="sm"
      onClick={recorder.toggle}
      disabled={busy}
      aria-label={recording ? `Stop recording “${word.display}”` : `Say just “${word.display}” to check it`}
      className={cn(recording && 'bg-bad text-white hover:bg-bad/90')}
    >
      {check.isPending ? (
        <>
          <SpinnerGapIcon className="motion-safe:animate-spin" /> Checking…
        </>
      ) : recording ? (
        <>
          <StopIcon weight="fill" /> Stop · {Math.max(0, Math.ceil(recorder.maxSeconds - recorder.elapsed))}s
        </>
      ) : (
        <>
          <MicrophoneIcon weight="fill" /> {compact ? 'Say it alone' : 'Not sure? Say just this word'}
          {hotkey && <Kbd className="ml-1 hidden sm:inline-flex">C</Kbd>}
        </>
      )}
    </Button>
  )
}

/** The verdict after saying a word alone. */
export function ConfirmedNote({ word }: { word: WordResult }) {
  if (!word.confirmed) return null
  const slip = word.confirmed === 'slip'
  const saved = word.confirmedSaved
  return (
    <div
      role="status"
      className={cn('mt-6 flex gap-3 rounded-2xl p-4 text-[15px] leading-relaxed', slip ? 'bg-bad-soft' : 'bg-good-soft')}
    >
      {slip ? (
        <WarningCircleIcon size={22} weight="fill" className="mt-0.5 shrink-0 text-bad" />
      ) : (
        <CheckCircleIcon size={22} weight="fill" className="mt-0.5 shrink-0 text-good" />
      )}
      <div>
        <div className="font-semibold">{slip ? 'Confirmed: worth fixing' : 'Sounded fine'}</div>
        <p className="mt-0.5 text-muted-foreground">
          {slip
            ? `Said on its own, the sound still slipped in “${word.display}”.${saved ? ' It now counts in your progress.' : ''} The guide below shows how to fix it.`
            : `Said on its own, “${word.display}” came out clean.${saved ? ' Your progress now records it as fine.' : ''}`}
        </p>
      </div>
    </div>
  )
}

/**
 * Borderline ("Worth checking") slips: the sound model wasn't sure, so the coach gives no tip
 * and these never count against mastery. `action` holds "Not sure? Say just this word".
 */
export function CheckNote({ word, action }: { word: WordResult; action?: ReactNode }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-warn/50 bg-warn-soft p-4 text-[15px] leading-relaxed">
      <div className="flex gap-3">
        <QuestionIcon size={22} weight="fill" className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0">
          <div className="font-semibold">{TIER_META.check.label}</div>
          <p className="mt-0.5 text-muted-foreground">
            A sound in “{word.display}” was borderline, and inside a sentence the sound model is often unsure. It may have
            been fine, so it doesn’t count against your progress. Compare <b>Hear it</b> with <b>Your take</b>.
          </p>
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  )
}

/** The words of an attempt whose only slips were borderline, as chips that open them in the inspector. */
export function WorthCheckingList({
  words,
  onSelect,
  action,
}: {
  words: WordResult[]
  onSelect?: (index: number) => void
  action?: (word: WordResult) => ReactNode
}) {
  const unsure = words.filter((w) => wordTier(w) === 'check')
  if (!unsure.length) return null
  return (
    <div className="rounded-2xl border border-dashed border-warn/50 bg-warn-soft p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-warn">
        <QuestionIcon size={16} weight="fill" /> {TIER_META.check.label}
      </div>
      <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
        A sound in {unsure.length === 1 ? 'this word' : 'each of these words'} was borderline. It may have been fine, so there is
        no tip and it doesn’t count against your progress.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {unsure.map((w) => (
          <span key={w.index} className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => onSelect?.(w.index)}
              disabled={!onSelect}
              className={cn(
                'rounded-full border border-dashed border-warn/60 bg-card px-3 py-1 text-[14px] font-semibold text-warn transition-colors',
                onSelect && 'hover:bg-warn-soft focus-visible:ring-2 focus-visible:ring-warn focus-visible:outline-none',
              )}
            >
              {w.display}
            </button>
            {action?.(w)}
          </span>
        ))}
      </div>
    </div>
  )
}
