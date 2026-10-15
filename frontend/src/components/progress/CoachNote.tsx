import { SparkleIcon } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { Panel, SectionLabel } from '@/components/common'
import { Skeleton } from '@/components/ui/skeleton'
import { useProgressReport } from '@/lib/queries'
import { useSettings } from '@/store/settings'

/** A short note from the coach on how things are going, written from the learner's own numbers. */
export function CoachNote({ username, sessions }: { username: string; sessions: number }) {
  const language = useSettings((s) => s.nativeLanguage)
  const { data, isLoading } = useProgressReport(username, sessions, language)
  const reduce = useReducedMotion()
  const report = data?.report

  if (isLoading) {
    return (
      <Panel className="progress-item p-6 sm:p-8">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-3/4" />
      </Panel>
    )
  }
  if (!report) return null

  return (
    <Panel className="progress-item p-6 sm:p-8">
      <SectionLabel icon={<SparkleIcon weight="fill" />}>From your coach</SectionLabel>
      <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <h2 className="headline text-[22px]">{report.headline}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{report.summary}</p>
        {(report.wins.length > 0 || report.next_steps.length > 0) && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {report.wins.length > 0 && (
              <div>
                <div className="mb-1.5 text-[13px] font-semibold text-good">Going well</div>
                <ul className="space-y-1.5 text-[14px]">
                  {report.wins.map((win) => (
                    <li key={win}>{win}</li>
                  ))}
                </ul>
              </div>
            )}
            {report.next_steps.length > 0 && (
              <div>
                <div className="mb-1.5 text-[13px] font-semibold text-primary">Next</div>
                <ul className="space-y-1.5 text-[14px]">
                  {report.next_steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {data?.source === 'template' && <p className="mt-3 text-xs text-subtle">Written from your stats by the built-in coach.</p>}
      </motion.div>
    </Panel>
  )
}
