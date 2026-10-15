import { FireIcon, TrendDownIcon, TrendUpIcon, TrophyIcon, CalendarCheckIcon } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { Panel } from '@/components/common'
import { CountUp, ScoreRing } from '@/components/ui/score-ring'
import { Skeleton } from '@/components/ui/skeleton'
import { useProgressReport } from '@/lib/queries'
import type { Analytics } from '@/lib/types'
import { cn, scoreTone, toneText } from '@/lib/utils'
import { useSettings } from '@/store/settings'

function Fact({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-fill px-3 py-1.5 text-[13px] font-medium">
      {icon}
      {children}
    </span>
  )
}

/** What matters first: how you are doing, said in a sentence, with the three numbers people ask about. */
export function ProgressHero({ username, analytics }: { username: string; analytics: Analytics }) {
  const language = useSettings((s) => s.nativeLanguage)
  const { data, isLoading } = useProgressReport(username, analytics.total_practice_sessions, language)
  const reduce = useReducedMotion()
  const report = data?.report
  const change = analytics.improvement ? Math.round(analytics.improvement.change) : null
  const average = Math.round(analytics.average_score)

  return (
    <Panel className="progress-item p-6 sm:p-8">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <ScoreRing value={average} size={132} stroke={12}>
            <span className={cn('headline text-[38px] tabular-nums', toneText[scoreTone(average)])}>
              <CountUp value={average} />
            </span>
          </ScoreRing>
          <span className="text-[13px] font-medium text-muted-foreground">Your usual score</span>
        </div>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          {isLoading ? (
            <>
              <Skeleton className="mx-auto h-6 w-3/4 sm:mx-0" />
              <Skeleton className="mx-auto mt-3 h-4 w-full sm:mx-0" />
            </>
          ) : (
            <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              <h2 className="headline text-[24px] leading-tight">
                {report?.headline ?? (change !== null && change > 0 ? `Up ${change} points since you started` : 'Keep going, you are building a habit')}
              </h2>
              {report?.summary && <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{report.summary}</p>}
            </motion.div>
          )}

          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            <Fact icon={<TrophyIcon size={15} weight="fill" className="text-[#ff9f0a]" />}>Best {Math.round(analytics.best_score)}</Fact>
            <Fact icon={<FireIcon size={15} weight="fill" className="text-[#ff453a]" />}>
              {analytics.streak_days} {analytics.streak_days === 1 ? 'day' : 'days'} in a row
            </Fact>
            <Fact icon={<CalendarCheckIcon size={15} weight="fill" className="text-[#30d158]" />}>
              {analytics.sessions_this_week} {analytics.sessions_this_week === 1 ? 'practice' : 'practices'} this week
            </Fact>
            {change !== null && change !== 0 && (
              <Fact
                icon={
                  change > 0 ? (
                    <TrendUpIcon size={15} weight="bold" className="text-good" />
                  ) : (
                    <TrendDownIcon size={15} weight="bold" className="text-warn" />
                  )
                }
              >
                {change > 0 ? `Up ${change}` : `Down ${Math.abs(change)}`} since you started
              </Fact>
            )}
          </div>
        </div>
      </div>
    </Panel>
  )
}
