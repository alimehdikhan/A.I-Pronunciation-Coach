import { PauseIcon, PlayIcon } from '@phosphor-icons/react'
import { motion, useTransform } from 'motion/react'
import { useMemo } from 'react'
import { SectionLabel } from '@/components/common'
import { ListenButton } from '@/components/tutor/SpeakButton'
import { useAudioPeaks } from '@/hooks/useAudioPeaks'
import type { Playback } from '@/hooks/usePlayback'
import type { EvaluationResult, WordResult } from '@/lib/types'
import { STATUS_META, cn, formatDuration } from '@/lib/utils'

const LEGEND: WordResult['status'][] = ['correct', 'unclear', 'mispronounced', 'missing', 'extra']

function WordToken({
  word,
  selected,
  active,
  onSelect,
}: {
  word: WordResult
  selected: boolean
  active: boolean
  onSelect: () => void
}) {
  const styles: Record<WordResult['status'], string> = {
    correct: 'text-foreground',
    unclear: 'text-warn decoration-warn/60 underline decoration-dotted decoration-2 underline-offset-[6px]',
    mispronounced: 'text-bad bg-bad-soft',
    missing: 'text-subtle line-through decoration-2',
    extra: 'text-extra text-[0.8em] italic',
  }
  return (
    <motion.button
      layout
      type="button"
      onClick={onSelect}
      className={cn(
        'word-token relative rounded-[10px] px-1.5 py-0.5 transition-[background,box-shadow,color] duration-200',
        styles[word.status],
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-card',
        active && 'bg-primary-soft text-primary',
      )}
    >
      {word.status === 'extra' ? `+${word.display}` : word.display}
    </motion.button>
  )
}

function Waveform({ result, blob, playback, onSelect }: { result: EvaluationResult; blob: Blob; playback: Playback; onSelect: (i: number) => void }) {
  const data = useAudioPeaks(blob, 96)
  const duration = data?.duration || playback.duration || result.speech.duration || 1
  const clip = useTransform(playback.position, (t) => `inset(0 ${100 - Math.min(100, (t / duration) * 100)}% 0 0)`)

  const colors = useMemo(() => {
    if (!data) return []
    return data.peaks.map((_, i) => {
      const t = ((i + 0.5) / data.peaks.length) * duration
      const word = result.words.find((w) => w.start != null && w.end != null && t >= w.start && t <= w.end)
      if (!word) return 'var(--subtle)'
      return word.status === 'correct' ? 'var(--primary)' : STATUS_META[word.status].color
    })
  }, [data, duration, result.words])

  const bars = (dim: boolean) =>
    data?.peaks.map((peak, i) => (
      <span
        key={i}
        className="w-full rounded-full"
        style={{ height: `${Math.max(8, peak * 100)}%`, background: colors[i], opacity: dim ? 0.28 : 1 }}
      />
    ))

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={playback.toggle}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-foreground text-background transition-transform active:scale-95"
        aria-label={playback.playing ? 'Pause your recording' : 'Play your recording'}
      >
        {playback.playing ? <PauseIcon size={18} weight="fill" /> : <PlayIcon size={18} weight="fill" className="translate-x-px" />}
      </button>
      <div
        className="relative h-12 flex-1 cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const t = ((e.clientX - rect.left) / rect.width) * duration
          playback.seek(t)
          const word = result.words.find((w) => w.start != null && w.end != null && t >= w.start && t <= w.end)
          if (word) onSelect(word.index)
        }}
      >
        {data ? (
          <>
            <div className="absolute inset-0 flex items-center gap-[2px]">{bars(true)}</div>
            <motion.div className="absolute inset-0 flex items-center gap-[2px]" style={{ clipPath: clip }}>
              {bars(false)}
            </motion.div>
          </>
        ) : (
          <div className="skeleton-shimmer h-full rounded-xl" />
        )}
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-xs text-subtle tabular-nums">{formatDuration(duration)}</span>
    </div>
  )
}

export function TranscriptPanel({
  result,
  blob,
  playback,
  selected,
  onSelect,
}: {
  result: EvaluationResult
  blob: Blob
  playback: Playback
  selected: number | null
  onSelect: (index: number) => void
}) {
  const statuses = new Set(result.words.map((w) => w.status))
  return (
    <div className="surface results-item p-6 sm:p-8">
      <SectionLabel
        action={
          <div className="hidden flex-wrap justify-end gap-3 sm:flex">
            {LEGEND.filter((s) => statuses.has(s)).map((s) => (
              <span key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-2 rounded-full" style={{ background: STATUS_META[s].color }} />
                {STATUS_META[s].label}
              </span>
            ))}
          </div>
        }
      >
        Word by word
      </SectionLabel>

      <div className="flex flex-wrap gap-x-1 gap-y-2 font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] sm:text-[30px]">
        {result.words.map((word) => (
          <WordToken
            key={word.index}
            word={word}
            selected={selected === word.index}
            active={playback.activeIndex === word.index}
            onSelect={() => onSelect(word.index)}
          />
        ))}
      </div>

      <p className="mt-4 text-[15px] text-muted-foreground">
        <span className="text-subtle">Heard: </span>“{result.transcription || '…nothing — try speaking a little louder'}”
      </p>

      <div className="mt-6 rounded-2xl bg-fill p-4">
        <Waveform result={result} blob={blob} playback={playback} onSelect={onSelect} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <span className="text-[13px] text-muted-foreground">
            Your recording{result.speech.wpm ? ` · ${result.speech.wpm} words/min` : ''}
          </span>
          <ListenButton text={result.reference_text} speakKey="compare-native" label="Reference voice" className="h-8 bg-card" />
        </div>
      </div>
    </div>
  )
}
