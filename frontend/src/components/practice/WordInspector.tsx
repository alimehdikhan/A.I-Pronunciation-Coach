import { usePronunciation } from '@/lib/queries'
import { useSoundName } from '@/lib/soundNames'
import { ArrowRightIcon, BookOpenTextIcon, CheckCircleIcon, MagnifyingGlassIcon, PlayIcon, SpeakerHighIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { Pill, SectionLabel } from '@/components/common'
import { PhonemeGuide } from '@/components/tutor/PhonemeGuide'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { Playback } from '@/hooks/usePlayback'
import { useTutorCard } from '@/lib/queries'
import { useSpeaker } from '@/lib/speech'
import type { AlignmentOp, PhonemeEvidence, WordResult } from '@/lib/types'
import { STATUS_META, TIER_META, cn, wordTier } from '@/lib/utils'
import { usePractice } from '@/store/practice'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'
import { DisputeSounds } from './Dispute'
import { CheckNote, ConfirmedNote, SayItAlone } from './WorthChecking'

function PhonemeAlignment({ ops, evidence }: { ops: AlignmentOp[]; evidence?: PhonemeEvidence[] }) {
  // Acoustic scoring yields one entry per expected sound, in alignment order.
  const scores = evidence && evidence.length === ops.length ? evidence : undefined
  return (
    <div className="flex flex-wrap gap-1.5">
      {ops.map((op, i) => {
        const wrong = op.op !== 'equal'
        const unsure = wrong && op.tier === 'check'
        const slot = scores?.[i]
        const score = slot?.score
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.035 }}
            className={cn(
              'ipa flex min-w-11 flex-col items-center overflow-hidden rounded-xl text-center',
              unsure ? 'border border-dashed border-warn/60 bg-warn-soft' : wrong ? 'bg-bad-soft' : 'bg-fill',
            )}
            title={unsure ? TIER_META.check.hint : wrong ? TIER_META.fix.hint : undefined}
          >
            <span className={cn('w-full px-2 pt-1.5 pb-1 text-[19px] leading-none', op.op === 'insert' && 'text-subtle')}>
              {op.expected || '∅'}
            </span>
            <span
              className={cn(
                'w-full px-2 pt-1 pb-1.5 text-[13px] leading-none',
                op.op === 'equal'
                  ? 'text-subtle'
                  : unsure
                    ? cn('text-warn', op.op === 'delete' ? 'line-through' : 'font-semibold')
                    : op.op === 'delete'
                      ? 'text-bad line-through'
                      : 'font-semibold text-bad',
              )}
            >
              {op.op === 'delete' ? op.expected : op.actual || '∅'}
            </span>
            {score != null && (
              <span
                className={cn(
                  'w-full border-t border-border/60 px-2 py-1 text-[11px] leading-none font-medium tabular-nums',
                  slot?.flagged ? (slot.tier === 'check' ? 'text-warn' : 'text-bad') : score < 90 ? 'text-warn' : 'text-good',
                )}
              >
                {Math.round(score)}%
              </span>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}

function Syllables({ word }: { word: WordResult }) {
  if (word.syllables.length < 2) return null
  const heard = word.stress?.heard
  return (
    <div>
      <div className="flex items-start gap-1">
        {word.syllables.map((s, i) => (
          <span key={i} className="flex flex-col items-center gap-1">
            <span
              className={cn(
                'ipa rounded-lg px-2 py-1 text-[15px]',
                s.stress === 1 ? 'bg-primary text-primary-foreground' : s.stress === 2 ? 'bg-primary-soft text-primary' : 'bg-fill text-muted-foreground',
              )}
            >
              {s.phonemes.join('')}
            </span>
            {heard === i && (
              <span className={cn('text-[11px] font-medium', word.stress?.error ? 'text-warn' : 'text-subtle')}>you stressed</span>
            )}
          </span>
        ))}
      </div>
      {word.stress && (
        <p className="mt-2 text-[12px] text-subtle">
          Experimental: which syllable sounded stressed comes from length, loudness and pitch, and often disagrees with expert
          listeners.
        </p>
      )}
    </div>
  )
}

function Tutor({ word, op }: { word: string; op: AlignmentOp }) {
  const soundName = useSoundName()
  const { data, isLoading } = useTutorCard(word, op.expected, op.op === 'delete' ? '' : op.actual)
  const openPhoneme = useUI((s) => s.openPhoneme)
  if (isLoading) return <Skeleton className="mt-6 h-48 w-full rounded-2xl" />
  if (!data) return null
  return (
    <div className="mt-6 border-t border-border pt-6">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[15px] font-semibold">
          Fix the <span className="text-primary">{soundName(op.expected).spelled}</span> sound
          <span className="ml-2 font-normal text-muted-foreground">{data.phoneme.label}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => openPhoneme(op.expected)}>
          <BookOpenTextIcon weight="bold" /> Full guide
        </Button>
      </div>
      <PhonemeGuide phoneme={data.phoneme} tip={data.tutor_data.why_wrong} compact />
    </div>
  )
}

/** How to say the target word in plain letters ("thingk"), with the symbols as a fallback. */
function TargetLine({ word, ipa }: { word: string; ipa?: string | null }) {
  const { data } = usePronunciation(word)
  const plain = data?.words[0]?.respelling
  if (!plain && !ipa) return null
  return (
    <span className="text-muted-foreground">
      Say it like <span className={plain ? 'font-medium text-foreground' : 'ipa text-foreground'}>{plain ?? `/${ipa}/`}</span>
    </span>
  )
}

export function WordInspector({
  word,
  playback,
  recordId,
}: {
  word: WordResult | null
  playback: Playback
  /** The saved attempt, so a word checked alone can update its history. */
  recordId?: number | null
}) {
  const { speak } = useSpeaker()
  const goal = useSettings((s) => s.goal)
  const setTarget = usePractice((s) => s.setTarget)

  if (!word) {
    return (
      <div className="surface results-item grid place-items-center p-8 text-center text-[15px] text-muted-foreground">
        Select a word to inspect it.
      </div>
    )
  }

  const tier = wordTier(word)
  const meta =
    word.confirmed === 'fine'
      ? { label: 'Sounded fine', soft: STATUS_META.correct.soft, text: STATUS_META.correct.text }
      : tier
        ? { label: TIER_META[tier].label, soft: TIER_META[tier].soft, text: TIER_META[tier].text }
        : STATUS_META[word.status]
  // Only a slip the coach is sure about (or one confirmed by saying the word alone) gets the "Fix the sound" tutor.
  const firstError =
    word.confirmed === 'fine'
      ? undefined
      : word.alignment.find((op) => (op.op === 'replace' || op.op === 'delete') && (op.tier !== 'check' || word.confirmed === 'slip'))
  const target = word.reference ?? word.spoken ?? ''
  const hasTiming = word.start != null && word.end != null

  return (
    <div className="surface results-item p-6 sm:p-8">
      <SectionLabel icon={<MagnifyingGlassIcon weight="fill" />}>Word inspector</SectionLabel>
      <AnimatePresence mode="wait">
        <motion.div
          key={word.index}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.22 }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h3 className="headline text-[40px]">{word.display}</h3>
                <Pill className={cn(meta.soft, meta.text, tier === 'check' && 'border border-dashed border-warn/50')}>{meta.label}</Pill>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px]">
                <TargetLine word={word.display} ipa={word.expected_ipa} />
                {word.status === 'mispronounced' && word.spoken && (
                  <span className="text-muted-foreground">
                    Heard{' '}
                    <span className={tier === 'check' ? 'text-warn' : 'text-bad'}>{word.spoken ? `“${word.spoken}”` : word.spoken_ipa ? `/${word.spoken_ipa}/` : ''}</span>
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="headline text-[34px] tabular-nums">{word.score != null ? Math.round(word.score) : '—'}</div>
              {word.confidence != null && <div className="text-xs text-subtle">{Math.round(word.confidence * 100)}% clarity</div>}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => speak(target, { rate: 0.75, key: 'inspect' })}>
              <SpeakerHighIcon weight="fill" /> Hear it
            </Button>
            {hasTiming && (
              <Button variant="secondary" size="sm" onClick={() => playback.playSegment(word.start!, word.end!)}>
                <PlayIcon weight="fill" /> Your take
              </Button>
            )}
            {word.reference && (
              <Button variant="ghost" size="sm" onClick={() => setTarget({ text: word.display, source: 'word' })}>
                Practise this word <ArrowRightIcon weight="bold" />
              </Button>
            )}
          </div>

          {word.alignment.length > 0 && (word.status === 'mispronounced' || word.acoustic) && (
            <div className="mt-6">
              <div className="mb-2.5 text-[13px] font-medium text-muted-foreground">
                Sound by sound · target over what we heard
                {word.acoustic && ' · % = chance an expert would rate the sound clean'}
              </div>
              <PhonemeAlignment ops={word.alignment} evidence={word.phonemes} />
            </div>
          )}

          {word.syllables.length > 1 && (
            <div className="mt-6">
              <div className="mb-2.5 text-[13px] font-medium text-muted-foreground">Syllables · stress in blue</div>
              <Syllables word={word} />
            </div>
          )}

          {word.misheard && word.reference && (
            <p className="mt-6 rounded-2xl bg-extra-soft p-4 text-[15px] leading-relaxed">
              <b>A listener might not catch this word.</b>{' '}
              {word.heard_as ? (
                <>
                  Heard cold, it came across as <b>“{word.heard_as}”</b>.
                </>
              ) : (
                <>Heard cold, it didn’t come through at all.</>
              )}{' '}
              <span className="text-muted-foreground">(machine estimate)</span>
            </p>
          )}

          {tier === 'fix' && word.changes_word && (
            <p className="mt-6 rounded-2xl bg-bad-soft p-4 text-[15px] leading-relaxed">
              Said this way, it sounds like <b>“{word.changes_word}”</b>, a different word, so a listener may get the wrong
              meaning.
            </p>
          )}
          {tier === 'fix' && word.affects_understanding === false && goal === 'understood' && (
            <p className="mt-6 rounded-2xl bg-fill p-4 text-[15px] leading-relaxed">
              <b>Won’t confuse a listener.</b> The sound differs a little from the standard one, but the word still comes across.
              Your goal is to be understood, so this one can wait.
            </p>
          )}

          {tier === 'check' && <CheckNote word={word} action={<SayItAlone word={word} recordId={recordId} hotkey />} />}
          {word.confirmed && <ConfirmedNote word={word} />}

          {word.status === 'correct' && (
            <div className="mt-6 flex items-center gap-3 rounded-2xl bg-good-soft p-4 text-[15px]">
              <CheckCircleIcon size={22} weight="fill" className="shrink-0 text-good" />
              Nicely done — every sound landed.
            </div>
          )}
          {word.status === 'unclear' && (
            <p className="mt-6 rounded-2xl bg-warn-soft p-4 text-[15px] leading-relaxed">
              {word.spoken && word.reference && word.spoken.toLowerCase() !== word.reference.toLowerCase() ? (
                <>
                  The sounds looked close, but this came across as <b>“{word.spoken}”</b>. Slow down and give each sound its full
                  length.
                </>
              ) : (
                <>
                  We recognised this word, but not confidently. Slow down, open your mouth a little more and give each sound its
                  full length.
                </>
              )}
            </p>
          )}
          {word.status === 'missing' && (
            <p className="mt-6 rounded-2xl bg-fill p-4 text-[15px] leading-relaxed">
              This word was skipped. Small words like this often get swallowed — tap <b>Hear it</b> and include it next time.
            </p>
          )}
          {word.status === 'extra' && (
            <p className="mt-6 rounded-2xl bg-extra-soft p-4 text-[15px] leading-relaxed">
              This word isn’t in the phrase. Fillers and repeats lower your fluency score.
            </p>
          )}

          {firstError && word.reference && <Tutor word={word.reference} op={firstError} />}

          {word.confirmed !== 'fine' && <DisputeSounds word={word} recordId={recordId} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
