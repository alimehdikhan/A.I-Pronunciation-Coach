import { cn, formatDuration } from '@/lib/utils'

/**
 * How long the answer has run, against the usual length of a good answer (the green band).
 * The bar grows with transform only, so it stays smooth while the recorder updates it.
 */
export function AnswerTimer({ elapsed, target, max, active }: { elapsed: number; target: [number, number]; max: number; active: boolean }) {
  const [low, high] = target
  const share = Math.min(elapsed / max, 1)
  const over = elapsed > high
  const inBand = elapsed >= low && !over
  return (
    <div>
      <div className="relative h-2 overflow-hidden rounded-full bg-fill" aria-hidden>
        <span
          className="absolute inset-y-0 bg-good/25"
          style={{ left: `${(low / max) * 100}%`, width: `${((Math.min(high, max) - low) / max) * 100}%` }}
        />
        <span
          className={cn('absolute inset-0 origin-left rounded-full', over ? 'bg-warn' : inBand ? 'bg-good' : 'bg-primary')}
          style={{ transform: `scaleX(${share})`, transition: 'transform 120ms linear' }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[13px] tabular-nums">
        <span className={cn('font-medium', active ? 'text-foreground' : 'text-subtle')}>{formatDuration(elapsed)}</span>
        <span className={cn(over && active ? 'font-medium text-warn' : 'text-muted-foreground')}>
          {over && active ? 'Time to wrap up' : `A good answer runs ${formatDuration(low)}–${formatDuration(high)}`}
        </span>
      </div>
    </div>
  )
}
