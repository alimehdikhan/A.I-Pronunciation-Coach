import { ArrowRightIcon, EarIcon, FlagIcon, PlayIcon, SpeakerHighIcon, TrashIcon, UsersThreeIcon } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { SignInActions } from '@/components/auth/SignInGate'
import { EmptyState, Panel, Pill, SectionLabel } from '@/components/common'
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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { audioEngine } from '@/lib/audioEngine'
import { showError } from '@/lib/errors'
import type { ListenerClipResult, ListenerWordResult } from '@/lib/types'
import { cn, relativeTime } from '@/lib/utils'
import { useSettings } from '@/store/settings'

/** Real listeners hear a recording at most twice, as they would in a conversation. */
const MAX_PLAYS = 2

/** Listen to another learner's recording and type what you heard. */
function HelpOthers({ username }: { username: string }) {
  const queryClient = useQueryClient()
  const next = useQuery({ queryKey: ['listener-next', username], queryFn: () => api.listenerNext(username), staleTime: 0 })
  const clip = next.data?.clip ?? null
  const [typed, setTyped] = useState('')
  const [plays, setPlays] = useState(0)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ text: string; words: ListenerWordResult[]; heard: number; total: number } | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const url = useRef<string | null>(null)

  useEffect(() => {
    setTyped('')
    setPlays(0)
    setResult(null)
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = null
  }, [clip?.id])
  useEffect(() => () => void (url.current && URL.revokeObjectURL(url.current)), [])

  const play = async () => {
    if (!clip || plays >= MAX_PLAYS) return
    try {
      setLoading(true)
      if (!url.current) url.current = URL.createObjectURL(await api.listenerAudio(username, clip.id))
      audioEngine.stop()
      audio.current ??= new Audio()
      audio.current.src = url.current
      await audio.current.play()
      setPlays((p) => p + 1)
    } catch (error) {
      showError(error)
    } finally {
      setLoading(false)
    }
  }

  const answer = useMutation({
    mutationFn: () => api.listenerAnswer(username, clip!.id, typed),
    onSuccess: (data) => {
      setResult(data)
      void queryClient.invalidateQueries({ queryKey: ['listener-clips', username] })
    },
    onError: showError,
  })
  const report = useMutation({
    mutationFn: () => api.listenerReport(username, clip!.id),
    onSuccess: () => {
      toast.success('Thanks. That recording won’t be played again.')
      void next.refetch()
    },
    onError: showError,
  })

  return (
    <Panel className="p-6 sm:p-8">
      <SectionLabel
        icon={<EarIcon weight="fill" />}
        action={
          next.data && (
            <span className="text-[13px] text-muted-foreground">
              You’ve helped {next.data.helped + (result ? 1 : 0)} learner{next.data.helped + (result ? 1 : 0) === 1 ? '' : 's'}
            </span>
          )
        }
      >
        Help another learner
      </SectionLabel>
      {next.isLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : !clip ? (
        <EmptyState
          className="py-10"
          icon={<UsersThreeIcon weight="duotone" />}
          title="No recordings to listen to right now"
          description="Learners share new ones every day. Check back later."
          action={
            <Button variant="secondary" onClick={() => void next.refetch()}>
              Check again
            </Button>
          }
        />
      ) : result ? (
        <div className="space-y-5">
          <div>
            <div className="text-[13px] font-medium text-muted-foreground">They said</div>
            <p className="mt-1 flex flex-wrap gap-x-1.5 gap-y-1 text-[22px] leading-snug font-semibold">
              {result.words.map((w, i) => (
                <span
                  key={i}
                  className={cn('rounded-md px-1', w.heard ? 'text-good' : 'bg-bad-soft text-bad')}
                  title={w.heard ? 'You heard this' : w.as ? `You heard “${w.as}”` : 'You missed this'}
                >
                  {w.word}
                </span>
              ))}
            </p>
            <p className="mt-2 text-[15px] text-muted-foreground">
              You understood {result.heard} of {result.total} words. Thank you: they’ll see what real listeners heard.
            </p>
          </div>
          <Button size="lg" className="h-12 px-6" onClick={() => void next.refetch()}>
            Next recording <ArrowRightIcon weight="bold" />
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Listen to a learner say a short sentence ({clip.words} words), then type what you heard. You can play it {MAX_PLAYS} times,
            as you might ask someone to repeat.
          </p>
          <Button variant="secondary" size="lg" className="h-12 px-6" onClick={() => void play()} disabled={loading || plays >= MAX_PLAYS}>
            {plays === 0 ? <PlayIcon weight="fill" /> : <SpeakerHighIcon weight="fill" />}
            {plays === 0 ? 'Play the recording' : plays < MAX_PLAYS ? 'Play once more' : 'Played twice'}
          </Button>
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault()
              if (typed.trim()) answer.mutate()
            }}
          >
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type what you heard"
              aria-label="What you heard"
              maxLength={300}
              disabled={plays === 0}
              className="h-12 flex-1 rounded-xl text-[16px]"
            />
            <Button type="submit" size="lg" className="h-12 px-6" disabled={!typed.trim() || answer.isPending}>
              {answer.isPending ? 'Checking…' : 'Check'}
            </Button>
          </form>
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <FlagIcon weight="bold" /> Report this recording
          </button>
          <AlertDialog open={reportOpen} onOpenChange={setReportOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Report this recording?</AlertDialogTitle>
                <AlertDialogDescription>
                  For a recording that isn’t a sentence, is offensive, or has personal information in it. It will stop being played and
                  its audio is deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => report.mutate()}>Report</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </Panel>
  )
}

function ClipRow({ clip, onDelete }: { clip: ListenerClipResult; onDelete: () => void }) {
  const status = clip.hidden ? (
    <Pill tone="bad">Removed after a report</Pill>
  ) : clip.active ? (
    <Pill tone="good">Being heard</Pill>
  ) : (
    <Pill>Finished</Pill>
  )
  return (
    <li className="py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[17px] font-semibold">{clip.text}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Shared {clip.created_at ? relativeTime(clip.created_at) : ''} · {clip.listeners} listener{clip.listeners === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status}
          <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Delete this recording">
            <TrashIcon weight="bold" />
          </Button>
        </div>
      </div>
      {clip.listeners > 0 ? (
        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className="text-[28px] leading-none font-semibold tabular-nums">{clip.understood}%</span>
            <span className="text-[14px] text-muted-foreground">of your words understood by real listeners</span>
          </div>
          {clip.missed.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {clip.missed.map((w) => (
                <li key={w.word} className="rounded-full bg-bad-soft px-3 py-1.5 text-[13px] text-bad">
                  <b>{w.word}</b>: missed by {w.of - w.heard} of {w.of}
                  {w.heard_as.length ? `, heard as “${w.heard_as.join('”, “')}”` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        clip.active && <p className="mt-3 text-[14px] text-muted-foreground">Waiting for the first listener.</p>
      )}
    </li>
  )
}

/** The learner's shared recordings, and what real people understood of each. */
function MyRecordings({ username }: { username: string }) {
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({ queryKey: ['listener-clips', username], queryFn: () => api.listenerClips(username) })
  const [deleting, setDeleting] = useState<number | null>(null)
  const remove = useMutation({
    mutationFn: (id: number) => api.listenerDelete(username, id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['listener-clips', username] }),
    onError: showError,
  })
  return (
    <Panel className="p-6 sm:p-8">
      <SectionLabel icon={<UsersThreeIcon weight="fill" />}>What real people understood of you</SectionLabel>
      {isLoading ? (
        <Skeleton className="h-32 w-full rounded-2xl" />
      ) : isError ? (
        <p className="text-[14px] text-muted-foreground">Couldn’t load your recordings. Refresh to try again.</p>
      ) : !data?.clips.length ? (
        <EmptyState
          className="py-10"
          icon={<EarIcon weight="duotone" />}
          title="Nothing shared yet"
          description="After a practice attempt, tap “Ask real listeners” under your results. Other learners hear it and type what they heard."
          action={
            <Button asChild variant="secondary">
              <Link to="/practice">Go to practice</Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {data.clips.map((clip) => (
            <ClipRow key={clip.id} clip={clip} onDelete={() => setDeleting(clip.id)} />
          ))}
        </ul>
      )}
      <AlertDialog open={deleting != null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this recording?</AlertDialogTitle>
            <AlertDialogDescription>It stops being played, and its audio and results are deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting != null && remove.mutate(deleting)} className="bg-bad text-white hover:bg-bad/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  )
}

/** Real listeners: help others by listening, and see whether real people understand you. */
export function RealListeners() {
  const username = useSettings((s) => s.username)
  const signedIn = useSettings((s) => !!s.accountEmail)
  if (!signedIn || !username) {
    return (
      <Panel className="p-8 text-center">
        <EarIcon size={36} weight="duotone" className="mx-auto text-primary" />
        <h3 className="mt-3 text-[18px] font-semibold">Would a real person understand you?</h3>
        <p className="mx-auto mt-1.5 max-w-md text-[15px] text-muted-foreground">
          Signed-in learners hear each other’s practice sentences and type what they heard. Sign in to take part.
        </p>
        <div className="mt-6">
          <SignInActions />
        </div>
      </Panel>
    )
  }
  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
        The scorer is a machine. Here, real learners hear each other’s practice sentences (anonymously) and type what they heard, so you
        find out what people actually understand.
      </p>
      <HelpOthers username={username} />
      <MyRecordings username={username} />
    </div>
  )
}
