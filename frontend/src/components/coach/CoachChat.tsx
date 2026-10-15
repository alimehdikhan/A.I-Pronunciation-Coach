import { PaperPlaneTiltIcon, SparkleIcon } from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { SectionLabel } from '@/components/common'
import { SpeakChip } from '@/components/tutor/SpeakButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import type { ChatTurn } from '@/lib/types'
import { cn } from '@/lib/utils'

interface Message extends ChatTurn {
  words?: string[]
  tryNext?: string | null
  offline?: boolean
}

const STARTERS = [
  'Which sound should I fix first?',
  'How do I make the th sound?',
  'Why do I keep saying v instead of w?',
  'Give me a trick for the r sound',
]

/** Ask the coach anything about your pronunciation. Answers are grounded in your own sounds and attempts. */
export function CoachChat({ username }: { username: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const reduce = useReducedMotion()
  const end = useRef<HTMLDivElement>(null)

  const ask = useMutation({
    mutationFn: (text: string) =>
      api.coachChat({
        username,
        message: text,
        history: messages.slice(-6).map(({ role, text: t }) => ({ role, text: t })),
      }),
    meta: { silent: true },
    onSuccess: (reply) =>
      setMessages((m) => [
        ...m,
        { role: 'coach', text: reply.reply, words: reply.words, tryNext: reply.try_next, offline: reply.source === 'template' },
      ]),
    onError: () =>
      setMessages((m) => [...m, { role: 'coach', text: 'I could not reach the coach just now. Please try again in a moment.', offline: true }]),
  })

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' })
  }, [messages.length, ask.isPending, reduce])

  const send = (text: string) => {
    const clean = text.trim()
    if (!clean || ask.isPending) return
    setMessages((m) => [...m, { role: 'learner', text: clean }])
    setDraft('')
    ask.mutate(clean)
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    send(draft)
  }

  return (
    <section className="surface p-6 sm:p-8">
      <SectionLabel icon={<SparkleIcon weight="fill" />}>Ask your coach</SectionLabel>

      {messages.length === 0 ? (
        <div className="mb-4">
          <p className="mb-3 text-[15px] text-muted-foreground">
            Ask about a sound, a word, or what to practise. I answer from your own attempts.
          </p>
          <div className="flex flex-wrap gap-2">
            {STARTERS.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => send(text)}
                className="rounded-full bg-fill px-3.5 py-2 text-[14px] transition-colors hover:bg-fill-strong"
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mb-4 max-h-[420px] space-y-3 overflow-y-auto pr-1" aria-live="polite">
          <AnimatePresence initial={false}>
            {messages.map((message, index) => (
              <motion.div
                key={index}
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className={cn('flex', message.role === 'learner' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[88%] rounded-[22px] px-4 py-3 text-[15px] leading-relaxed',
                    message.role === 'learner' ? 'bg-primary text-primary-foreground' : 'bg-fill',
                  )}
                >
                  <p className="whitespace-pre-wrap">{message.text}</p>
                  {message.tryNext && (
                    <p className="mt-2 rounded-xl bg-background/60 px-3 py-2 text-[14px]">
                      <b>Try now:</b> {message.tryNext}
                    </p>
                  )}
                  {!!message.words?.length && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {message.words.map((word) => (
                        <SpeakChip key={word} text={word} rate={0.8}>
                          {word}
                        </SpeakChip>
                      ))}
                    </div>
                  )}
                  {message.offline && <p className="mt-1.5 text-xs text-subtle">Built-in answer: the language model was not reachable.</p>}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {ask.isPending && (
            <div className="flex" aria-label="The coach is writing">
              <div className="flex gap-1 rounded-[22px] bg-fill px-4 py-3.5">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="size-2 rounded-full bg-muted-foreground"
                    animate={reduce ? undefined : { opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                    transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
              </div>
            </div>
          )}
          <div ref={end} />
        </div>
      )}

      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask your coach…"
          aria-label="Ask your coach"
          maxLength={400}
          className="h-11 flex-1"
        />
        <Button type="submit" size="lg" disabled={!draft.trim() || ask.isPending} aria-label="Send">
          <PaperPlaneTiltIcon weight="fill" />
        </Button>
      </form>
    </section>
  )
}
