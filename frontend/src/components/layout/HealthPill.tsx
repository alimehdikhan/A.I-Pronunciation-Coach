import { StatusDot, Tip } from '@/components/common'
import { useHealth } from '@/lib/queries'
import { cn } from '@/lib/utils'

/** Live status of the speech model behind the API. */
export function HealthPill({ className }: { className?: string }) {
  const { data, isError } = useHealth()
  const state = isError ? 'offline' : data?.models_loaded ? 'ready' : 'loading'
  const meta = {
    ready: { dot: 'bg-good', label: 'Coach ready', tip: [
        `Whisper ${data?.model_size}`,
        data?.acoustic_scoring ? 'acoustic sound scoring' : `${data?.phoneme_backend} phonemes`,
        data?.coach_llm ? 'AI coach' : 'built-in tips',
      ].join(' · '),
    },
    loading: { dot: 'bg-warn', label: 'Warming up', tip: 'The speech model is loading. This takes up to a minute on first start.' },
    offline: { dot: 'bg-bad', label: 'Offline', tip: 'Cannot reach the server.' },
  }[state]

  return (
    <Tip content={meta.tip} side="top">
      <div className={cn('inline-flex h-7 items-center gap-2 rounded-full px-2.5 text-xs font-medium text-muted-foreground', className)}>
        <StatusDot className={meta.dot} pulse={state !== 'ready'} />
        {meta.label}
      </div>
    </Tip>
  )
}
