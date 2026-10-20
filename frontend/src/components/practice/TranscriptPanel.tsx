import { PauseIcon, PlayIcon, TextTIcon } from '@phosphor-icons/react'
import { motion, useTransform } from 'motion/react'
import { useMemo } from 'react'
import { SectionLabel, Tip } from '@/components/common'
import { ListenButton } from '@/components/tutor/SpeakButton'
import { useAudioPeaks } from '@/hooks/useAudioPeaks'
import type { Playback } from '@/hooks/usePlayback'
import type { EvaluationResult, WordResult } from '@/lib/types'
import { STATUS_META, TIER_META, cn, formatDuration, wordTier } from '@/lib/utils'
import { useSettings } from '@/store/settings'

type LegendKey = WordResult['status'] | 'check'
const LEGEND: LegendKey[] = ['correct', 'unclear', 'mispronounced', 'check', 'missing', 'extra']

function legendKey(word: WordResult): LegendKey {
  if (word.confirmed === 'fine') return 'correct'
  return wordTier(word) === 'check' ? 'check' : word.status
}

const LEGEND_META: Record<LegendKey, { label: string; color: string; dashed?: boolean }> = {
  ...STATUS_META,
  mispronounced: { label: TIER_META.fix.label, color: TIER_META.fix.color },
  check: { label: TIER_META.check.label, color: TIER_META.check.color, dashed: true },
}

/** The colour a word gets in the waveform. */
function wordColor(word: WordResult): string {
  if (legendKey(word) === 'correct') return 'var(--primary)'
  return wordTier(word) === 'check' ? TIER_META.check.color : STATUS_META[word.status].color
}

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
  const styles: Record<LegendKey, string> = {
    correct: 'text-foreground',
    unclear: 'text-warn decoration-warn/60 underline decoration-dotted decoration-2 underline-offset-[6px]',
    mispronounced: 'text-bad bg-bad-soft',
    // Borderline: softer, with a dashed outline so it never reads as a confirmed mistake (also without colour).
    check: 'text-warn bg-warn-soft outline-2 outline-dashed -outline-offset-2 outline-warn/50',
    missing: 'text-subtle line-through decoration-2',
    extra: 'text-extra text-[0.8em] italic',
  }
  const key = legendKey(word)
  const goal = useSettings((s) => s.goal)
  // Goal "be clearly understood": a sure slip that changes nothing a listener understands is shown quietly.
  const minor = goal === 'understood' && key === 'mispronounced' && word.affects_understanding === false
  return (
    <motion.button
      layout
      type="button"
      onClick={onSelect}
      aria-label={
        [word.display, key === 'check' ? TIER_META.check.label.toLowerCase() : null, word.misheard ? 'a listener may mishear this' : null]
          .filter(Boolean)
          .join(', ') || undefined
      }
      className={cn(
        'word-token relative rounded-[10px] px-1.5 py-0.5 transition-[background,box-shadow,color] duration-200',
        styles[key],
        // Separate from sound slips: a listener would likely not catch this word.
        word.misheard && word.reference && word.status !== 'missing' && 'misheard',
        minor && 'bg-transparent opacity-80 underline decoration-bad/40 decoration-2 underline-offset-[6px]',
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
      return word ? wordColor(word) : 'var(--subtle)'
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
  const statuses = new Set(result.words.map(legendKey))
  return (
    <div className="surface results-item p-6 sm:p-8">
      <SectionLabel
        icon={<TextTIcon weight="fill" />}
        action={
          <div className="hidden flex-wrap justify-end gap-3 sm:flex">
            {result.words.some((w) => w.misheard && w.reference) && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="misheard-swatch" aria-hidden /> May be misheard
              </span>
            )}
            {LEGEND.filter((s) => statuses.has(s)).map((s) => (
              <span key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={cn('size-2 rounded-full', LEGEND_META[s].dashed && 'size-2.5 border border-dashed bg-transparent')}
                  style={LEGEND_META[s].dashed ? { borderColor: LEGEND_META[s].color } : { background: LEGEND_META[s].color }}
                />
                {LEGEND_META[s].label}
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
          <span className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            Your recording{result.speech.wpm ? ` · ${result.speech.wpm} words/min` : ''}
            {result.speech.careful && (
              <Tip
                content={`Under ${result.speech.careful_below ?? 100} words a minute: slow, careful reading scores higher than everyday speech. Try it at the pace you would talk.${result.counted === false ? ' With natural speed on, this attempt doesn’t count toward your sounds, streak or goal.' : ''}`}
              >
                <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[12px] font-medium text-warn">
                  Careful speech{result.counted === false ? ' · not counted' : ''}
                </span>
              </Tip>
            )}
          </span>
          <ListenButton text={result.reference_text} speakKey="compare-native" label="Reference voice" className="h-8 bg-card" />
        </div>
      </div>
    </div>
  )
}
