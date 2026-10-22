import { CheckIcon, FireIcon } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { useId } from 'react'
import { Link } from 'react-router'
import { Tip } from '@/components/common'
import { useJourney } from '@/lib/queries'
import { useSettings } from '@/store/settings'

const RING = 26
const STROKE = 3.5

/** Today's progress as a small activity ring, in the colours of the progress page's rings. */
function GoalRing({ value, met }: { value: number; met: boolean }) {
  const gradient = `goal-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const radius = (RING - STROKE) / 2
  const circumference = 2 * Math.PI * radius
  return (
    <span aria-hidden className="relative grid shrink-0 place-items-center" style={{ width: RING, height: RING }}>
      <svg width={RING} height={RING} className="-rotate-90">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--ring-move-a)" />
            <stop offset="1" stopColor="var(--ring-move-b)" />
          </linearGradient>
        </defs>
        <circle cx={RING / 2} cy={RING / 2} r={radius} fill="none" stroke="var(--ring-move-a)" strokeOpacity={0.22} strokeWidth={STROKE} />
        {value > 0 && (
          <motion.circle
            cx={RING / 2}
            cy={RING / 2}
            r={radius}
            fill="none"
            stroke={`url(#${gradient})`}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - value) }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
      </svg>
      {met && <CheckIcon size={11} weight="bold" className="absolute text-[var(--ring-move-a)]" />}
    </span>
  )
}

/** Today's goal and streak, always in view on the practice page. Taps through to the journey. */
export function GoalChip() {
  const username = useSettings((s) => s.username)
  const signedIn = useSettings((s) => !!s.accountEmail)
  const goal = useSettings((s) => s.dailyGoal)
  const { data } = useJourney(signedIn ? username : '', goal)
  if (!data) return null
  const { done, target, met } = data.goal
  return (
    <Tip content={met ? 'Daily goal reached. Nice.' : `${target - done} more to reach today's goal`}>
      <Link
        to="/journey"
        aria-label={`${done} of ${target} practised today${data.streak_days > 0 ? `, a ${data.streak_days}-day streak` : ''}`}
        className="inline-flex h-9 items-center gap-2 rounded-full bg-fill py-1 pr-3 pl-1.5 text-[13px] font-semibold transition-colors hover:bg-fill-strong"
      >
        <GoalRing value={target > 0 ? Math.min(1, done / target) : 0} met={met} />
        <span className="tabular-nums">
          {done}
          <span className="text-subtle">/{target}</span>
        </span>
        <span className="font-medium text-muted-foreground">today</span>
        {data.streak_days > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[#ff453a] tabular-nums">
            <FireIcon size={15} weight="fill" /> {data.streak_days}
          </span>
        )}
      </Link>
    </Tip>
  )
}
