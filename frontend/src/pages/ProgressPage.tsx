import { ArrowRightIcon, CalendarBlankIcon, ChartLineUpIcon, GaugeIcon, LockKeyIcon, SparkleIcon, TrashIcon, UserCirclePlusIcon, WarningCircleIcon, WaveformIcon } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { EmptyState, Panel, Segmented, SectionLabel } from '@/components/common'
import { SignInActions } from '@/components/auth/SignInGate'
import { PageHeader } from '@/components/layout/AppShell'
import { ActivityCalendar } from '@/components/progress/ActivityCalendar'
import { HistoryPanel } from '@/components/progress/HistoryPanel'
import { FocusSounds } from '@/components/progress/FocusSounds'
import { ProgressHero } from '@/components/progress/ProgressHero'
import { SoundMasteryGrid } from '@/components/progress/SoundMasteryGrid'
import { TrendChart } from '@/components/progress/TrendChart'
import { TrickyWords } from '@/components/progress/TrickyWords'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { MetricIcon } from '@/components/practice/ScoreSummary'
import { ActivityRings } from '@/components/ui/score-ring'
import { Skeleton } from '@/components/ui/skeleton'
import { api, ApiError } from '@/lib/api'
import { useScrollReveal, useStaggerIn } from '@/lib/gsap'
import { keys, useAnalytics } from '@/lib/queries'
import { SCORE_WORDS } from '@/lib/plain'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'

type TrendMetric = 'score' | 'pronunciation' | 'fluency' | 'clarity'

const TREND_COLORS: Record<TrendMetric, string> = {
  score: 'var(--chart-1)',
  pronunciation: '#fa114f',
  fluency: '#6fd12b',
  clarity: '#00c7ff',
}

export default function ProgressPage() {
  const username = useSettings((s) => s.username)
  const signedIn = useSettings((s) => !!s.accountEmail)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  const { data: analytics, isLoading, error } = useAnalytics(username)
  const locked = error instanceof ApiError && error.code === 'profile_locked'
  const [metric, setMetric] = useState<TrendMetric>('score')
  const queryClient = useQueryClient()
  const scope = useRef<HTMLDivElement>(null)

  const reset = useMutation({
    mutationFn: () => api.resetHistory(username),
    onSuccess: (r) => {
      toast.success(`Cleared ${r.deleted} session${r.deleted === 1 ? '' : 's'}`)
      void queryClient.invalidateQueries({ queryKey: keys.analytics(username) })
      void queryClient.invalidateQueries({ queryKey: keys.history(username) })
      void queryClient.invalidateQueries({ queryKey: keys.practice(username) })
    },
  })

  const trend = useMemo(
    () =>
      (analytics?.score_trend ?? []).map((point, i) => ({
        i,
        label: new Date(point.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        value: point[metric] ?? null,
      })),
    [analytics, metric],
  )

  const hasData = !!analytics && analytics.total_practice_sessions > 0
  useStaggerIn(scope, '.progress-item', [hasData])
  useScrollReveal(scope, '.session-row', [hasData])

  if (!signedIn) {
    return (
      <>
        <PageHeader eyebrow="Progress" title="Your progress" description="Streaks, trends and the sounds to work on." />
        <div className="surface">
          <EmptyState
            icon={<LockKeyIcon weight="fill" />}
            title="Sign in to see your progress"
            description="Scores, streaks and history are part of your account."
            action={<SignInActions />}
          />
        </div>
      </>
    )
  }

  if (!username) {
    return (
      <>
        <PageHeader eyebrow="Progress" title="See how far you’ve come." />
        <Panel>
          <EmptyState
            icon={<UserCirclePlusIcon weight="fill" />}
            title="Add your name to track progress"
            description="Scores, streaks and your trouble sounds are saved under your name."
            action={
              <Button size="lg" onClick={() => setSettingsOpen(true)}>
                Add your name
              </Button>
            }
          />
        </Panel>
      </>
    )
  }

  const averages = analytics?.metric_averages ?? {}

  return (
    <div ref={scope}>
      <PageHeader
        eyebrow="Progress"
        title={`Nice work, ${username.split(' ')[0]}.`}
        description="How you are doing, and what to practise next."
        actions={
          hasData && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" className="text-muted-foreground">
                  <TrashIcon weight="bold" /> Reset
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset all progress?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes {analytics.total_practice_sessions} saved sessions for {username}. This can’t be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => reset.mutate()}>
                    Delete history
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )
        }
      />

      {isLoading && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-[30px]" />
          ))}
        </div>
      )}

      {!isLoading && !hasData && locked && (
        <Panel>
          <EmptyState
            icon={<UserCirclePlusIcon weight="fill" />}
            title="This name is in use on another device"
            description="Progress saved under this name belongs to the device that created it. Choose a different name to track your own."
            action={
              <Button size="lg" onClick={() => setSettingsOpen(true)}>
                Choose a name
              </Button>
            }
          />
        </Panel>
      )}

      {!isLoading && !hasData && !locked && (
        <Panel>
          <EmptyState
            icon={<ChartLineUpIcon weight="fill" />}
            title="No sessions yet"
            description="Record your first phrase and your progress will appear here."
            action={
              <Button asChild size="lg">
                <Link to="/">
                  Start practising <ArrowRightIcon weight="bold" />
                </Link>
              </Button>
            }
          />
        </Panel>
      )}

      {hasData && (
        <div className="space-y-5">
          <ProgressHero username={username} analytics={analytics} />

          <FocusSounds sounds={analytics.sound_mastery ?? []} />

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <Panel className="progress-item p-6 sm:p-8">
              <SectionLabel
                icon={<ChartLineUpIcon weight="fill" />}
                action={
                  <Segmented<TrendMetric>
                    layoutId="trend-metric"
                    size="sm"
                    value={metric}
                    onChange={setMetric}
                    options={[
                      { value: 'score', label: 'Overall', icon: <ChartLineUpIcon weight="bold" /> },
                      { value: 'pronunciation', label: SCORE_WORDS.pronunciation.label, icon: <WaveformIcon weight="bold" /> },
                      { value: 'fluency', label: SCORE_WORDS.fluency.label, icon: <GaugeIcon weight="bold" /> },
                      { value: 'clarity', label: SCORE_WORDS.clarity.label, icon: <SparkleIcon weight="bold" /> },
                    ]}
                  />
                }
              >
                Your scores over time
              </SectionLabel>
              {trend.length < 2 ? (
                <div className="grid h-[240px] place-items-center text-[15px] text-muted-foreground">
                  Practise a little more to see your trend.
                </div>
              ) : (
                <TrendChart points={trend.map((p) => ({ label: p.label, value: p.value }))} color={TREND_COLORS[metric]} />
              )}
            </Panel>

            <Panel className="progress-item flex flex-col p-6 sm:p-8">
              <SectionLabel icon={<GaugeIcon weight="fill" />}>How you score</SectionLabel>
              <div className="flex flex-1 flex-col items-center justify-center gap-6 sm:flex-row lg:flex-col xl:flex-row">
                <ActivityRings
                  size={150}
                  stroke={16}
                  gap={3}
                  rings={[
                    { value: averages.pronunciation ?? null, from: 'var(--ring-move-a)', to: 'var(--ring-move-b)' },
                    { value: averages.fluency ?? null, from: 'var(--ring-exercise-a)', to: 'var(--ring-exercise-b)' },
                    { value: averages.clarity ?? null, from: 'var(--ring-stand-a)', to: 'var(--ring-stand-b)' },
                  ]}
                />
                <div className="w-full space-y-3">
                  {(['pronunciation', 'fluency', 'clarity'] as const).map((key, i) => (
                    <div key={key} className="flex items-start gap-2.5">
                      <MetricIcon Icon={[WaveformIcon, GaugeIcon, SparkleIcon][i]} color={['#fa114f', '#6fd12b', '#00b8d9'][i]} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[14px] font-medium">{SCORE_WORDS[key].label}</span>
                          <span className="text-[15px] font-semibold tabular-nums">{averages[key] != null ? Math.round(averages[key]!) : '—'}</span>
                        </div>
                        <div className="text-xs text-subtle">{SCORE_WORDS[key].hint}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          </div>

          {!!analytics.sound_mastery?.length && (
            <Panel className="progress-item p-6 sm:p-8">
              <SectionLabel icon={<WaveformIcon weight="fill" />}>Sound mastery</SectionLabel>
              <SoundMasteryGrid sounds={analytics.sound_mastery} />
            </Panel>
          )}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
            <Panel className="progress-item p-6 sm:p-8">
              <SectionLabel icon={<CalendarBlankIcon weight="fill" />}>Practice calendar</SectionLabel>
              <ActivityCalendar days={analytics.daily_activity ?? []} />
            </Panel>
            {!!analytics.tricky_words?.length && (
              <Panel className="progress-item p-6 sm:p-8">
                <SectionLabel icon={<WarningCircleIcon weight="fill" />}>Tricky words</SectionLabel>
                <TrickyWords words={analytics.tricky_words} />
              </Panel>
            )}
          </div>

          <HistoryPanel username={username} />
        </div>
      )}
    </div>
  )
}
