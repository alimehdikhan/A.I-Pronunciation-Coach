import {
  ArrowRightIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CrownIcon,
  FireIcon,
  LockSimpleIcon,
  MapTrifoldIcon,
  MedalIcon,
  MicrophoneIcon,
  ClipboardTextIcon,
  RocketLaunchIcon,
  SparkleIcon,
  StarIcon,
  TargetIcon,
  TrendUpIcon,
  TrophyIcon,
  ArrowsClockwiseIcon,
  type Icon,
} from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { EmptyState, Panel, SectionLabel, Segmented } from '@/components/common'
import { SignInActions } from '@/components/auth/SignInGate'
import { PageHeader } from '@/components/layout/AppShell'
import { SpeakChip } from '@/components/tutor/SpeakButton'
import { Button } from '@/components/ui/button'
import { CountUp, ScoreRing } from '@/components/ui/score-ring'
import { Skeleton } from '@/components/ui/skeleton'
import { describeSound } from '@/lib/plain'
import { useHealth, useJourney } from '@/lib/queries'
import { useVoiceUI } from '@/store/voice'
import type { Badge, Journey, PathUnit } from '@/lib/types'
import { cn } from '@/lib/utils'
import { usePractice } from '@/store/practice'
import { useSettings } from '@/store/settings'

const BADGE_ICONS: Record<string, Icon> = {
  microphone: MicrophoneIcon,
  rocket: RocketLaunchIcon,
  medal: MedalIcon,
  trophy: TrophyIcon,
  star: StarIcon,
  sparkle: SparkleIcon,
  fire: FireIcon,
  crown: CrownIcon,
  check: CheckCircleIcon,
  target: TargetIcon,
}

const STATUS_TEXT: Record<PathUnit['status'], string> = {
  mastered: 'Got it',
  practising: 'Practising',
  started: 'Started',
  new: 'Not started',
}

function LevelCard({ journey }: { journey: Journey }) {
  const { xp } = journey
  const reduce = useReducedMotion()
  return (
    <Panel className="progress-item p-6 sm:p-8">
      <SectionLabel icon={<StarIcon weight="fill" />}>Your level</SectionLabel>
      <div className="flex items-center gap-5">
        <div className="grid size-20 shrink-0 place-items-center rounded-[26px] bg-primary-soft">
          <span className="headline text-[40px] leading-none text-primary tabular-nums">{xp.level}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-semibold">Level {xp.level}</div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-fill">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[#0a84ff] to-[#5e5ce6]"
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${Math.round(xp.progress * 100)}%` }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <div className="mt-1.5 text-[13px] text-muted-foreground">
            {xp.next_level_at - xp.xp} points to level {xp.level + 1} · {xp.xp} points so far
          </div>
        </div>
      </div>
    </Panel>
  )
}

function GoalCard({ journey }: { journey: Journey }) {
  const goal = useSettings((s) => s.dailyGoal)
  const setGoal = useSettings((s) => s.setDailyGoal)
  const { done, target, met, progress } = journey.goal
  return (
    <Panel className="progress-item p-6 sm:p-8">
      <SectionLabel
        icon={<TargetIcon weight="fill" />}
        action={
          <Segmented<string>
            layoutId="daily-goal"
            size="sm"
            value={String(goal)}
            onChange={(v) => setGoal(Number(v))}
            options={['3', '5', '10'].map((v) => ({ value: v, label: v }))}
          />
        }
      >
        Today&rsquo;s goal
      </SectionLabel>
      <div className="flex items-center gap-5">
        <ScoreRing value={Math.round(progress * 100)} size={84} stroke={9}>
          <span className="text-[18px] font-semibold tabular-nums">
            <CountUp value={done} />
            <span className="text-subtle">/{target}</span>
          </span>
        </ScoreRing>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-semibold">{met ? 'Goal reached. Well done!' : `${target - done} more to go`}</div>
          <p className="mt-0.5 text-[14px] text-muted-foreground">
            {met ? 'Keep going if you like. Every try still counts.' : 'Say a phrase, a word or a coach session: each try counts.'}
          </p>
          {journey.streak_days > 0 && (
            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-fill px-2.5 py-1 text-[13px] font-medium">
              <FireIcon size={15} weight="fill" className="text-[#ff453a]" />
              {journey.streak_days} {journey.streak_days === 1 ? 'day' : 'days'} in a row
            </span>
          )}
        </div>
      </div>
    </Panel>
  )
}

function PathCard({ journey }: { journey: Journey }) {
  const navigate = useNavigate()
  const [all, setAll] = useState(false)
  const reduce = useReducedMotion()
  const { units, current, mastered, total } = journey.path
  const currentIndex = Math.max(0, units.findIndex((u) => u.phoneme === current))
  const shown = all ? units : units.slice(0, Math.max(6, currentIndex + 3))

  return (
    <Panel className="progress-item p-6 sm:p-8">
      <SectionLabel
        icon={<MapTrifoldIcon weight="fill" />}
        action={
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {mastered} of {total} sounds mastered
          </span>
        }
      >
        Your learning path
      </SectionLabel>
      <ol className="space-y-2">
        {shown.map((unit, index) => {
          const { spelled, word } = describeSound(unit)
          const isCurrent = unit.phoneme === current
          const percent = unit.clean_rate === null ? 0 : Math.floor(unit.clean_rate * 100 + 1e-9)
          const StatusIcon =
            unit.status === 'mastered' ? CheckCircleIcon : unit.status === 'practising' ? TrendUpIcon : unit.status === 'started' ? TargetIcon : CircleDashedIcon
          return (
            <motion.li
              key={unit.phoneme}
              initial={reduce ? false : { opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(0.4, index * 0.04) }}
              className={cn(
                'flex items-center gap-3 rounded-2xl p-3 sm:gap-4',
                isCurrent ? 'bg-primary-soft ring-1 ring-primary/30' : 'bg-fill',
                unit.status === 'mastered' && 'opacity-80',
              )}
            >
              <span
                className={cn(
                  'grid size-10 shrink-0 place-items-center rounded-full',
                  unit.status === 'mastered' ? 'bg-good-soft text-good' : isCurrent ? 'bg-primary text-primary-foreground' : 'bg-background/60 text-muted-foreground',
                )}
              >
                <StatusIcon size={20} weight={unit.status === 'new' ? 'regular' : 'fill'} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[16px] font-semibold">{word || spelled}</span>
                  <span className="text-[13px] text-muted-foreground">the {spelled} sound</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background/60" aria-hidden>
                    <div
                      className={cn('h-full rounded-full', unit.status === 'mastered' ? 'bg-good' : isCurrent ? 'bg-primary' : 'bg-warn')}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-xs text-subtle">{STATUS_TEXT[unit.status]}</span>
                </div>
              </div>
              <Button
                size="sm"
                variant={isCurrent ? 'default' : 'secondary'}
                onClick={() => navigate(`/coach?focus=${encodeURIComponent(unit.phoneme)}`)}
              >
                {isCurrent ? 'Start' : unit.status === 'mastered' ? 'Refresh' : 'Practise'}
              </Button>
            </motion.li>
          )
        })}
      </ol>
      {units.length > shown.length && (
        <Button variant="ghost" className="mt-3 w-full text-muted-foreground" onClick={() => setAll(true)}>
          Show all {total} sounds
        </Button>
      )}
    </Panel>
  )
}

function ReviewCard({ journey }: { journey: Journey }) {
  const navigate = useNavigate()
  const setTarget = usePractice((s) => s.setTarget)
  return (
    <Panel className="progress-item p-6 sm:p-8">
      <SectionLabel icon={<ArrowsClockwiseIcon weight="fill" />}>Time to review</SectionLabel>
      <p className="-mt-2 mb-4 text-[14px] text-muted-foreground">
        Words you keep missing, back for another go now that you have had a rest. Practising them again a little later is what makes
        them stick.
      </p>
      <ul className="space-y-2">
        {journey.review.map((item) => (
          <li key={item.word} className="flex items-center gap-3 rounded-2xl bg-fill p-3">
            <span className="min-w-0 flex-1">
              <span className="text-[16px] font-semibold">{item.word}</span>
              <span className="ml-2 text-xs text-subtle">
                missed {item.misses} of {item.tries} times
              </span>
            </span>
            <SpeakChip text={item.word} rate={0.8}>
              Hear it
            </SpeakChip>
            <Button
              size="sm"
              onClick={() => {
                setTarget({ text: item.word, source: 'custom' })
                navigate('/')
              }}
            >
              Practise
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function BadgeTile({ badge, index }: { badge: Badge; index: number }) {
  const IconComp = BADGE_ICONS[badge.icon] ?? StarIcon
  const reduce = useReducedMotion()
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: Math.min(0.5, index * 0.03), type: 'spring', stiffness: 320, damping: 26 }}
      className={cn('flex flex-col items-center gap-2 rounded-2xl p-3 text-center', badge.earned ? 'bg-fill' : 'bg-fill/50')}
      title={badge.text}
    >
      <span
        className={cn(
          'grid size-12 place-items-center rounded-full',
          badge.earned ? 'bg-gradient-to-br from-[#ffd60a] to-[#ff9f0a] text-white shadow-md shadow-[#ff9f0a]/30' : 'bg-background/60 text-subtle',
        )}
      >
        {badge.earned ? <IconComp size={24} weight="fill" /> : <LockSimpleIcon size={20} weight="fill" />}
      </span>
      <div>
        <div className={cn('text-[13px] font-semibold leading-tight', !badge.earned && 'text-muted-foreground')}>{badge.title}</div>
        <div className="mt-0.5 text-[11px] text-subtle">{badge.earned ? 'Earned' : `${badge.have} of ${badge.need}`}</div>
      </div>
    </motion.li>
  )
}

function TalkBanner() {
  const open = useVoiceUI((s) => s.setOpen)
  return (
    <Panel className="progress-item flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:p-8">
      <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">
        <MicrophoneIcon size={28} weight="fill" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="headline text-[20px]">Talk to your coach</div>
        <p className="mt-0.5 text-[14px] text-muted-foreground">
          Have a real conversation. The coach answers out loud and helps with the words you find hard as you go.
        </p>
      </div>
      <Button size="lg" onClick={() => open(true)}>
        Start talking <ArrowRightIcon weight="bold" />
      </Button>
    </Panel>
  )
}

function CheckupBanner() {
  return (
    <Panel className="progress-item flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:p-8">
      <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">
        <ClipboardTextIcon size={28} weight="fill" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="headline text-[20px]">Take the 2-minute check-up</div>
        <p className="mt-0.5 text-[14px] text-muted-foreground">
          Say six short sentences and the coach will find where you are strong, where to start, and the level that suits you.
        </p>
      </div>
      <Button asChild size="lg">
        <Link to="/checkup">
          Start <ArrowRightIcon weight="bold" />
        </Link>
      </Button>
    </Panel>
  )
}

/** The whole picture of where you are and what to do next, with the habit loop around it. */
export default function JourneyPage() {
  const username = useSettings((s) => s.username)
  const signedIn = useSettings((s) => !!s.accountEmail)
  const goal = useSettings((s) => s.dailyGoal)
  const { data, isLoading } = useJourney(signedIn ? username : '', goal)
  const { data: health } = useHealth()

  if (!signedIn) {
    return (
      <>
        <PageHeader eyebrow="Journey" title="Your learning journey" description="A path through the sounds, daily goals and badges." />
        <div className="surface">
          <EmptyState
            icon={<MapTrifoldIcon weight="fill" />}
            title="Sign in to start your journey"
            description="Your path, level and goals are saved to your account."
            action={<SignInActions />}
          />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Journey"
        title="Your learning journey"
        description="Where you are, what to practise next, and what is worth coming back for."
      />
      {isLoading || !data ? (
        <div className="space-y-5">
          <Skeleton className="h-40 w-full rounded-[30px]" />
          <Skeleton className="h-72 w-full rounded-[30px]" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <LevelCard journey={data} />
            <GoalCard journey={data} />
          </div>
          {health?.voice_agent && <TalkBanner />}
          {!data.checkup_done && <CheckupBanner />}
          <PathCard journey={data} />
          {data.review.length > 0 && <ReviewCard journey={data} />}
          <Panel className="progress-item p-6 sm:p-8">
            <SectionLabel
              icon={<TrophyIcon weight="fill" />}
              action={
                <span className="text-[13px] text-muted-foreground tabular-nums">
                  {data.badges.filter((b) => b.earned).length} of {data.badges.length}
                </span>
              }
            >
              Badges
            </SectionLabel>
            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {data.badges.map((badge, index) => (
                <BadgeTile key={badge.id} badge={badge} index={index} />
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </>
  )
}
