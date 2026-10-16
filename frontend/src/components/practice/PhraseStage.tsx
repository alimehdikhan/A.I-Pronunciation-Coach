import { CaretLeftIcon, CaretRightIcon, MagicWandIcon, PencilSimpleIcon, SpinnerGapIcon, SquaresFourIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Pill, Tip } from '@/components/common'
import { ListenButton } from '@/components/tutor/SpeakButton'
import { Button } from '@/components/ui/button'
import { usePronunciation } from '@/lib/queries'
import type { Phrase } from '@/lib/sentences'
import { cn } from '@/lib/utils'
import type { Target } from '@/store/practice'
import { useSettings } from '@/store/settings'

const SOURCE_LABEL: Record<Target['source'], string> = {
  library: '',
  custom: 'Your text',
  drill: 'Sound drill',
  word: 'Single word',
}

/** The phrase to say: large type with IPA beneath each word. */
export function PhraseStage({
  target,
  phrase,
  position,
  onPrev,
  onNext,
  onBrowse,
  onSuggest,
  suggesting,
  children,
}: {
  target: Target
  phrase?: Phrase
  position?: { index: number; total: number }
  onPrev: () => void
  onNext: () => void
  onBrowse: () => void
  /** Ask the coach for a new sentence aimed at the learner's weakest sound. */
  onSuggest?: () => void
  suggesting?: boolean
  children?: ReactNode
}) {
  const style = useSettings((s) => s.phoneticStyle)
  const { data: pronunciation } = usePronunciation(target.text)
  const words = target.text.split(/\s+/).filter(Boolean)
  const long = target.text.length > 70

  return (
    <div className="surface relative overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pt-5 sm:px-7 sm:pt-6">
        <div className="flex min-w-0 items-center gap-2">
          {/* The library category is the first thing to give up on a phone; "Your text" and the like stay. */}
          {phrase ? <Pill className="max-sm:hidden">{phrase.category}</Pill> : <Pill tone="primary">{SOURCE_LABEL[target.source]}</Pill>}
          {position && target.source === 'library' && (
            <span className="text-xs font-medium whitespace-nowrap text-subtle tabular-nums">
              {position.index + 1} of {position.total}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Tip content="Previous (←)">
            <Button variant="ghost" size="icon-sm" onClick={onPrev} aria-label="Previous phrase">
              <CaretLeftIcon weight="bold" />
            </Button>
          </Tip>
          <Tip content="Next (N)">
            <Button variant="ghost" size="icon-sm" onClick={onNext} aria-label="Next phrase">
              <CaretRightIcon weight="bold" />
            </Button>
          </Tip>
          {onSuggest && (
            <Tip content="A new sentence for your weakest sound">
              <Button variant="secondary" size="sm" onClick={onSuggest} disabled={suggesting} className="ml-1">
                {suggesting ? <SpinnerGapIcon className="animate-spin" /> : <MagicWandIcon weight="bold" />} For me
              </Button>
            </Tip>
          )}
          <Button variant="secondary" size="sm" onClick={onBrowse} className="ml-1">
            <SquaresFourIcon weight="bold" /> Phrases
          </Button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={target.text}
          initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
          transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
          className="px-5 pt-8 pb-6 text-center sm:px-12 sm:pt-10"
        >
          <p
            className={cn(
              'mx-auto flex max-w-3xl flex-wrap justify-center gap-x-[0.32em] gap-y-3 font-display font-semibold tracking-[-0.03em] text-balance',
              long ? 'text-[26px] leading-[1.15] sm:text-[32px]' : 'text-[30px] leading-[1.1] sm:text-[42px]',
            )}
          >
            {words.map((word, i) => {
              const entry = pronunciation?.words[i]
              const ipa = entry?.ipa
              // Plain letters by default; fall back to the symbols for a word the dictionary cannot spell out.
              const simple = entry?.respelling
              const shown = style === 'ipa' ? (ipa ? `/${ipa}/` : null) : (simple ?? (ipa ? `/${ipa}/` : null))
              const asSymbols = style === 'ipa' || !simple
              return (
                <span key={`${word}-${i}`} className="inline-flex flex-col items-center">
                  <span>{word}</span>
                  {style !== 'off' && (
                    <span
                      className={cn(
                        'mt-1 text-[13px] font-normal tracking-normal text-subtle transition-opacity sm:text-[15px]',
                        asSymbols && 'ipa',
                        shown ? 'opacity-100' : 'opacity-0',
                      )}
                    >
                      {shown ?? '·'}
                    </span>
                  )}
                </span>
              )
            })}
          </p>
          <div className="mt-7 flex items-center justify-center gap-2">
            <ListenButton text={target.text} speakKey="stage-normal" label="Listen" />
            <ListenButton text={target.text} speakKey="stage-slow" rate={0.7} label="Slowly" />
            {target.source === 'custom' && (
              <Button variant="ghost" size="sm" onClick={onBrowse} className="h-9">
                <PencilSimpleIcon weight="bold" /> Edit
              </Button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {children && <div className="border-t border-border px-5 pt-4 pb-6 sm:px-7">{children}</div>}
    </div>
  )
}
