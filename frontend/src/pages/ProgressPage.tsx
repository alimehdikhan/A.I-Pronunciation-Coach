import {
  ArrowRightIcon,
  CalendarCheckIcon,
  ChartLineUpIcon,
  FireIcon,
  LockKeyIcon,
  TargetIcon,
  TrashIcon,
  TrophyIcon,
  UserCirclePlusIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { EmptyState, Panel, Pill, Segmented, SectionLabel } from '@/components/common'
import { SignInActions } from '@/components/auth/SignInGate'
import { PageHeader } from '@/components/layout/AppShell'
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
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { ActivityRings, CountUp, ScoreRing } from '@/components/ui/score-ring'
import { Skeleton } from '@/components/ui/skeleton'
import { api, ApiError } from '@/lib/api'
import { useScrollReveal, useStaggerIn } from '@/lib/gsap'
import { keys, useAnalytics, useHistory } from '@/lib/queries'
import type { HistoryRecord } from '@/lib/types'
import { METRIC_META, cn, relativeTime, scoreTone, toneText } from '@/lib/utils'
import { usePractice } from '@/store/practice'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'

type TrendMetric = 'score' | 'pronunciation' | 'fluency' | 'clarity'

const TREND_COLORS: Record<TrendMetric, string> = {
  score: 'var(--chart-1)',
  pronunciation: '#fa114f',
  fluency: '#6fd12b',
  clarity: '#00c7ff',
}

function StatTile({ icon: IconComp, color, label, value, suffix, sub }: { icon: Icon; color: string; label: string; value: number; suffix?: string; sub: string }) {
  return (
    <Panel className="progress-item p-5">
      <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color }}>
        <IconComp size={17} weight="fill" />
        {label}
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="headline text-[34px] tabular-nums">
          <CountUp value={value} decimals={value % 1 ? 1 : 0} />
        </span>
        {suffix && <span className="text-[15px] font-medium text-muted-foreground">{suffix}</span>}
      </div>
      <div className="mt-0.5 text-[13px] text-subtle">{sub}</div>
    </Panel>
  )
}

function SessionRow({ record }: { record: HistoryRecord }) {
  const setTarget = usePractice((s) => s.setTarget)
  const navigate = useNavigate()
  const openPhoneme = useUI((s) => s.openPhoneme)
  const sounds = [...new Set(record.mistakes.map((m) => m.expected_phoneme))].slice(0, 4)
  return (
    <div className="session-row flex items-center gap-4 py-3.5">
      <ScoreRing value={record.score} size={44} stroke={4}>
        <span className={cn('text-[13px] font-semibold tabular-nums', toneText[scoreTone(record.score)])}>{Math.round(record.score)}</span>
      </ScoreRing>
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => {
          setTarget({ text: record.target_text, source: 'custom' })
          navigate('/')
        }}
      >
        <div className="truncate text-[15px] font-medium hover:text-primary">{record.target_text}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[13px] text-subtle">
          <span>{relativeTime(record.created_at)}</span>
          {record.difficulty && <span className="capitalize">· {record.difficulty}</span>}
        </div>
      </button>
      <div className="hidden shrink-0 gap-1 sm:flex">
        {sounds.map((symbol) => (
          <button
            key={symbol}
            onClick={() => openPhoneme(symbol)}
            className="ipa grid h-7 min-w-7 place-items-center rounded-full bg-bad-soft px-2 text-[13px] text-bad hover:brightness-110"
          >
            {symbol}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function ProgressPage() {
  const username = useSettings((s) => s.username)
  const signedIn = useSettings((s) => !!s.accountEmail)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  const openPhoneme = useUI((s) => s.openPhoneme)
  const { data: analytics, isLoading, error } = useAnalytics(username)
  const locked = error instanceof ApiError && error.code === 'profile_locked'
  const { data: history } = useHistory(username)
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
  useScrollReveal(scope, '.session-row', [history?.length])

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

  const maxCount = Math.max(1, ...(analytics?.top_weaknesses ?? []).map((w) => w.count))
  const chartConfig = { value: { label: metric === 'score' ? 'Overall' : METRIC_META[metric].label, color: TREND_COLORS[metric] } } satisfies ChartConfig
  const averages = analytics?.metric_averages ?? {}

  return (
    <div ref={scope}>
      <PageHeader
        eyebrow="Progress"
        title={`Nice work, ${username.split(' ')[0]}.`}
        description="Your scores, streaks and the sounds worth practising next."
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
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile icon={ChartLineUpIcon} color="var(--chart-1)" label="Average" value={analytics.average_score} sub="across all sessions" />
            <StatTile icon={TrophyIcon} color="#ff9f0a" label="Best" value={analytics.best_score} sub="personal record" />
            <StatTile
              icon={CalendarCheckIcon}
              color="#30d158"
              label="Sessions"
              value={analytics.total_practice_sessions}
              sub={`${analytics.sessions_this_week} this week`}
            />
            <StatTile
              icon={FireIcon}
              color="#ff453a"
              label="Streak"
              value={analytics.streak_days}
              suffix={analytics.streak_days === 1 ? 'day' : 'days'}
              sub={`${analytics.practice_days} practice ${analytics.practice_days === 1 ? 'day' : 'days'}`}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <Panel className="progress-item p-6 sm:p-8">
              <SectionLabel
                action={
                  <Segmented<TrendMetric>
                    layoutId="trend-metric"
                    size="sm"
                    value={metric}
                    onChange={setMetric}
                    options={[
                      { value: 'score', label: 'Overall' },
                      { value: 'pronunciation', label: 'Sounds' },
                      { value: 'fluency', label: 'Fluency' },
                      { value: 'clarity', label: 'Clarity' },
                    ]}
                  />
                }
              >
                Score trend
              </SectionLabel>
              {trend.length < 2 ? (
                <div className="grid h-[240px] place-items-center text-[15px] text-muted-foreground">
                  Practise a little more to see your trend.
                </div>
              ) : (
                <ChartContainer config={chartConfig} className="aspect-auto h-[240px] w-full">
                  <AreaChart data={trend} margin={{ left: -24, right: 8, top: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} minTickGap={24} />
                    <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tickCount={5} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                    <Area
                      dataKey="value"
                      type="monotone"
                      stroke="var(--color-value)"
                      strokeWidth={2.5}
                      fill="url(#trendFill)"
                      connectNulls
                      dot={false}
                      activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--card)' }}
                    />
                  </AreaChart>
                </ChartContainer>
              )}
            </Panel>

            <Panel className="progress-item flex flex-col p-6 sm:p-8">
              <SectionLabel>Averages</SectionLabel>
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
                    <div key={key} className="flex items-center gap-2.5">
                      <span className={cn('size-2.5 rounded-full', ['bg-[#fa114f]', 'bg-[#92e82a]', 'bg-[#1eeaef]'][i])} />
                      <span className="flex-1 text-[14px] text-muted-foreground">{METRIC_META[key].label}</span>
                      <span className="text-[15px] font-semibold tabular-nums">{averages[key] != null ? Math.round(averages[key]!) : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] lg:items-start">
            <Panel className="progress-item p-6 sm:p-8">
              <SectionLabel
                action={
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/drills">
                      Drills <ArrowRightIcon weight="bold" />
                    </Link>
                  </Button>
                }
              >
                Trouble sounds
              </SectionLabel>
              {analytics.top_weaknesses.length === 0 ? (
                <p className="text-[15px] text-muted-foreground">No recurring mistakes yet. Impressive.</p>
              ) : (
                <ul className="space-y-1">
                  {analytics.top_weaknesses.map((w) => (
                    <li key={w.phoneme}>
                      <button
                        type="button"
                        onClick={() => openPhoneme(w.phoneme)}
                        className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-fill"
                      >
                        <span className="ipa grid size-10 shrink-0 place-items-center rounded-[12px] bg-fill text-[20px]">{w.phoneme}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[14px] font-medium">{w.label ?? w.phoneme}</span>
                            <span className="text-xs text-subtle tabular-nums">{w.count}×</span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill">
                            <div className="h-full rounded-full bg-gradient-to-r from-[#ff9500] to-[#ff3b30]" style={{ width: `${(w.count / maxCount) * 100}%` }} />
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel className="progress-item p-6 sm:p-8">
              <SectionLabel action={<Pill>{history?.length ?? 0} recent</Pill>}>Recent sessions</SectionLabel>
              <div className="divide-y divide-border">
                {history?.map((record) => <SessionRow key={record.id} record={record} />)}
              </div>
              {history && history.length === 0 && <p className="text-[15px] text-muted-foreground">Nothing here yet.</p>}
              <Button asChild variant="secondary" className="mt-5 w-full">
                <Link to="/drills">
                  <TargetIcon weight="bold" /> Work on your weakest sound
                </Link>
              </Button>
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
