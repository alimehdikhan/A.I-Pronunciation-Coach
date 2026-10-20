import { useSoundName } from '@/lib/soundNames'
import { MagicWandIcon, MountainsIcon, LeafIcon, SpinnerGapIcon, TreeIcon } from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { SectionLabel, Segmented } from '@/components/common'
import { SpeakChip } from '@/components/tutor/SpeakButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import type { Level } from '@/lib/types'
import { usePractice } from '@/store/practice'
import { useSettings } from '@/store/settings'

/** Fresh sentences for a sound, written for your level and (optionally) a topic you care about. */
export function PracticeWriter({ username, phoneme }: { username: string; phoneme: string }) {
  const level = useSettings((s) => s.level)
  const nativeLanguage = useSettings((s) => s.nativeLanguage)
  const soundName = useSoundName()
  const [chosen, setChosen] = useState<Level>(level)
  const [topic, setTopic] = useState('')
  const setTarget = usePractice((s) => s.setTarget)
  const navigate = useNavigate()
  const reduce = useReducedMotion()

  const write = useMutation({
    mutationFn: () =>
      api.coachSentences({ username, phoneme, level: chosen, topic: topic.trim() || undefined, count: 4, native_language: nativeLanguage }),
    meta: { silent: true },
  })

  const result = write.data

  return (
    <section className="surface p-6 sm:p-8">
      <SectionLabel icon={<MagicWandIcon weight="fill" />}>Fresh sentences for {soundName(phoneme).text}</SectionLabel>
      <p className="mb-4 text-[15px] text-muted-foreground">
        Your coach writes new sentences full of this sound, and each one is checked against the dictionary before you see it.
      </p>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Segmented<Level>
          layoutId="writer-level"
          size="sm"
          value={chosen}
          onChange={setChosen}
          options={[
            { value: 'beginner', label: 'Beginner', icon: <LeafIcon weight="bold" /> },
            { value: 'intermediate', label: 'Intermediate', icon: <TreeIcon weight="bold" /> },
            { value: 'advanced', label: 'Advanced', icon: <MountainsIcon weight="bold" /> },
          ]}
        />
        <Input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="Topic (optional), e.g. travel, work, food"
          aria-label="Topic"
          maxLength={40}
          className="h-9 min-w-0 flex-1"
        />
      </div>

      <Button onClick={() => write.mutate()} disabled={write.isPending}>
        {write.isPending ? <SpinnerGapIcon className="animate-spin" /> : <MagicWandIcon weight="bold" />}
        {result ? 'Write new ones' : 'Write sentences'}
      </Button>

      {write.isError && <p className="mt-3 text-[14px] text-bad">Could not write sentences just now. Please try again.</p>}

      <AnimatePresence mode="popLayout">
        {result && (
          <ul className="mt-5 space-y-2.5">
            {result.sentences.map((sentence, index) => (
              <motion.li
                key={sentence.text}
                layout
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: index * 0.06, type: 'spring', stiffness: 340, damping: 28 }}
                className="flex flex-col gap-3 rounded-2xl bg-fill p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] leading-snug">{sentence.text}</p>
                  {!!sentence.target_words.length && (
                    <p className="mt-1 text-xs text-subtle">Listen for: {sentence.target_words.join(', ')}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <SpeakChip text={sentence.text} rate={0.9}>
                    Listen
                  </SpeakChip>
                  <Button
                    size="sm"
                    onClick={() => {
                      setTarget({ text: sentence.text, source: 'custom' })
                      navigate('/practice')
                    }}
                  >
                    Practise
                  </Button>
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </AnimatePresence>
      {result?.source === 'template' && (
        <p className="mt-3 text-xs text-subtle">These come from the built-in sound library: the language model was not reachable.</p>
      )}
    </section>
  )
}
