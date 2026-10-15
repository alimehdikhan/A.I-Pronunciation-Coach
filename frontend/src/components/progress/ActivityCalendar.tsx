import { motion, useReducedMotion } from 'motion/react'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'

const LEVELS = ['bg-fill', 'bg-primary/25', 'bg-primary/45', 'bg-primary/70', 'bg-primary']

function level(count: number): number {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

/** Twelve weeks of practice as a calendar grid, one column per week, Monday at the top. */
export function ActivityCalendar({ days }: { days: { date: string; count: number }[] }) {
  const reduce = useReducedMotion()
  const columns = useMemo(() => {
    const first = days.length ? new Date(`${days[0].date}T00:00:00`) : null
    const lead = first ? (first.getDay() + 6) % 7 : 0 // empty cells before the first day, Monday-based
    const cells: ({ date: string; count: number } | null)[] = [...Array<null>(lead).fill(null), ...days]
    const weeks: (typeof cells)[] = []
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
    return weeks
  }, [days])

  const total = days.reduce((n, d) => n + d.count, 0)
  const active = days.filter((d) => d.count > 0).length

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto pb-1" role="img" aria-label={`${total} attempts on ${active} days in the last twelve weeks`}>
        {columns.map((week, w) => (
          <div key={w} className="flex flex-col gap-1">
            {week.map((cell, d) =>
              cell ? (
                <motion.div
                  key={cell.date}
                  initial={reduce ? false : { opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: Math.min(0.6, w * 0.035 + d * 0.01), type: 'spring', stiffness: 420, damping: 26 }}
                  whileHover={{ scale: 1.25 }}
                  title={`${new Date(`${cell.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${cell.count} ${cell.count === 1 ? 'attempt' : 'attempts'}`}
                  className={cn('size-4 rounded-[5px] sm:size-[18px]', LEVELS[level(cell.count)])}
                />
              ) : (
                <div key={`blank-${d}`} className="size-4 sm:size-[18px]" />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-[12px] text-subtle">
        <span>
          {total} {total === 1 ? 'attempt' : 'attempts'} on {active} {active === 1 ? 'day' : 'days'}
        </span>
        <span className="flex items-center gap-1">
          Less
          {LEVELS.map((c) => (
            <span key={c} className={cn('size-3 rounded-[4px]', c)} />
          ))}
          More
        </span>
      </div>
    </div>
  )
}
