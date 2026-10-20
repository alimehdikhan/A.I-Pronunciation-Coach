import { CheckCircleIcon, LockKeyIcon, MicrophoneIcon, PauseIcon, PlayIcon, SpinnerGapIcon, StopIcon, TrashIcon } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Panel, Pill, Segmented, SectionLabel } from '@/components/common'
import { Day30 } from '@/components/progress/Day30'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useRecorder, type Recording } from '@/hooks/useRecorder'
import { api } from '@/lib/api'
import { audioEngine } from '@/lib/audioEngine'
import type { BaselineStatus } from '@/lib/types'
import { cn, scoreTone, toneText } from '@/lib/utils'
import { useSettings } from '@/store/settings'

const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')

/** Plays one stored recording (fetched with the profile key, so it never sits at a public URL). */
function PlayStored({ username, id, label }: { username: string; id: number; label: string }) {
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => () => audio.current?.pause(), [])
  const toggle = async () => {
    if (playing) {
      audio.current?.pause()
      return
    }
    try {
      audioEngine.stop()
      const blob = await api.baselineAudio(username, id)
      const url = URL.createObjectURL(blob)
      const element = new Audio(url)
      audio.current = element
      element.onended = element.onpause = () => {
        setPlaying(false)
        URL.revokeObjectURL(url)
      }
      setPlaying(true)
      await element.play()
    } catch {
      setPlaying(false)
      toast.error('Could not play that recording.')
    }
  }
  return (
    <Button variant="secondary" size="sm" onClick={() => void toggle()} aria-label={`${playing ? 'Pause' : 'Play'} ${label}`}>
      {playing ? <PauseIcon weight="fill" /> : <PlayIcon weight="fill" />} {label}
    </Button>
  )
}

function Comparison({ status, username }: { status: BaselineStatus; username: string }) {
  const done = status.rounds.filter((r) => r.complete)
  if (!done.length) return null
  const first = done[0]
  const latest = done[done.length - 1]
  const compare = latest.round !== first.round
  return (
    <Panel className="p-6 sm:p-8">
      <SectionLabel icon={<PlayIcon weight="fill" />}>{compare ? 'Then and now' : 'Your baseline'}</SectionLabel>
      <div className="mb-4 flex flex-wrap gap-3 text-[14px] text-muted-foreground">
        <span>
          Baseline {dateText(first.finished_at)}: <b className="text-foreground">{first.average ?? '—'}</b>
        </span>
        {compare && (
          <span>
            Latest {dateText(latest.finished_at)}: <b className="text-foreground">{latest.average ?? '—'}</b>
          </span>
        )}
      </div>
      <ul className="space-y-3">
        {status.sentences.map((sentence, i) => {
          const before = first.sentences[String(i)]
          const after = compare ? latest.sentences[String(i)] : undefined
          return (
            <li key={sentence} className="rounded-2xl bg-fill p-4">
              <div className="text-[15px] font-medium">{sentence}</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {[
                  { take: before, label: 'Before' },
                  ...(after ? [{ take: after, label: 'Now' }] : []),
                ].map(({ take, label }) => (
                  <div key={label} className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-2">
                    <span className="text-[13px] text-muted-foreground">
                      {label} ·{' '}
                      <b className={cn('tabular-nums', toneText[scoreTone(take?.score ?? null)])}>{take?.score != null ? Math.round(take.score) : '—'}</b>
                    </span>
                    {take?.has_audio ? <PlayStored username={username} id={take.id} label={label} /> : <span className="text-[12px] text-subtle">audio deleted</span>}
                  </div>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/** The five-sentence before and after. */
function FiveSentences({ tabs }: { tabs: ReactNode }) {
  const username = useSettings((s) => s.username)
  const queryClient = useQueryClient()
  const [consent, setConsent] = useState(false)
  const { data: status, isLoading } = useQuery({
    queryKey: ['baseline', username],
    queryFn: () => api.baselineStatus(username),
    enabled: !!username,
  })
  const current = status?.next
  const round = status?.rounds.find((r) => r.round === current?.round)
  const remaining = status ? status.sentences.map((_, i) => i).filter((i) => !round?.sentences[String(i)]) : []
  const index = remaining[0]

  const record = useMutation({
    mutationFn: (recording: Recording) =>
      api.baselineRecord(username, { audio: recording.blob, filename: recording.filename, sentenceIndex: index!, consent: true }),
    onSuccess: (result) => {
      queryClient.setQueryData(['baseline', username], result.status)
      toast.success(`Saved. Score ${Math.round(result.score ?? 0)}.`)
    },
  })
  const onRecorded = useCallback((r: Recording) => record.mutate(r), [record])
  const recorder = useRecorder({ maxSeconds: 15, onRecorded })
  const recording = recorder.state === 'recording'
  const canRecord = !!current?.due && index !== undefined && (consent || (current?.round ?? 0) > 0 || !!round)
  const toggle = () => {
    if (!canRecord || record.isPending) return
    if (recorder.state === 'idle') audioEngine.stop()
    recorder.toggle()
  }
  useHotkeys({ ' ': toggle })

  const removeAudio = useMutation({
    mutationFn: () => api.deleteBaselineAudio(username),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['baseline', username] })
      toast.success(r.deleted ? `Deleted ${r.deleted} recordings. Your scores stay.` : 'There was no stored audio.')
    },
  })

  if (!username) {
    return (
      <>
        <PageHeader eyebrow="Before & after" title="Hear how far you have come." description="Add your name in Settings first, so your recordings can be kept for you." actions={tabs} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Before & after"
        title="Hear how far you have come."
        description="Record five sentences now, again after two weeks, then every month, and play them side by side."
        actions={tabs}
      />
      <div className="space-y-5">
        {isLoading || !status ? (
          <Skeleton className="h-48 w-full rounded-[30px]" />
        ) : (
          <Panel className="p-6 sm:p-8">
            {index !== undefined && current?.due ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="primary">{current.round === 0 ? 'Baseline' : `Re-recording ${current.round}`}</Pill>
                  <span className="text-[14px] text-muted-foreground">
                    Sentence {status.sentences.length - remaining.length + 1} of {status.sentences.length}
                  </span>
                </div>
                {current.round === 0 && !round && (
                  <label className="flex items-start gap-3 rounded-2xl bg-fill p-4 text-[14px] leading-relaxed">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                    />
                    <span>
                      <LockKeyIcon size={16} weight="fill" className="mr-1 inline text-primary" />
                      <b>Keep these recordings.</b> I agree that the app stores these five recordings (and later re-recordings of the same
                      sentences) so I can hear my progress. Only I can play them, and I can delete them any time from this page or my
                      Profile. Deleting my account deletes them too. (<Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>)
                    </span>
                  </label>
                )}
                <p className="headline text-[26px] sm:text-[30px]">{status.sentences[index]}</p>
                <Button size="lg" className={cn('h-12 px-6', recording && 'bg-bad hover:bg-bad/90')} onClick={toggle} disabled={!canRecord || record.isPending}>
                  {record.isPending ? (
                    <>
                      <SpinnerGapIcon className="motion-safe:animate-spin" /> Saving…
                    </>
                  ) : recording ? (
                    <>
                      <StopIcon weight="fill" /> Stop
                    </>
                  ) : (
                    <>
                      <MicrophoneIcon weight="fill" /> Record this sentence
                    </>
                  )}
                  <Kbd className="ml-1 hidden bg-white/20 text-white sm:inline-flex">Space</Kbd>
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-[15px]">
                <CheckCircleIcon size={24} weight="fill" className="shrink-0 text-good" />
                <span>
                  All done for now.{' '}
                  {current?.due_at && (
                    <>
                      Your next re-recording is due on <b>{dateText(current.due_at)}</b>.
                    </>
                  )}
                </span>
              </div>
            )}
          </Panel>
        )}

        {status && <Comparison status={status} username={username} />}

        {!!status?.stored_audio && (
          <Panel className="flex flex-wrap items-center justify-between gap-4 p-6 sm:p-8">
            <div>
              <div className="text-[15px] font-medium">Stored recordings: {status.stored_audio}</div>
              <div className="text-[13px] text-muted-foreground">Delete the audio at any time. Your scores stay.</div>
            </div>
            <Button variant="secondary" className="rounded-xl" onClick={() => removeAudio.mutate()} disabled={removeAudio.isPending}>
              <TrashIcon weight="bold" /> Delete stored audio
            </Button>
          </Panel>
        )}
      </div>
    </>
  )
}

type Mode = 'sentences' | 'interview'

/** Before and after: five read sentences, or one interview answer (Day 1 vs Day 30). */
export default function BaselinePage() {
  const username = useSettings((s) => s.username)
  const [params, setParams] = useSearchParams()
  const mode: Mode = params.get('mode') === 'interview' ? 'interview' : 'sentences'
  const tabs = (
    <Segmented<Mode>
      layoutId="before-after-mode"
      value={mode}
      onChange={(next) => setParams(next === 'interview' ? { mode: next } : {})}
      options={[
        { value: 'sentences', label: 'Five sentences' },
        { value: 'interview', label: 'Interview answer' },
      ]}
    />
  )
  if (mode === 'sentences') return <FiveSentences tabs={tabs} />
  return (
    <>
      <PageHeader
        eyebrow="Before & after"
        title="Day 1 vs Day 30."
        description={
          username
            ? 'Answer one interview question today and again in a month. Hear the two side by side, and make a video of how far you’ve come.'
            : 'Add your name in Settings first, so your recordings can be kept for you.'
        }
        actions={tabs}
      />
      {username && <Day30 />}
    </>
  )
}
