import { CheckCircleIcon, FireIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import { Tip } from '@/components/common'
import { useJourney } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'

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
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-semibold transition-colors',
          met ? 'bg-good-soft text-good' : 'bg-fill text-foreground hover:bg-fill-strong',
        )}
      >
        {met ? <CheckCircleIcon size={17} weight="fill" /> : <span className="tabular-nums">{done}/{target}</span>}
        <span className="font-medium text-muted-foreground">today</span>
        {data.streak_days > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[#ff453a]">
            <FireIcon size={15} weight="fill" /> {data.streak_days}
          </span>
        )}
      </Link>
    </Tip>
  )
}
