import { ChatCircleDotsIcon, CheckIcon, FlagIcon } from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useSoundName } from '@/lib/soundNames'
import type { WordResult } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'

type Reason = 'said_correctly' | 'accent_normal' | null

const REASONS: { value: Reason; label: string }[] = [
  { value: 'said_correctly', label: 'I said it correctly' },
  { value: 'accent_normal', label: 'That’s normal in my accent' },
  { value: null, label: 'Just report it' },
]

interface FlaggedSound {
  expected: string
  detected: string
  gop: number | null
}

/** The sounds in a word the scorer flagged, with what it thought it heard. */
function flaggedSounds(word: WordResult): FlaggedSound[] {
  if (word.phonemes?.length) {
    return word.phonemes
      .filter((p) => p.flagged)
      .map((p) => ({ expected: p.phoneme, detected: p.alternative ?? '', gop: p.gop ?? null }))
  }
  return word.alignment
    .filter((op) => op.op === 'replace' || op.op === 'delete')
    .map((op) => ({ expected: op.expected, detected: op.op === 'delete' ? '' : op.actual, gop: null }))
}

function DisputeRow({ word, sound, recordId }: { word: WordResult; sound: FlaggedSound; recordId: number }) {
  const username = useSettings((s) => s.username)
  const soundName = useSoundName()
  const [open, setOpen] = useState(false)
  const send = useMutation({
    mutationFn: (reason: Reason) =>
      api.dispute({
        username,
        record_id: recordId,
        word: word.reference ?? word.display,
        expected: sound.expected,
        detected: sound.detected,
        gop: sound.gop,
        reason,
      }),
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not send that. Try again.'),
  })
  const heard = sound.detected ? (sound.detected === '?' ? 'an unclear sound' : `“${soundName(sound.detected).spelled}”`) : 'dropped'

  return (
    <li className="rounded-xl bg-fill px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
        <span>
          <b>{soundName(sound.expected).spelled}</b>
          <span className="text-muted-foreground"> {sound.detected ? 'heard as' : 'was'} {heard}</span>
        </span>
        {send.isSuccess ? (
          <span className="flex items-center gap-1 text-[13px] font-medium text-good" role="status">
            <CheckIcon weight="bold" /> Thanks, noted
          </span>
        ) : (
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <FlagIcon weight="bold" /> I think this is wrong
          </Button>
        )}
      </div>
      {open && !send.isSuccess && (
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Why do you think it is wrong?">
          {REASONS.map((r) => (
            <button
              key={r.label}
              type="button"
              disabled={send.isPending}
              onClick={() => send.mutate(r.value)}
              className={cn(
                'rounded-full border border-border bg-card px-3 py-1 text-[13px] font-medium transition-colors',
                'hover:bg-fill-strong focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </li>
  )
}

/**
 * "I think this is wrong" for each flagged sound in a saved attempt. Reports keep what the scorer
 * said (sound, what it heard, its score and tier), never audio; they are exported for recalibration.
 */
export function DisputeSounds({ word, recordId }: { word: WordResult; recordId?: number | null }) {
  const username = useSettings((s) => s.username)
  const sounds = flaggedSounds(word)
  if (!sounds.length || word.status !== 'mispronounced') return null
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <ChatCircleDotsIcon size={16} weight="fill" /> Disagree with the coach?
      </div>
      {recordId != null && username ? (
        <ul className="space-y-2">
          {sounds.map((sound) => (
            <DisputeRow key={sound.expected} word={word} sound={sound} recordId={recordId} />
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-subtle">Sign in and save the attempt to report a sound you think was marked wrongly.</p>
      )}
      <p className="mt-2 text-[12px] text-subtle">Reports don’t change your score. They help tune the scorer; no audio is kept.</p>
    </div>
  )
}
