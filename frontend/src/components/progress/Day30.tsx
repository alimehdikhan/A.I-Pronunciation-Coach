import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  DownloadSimpleIcon,
  FilmSlateIcon,
  MicrophoneIcon,
  PauseIcon,
  PlayIcon,
  ShareNetworkIcon,
  SpinnerGapIcon,
  StopIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Panel, Pill, SectionLabel } from '@/components/common'
import { AnswerTimer } from '@/components/interview/AnswerTimer'
import { Choice } from '@/components/interview/setupParts'
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
import { Skeleton } from '@/components/ui/skeleton'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useRecorder, type Recording } from '@/hooks/useRecorder'
import { api } from '@/lib/api'
import { audioEngine } from '@/lib/audioEngine'
import { errorLine, showError } from '@/lib/errors'
import { makeProgressVideo, videoSupported } from '@/lib/progressVideo'
import type { Day30Change, Day30Round, Day30Status } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'

const DAY_MS = 86_400_000
const longDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : '')

/** "Day 1", or the day the round was recorded counting from day one. */
function dayLabel(first: Day30Round, round: Day30Round): string {
  if (round.round === 0 || !first.created_at || !round.created_at) return 'Day 1'
  return `Day ${Math.max(2, Math.round((Date.parse(round.created_at) - Date.parse(first.created_at)) / DAY_MS) + 1)}`
}

const CHANGES: { key: keyof NonNullable<Day30Status['comparison']>; label: string; unit: string }[] = [
  { key: 'fillers_per_minute', label: 'Fillers a minute', unit: '' },
  { key: 'wpm', label: 'Pace (words a minute)', unit: '' },
  { key: 'long_pauses', label: 'Long pauses', unit: '' },
  { key: 'slips', label: 'Sound slips', unit: '' },
  { key: 'pronunciation', label: 'Sound score', unit: '' },
]

/** One recorded round: play it, read it, see its numbers. */
function RoundCard({ username, round, label, highlight }: { username: string; round: Day30Round; label: string; highlight?: boolean }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const m = round.measures
  useEffect(() => () => audio.current?.pause(), [])
  const toggle = async () => {
    if (playing) {
      audio.current?.pause()
      return
    }
    try {
      if (!audio.current) {
        audio.current = new Audio(URL.createObjectURL(await api.day30Audio(username, round.round)))
        audio.current.onended = audio.current.onpause = () => setPlaying(false)
      }
      audioEngine.stop()
      await audio.current.play()
      setPlaying(true)
    } catch (error) {
      showError(error)
    }
  }
  return (
    <div className={cn('rounded-[24px] p-5 sm:p-6', highlight ? 'bg-primary-soft ring-1 ring-primary/25' : 'bg-fill')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[24px] font-semibold tracking-[-0.02em]">{label}</div>
          <div className="text-[13px] text-muted-foreground">{longDate(round.created_at)}</div>
        </div>
        {round.has_audio && (
          <Button variant="secondary" size="sm" onClick={() => void toggle()}>
            {playing ? <PauseIcon weight="fill" /> : <PlayIcon weight="fill" />} {playing ? 'Pause' : 'Play'}
          </Button>
        )}
      </div>
      <p className="mt-4 text-[15px] leading-relaxed">{round.transcript}</p>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-[13px]">
        {[
          ['Fillers', m.fillers_per_minute != null ? `${m.fillers_per_minute}/min` : '—'],
          ['Pace', m.wpm != null ? `${m.wpm} wpm` : '—'],
          ['Long pauses', String(m.long_pauses)],
          ['Sound slips', String(m.slips.length)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-card/60 px-3 py-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-[16px] font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function ChangeTile({ label, change }: { label: string; change: Day30Change }) {
  return (
    <div className="rounded-2xl bg-fill p-4">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2 tabular-nums">
        <span className="text-[15px] text-subtle line-through decoration-1">{change.before}</span>
        <span className={cn('text-[24px] font-semibold', change.better === true && 'text-good', change.better === false && 'text-warn')}>
          {change.after}
        </span>
        {change.better != null && (change.better ? <ArrowUpIcon className="text-good" weight="bold" /> : <ArrowDownIcon className="text-warn" weight="bold" />)}
      </div>
      <div className="text-[12px] text-subtle">{change.better === true ? 'better' : change.better === false ? 'worse' : 'no change'}</div>
    </div>
  )
}

/** Makes the side-by-side video in the browser, then offers it to download or share. */
function VideoMaker({ username, status }: { username: string; status: Day30Status }) {
  const first = status.rounds[0]
  const latest = status.rounds[status.rounds.length - 1]
  const [progress, setProgress] = useState<number | null>(null)
  const [video, setVideo] = useState<{ url: string; file: File } | null>(null)
  useEffect(() => () => void (video && URL.revokeObjectURL(video.url)), [video])

  const make = async () => {
    try {
      setProgress(0)
      const [a, b] = await Promise.all([api.day30Audio(username, first.round), api.day30Audio(username, latest.round)])
      const changes = CHANGES.flatMap(({ key, label, unit }) => {
        const change = status.comparison?.[key]
        return change ? [{ label, change, unit }] : []
      })
      const { blob, type } = await makeProgressVideo(
        {
          question: first.prompt.text,
          first: { round: first, audio: a, label: dayLabel(first, first) },
          latest: { round: latest, audio: b, label: dayLabel(first, latest) },
          changes,
        },
        setProgress,
      )
      const file = new File([blob], `my-english-${dayLabel(first, first)}-vs-${dayLabel(first, latest)}.${type.includes('mp4') ? 'mp4' : 'webm'}`.replace(/ /g, '-').toLowerCase(), { type })
      setVideo({ url: URL.createObjectURL(blob), file })
    } catch (error) {
      showError(error)
    } finally {
      setProgress(null)
    }
  }

  const share = async () => {
    if (!video) return
    try {
      await navigator.share({ files: [video.file], title: 'My English: Day 1 vs Day 30' })
    } catch {
      /* the learner closed the share sheet */
    }
  }
  const canShare = !!video && typeof navigator.canShare === 'function' && navigator.canShare({ files: [video.file] })

  if (!videoSupported()) {
    return <p className="text-[14px] text-muted-foreground">This browser can’t make videos. Try Chrome, Edge or Safari.</p>
  }
  return (
    <div className="space-y-4">
      {video ? (
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <video src={video.url} controls playsInline className="aspect-[9/16] w-full max-w-[260px] rounded-2xl bg-black" />
          <div className="space-y-3">
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              Your video is ready. It was made on this device and isn’t uploaded anywhere. It has your voice in it, so share it only where
              you want to.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <a href={video.url} download={video.file.name}>
                  <DownloadSimpleIcon weight="bold" /> Download
                </a>
              </Button>
              {canShare && (
                <Button variant="secondary" onClick={() => void share()}>
                  <ShareNetworkIcon weight="bold" /> Share
                </Button>
              )}
              <Button variant="ghost" onClick={() => setVideo(null)}>
                Make it again
              </Button>
            </div>
          </div>
        </div>
      ) : progress != null ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[14px] font-medium">
            <SpinnerGapIcon className="motion-safe:animate-spin" /> Making your video… keep this tab open
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-fill">
            <span className="block h-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${progress})`, transition: 'transform 200ms linear' }} />
          </div>
        </div>
      ) : (
        <Button size="lg" className="h-12 px-6" onClick={() => void make()}>
          <FilmSlateIcon weight="fill" /> Make a video of the two
        </Button>
      )}
    </div>
  )
}

/** Day 1 vs Day 30: one interview answer now, the same one a month later, side by side. */
export function Day30() {
  const username = useSettings((s) => s.username)
  const queryClient = useQueryClient()
  const { data: status, isLoading } = useQuery({ queryKey: ['day30', username], queryFn: () => api.day30Status(username), enabled: !!username })
  const [promptId, setPromptId] = useState('about')
  const [consent, setConsent] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const record = useMutation({
    mutationFn: (clip: Recording) =>
      api.day30Record(username, { audio: clip.blob, filename: clip.filename, promptId, consent: true }),
    onSuccess: (next) => {
      queryClient.setQueryData(['day30', username], next)
      toast.success(next.rounds.length > 1 ? 'Recorded. Here’s how far you’ve come.' : 'Day 1 recorded. See you in a month.')
    },
  })
  const onRecorded = useCallback((clip: Recording) => record.mutate(clip), [record])
  const recorder = useRecorder({ maxSeconds: status?.max_seconds ?? 60, minSeconds: 2, onRecorded })
  const recording = recorder.state === 'recording'
  const remove = useMutation({
    mutationFn: () => api.day30Delete(username),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['day30', username] }),
    onError: showError,
  })

  const rounds = status?.rounds ?? []
  const first = rounds[0]
  const latest = rounds[rounds.length - 1]
  const canRecord = !!status?.next.due && (rounds.length > 0 || consent)
  const toggle = () => {
    if (!canRecord || record.isPending) return
    if (recorder.state === 'idle') audioEngine.stop()
    recorder.toggle()
  }
  useHotkeys({ ' ': toggle })

  if (isLoading || !status) return <Skeleton className="h-72 w-full rounded-[30px]" />

  const question = first?.prompt.text ?? status.prompts.find((p) => p.id === promptId)?.text ?? ''
  const recorderBlock = (
    <div className="space-y-4">
      <AnswerTimer elapsed={recording ? recorder.elapsed : 0} target={[30, 60]} max={status.max_seconds} active={recording} />
      <Button
        size="lg"
        onClick={toggle}
        disabled={!canRecord || record.isPending || recorder.state === 'requesting'}
        className={cn('h-12 px-6 text-[15px]', recording && 'bg-bad hover:bg-bad/90')}
      >
        {record.isPending ? (
          <>
            <SpinnerGapIcon className="motion-safe:animate-spin" /> Listening back…
          </>
        ) : recording ? (
          <>
            <StopIcon weight="fill" /> I’m done
          </>
        ) : (
          <>
            <MicrophoneIcon weight="fill" /> {rounds.length ? 'Record it again' : 'Record day 1'}
          </>
        )}
        <Kbd className="ml-1 hidden bg-white/20 text-white sm:inline-flex">Space</Kbd>
      </Button>
      {record.isError && <p className="text-[14px] text-bad">{errorLine(record.error)}</p>}
    </div>
  )

  return (
    <div className="space-y-5">
      {rounds.length === 0 ? (
        <Panel className="p-6 sm:p-8">
          <h2 className="headline text-[26px] tracking-[-0.02em] sm:text-[30px]">Record your Day 1 answer.</h2>
          <p className="mt-2 max-w-2xl text-[16px] leading-relaxed text-muted-foreground">
            Answer one interview question today, for up to a minute. In {status.every_days} days, answer it again. Then hear the two side
            by side, see what changed, and make a short video to share.
          </p>
          <div role="radiogroup" aria-label="Question" className="mt-6 grid gap-2.5 sm:grid-cols-3">
            {status.prompts.map((p) => (
              <Choice key={p.id} name="day30-prompt" checked={p.id === promptId} onChange={() => setPromptId(p.id)} className="px-4 py-3.5">
                <span className="text-[15px] font-medium">{p.text}</span>
              </Choice>
            ))}
          </div>
          <label className="mt-5 flex items-start gap-3 rounded-2xl bg-fill p-4 text-[14px] leading-relaxed">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--primary)]" />
            <span>
              <b>Keep my recordings.</b> I agree that the app stores this answer (and my later recordings of it) so I can compare them. Only I
              can play them, and I can delete them any time here; deleting my history or account deletes them too. (
              <Link to="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
              )
            </span>
          </label>
          <div className="mt-6">{recorderBlock}</div>
        </Panel>
      ) : (
        <>
          {status.next.due ? (
            <Panel className="p-6 sm:p-8">
              <Pill tone="primary">It’s time</Pill>
              <h2 className="headline mt-3 text-[26px] tracking-[-0.02em] sm:text-[30px]">Answer it again: “{question}”</h2>
              <p className="mt-2 text-[16px] text-muted-foreground">Same question as day 1. Answer naturally; don’t try to repeat what you said.</p>
              <div className="mt-6">{recorderBlock}</div>
            </Panel>
          ) : (
            rounds.length === 1 && (
              <Panel className="p-6 sm:p-8">
                <h2 className="headline text-[26px] tracking-[-0.02em] sm:text-[30px]">Day 1 is in. See you on {longDate(status.next.due_at)}.</h2>
                <p className="mt-2 text-[16px] text-muted-foreground">
                  Keep practising until then. On that day, answer “{question}” again and see the difference.
                </p>
              </Panel>
            )
          )}

          {rounds.length > 1 && first && latest ? (
            <Panel className="p-6 sm:p-8">
              <SectionLabel>
                {dayLabel(first, first)} vs {dayLabel(first, latest)}: “{question}”
              </SectionLabel>
              <div className="grid gap-4 md:grid-cols-2">
                <RoundCard username={username} round={first} label={dayLabel(first, first)} />
                <RoundCard username={username} round={latest} label={dayLabel(first, latest)} highlight />
              </div>
              {status.comparison && (
                <div className="mt-6 grid grid-cols-2 gap-2.5 lg:grid-cols-5">
                  {CHANGES.map(({ key, label }) => {
                    const change = status.comparison?.[key]
                    return change ? <ChangeTile key={key} label={label} change={change} /> : null
                  })}
                </div>
              )}
              <div className="mt-8 border-t border-border pt-6">
                <VideoMaker username={username} status={status} />
              </div>
            </Panel>
          ) : (
            first && (
              <Panel className="p-6 sm:p-8">
                <RoundCard username={username} round={first} label="Day 1" />
              </Panel>
            )
          )}

          <div className="flex justify-center">
            <Button variant="ghost" className="text-muted-foreground" onClick={() => setConfirmDelete(true)}>
              <TrashIcon weight="bold" /> Delete these recordings
            </Button>
          </div>
        </>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete every recording of this answer?</AlertDialogTitle>
            <AlertDialogDescription>The recordings and their numbers are removed for good. You can record a new day 1 afterwards.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()} className="bg-bad text-white hover:bg-bad/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** A way in from the pages people use most. */
export function Day30Link() {
  return (
    <Link
      to="/before-after?mode=interview"
      className="group flex items-center gap-4 rounded-[24px] border border-primary/25 bg-primary-soft px-5 py-4 transition-[background-color,transform] duration-150 ease-out hover:bg-primary-soft/80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:scale-[0.99]"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-white">
        <FilmSlateIcon size={22} weight="fill" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">Day 1 vs Day 30</span>
        <span className="block text-[13px] text-muted-foreground">
          Record one interview answer now and again in a month, then make a video of how far you’ve come.
        </span>
      </span>
      <ArrowRightIcon
        weight="bold"
        className="shrink-0 text-primary transition-transform duration-200 ease-out [@media(hover:hover)_and_(pointer:fine)]:group-hover:translate-x-0.5"
      />
    </Link>
  )
}
