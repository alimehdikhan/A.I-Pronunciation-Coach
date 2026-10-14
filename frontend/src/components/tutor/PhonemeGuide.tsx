import { ArrowRightIcon, ArrowsLeftRightIcon, HandPointingIcon, LightbulbIcon, QuotesIcon, ShuffleIcon } from '@phosphor-icons/react'
import { useNavigate } from 'react-router'
import { Pill } from '@/components/common'
import { Button } from '@/components/ui/button'
import type { PhonemeDetail } from '@/lib/types'
import { cn } from '@/lib/utils'
import { usePractice } from '@/store/practice'
import { useUI } from '@/store/ui'
import { ListenButton, SpeakChip } from './SpeakButton'

export function PhonemeTile({ symbol, size = 'md', className }: { symbol: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizes = {
    sm: 'size-10 text-xl rounded-[12px]',
    md: 'size-14 text-[28px] rounded-[16px]',
    lg: 'size-[76px] text-[40px] rounded-[22px]',
  }
  return (
    <div
      className={cn(
        'ipa relative grid shrink-0 place-items-center bg-gradient-to-b from-[#f5f5f7] to-[#e8e8ed] font-medium text-foreground shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)] dark:from-[#3a3a3c] dark:to-[#2c2c2e] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]',
        sizes[size],
        className,
      )}
    >
      {symbol}
    </div>
  )
}

export function DifficultyDots({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Difficulty ${level} of 3`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cn('size-1.5 rounded-full', i <= level ? 'bg-[#ff9500]' : 'bg-fill-strong')} />
      ))}
    </span>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h4 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-muted-foreground [&_svg]:size-4 [&_svg]:text-primary">
        {icon}
        {title}
      </h4>
      {children}
    </section>
  )
}

/** Full teaching card for one phoneme. */
export function PhonemeGuide({
  phoneme,
  tip,
  compact = false,
  hidePairs = false,
  onNavigate,
}: {
  phoneme: PhonemeDetail
  tip?: string
  compact?: boolean
  hidePairs?: boolean
  onNavigate?: () => void
}) {
  const navigate = useNavigate()
  const setTarget = usePractice((s) => s.setTarget)
  const openPhoneme = useUI((s) => s.openPhoneme)

  const practiceSentence = () => {
    setTarget({ text: phoneme.practice_sentence, source: 'drill' })
    onNavigate?.()
    navigate('/')
  }

  return (
    <div>
      {!compact && (
        <div className="flex items-center gap-4">
          <PhonemeTile symbol={phoneme.symbol} size="lg" />
          <div className="min-w-0">
            <div className="text-[20px] font-semibold tracking-tight">{phoneme.label}</div>
            <div className="text-[13px] text-muted-foreground">{phoneme.name}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Pill tone="primary" className="capitalize">{phoneme.category}</Pill>
              <Pill className="capitalize">{phoneme.group}</Pill>
              {phoneme.category === 'consonant' && <Pill>{phoneme.voiced ? 'Voiced' : 'Voiceless'}</Pill>}
              <Pill className="gap-1.5">
                <DifficultyDots level={phoneme.difficulty} />
              </Pill>
            </div>
          </div>
        </div>
      )}

      {tip && (
        <div className="mt-6 flex gap-3 rounded-2xl bg-warn-soft p-4">
          <LightbulbIcon size={20} weight="fill" className="mt-0.5 shrink-0 text-[#ff9500]" />
          <p className="text-[14px] leading-relaxed">{tip}</p>
        </div>
      )}

      <Section icon={<HandPointingIcon weight="fill" />} title="How to make it">
        <p className="text-[15px] leading-relaxed text-muted-foreground">{phoneme.placement}</p>
        <ol className="mt-4 space-y-3">
          {phoneme.steps.map((step, i) => (
            <li key={step} className="flex gap-3 text-[15px] leading-relaxed">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Section>

      {!hidePairs && (
      <Section icon={<ArrowsLeftRightIcon weight="bold" />} title="Minimal pairs">
        <p className="-mt-1 mb-3 text-[13px] text-subtle">Hear the difference, then say each pair aloud.</p>
        <div className="space-y-2">
          {phoneme.minimal_pairs.map((pair) => (
            <div key={pair.correct + pair.incorrect} className="flex items-center gap-2">
              <SpeakChip text={pair.correct} tone="good" className="flex-1 justify-center" />
              <span className="text-xs text-subtle">vs</span>
              <SpeakChip text={pair.incorrect} className="flex-1 justify-center" />
            </div>
          ))}
        </div>
      </Section>
      )}

      {!compact && phoneme.common_substitutions.length > 0 && (
        <Section icon={<ShuffleIcon weight="bold" />} title="Often confused with">
          <div className="flex flex-wrap gap-2">
            {phoneme.common_substitutions.map((symbol) => (
              <button
                key={symbol}
                onClick={() => openPhoneme(symbol)}
                className="ipa inline-flex h-9 min-w-11 items-center justify-center rounded-full bg-fill px-3.5 text-base transition-colors hover:bg-fill-strong hover:text-primary"
              >
                /{symbol}/
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section icon={<QuotesIcon weight="fill" />} title="Practise">
        <div className="flex flex-wrap gap-2">
          {phoneme.examples.map((word) => (
            <SpeakChip key={word} text={word} />
          ))}
        </div>
        <div className="mt-3 rounded-2xl bg-fill p-5">
          <p className="text-[19px] leading-snug font-medium tracking-[-0.015em]">“{phoneme.practice_sentence}”</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ListenButton text={phoneme.practice_sentence} rate={0.9} speakKey={`guide:${phoneme.symbol}`} />
            <Button className="h-9 px-4" onClick={practiceSentence}>
              Practise this <ArrowRightIcon weight="bold" />
            </Button>
          </div>
        </div>
      </Section>
    </div>
  )
}
